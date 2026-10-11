"""Read-only packet verification; it does not admit a canonical replay."""
from pathlib import Path,PurePosixPath
import hashlib,json

ROOT=Path(__file__).resolve().parents[2]
PACKET=ROOT/'apps/web/performance/readiness-pg15-storage-20261012'


def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()


def verify():
    mapping=PACKET/'artifact-map-v1.json'
    if PACKET.is_symlink() or any(p.is_symlink() for p in PACKET.parents) or any(p.is_symlink() for p in PACKET.rglob('*')):raise ValueError('PG15_SYMLINK_DENIED')
    if sha(mapping)!=(ROOT/'docs/evidence/readiness-pg15-storage-20261012-map-v1.sha256').read_text().strip():raise ValueError('PG15_DETACHED_PIN_DRIFT')
    data=json.loads(mapping.read_bytes());seen=set()
    if data['canonicalFullReplayVerified'] or data['performanceAdmission'] or data['operatingDDL']:raise ValueError('PG15_SCOPE_DRIFT')
    for r in data['artifacts']:
        name=PurePosixPath(r['path'])
        if name.is_absolute() or '..' in name.parts or str(name)!=r['path'] or '\\' in str(name) or str(name) in seen:raise ValueError('PG15_PATH_DRIFT')
        p=PACKET.joinpath(*name.parts);seen.add(str(name))
        if p.stat().st_size!=r['bytes'] or sha(p)!=r['sha256']:raise ValueError('PG15_ARTIFACT_BYTES_DRIFT')
    if seen!={p.relative_to(PACKET).as_posix() for p in PACKET.rglob('*') if p.is_file() and p!=mapping}:raise ValueError('PG15_COMPLETE_TREE_DRIFT')
    for r in json.loads((PACKET/'source-manifest-v1.json').read_bytes())['files']:
        p=ROOT/r['path']
        if p.is_symlink() or p.stat().st_size!=r['bytes'] or sha(p)!=r['sha256']:raise ValueError('PG15_SOURCE_DRIFT')
    runtime=json.loads((PACKET/'pg15-acl-v3.json').read_bytes())
    if runtime['status']!='passed' or runtime['engine']!='15.8' or runtime['architecture']!='arm64' or runtime['canonicalFullReplayVerified'] or runtime['operatingDDL']:raise ValueError('PG15_RUNTIME_SCOPE')
    if runtime['scriptSha256']!=sha(PACKET/'verify_pg15_acl_v3.py') or runtime['transformerSha256']!=sha(ROOT/'backend/supabase/scripts/transform_review_storage_pg15_replay.py'):raise ValueError('PG15_RUNTIME_SOURCE_BINDING')
    if runtime['baseline']['states']!=['P0001'] or runtime['duringOwnerLease']!={'effectiveExec':True,'directExecutorExec':False} or runtime['directGrantNegativeActor']!='postgres' or not all(runtime[k] for k in ('candidatePassed','exactMembershipAndFunctionAclRestored','directExecutorGrantDenied','indirectNoInheritMembershipPreserved')):raise ValueError('PG15_RUNTIME_RESULT')
    return {'status':'passed','files':len(seen),'mapSha256':sha(mapping),'canonicalFullReplayVerified':False,'performanceAdmission':0,'operatingDDL':0}


if __name__=='__main__':print(json.dumps(verify()))
