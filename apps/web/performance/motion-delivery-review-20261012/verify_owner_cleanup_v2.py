"""Exact isolated PG17 owner cleanup completion, permission and rollback check."""
from pathlib import Path
import hashlib
import importlib.util
import json
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
spec = importlib.util.spec_from_file_location('fixture', ROOT / 'apps/web/performance/readiness-delivery-20261011/verify_admin_media_forward_v1.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SOURCE = ROOT / 'backend/supabase/migrations/20261011175912_review_owner_cleanup_completion.sql'
TEMPLATE = 'readiness_admin_forward_v5_20261011'


def require(condition, message):
    if not condition:
        raise ValueError(message)


def main():
    output = HERE / 'owner-cleanup-pg17-v2.json'
    require(not output.exists(), 'OUTPUT_EXISTS')
    inspected = json.loads(subprocess.check_output(['docker', '--context', m.CONTEXT, 'inspect', m.CONTAINER]))[0]
    require(inspected['HostConfig']['NetworkMode'] == 'none' and not inspected['NetworkSettings']['Ports'], 'ISOLATION_DENIED')
    require(m.run(TEMPLATE, "SELECT current_setting('server_version');") == '17.6', 'ENGINE_DENIED')
    require(m.run(TEMPLATE, 'SELECT (SELECT count(*) FROM auth.users)+(SELECT count(*) FROM public.reviews);') == '0', 'TEMPLATE_DENIED')
    dbs = ['motion_cleanup_before_v2_20261012', 'motion_cleanup_after_v2_20261012', 'motion_cleanup_rollback_v2_20261012']
    for db in dbs:
        m.fresh(db, TEMPLATE)
        m.run(db, 'INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton) VALUES(true);')
        for name in ('20261011085342_review_legacy_shared_cleanup.sql', '20261011094346_admin_evaluation_revision_safeupdate.sql',
                     '20261011100730_admin_record_expired_preview_readback.sql', '20261011103501_admin_verification_durable_staging.sql',
                     '20261011105114_review_media_storage_retirement_fence.sql', '20261011110108_review_storage_caller_bound_admin_policy.sql'):
            path = ROOT / 'backend/supabase/migrations' / name
            # Discovering a renamed source is forbidden; exact reviewed chain only.
            require(path.is_file(), 'SOURCE_CHAIN_MISSING:' + name)
            m.run(db, path.read_text(), 'postgres')
    before, after, rollback = dbs
    fp = json.loads(m.run(rollback, m.FP))
    m.run(rollback, SOURCE.read_text().rsplit('COMMIT;', 1)[0] + 'ROLLBACK;', 'postgres')
    require(json.loads(m.run(rollback, m.FP)) == fp, 'ROLLBACK_DRIFT')
    m.run(after, SOURCE.read_text(), 'postgres')
    key = f'{m.OWNER}/reviews/{m.REVIEW}/verification/ocr-99999999-9999-4999-8999-999999999999.jpg'
    results = []
    for db in (before, after):
        m.fixture(db)
        m.run(db, f"""LOAD 'safeupdate'; SET ROLE service_role;
SELECT public.admin_review_verification_cleanup('{m.REVIEW}','stage',ARRAY['{key}']);
RESET ROLE;
INSERT INTO storage.objects(bucket_id,name) VALUES('review-verifications','{key}');
UPDATE public.reviews SET verification_photo='{key}' WHERE id='{m.REVIEW}';
SET storage.allow_delete_query='true';
DELETE FROM storage.objects WHERE bucket_id='review-verifications' AND name='{m.VERIFY}';
""")
        auth = f"""SET ROLE authenticated; SET request.jwt.claim.sub='{m.OWNER}';
SET request.jwt.claims='{{"sub":"{m.OWNER}","role":"authenticated"}}';
SELECT public.finish_review_media_cleanup();"""
        remaining = int(m.run(db, auth))
        observed = json.loads(m.run(db, f"SELECT jsonb_build_object('remaining',{remaining},'liveRowRetained',EXISTS(SELECT 1 FROM review_media_private.cleanup WHERE path='{key}' AND NOT retired AND NOT complete),'liveObjectRetained',EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='review-verifications' AND name='{key}'),'oldRowCompleted',EXISTS(SELECT 1 FROM review_media_private.cleanup WHERE path='{m.VERIFY}' AND retired AND complete));"))
        require(observed['liveRowRetained'] and observed['liveObjectRetained'] and observed['oldRowCompleted'], 'LIVE_OBJECT_OR_CLEANUP_DRIFT')
        results.append(observed)
    require([r['remaining'] for r in results] == [1, 0], 'OWNER_PENDING_RESULT_DRIFT')
    # Retired referenced keys remain live; actual unreferenced work still blocks.
    abandoned = f'{m.OWNER}/reviews/{m.REVIEW}/food/abandoned.webp'
    m.run(after, f"""INSERT INTO storage.objects(bucket_id,name) VALUES('review-photos','{abandoned}');
INSERT INTO review_media_private.cleanup(path,owner_id,review_id,purpose,retired)
VALUES('{abandoned}','{m.OWNER}','{m.REVIEW}','food',true);
""")
    require(int(m.run(after, auth)) == 1, 'ACTUAL_CLEANUP_HIDDEN')
    m.run(after, f"SET storage.allow_delete_query='true'; DELETE FROM storage.objects WHERE bucket_id='review-photos' AND name='{abandoned}';")
    require(int(m.run(after, auth)) == 0, 'ACTUAL_CLEANUP_NOT_COMPLETED')
    permissions = json.loads(m.run(after, "SELECT jsonb_build_object('anonymousDenied',NOT has_function_privilege('anon','public.finish_review_media_cleanup()','EXECUTE'),'serviceDenied',NOT has_function_privilege('service_role','public.finish_review_media_cleanup()','EXECUTE'),'ownerAdmitted',has_function_privilege('authenticated','public.finish_review_media_cleanup()','EXECUTE'));"))
    require(all(permissions.values()), 'PERMISSION_DRIFT')
    result = {'status': 'passed', 'engine': '17.6', 'sourceSha256': hashlib.sha256(SOURCE.read_bytes()).hexdigest(),
              'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), 'observations': results,
              'realRetiredWorkStillPending': True, 'retiredMissingObjectCompletes': True, 'permissions': permissions,
              'rollbackExact': True, 'operatingDDL': 0, 'performanceAdmission': 0}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
