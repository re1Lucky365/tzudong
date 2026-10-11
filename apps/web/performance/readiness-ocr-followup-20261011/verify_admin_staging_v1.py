"""PG17 durable staging, shared-reference completion, late-writer fence and rollback."""
from pathlib import Path
import importlib.util
import json
import hashlib
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
spec = importlib.util.spec_from_file_location('owned_fixture', HERE.parent / 'readiness-delivery-20261011/verify_admin_media_forward_v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
SOURCE = ROOT / 'backend/supabase/migrations/20261011103501_admin_verification_durable_staging.sql'
TEMPLATE = 'readiness_admin_forward_v5_20261011'


def main():
    output = HERE / 'admin-staging-pg17-v1.json'
    if output.exists():
        raise ValueError('OUTPUT_EXISTS')
    inspected = json.loads(subprocess.check_output(['docker', '--context', m.CONTEXT, 'inspect', m.CONTAINER]))[0]
    if inspected['HostConfig']['NetworkMode'] != 'none' or inspected['NetworkSettings']['Ports']:
        raise ValueError('ISOLATION_DENIED')
    if m.run(TEMPLATE, "SELECT current_setting('server_version');") != '17.6' or m.run(TEMPLATE, 'SELECT (SELECT count(*) FROM auth.users)+(SELECT count(*) FROM public.reviews);') != '0':
        raise ValueError('TEMPLATE_DENIED')
    before, after, rollback = ('readiness_staging_before_v3_20261011', 'readiness_staging_after_v3_20261011', 'readiness_staging_rollback_v3_20261011')
    for db in (before, after, rollback):
        m.fresh(db, TEMPLATE)
        m.run(db, 'INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton) VALUES(true);')
        for filename in ('20261011085342_review_legacy_shared_cleanup.sql', '20261011094346_admin_evaluation_revision_safeupdate.sql', '20261011100730_admin_record_expired_preview_readback.sql'):
            m.run(db, (ROOT / 'backend/supabase/migrations' / filename).read_text(), 'postgres')
    fp = json.loads(m.run(rollback, m.FP))
    m.run(rollback, SOURCE.read_text().rsplit('COMMIT;', 1)[0] + 'ROLLBACK;', 'postgres')
    if json.loads(m.run(rollback, m.FP)) != fp:
        raise ValueError('ROLLBACK_DRIFT')
    m.run(after, SOURCE.read_text(), 'postgres')
    probe = (HERE / 'shared-reference-probe-v1.sql').read_text().replace('__EXPECTED_READY__', '1')
    shared_before = json.loads(m.run(before, "LOAD 'safeupdate';\n" + probe.replace('__EXPECTED_REMAINING__', '1')).splitlines()[-1])
    shared_after = json.loads(m.run(after, "LOAD 'safeupdate';\n" + probe.replace('__EXPECTED_REMAINING__', '0')).splitlines()[-1])
    m.fixture(after)
    staged = f'{m.OWNER}/reviews/{m.REVIEW}/verification/ocr-99999999-9999-4999-8999-999999999999.jpg'
    sql = f"""LOAD 'safeupdate'; SET ROLE service_role;
DO $probe$ DECLARE p jsonb; BEGIN
 p:=public.admin_review_verification_cleanup('{m.REVIEW}','stage',ARRAY['{staged}']);
 IF p<> '{{"status":"STAGED"}}'::jsonb THEN RAISE EXCEPTION 'STAGE_NOT_DURABLE'; END IF;
 p:=public.admin_review_verification_cleanup('{m.REVIEW}','stage',ARRAY['{staged}']);
 IF p<> '{{"status":"STAGED"}}'::jsonb THEN RAISE EXCEPTION 'STAGE_NOT_IDEMPOTENT'; END IF;
 BEGIN
  PERFORM public.admin_review_verification_cleanup('{m.REVIEW}','stage',ARRAY['{m.OWNER}/reviews/{m.REVIEW}/food/foreign.webp']);
  RAISE EXCEPTION 'WRONG_PURPOSE_STAGED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'REVIEW_ADMIN_CLEANUP_INVALID' THEN RAISE; END IF;
 END;
END $probe$;
RESET ROLE;
DO $probe$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM review_media_private.cleanup WHERE path='{staged}' AND NOT retired AND NOT complete)
  THEN RAISE EXCEPTION 'STAGE_LOST_BEFORE_UPLOAD'; END IF;
END $probe$;
SET ROLE authenticated; SET request.jwt.claim.sub='{m.OWNER}';
SET request.jwt.claims='{{"sub":"{m.OWNER}","role":"authenticated"}}';
INSERT INTO storage.objects(bucket_id,name) VALUES('review-verifications','{staged}');
RESET ROLE; SET ROLE service_role;
DO $probe$ DECLARE p jsonb;BEGIN
 p:=public.admin_review_verification_cleanup('{m.REVIEW}','prepare');
 IF jsonb_array_length(p->'items')<>1 THEN RAISE EXCEPTION 'LOST_UPLOAD_KEY_NOT_DISCOVERED'; END IF;
 IF public.admin_review_verification_cleanup('{m.REVIEW}','finish',ARRAY['{staged}'])->>'remaining'<>'1'
  THEN RAISE EXCEPTION 'PRESENT_UPLOAD_FINISHED'; END IF;
END $probe$;
RESET ROLE; SET storage.allow_delete_query='true';
DELETE FROM storage.objects WHERE bucket_id='review-verifications' AND name='{staged}';
SET ROLE service_role;
DO $probe$ BEGIN
 IF public.admin_review_verification_cleanup('{m.REVIEW}','finish',ARRAY['{staged}'])->>'remaining'<>'0'
  THEN RAISE EXCEPTION 'ABSENT_UPLOAD_NOT_FINISHED'; END IF;
 BEGIN
  PERFORM public.admin_review_verification_cleanup('{m.REVIEW}','stage',ARRAY['{staged}']);
  RAISE EXCEPTION 'RETIRED_KEY_RESTAGED';
 EXCEPTION WHEN raise_exception THEN
  IF SQLERRM<>'REVIEW_ADMIN_UPLOAD_RETIRED' THEN RAISE; END IF;
 END;
END $probe$;
RESET ROLE; SET ROLE authenticated;
DO $probe$ BEGIN
 IF public.review_media_upload_allowed('review-verifications','{staged}') THEN RAISE EXCEPTION 'LATE_UPLOAD_ALLOWED'; END IF;
 BEGIN
  INSERT INTO storage.objects(bucket_id,name) VALUES('review-verifications','{staged}');
  RAISE EXCEPTION 'LATE_STORAGE_COMMITTED';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $probe$;
RESET ROLE;
SELECT jsonb_build_object('durableStageBeforeTransport',true,'idempotentStage',true,'unreferencedLostUploadDiscovered',true,
 'survivingPrivateObjectKeptPending',true,'absentObjectFinished',true,'retiredKeyCannotRestage',true,'lateUploadDenied',true,
 'anonDenied',NOT has_function_privilege('anon','public.admin_review_verification_cleanup(uuid,text,text[])','EXECUTE'),
 'authenticatedDenied',NOT has_function_privilege('authenticated','public.admin_review_verification_cleanup(uuid,text,text[])','EXECUTE'));
"""
    runtime = json.loads(m.run(after, sql).splitlines()[-1])
    if not all(runtime.values()) or shared_before['referencedRemaining'] != 1 or shared_after['referencedRemaining'] != 0 or not shared_after['firstReferenceProtected']:
        raise ValueError('STAGING_OR_REFERENCE_GUARD_FAILED')
    result = {'engine': '17.6', 'network': 'none', 'ports': 'none', 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
              'probeSha256': hashlib.sha256((HERE / 'shared-reference-probe-v1.sql').read_bytes()).hexdigest(),
              'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'rollbackExact': True,
              'rollbackFingerprint': fp, 'sharedBaseline': shared_before, 'sharedCandidate': shared_after,
              'runtime': runtime, 'safeupdateEnabled': True, 'fixtureGuardSuspendedOnlyForHistoricalSeed': True,
              'operatingDDL': 0, 'synthetic': True, 'storageHTTPOrActualOCRProviderTested': False}
    output.write_text(json.dumps(result, indent=2) + '\n'); print(json.dumps({'status': 'passed', 'checks': len(runtime), 'sharedRemaining': '1→0', 'rollbackExact': True}))


if __name__ == '__main__':
    main()
