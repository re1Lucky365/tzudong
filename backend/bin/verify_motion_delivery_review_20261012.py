"""Independent immutable-tree, historical-source and functional-result check."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import subprocess

REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / 'apps/web/performance/motion-delivery-review-20261012'


def require(condition, code):
    if not condition:
        raise ValueError(code)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def load(name):
    return json.loads((ROOT / name).read_bytes())


def main():
    require(not ROOT.is_symlink() and not any(p.is_symlink() for p in ROOT.rglob('*')), 'SYMLINK_DENIED')
    mapping = ROOT / 'artifact-map-v1.json'
    pin = (REPO / 'docs/evidence/motion-delivery-review-20261012-map-v1.sha256').read_text().strip()
    require(sha(mapping.read_bytes()) == pin, 'DETACHED_MAP_DRIFT')
    packet = load(mapping.name)
    require(packet['performanceAdmission'] == 0 and packet['physicalFieldAdmission'] == 0
            and packet['operatingDDL'] == 0 and not packet['deployed'], 'CLAIM_DRIFT')
    actual = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and p != mapping}
    require(actual == set(packet['artifacts']), 'INVENTORY_DRIFT')
    for name, item in packet['artifacts'].items():
        path = PurePosixPath(name)
        require(not path.is_absolute() and '..' not in path.parts and str(path) == name and '\\' not in name, 'PATH_DENIED')
        body = (ROOT / name).read_bytes()
        require(len(body) == item['bytes'] and sha(body) == item['sha256'], 'ARTIFACT_DRIFT')
    source = load('source-manifest-v2.json')
    for name, digest in source['files'].items():
        body = subprocess.check_output(['git', 'show', source['candidate'] + ':' + name], cwd=REPO)
        require(sha(body) == digest, 'HISTORICAL_SOURCE_DRIFT')
    final = load('FINAL-v1.json')
    require(final['source'] == source['candidate'] and final['checks']['webFull']['pass'] == 3442
            and final['checks']['webFull']['skip'] == 11 and final['checks']['webFull']['fail'] == 0, 'TEST_TOTAL_DRIFT')
    for item in final['checks'].values():
        require(item['exit'] == 0 and sha((ROOT / item['log']).read_bytes()) == item['logSha256'], 'CHECK_DRIFT')
    build = load(final['productionBuild'])
    require(build['stampSourceSha256'] == source['files']['apps/web/app/stamp/page.tsx']
            and build['buildExit'] == 0 and build['cssExit'] == 0 and not build['deploymentVerified'], 'BUILD_DRIFT')
    before, after = load('stamp-before-v9.json'), load('stamp-after-v9.json')
    require(len(before['cases']) == 9 and len(after['cases']) == 9
            and sum(not row['passed'] for row in before['cases']) == 3 and after['passed'], 'BROWSER_RESULT_DRIFT')
    require(all(row['passed'] and row['dialogState']['hiddenAncestors'] == 0 for row in after['cases']), 'BROWSER_ACCESSIBILITY_DRIFT')
    require(not after['serverAuthenticationVerified'] and not after['browserHealthClean']
            and after['pageErrors'] == 0 and after['unsupportedFixture'] == 0 and after['mutationAttempts'] == 0, 'BROWSER_CLAIM_DRIFT')
    db = load(final['ownerCleanup'])
    migration = 'backend/supabase/migrations/20261011175912_review_owner_cleanup_completion.sql'
    require(db['sourceSha256'] == source['files'][migration] and db['engine'] == '17.6'
            and db['rollbackExact'] and [row['remaining'] for row in db['observations']] == [1, 0], 'DATABASE_DRIFT')
    require(all(row['liveRowRetained'] and row['liveObjectRetained'] and row['oldRowCompleted'] for row in db['observations']), 'MEDIA_PRESERVATION_DRIFT')
    permissions = load(final['permissionProbes'])['results']
    require([row['states'] for row in permissions] == [['42501'], ['42501'], []]
            and permissions[2]['noClaimReturnsNull'], 'PERMISSION_DRIFT')
    print(json.dumps({'status': 'passed', 'files': len(actual), 'mapSha256': pin,
                      'sourceCommit': source['candidate'], 'sourceFiles': len(source['files']),
                      'performanceAdmission': 0, 'operatingDDL': 0, 'deployed': False, 'physicalFieldAdmission': 0}))


if __name__ == '__main__':
    main()
