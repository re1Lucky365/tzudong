"""Exact PG17 rollback, authenticated RLS and real Storage/retirement contention.

Storage metadata is synthetic. No bytes, user credentials, HTTP upload or OCR
provider are contacted. Every target is a fresh owned DB with network/ports none.
"""
from pathlib import Path
import importlib.util
import hashlib
import json
import re
import selectors
import subprocess
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
spec = importlib.util.spec_from_file_location('owned_fixture', HERE.parent/'readiness-delivery-20261011/verify_admin_media_forward_v1.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
SOURCES = [ROOT/'backend/supabase/migrations'/name for name in (
 '20261011103501_admin_verification_durable_staging.sql',
 '20261011105114_review_media_storage_retirement_fence.sql',
 '20261011110108_review_storage_caller_bound_admin_policy.sql')]
TEMPLATE = 'readiness_admin_forward_v5_20261011'
FP = m.FP.replace("'data',jsonb_build_array", "'triggers',md5((SELECT jsonb_agg(to_jsonb(t) ORDER BY oid)::text FROM pg_trigger t)),\n'schemas',md5((SELECT jsonb_agg(to_jsonb(n) ORDER BY oid)::text FROM pg_namespace n WHERE nspname NOT LIKE 'pg_temp_%' AND nspname NOT LIKE 'pg_toast_temp_%')),\n'storageRelations',md5((SELECT jsonb_agg(to_jsonb(c) ORDER BY oid)::text FROM pg_class c WHERE relnamespace='storage'::regnamespace)),\n'data',jsonb_build_array")


def ready(p, marker):
    with selectors.DefaultSelector() as reader:
        reader.register(p.stdout, selectors.EVENT_READ)
        if not reader.select(5) or p.stdout.readline().strip()!=marker:
            raise RuntimeError('SYNC_MARKER_MISSING')


def waiting(db, name):
    for _ in range(100):
        if m.run(db,f"SELECT coalesce(wait_event,'') FROM pg_stat_activity WHERE application_name='{name}';")=='advisory':
            return
        time.sleep(.02)
    raise RuntimeError('ACTUAL_ADVISORY_WAIT_NOT_OBSERVED')


def finish(p):
    p.stdin.close();p.stdin=None
    out,err=p.communicate(timeout=12)
    return {'exit':p.returncode,'states':re.findall(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5})',err),'committed':'COMMITTED' in out}


def race(db, tag, retirement_first):
    key=f'{m.OWNER}/reviews/{m.REVIEW}/verification/race-{tag}.jpg'
    m.run(db,f"SET ROLE service_role; SELECT public.admin_review_verification_cleanup('{m.REVIEW}','stage',ARRAY['{key}']);")
    holder=waiter=None
    try:
        if retirement_first:
            holder=m.background(db,'fence_holder',f"BEGIN; SET LOCAL ROLE service_role; SELECT public.admin_review_verification_cleanup('{m.REVIEW}','prepare'); SELECT 'HOLDER_READY';\n")
            # Drain its fixed JSON result, then its lock-acquisition marker.
            with selectors.DefaultSelector() as r:
                r.register(holder.stdout,selectors.EVENT_READ)
                if not r.select(5):raise RuntimeError('HOLDER_NOT_READY')
                json.loads(holder.stdout.readline());assert holder.stdout.readline().strip()=='HOLDER_READY'
            waiter=m.background(db,'fence_waiter',f"INSERT INTO storage.objects(bucket_id,name) VALUES('review-verifications','{key}'); SELECT 'COMMITTED';\n")
        else:
            holder=m.background(db,'fence_holder',f"BEGIN; INSERT INTO storage.objects(bucket_id,name) VALUES('review-verifications','{key}'); SELECT 'HOLDER_READY';\n")
            ready(holder,'HOLDER_READY')
            waiter=m.background(db,'fence_waiter',f"SET ROLE service_role; SELECT public.admin_review_verification_cleanup('{m.REVIEW}','prepare'); SELECT 'COMMITTED';\n")
        waiting(db,'fence_waiter')
        holder.stdin.write("COMMIT; SELECT 'COMMITTED';\n");holder.stdin.flush()
        h=finish(holder); w=finish(waiter)
        if h['exit'] or '40P01' in w['states'] or (retirement_first and w['states']!=['23514']) or (not retirement_first and w['exit']):
            raise RuntimeError('RACE_FENCE_NOT_PROVEN')
        count=int(m.run(db,f"SELECT count(*) FROM storage.objects WHERE bucket_id='review-verifications' AND name='{key}';"))
        if count != (0 if retirement_first else 1):raise RuntimeError('RACE_METADATA_DRIFT')
        return {'retirementFirst':retirement_first,'connections':2,'observedWait':'advisory','holder':h,'waiter':w,'objectCount':count,'deadlock':False}
    finally:
        for p in (holder,waiter):
            if p and p.poll() is None:p.terminate();p.communicate(timeout=5)


def main():
    output=HERE/'storage-fence-pg17-v2.json'
    if output.exists():raise ValueError('OUTPUT_EXISTS')
    config=json.loads(subprocess.check_output(['docker','--context',m.CONTEXT,'inspect',m.CONTAINER]))[0]
    if config['HostConfig']['NetworkMode']!='none' or config['NetworkSettings']['Ports']:raise ValueError('ISOLATION_DENIED')
    if m.run(TEMPLATE,"SELECT current_setting('server_version');")!='17.6' or m.run(TEMPLATE,'SELECT (SELECT count(*) FROM auth.users)+(SELECT count(*) FROM public.reviews);')!='0':raise ValueError('TEMPLATE_DENIED')
    before,after,rollback=('readiness_storage_before_v2_20261011','readiness_storage_after_v2_20261011','readiness_storage_rollback_v2_20261011')
    for db in (before,after,rollback):
        m.fresh(db,TEMPLATE)
        m.run(db,'INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton) VALUES(true);')
        for filename in ('20261011085342_review_legacy_shared_cleanup.sql','20261011094346_admin_evaluation_revision_safeupdate.sql','20261011100730_admin_record_expired_preview_readback.sql'):
            m.run(db,(ROOT/'backend/supabase/migrations'/filename).read_text(),'postgres')
    fp=json.loads(m.run(rollback,FP))
    # Apply all three source units inside one outer transaction, then roll back.
    body='BEGIN;\n'+''.join(p.read_text().replace('BEGIN;', '',1).rsplit('COMMIT;',1)[0] for p in SOURCES)+'ROLLBACK;\n'
    m.run(rollback,body,'postgres')
    if json.loads(m.run(rollback,FP))!=fp:raise RuntimeError('EXACT_ROLLBACK_DRIFT')
    for p in SOURCES:m.run(after,p.read_text(),'postgres')
    post=json.loads(m.run(after,FP))
    for key in ('members','manifest','schemas','defaultACL'):
        if post[key]!=fp[key]:raise RuntimeError('BOUNDARY_PRESERVATION_DRIFT')
    m.fixture(before);m.fixture(after)
    key=f'{m.OWNER}/reviews/{m.REVIEW}/verification/owner-upload.jpg'
    owner_claims=f"SET ROLE authenticated; SET request.jwt.claim.sub='{m.OWNER}'; SET request.jwt.claims='{{\"sub\":\"{m.OWNER}\",\"role\":\"authenticated\"}}';"
    # Baseline failure is SQLSTATE, never an unredacted database diagnostic.
    try:m.run(before,owner_claims+f"INSERT INTO storage.objects(bucket_id,name) VALUES('review-verifications','{key}');")
    except RuntimeError as e:
        baseline=str(e)
        if baseline!='ISOLATED_SQL_FAILED:42501':raise
    else:raise RuntimeError('BASELINE_UPLOAD_FAILURE_NOT_REPRODUCED')
    sql=f"""BEGIN; LOAD 'safeupdate';
DELETE FROM public.user_roles WHERE user_id='{m.OWNER}';
{owner_claims}
INSERT INTO storage.objects(bucket_id,name) VALUES('review-verifications','{key}');
INSERT INTO storage.objects(bucket_id,name) VALUES('review-photos','{m.OWNER}/reviews/{m.REVIEW}/food/new.jpg');
DO $probe$ BEGIN
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('review-verifications','99999999-9999-4999-8999-999999999999/reviews/{m.REVIEW}/verification/foreign.jpg');
  RAISE EXCEPTION 'FOREIGN_UPLOAD_COMMITTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('ad-banner-images','blocked.jpg');
  RAISE EXCEPTION 'NONADMIN_BANNER_COMMITTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 IF (SELECT count(*) FROM storage.objects WHERE bucket_id='review-verifications' AND name='{key}')<>1 THEN RAISE EXCEPTION 'OWNER_PRIVATE_READ_FAILED'; END IF;
END $probe$;
RESET ROLE; SET ROLE anon;
DO $probe$ BEGIN
 IF EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='review-verifications') THEN RAISE EXCEPTION 'ANON_PRIVATE_VISIBLE'; END IF;
 IF NOT EXISTS(SELECT 1 FROM storage.objects WHERE bucket_id='review-photos' AND name='{m.FOOD}') THEN RAISE EXCEPTION 'PUBLIC_FOOD_HIDDEN'; END IF;
END $probe$;
RESET ROLE;
INSERT INTO public.user_roles(user_id,role) VALUES('{m.OWNER}','admin');
{owner_claims}
INSERT INTO storage.objects(bucket_id,name) VALUES('ad-banner-images','legacy-admin-banner.jpg');
RESET ROLE;
UPDATE public.user_account_status SET account_status='disabled',disabled_at=now() WHERE user_id='{m.OWNER}';
{owner_claims}
DO $probe$ BEGIN
 BEGIN INSERT INTO storage.objects(bucket_id,name) VALUES('ad-banner-images','disabled-admin-banner.jpg');
  RAISE EXCEPTION 'DISABLED_ADMIN_COMMITTED'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $probe$;
RESET ROLE;
ROLLBACK;
"""
    m.run(after,sql)
    # Both supported legacy policies are absent in a fresh canonical replay.
    absent='readiness_storage_absent_v2_20261011';m.fresh(absent,after)
    m.run(absent,'DROP POLICY "Admin upload access" ON storage.objects; DROP POLICY "Admin delete access" ON storage.objects;')
    absent_before=json.loads(m.run(absent,FP));m.run(absent,SOURCES[2].read_text(),'postgres')
    if json.loads(m.run(absent,FP))!=absent_before:raise RuntimeError('ABSENT_BRANCH_MUTATED')
    races=[race(after,'upload-first',False),race(after,'retire-first',True)]
    rekey=f'{m.OWNER}/reviews/{m.REVIEW}/verification/rekey.jpg'
    retired=f'{m.OWNER}/reviews/{m.REVIEW}/verification/race-retire-first.jpg'
    m.run(after,f"""BEGIN; LOAD 'safeupdate';
INSERT INTO storage.objects(bucket_id,name) VALUES('review-verifications','{rekey}');
DO $probe$ BEGIN
 BEGIN UPDATE storage.objects SET name='{retired}' WHERE bucket_id='review-verifications' AND name='{rekey}';
 RAISE EXCEPTION 'REKEY_COMMITTED'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'REVIEW_MEDIA_RETIRED' THEN RAISE; END IF; END;
END $probe$;
INSERT INTO storage.buckets(id,name,public) VALUES('non-review-fixture','non-review-fixture',false);
INSERT INTO storage.objects(bucket_id,name) VALUES('non-review-fixture','{retired}');
UPDATE storage.objects SET metadata='{{\"test\":true}}'::jsonb WHERE bucket_id='non-review-fixture' AND name='{retired}';
ROLLBACK;""")
    result={'status':'passed','engine':'17.6','network':'none','ports':'none','sourceSha256':{str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in SOURCES},
      'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'rollbackExactIncludingStorageTriggers':True,'rollbackFingerprint':fp,
      'baselineAuthenticatedUpload':{'success':False,'sqlstate':'42501'},'candidateAuthenticatedUpload':{'success':True,'nonAdminOwner':True},
      'foreignUploadDenied':True,'privateAnonymousReadDenied':True,'publicFoodPreserved':True,'nonAdminBannerDenied':True,'disabledAdminBannerDenied':True,
      'activeAdminBannerPreserved':True,'absentLegacyPolicyBranchExact':True,'storageRekeyRetiredDenied':True,'nonReviewMetadataPreserved':True,'races':races,
      'synthetic':True,'storageHTTPOrActualOCRProviderTested':False,'operatingDDL':0}
    output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({'status':'passed','rollbackExact':True,'races':len(races),'ownerUpload':'42501→success'}))


if __name__=='__main__':main()
