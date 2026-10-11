"""Private PG15 ACL semantics only; not canonical replay or Storage behavior."""
from pathlib import Path
import hashlib
import importlib.util
import json
import re
import subprocess

ROOT=Path(__file__).resolve().parents[4]
HERE=Path(__file__).resolve().parent
CONTEXT='colima-tzudong-catalog-20261007'
CONTAINER='tzudong-storage-pg15-lease-20261012'
p=ROOT/'backend/supabase/scripts/transform_review_storage_pg15_replay.py'
s=importlib.util.spec_from_file_location('t',p);t=importlib.util.module_from_spec(s);s.loader.exec_module(t)
PREFIX=['docker','--context',CONTEXT,'exec','-i','-e','PGPASSWORD=fixture-only',CONTAINER,'psql','-XAtq','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate','-h','127.0.0.1']


def run(sql,actor='postgres'):
    result=subprocess.run(PREFIX+['-U',actor,'-d','storage_acl_v2_20261012'],input=sql,capture_output=True,text=True,timeout=20)
    return {'exit':result.returncode,'states':re.findall(r'ERROR:\s+([0-9A-Z]{5})',result.stderr),'out':result.stdout.strip()}


def ok(sql,actor='postgres'):
    result=run(sql,actor)
    if result['exit']:raise ValueError('FIXTURE_SQL_FAILED:'+','.join(result['states']))
    return result['out']


def fp():
    return json.loads(ok("SELECT jsonb_build_object('members',md5((SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY roleid,member,grantor),'[]')::text FROM pg_auth_members m)),'functions',md5((SELECT jsonb_agg(to_jsonb(p) ORDER BY oid)::text FROM pg_proc p WHERE pronamespace='review_media_private'::regnamespace)));"))


def main():
    output=HERE/'pg15-acl-v2.json'
    if output.exists():raise ValueError('OUTPUT_EXISTS')
    c=json.loads(subprocess.check_output(['docker','--context',CONTEXT,'inspect',CONTAINER]))[0]
    if c['HostConfig']['NetworkMode']!='none' or c['NetworkSettings']['Ports']:raise ValueError('ISOLATION_DENIED')
    if ok("SELECT current_setting('server_version');")!='15.8':raise ValueError('ENGINE_PIN_DENIED')
    if ok("SELECT to_regnamespace('review_media_private') IS NULL;")!='t':raise ValueError('TARGET_ALREADY_USED')
    ok("""CREATE SCHEMA review_media_private AUTHORIZATION postgres;
GRANT USAGE ON SCHEMA review_media_private TO privacy_workflow_owner;
CREATE FUNCTION review_media_private.guard_references() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION review_media_private.lock_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$ BEGIN RETURN NULL; END $$;
ALTER FUNCTION review_media_private.guard_references() OWNER TO privacy_workflow_owner;
ALTER FUNCTION review_media_private.lock_changes() OWNER TO privacy_workflow_owner;
REVOKE ALL ON FUNCTION review_media_private.guard_references(),review_media_private.lock_changes() FROM PUBLIC,anon,authenticated,service_role,postgres;""",'supabase_admin')
    before=fp()
    lease="BEGIN; GRANT privacy_workflow_owner TO postgres; SET LOCAL ROLE privacy_workflow_owner;\n"
    baseline=run(lease+'DO $test$ BEGIN\n'+t.ANCHOR.decode()+'END $test$; COMMIT;')
    if baseline['states']!=['P0001'] or fp()!=before:raise ValueError('BASELINE_INHERITANCE_FAILURE_NOT_PROVEN')
    snapshot=ok(lease+"""SELECT jsonb_build_object('effectiveExec',has_function_privilege('postgres','review_media_private.guard_references()','EXECUTE'),
'directExecutorExec',EXISTS(SELECT 1 FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.oid='review_media_private.guard_references()'::regprocedure AND a.grantee='postgres'::regrole AND a.privilege_type='EXECUTE'));
ROLLBACK;""")
    inside=json.loads(snapshot)
    if inside!={'effectiveExec':True,'directExecutorExec':False}:raise ValueError('INHERITANCE_STATE_DRIFT')
    ok(t.PREFIX.decode()+"GRANT privacy_workflow_owner TO postgres; SET LOCAL ROLE privacy_workflow_owner;\nDO $test$ BEGIN\n"+t.REPLACEMENT.decode()+"END $test$;\n"+"""GRANT EXECUTE ON FUNCTION review_media_private.guard_references(),review_media_private.lock_changes() TO postgres;
RESET ROLE;
SET LOCAL ROLE privacy_workflow_owner;
REVOKE EXECUTE ON FUNCTION review_media_private.guard_references(),review_media_private.lock_changes() FROM postgres;
RESET ROLE;
REVOKE privacy_workflow_owner FROM postgres;
"""+t.SUFFIX.decode())
    if fp()!=before:raise ValueError('MEMBERSHIP_OR_ACL_RESTORE_DRIFT')
    denied=run("BEGIN; GRANT EXECUTE ON FUNCTION review_media_private.guard_references() TO postgres; SET LOCAL ROLE postgres;\n"+t.PREFIX.decode().replace('BEGIN;\n','',1)+"ROLLBACK;",'supabase_admin')
    if denied['exit']==0 or fp()!=before:raise ValueError('DIRECT_LEAK_NOT_DENIED')
    record={'status':'passed','engine':'15.8','image':c['Image'],'architecture':'arm64','network':'none','ports':'none','synthetic':True,
      'baseline':{'exit':baseline['exit'],'states':baseline['states'],'exactRollback':True},'duringOwnerLease':inside,'candidatePassed':True,
      'exactMembershipAndFunctionAclRestored':True,'directExecutorGrantDenied':True,'beforeAfterFingerprint':before,
      'transformerSha256':hashlib.sha256(p.read_bytes()).hexdigest(),'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
      'canonicalFullReplayVerified':False,'storageOrReferenceLifecycleVerified':False,'operatingDDL':0}
    output.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({'status':'passed','effectiveInheritedExec':True,'directExec':False,'restored':True,'canonicalFullReplayVerified':False}))


if __name__=='__main__':main()
