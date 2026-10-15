"""Deliberate local drift must reject and roll back every partial mutation."""
from pathlib import Path
import importlib.util
import hashlib
import json
import re
import subprocess

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('probe',HERE/'verify_storage_fence_v7.py')
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)


def reject(db,sql,expected):
    before=json.loads(v.m.run(db,v.FP))
    result=subprocess.run(v.m.command(db)+['-v','VERBOSITY=default'],input=sql,capture_output=True,text=True,timeout=20)
    codes=re.findall(r'\bSTORAGE_[A-Z_]+\b',result.stderr)
    if result.returncode==0 or expected not in codes or json.loads(v.m.run(db,v.FP))!=before:
        raise ValueError('DRIFT_REJECTION_OR_ROLLBACK_FAILED')
    return {'exit':result.returncode,'fixedCode':expected,'exactRollback':True}


def main():
    output=HERE/'storage-adversarial-pg17-v1.json'
    if output.exists():raise ValueError('OUTPUT_EXISTS')
    failures=[]
    for tag,setup,expected in (
      ('partial','DROP POLICY "Admin delete access" ON storage.objects;','STORAGE_ADMIN_POLICY_INVENTORY_DRIFT'),
      ('broad','ALTER POLICY "Admin upload access" ON storage.objects WITH CHECK (true);','STORAGE_ADMIN_POLICY_SOURCE_DRIFT'),
      ('owner','ALTER POLICY review_verifications_owner_read ON storage.objects USING (true);','STORAGE_OWNER_READ_SOURCE_DRIFT')):
        db=f'readiness_storage_adversarial_{tag}_v1_20261011';v.m.fresh(db,'readiness_storage_before_v7_20261011')
        for source in v.SOURCES[:2]:v.m.run(db,source.read_text(),'postgres')
        v.m.run(db,setup)
        failures.append({'case':tag,**reject(db,v.SOURCES[2].read_text(),expected)})
    db='readiness_storage_fence_drift_v1_20261011';v.m.fresh(db,'readiness_storage_after_v7_20261011')
    source=v.SOURCES[1].read_text();start='-- STORAGE_RETIREMENT_FENCE_READBACK_BEGIN\n';end='-- STORAGE_RETIREMENT_FENCE_READBACK_END'
    readback=source.split(start)[1].split(end)[0]
    for tag,setup in (('disabled','ALTER TABLE storage.objects DISABLE TRIGGER a00_review_media_storage_guard;'),
                      ('events','DROP TRIGGER a00_review_media_storage_serialize ON storage.objects; CREATE TRIGGER a00_review_media_storage_serialize BEFORE INSERT ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION review_media_private.lock_changes();')):
        failures.append({'case':tag,**reject(db,'BEGIN;\n'+setup+readback+'COMMIT;', 'STORAGE_RETIREMENT_FENCE_READBACK_DRIFT')})
    record={'status':'passed','engine':'17.6','synthetic':True,'network':'none','ports':'none',
       'sourceSha256':{str(p.relative_to(v.ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in v.SOURCES},
       'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'cases':failures,'operatingDDL':0}
    output.write_text(json.dumps(record,indent=2)+'\n');print(json.dumps({'status':'passed','rejectedCases':len(failures),'exactRollback':True}))


if __name__=='__main__':main()
