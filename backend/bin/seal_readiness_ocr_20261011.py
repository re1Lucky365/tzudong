"""One-time seal; never replace an existing map, source manifest or detached pin."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT=Path(__file__).resolve().parents[2]
NAME='readiness-ocr-followup-20261011'
PACKET=ROOT/'apps/web/performance'/NAME


def row(path,relative):return {'path':relative,'bytes':path.stat().st_size,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}


def main():
    mapping=PACKET/'artifact-map-v1.json';manifest=PACKET/'source-manifest-v1.json';pin=ROOT/f'docs/evidence/{NAME}-map-v1.sha256'
    if any(p.exists() for p in (mapping,manifest,pin)):raise ValueError('OCR_SEALED_OUTPUT_EXISTS')
    if any(p.is_symlink() for p in PACKET.rglob('*')):raise ValueError('OCR_SYMLINK_DENIED')
    files=set(subprocess.check_output(['git','diff','--name-only'],cwd=ROOT,text=True).splitlines())
    files|={p.relative_to(ROOT).as_posix() for p in (ROOT/'backend/supabase/migrations').glob('2026101110*.sql') if p.name.startswith(('20261011103501','20261011105114'))}
    files.add('backend/supabase/migrations/20261011110108_review_storage_caller_bound_admin_policy.sql')
    files|={'backend/supabase/tests/test_admin_verification_durable_staging.py','backend/supabase/tests/test_review_storage_retirement_contract.py','backend/bin/verify_readiness_ocr_20261011.py','backend/bin/seal_readiness_ocr_20261011.py'}
    files={name for name in files if not name.startswith('apps/web/performance/')}
    manifest.write_text(json.dumps({'baseCommit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),'files':[row(ROOT/name,name) for name in sorted(files)]},indent=2)+'\n')
    data={'schema':'readiness-ocr-artifact-map-v1','performanceAdmission':0,'physicalFieldAdmission':0,'operatingDDL':0,'earlierOperatingApplyAttempts':1,
       'artifacts':[row(p,p.relative_to(PACKET).as_posix()) for p in sorted(PACKET.rglob('*')) if p.is_file() and p!=mapping]}
    mapping.write_text(json.dumps(data,indent=2)+'\n');pin.write_text(hashlib.sha256(mapping.read_bytes()).hexdigest()+'\n')
    print(json.dumps({'status':'sealed','files':len(data['artifacts']),'sourceFiles':len(files),'mapSha256':pin.read_text().strip()}))


if __name__=='__main__':main()
