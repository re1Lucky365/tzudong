"""Fresh isolated PG17 restaurant-edit reproduction, synthetic rows only."""
from pathlib import Path
import importlib.util,json,re,subprocess
H=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('helper',H.parent/'readiness-delivery-20261011/verify_admin_media_forward_v1.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def run():
 o=H/'restaurant-edit-safeupdate-after-v5.json'
 if o.exists():raise RuntimeError('OUTPUT_EXISTS')
 db='readiness_restaurant_edit_v5_20261011'
 m.fresh(db,m.TEMPLATE);m.run(db,'INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton) VALUES(true);');m.run(db,(H.parents[3]/'backend/supabase/migrations/20261011094346_admin_evaluation_revision_safeupdate.sql').read_text(),'postgres');m.fixture(db)
 sql="""LOAD 'safeupdate'; SET ROLE service_role;
DO $probe$ DECLARE p jsonb;a jsonb; BEGIN
 p:=public.admin_record_action('11111111-1111-4111-8111-111111111111','preview','77777777-7777-4777-8777-777777777777','restaurant.edit',ARRAY['44444444-4444-4444-8444-444444444444']::uuid[],'{"changes":{},"perTargetChanges":[{"id":"44444444-4444-4444-8444-444444444444","changes":{"tzuyang_review":"Synthetic review text only."}}]}'::jsonb);
 BEGIN
 a:=public.admin_record_action('11111111-1111-4111-8111-111111111111','apply','77777777-7777-4777-8777-777777777777','restaurant.edit',ARRAY['44444444-4444-4444-8444-444444444444']::uuid[],'{"changes":{},"perTargetChanges":[{"id":"44444444-4444-4444-8444-444444444444","changes":{"tzuyang_review":"Synthetic review text only."}}]}'::jsonb,p->>'previewHash');
 RAISE NOTICE 'PROBE_SUCCESS:%',a->>'state';
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PROBE_SQLSTATE:%',SQLSTATE;RAISE NOTICE 'PROBE_CONTEXT:%',SQLERRM;END;
END $probe$;
RESET ROLE;
SELECT jsonb_build_object('state',(SELECT state FROM pipeline_control.admin_record_operations WHERE id='77777777-7777-4777-8777-777777777777'),'reviewChanged',(SELECT tzuyang_review='Synthetic review text only.' FROM public.restaurants WHERE id='44444444-4444-4444-8444-444444444444'),'auditCount',(SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id='77777777-7777-4777-8777-777777777777'));
"""
 p=subprocess.run(m.command(db)+['-v','VERBOSITY=default'],input=sql,text=True,capture_output=True,timeout=25)
 states=re.findall(r'PROBE_SQLSTATE:([A-Z0-9]{5})',p.stderr)
 codes=re.findall(r'RECORD_ACTION_[A-Z_]+',p.stderr)
 result={'database':db,'engine':'17.6','synthetic':True,'operatingWrites':0,'exit':p.returncode,'sqlstates':states,'fixedCodes':codes,'outcome':json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else None,'diagnosticKeywords':[x for x in ['permission denied','not-null','does not exist','ambiguous','constraint','updated_at','value','column','relation'] if x in p.stderr]}
 o.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':run()
