"""Read-only complete-tree/current-source/historical-source result validation."""
from pathlib import Path, PurePosixPath
import hashlib
import importlib.util
import json
import subprocess

ROOT=Path(__file__).resolve().parents[2]
NAME='readiness-ocr-followup-20261011'
PACKET=ROOT/'apps/web/performance'/NAME
BASE='592b1415b79b4d5f595498dfa23d85fb730099fb'


def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()


def load(name):return json.loads((PACKET/name).read_bytes())


def verify():
    if PACKET.is_symlink() or any(p.is_symlink() for p in PACKET.parents) or any(p.is_symlink() for p in PACKET.rglob('*')):raise ValueError('OCR_SYMLINK_DENIED')
    mapping=PACKET/'artifact-map-v1.json';digest=sha(mapping)
    if digest!=(ROOT/f'docs/evidence/{NAME}-map-v1.sha256').read_text().strip():raise ValueError('OCR_DETACHED_MAP_DRIFT')
    data=load(mapping.name);seen=set()
    if data['operatingDDL']!=0 or data['performanceAdmission']!=0 or data['physicalFieldAdmission']!=0 or data['earlierOperatingApplyAttempts']!=1:raise ValueError('OCR_CLAIM_DRIFT')
    for item in data['artifacts']:
        path=PurePosixPath(item['path'])
        if set(item)!={'path','bytes','sha256'} or path.is_absolute() or '..' in path.parts or str(path)!=item['path'] or '\\' in str(path) or str(path) in seen:raise ValueError('OCR_MAP_PATH')
        p=PACKET.joinpath(*path.parts);seen.add(str(path))
        if not p.is_file() or p.stat().st_size!=item['bytes'] or sha(p)!=item['sha256']:raise ValueError('OCR_MAP_BYTES')
    if seen!={p.relative_to(PACKET).as_posix() for p in PACKET.rglob('*') if p.is_file() and p!=mapping}:raise ValueError('OCR_COMPLETE_TREE_DRIFT')
    manifest=load('source-manifest-v1.json')
    for item in manifest['files']:
        path=PurePosixPath(item['path']);p=ROOT.joinpath(*path.parts)
        if path.is_absolute() or '..' in path.parts or p.is_symlink() or sha(p)!=item['sha256'] or p.stat().st_size!=item['bytes']:raise ValueError('OCR_SOURCE_DRIFT')
    spec=importlib.util.spec_from_file_location('historical_packets',ROOT/'backend/bin/verify_readiness_followup_20261011.py')
    previous=importlib.util.module_from_spec(spec);spec.loader.exec_module(previous)
    historical=[previous.verify_package(name) for name in previous.PACKAGES]
    history=json.loads((ROOT/'apps/web/performance/readiness-media-followup-20261011/source-manifest-v1.json').read_bytes())
    for item in history['files']:
        blob=subprocess.check_output(['git','show',f"{BASE}:{item['path']}"],cwd=ROOT)
        if len(blob)!=item['bytes'] or hashlib.sha256(blob).hexdigest()!=item['sha256']:raise ValueError('OCR_HISTORICAL_GIT_SOURCE_DRIFT')
    result=load('storage-fence-pg17-v7.json');negative=load('storage-adversarial-pg17-v2.json')
    for payload,script in ((result,'verify_storage_fence_v7.py'),(negative,'verify_storage_adversarial_v2.py')):
        if payload['status']!='passed' or payload['engine']!='17.6' or payload['operatingDDL']!=0 or payload['scriptSha256']!=sha(PACKET/script):raise ValueError('OCR_RUNTIME_IDENTITY')
        for name,value in payload['sourceSha256'].items():
            if sha(ROOT/name)!=value:raise ValueError('OCR_SQL_SOURCE_BINDING')
    if not result['rollbackExactIncludingStorageTriggers'] or result['baselineAuthenticatedUpload']!={'success':False,'sqlstate':'42501'} or result['candidateAuthenticatedUpload']!={'success':True,'nonAdminOwner':True}:raise ValueError('OCR_OWNER_PERMISSION_RESULT')
    for field in ('foreignUploadDenied','privateAnonymousReadDenied','publicFoodPreserved','nonAdminBannerDenied','disabledAdminBannerDenied','activeAdminBannerPreserved','absentLegacyPoliciesRemainAbsent','absentBranchOnlyOwnerReadChanged','storageRekeyRetiredDenied','nonReviewMetadataPreserved'):
        if result[field] is not True:raise ValueError('OCR_PERMISSION_OR_FENCE_RESULT')
    races=result['races']
    if len(races)!=2 or any(r['connections']!=2 or r['observedWait']!='advisory' or r['deadlock'] for r in races) or races[0]['waiter']['exit']!=0 or races[0]['objectCount']!=1 or races[1]['waiter']['states']!=['23514'] or races[1]['objectCount']!=0:raise ValueError('OCR_RACE_RESULT')
    if len(negative['cases'])!=5 or not all(c['exit']!=0 and c['exactRollback'] for c in negative['cases']):raise ValueError('OCR_ADVERSARIAL_RESULT')
    build=load('configured-build-v5.json')
    for field,name in (('ocrRouteSha256','apps/web/app/api/admin/ocr-receipts/process/route.ts'),('cleanupHelperSha256','apps/web/lib/reviews/admin-verification-cleanup.ts'),('myPageSourceSha256','apps/web/app/mypage/mypage-layout-content.tsx'),('recordClientSha256','apps/web/lib/admin/record-action-client.ts')):
        if build[field]!=sha(ROOT/name):raise ValueError('OCR_BUILD_SOURCE_BINDING')
    if build['buildExit'] or build['cssExit'] or build['deploymentVerified']:raise ValueError('OCR_BUILD_CLAIM')
    full=load('unit-ocr-v1.json');focused=load('focused-ocr-v2.json');parity=load('parity-ocr-v2.json')
    if full['unitTotals']!={'pass':3422,'skip':11,'fail':0} or focused['unitTotals']!={'pass':54,'skip':0,'fail':0} or any(p['exit'] for p in (full,focused,parity)):raise ValueError('OCR_TEST_RESULT')
    for value in (full,focused,parity):
        if value['logSha256']!=sha(PACKET/f"{value['check']}-ocr-{'v1' if value is full else 'v2'}.log"):raise ValueError('OCR_TEST_LOG_BINDING')
    return {'status':'passed','files':len(seen),'sourceFiles':len(manifest['files']),'mapSha256':digest,'historicalPackets':historical,'historicalSourceCommit':BASE,'historicalSourceFiles':len(history['files']),'sourceBindingsVerified':True,'operatingDDL':0,'performanceAdmission':0,'physicalFieldAdmission':0}


if __name__=='__main__':print(json.dumps(verify()))
