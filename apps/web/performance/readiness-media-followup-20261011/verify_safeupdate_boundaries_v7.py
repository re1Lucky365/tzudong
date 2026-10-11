"""Verify safeupdate remains enabled, guarded idempotency, and exact DDL rollback."""
from pathlib import Path
import importlib.util,json,hashlib,subprocess,re
H=Path(__file__).resolve().parent;R=H.parents[3]
s=importlib.util.spec_from_file_location('m',H.parent/'readiness-delivery-20261011/verify_admin_media_forward_v1.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
SOURCE=R/'backend/supabase/migrations/20261011094346_admin_evaluation_revision_safeupdate.sql'
def main():
 output=H/'safeupdate-boundaries-v7.json'
 if output.exists():raise ValueError('OUTPUT_EXISTS')
 config=json.loads(subprocess.check_output(['docker','--context',m.CONTEXT,'inspect',m.CONTAINER]))[0]
 if config['HostConfig']['NetworkMode']!='none' or config['NetworkSettings']['Ports']:raise ValueError('ISOLATION_DENIED')
 db='readiness_revision_rollback_v7_20261011';m.fresh(db,m.TEMPLATE)
 m.run(db,'INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton) VALUES(true);')
 before=json.loads(m.run(db,m.FP));m.run(db,SOURCE.read_text().rsplit('COMMIT;',1)[0]+'ROLLBACK;','postgres');after=json.loads(m.run(db,m.FP))
 if before!=after:raise ValueError('ROLLBACK_DRIFT')
 candidate='readiness_restaurant_edit_v5_20261011'
 sql="""LOAD 'safeupdate'; SET ROLE service_role;
DO $probe$ DECLARE receipt jsonb;BEGIN
 BEGIN
  UPDATE public.restaurants SET tzuyang_review='Forbidden unbounded fixture write';
  RAISE EXCEPTION 'SAFEUPDATE_NOT_ENFORCED';
 EXCEPTION WHEN cardinality_violation THEN RAISE NOTICE 'SAFEUPDATE_ENFORCED';END;
 SELECT public.admin_record_action('11111111-1111-4111-8111-111111111111','apply','77777777-7777-4777-8777-777777777777','restaurant.edit',ARRAY['44444444-4444-4444-8444-444444444444']::uuid[],'{"changes":{},"perTargetChanges":[{"id":"44444444-4444-4444-8444-444444444444","changes":{"tzuyang_review":"Synthetic review text only."}}]}'::jsonb,(SELECT preview_hash FROM pipeline_control.admin_record_operations WHERE id='77777777-7777-4777-8777-777777777777')) INTO receipt;
 IF receipt->>'state'<>'applied' THEN RAISE EXCEPTION 'IDEMPOTENT_READBACK_FAILED';END IF;
END $probe$;
RESET ROLE;
SELECT jsonb_build_object('auditCount',(SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id='77777777-7777-4777-8777-777777777777'),'reviewUnchanged',(SELECT tzuyang_review='Synthetic review text only.' FROM public.restaurants WHERE id='44444444-4444-4444-8444-444444444444'),'privateAnonDenied',NOT has_function_privilege('anon','pipeline_control.bump_admin_evaluation_revision()','EXECUTE'),'privateAuthenticatedDenied',NOT has_function_privilege('authenticated','pipeline_control.bump_admin_evaluation_revision()','EXECUTE'));
"""
 p=subprocess.run(m.command(candidate)+['-v','VERBOSITY=default'],input=sql,text=True,capture_output=True,timeout=25)
 if p.returncode or 'SAFEUPDATE_ENFORCED' not in p.stderr:raise ValueError('RUNTIME_BOUNDARY_FAILED')
 result=json.loads(p.stdout.strip().splitlines()[-1])
 if result!={'auditCount':1,'reviewUnchanged':True,'privateAnonDenied':True,'privateAuthenticatedDenied':True}:raise ValueError('RUNTIME_RESULT_DRIFT')
 record={'migrationSha256':hashlib.sha256(SOURCE.read_bytes()).hexdigest(),'engine':'17.6','network':'none','ports':'none','synthetic':True,'rollbackExact':True,'beforeFingerprint':before,'afterFingerprint':after,'safeupdateUnboundedWriteRejected':True,'idempotentApply':result,'operatingDDL':0,'productionContentCommitVerified':False}
 output.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
if __name__=='__main__':main()
