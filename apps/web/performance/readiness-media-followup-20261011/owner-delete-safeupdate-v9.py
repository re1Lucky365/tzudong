"""Fresh exact-PG17 user-delete A/B under the same safeupdate session guard."""
from pathlib import Path
import importlib.util,subprocess,json,re,hashlib
H=Path(__file__).resolve().parent;R=H.parents[3]
s=importlib.util.spec_from_file_location('m',H.parent/'readiness-delivery-20261011/verify_admin_media_forward_v1.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def main():
 output=H/'owner-delete-safeupdate-v9.json'
 if output.exists():raise ValueError('OUTPUT_EXISTS')
 outcomes=[]
 source=R/'backend/supabase/migrations/20261011094346_admin_evaluation_revision_safeupdate.sql'
 for variant in ['before','after']:
  db=f'readiness_owner_delete_{variant}_v9_20261011';m.fresh(db,m.TEMPLATE)
  m.run(db,'INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton) VALUES(true);')
  if variant=='after':m.run(db,source.read_text(),'postgres')
  m.fixture(db)
  sql="""LOAD 'safeupdate'; SET ROLE authenticated;
SET request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
SET request.jwt.claims='{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}';
DO $probe$ DECLARE state text;BEGIN
 BEGIN
  SELECT public.mutate_review_with_media('99999999-9999-4999-8999-999999999999','22222222-2222-4222-8222-222222222222','delete',(SELECT updated_at FROM public.reviews WHERE id='22222222-2222-4222-8222-222222222222')) INTO state;
  RAISE NOTICE 'PROBE_RESULT:%',state;
 EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PROBE_SQLSTATE:%',SQLSTATE;END;
END $probe$;
RESET ROLE;
SELECT jsonb_build_object('reviewCount',(SELECT count(*) FROM public.reviews WHERE id='22222222-2222-4222-8222-222222222222'),'receiptCount',(SELECT count(*) FROM review_media_private.commits WHERE operation_id='99999999-9999-4999-8999-999999999999'),'queuedCount',(SELECT count(*) FROM review_media_private.cleanup WHERE review_id='22222222-2222-4222-8222-222222222222'));
"""
  p=subprocess.run(m.command(db)+['-v','VERBOSITY=default'],input=sql,text=True,capture_output=True,timeout=25)
  outcomes.append({'variant':variant,'database':db,'exit':p.returncode,'sqlstates':re.findall('PROBE_SQLSTATE:([0-9A-Z]{5})',p.stderr),'result':re.findall('PROBE_RESULT:(REVIEW_[A-Z_]+)',p.stderr),'outcome':json.loads(p.stdout.strip().splitlines()[-1])})
 if outcomes[0]['sqlstates']!=['21000'] or outcomes[0]['outcome']!={'queuedCount':0,'reviewCount':1,'receiptCount':0}:raise ValueError('BASELINE_DRIFT')
 if outcomes[1]['result']!=['REVIEW_COMMITTED'] or outcomes[1]['sqlstates'] or outcomes[1]['outcome']!={'queuedCount':2,'reviewCount':0,'receiptCount':1}:raise ValueError('CANDIDATE_DRIFT')
 result={'engine':'17.6','synthetic':True,'guardLibrary':'safeupdate','operatingWrites':0,'migrationSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'outcomes':outcomes}
 output.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
if __name__=='__main__':main()
