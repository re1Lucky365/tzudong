"""Retained-tree and exact source/result validation; no release admission."""
from pathlib import Path, PurePosixPath
import hashlib
import json
import subprocess

REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / 'apps/web/performance/readiness-final-review-20261012'


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
    pin = (REPO / 'docs/evidence/readiness-final-review-20261012-map-v1.sha256').read_text().strip()
    require(sha(mapping.read_bytes()) == pin, 'DETACHED_MAP_DRIFT')
    packet = load(mapping.name)
    actual = {p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*') if p.is_file() and p != mapping}
    require(actual == set(packet['artifacts']), 'INVENTORY_DRIFT')
    for name, item in packet['artifacts'].items():
        path = PurePosixPath(name)
        require(not path.is_absolute() and '..' not in path.parts and str(path) == name and '\\' not in name, 'PATH_DENIED')
        body = (ROOT / name).read_bytes()
        require(len(body) == item['bytes'] and sha(body) == item['sha256'], 'ARTIFACT_DRIFT')
    source = load('source-manifest-v1.json')
    for name, digest in source['files'].items():
        require(sha(subprocess.check_output(['git', 'show', source['candidate'] + ':' + name], cwd=REPO)) == digest, 'HISTORICAL_SOURCE_DRIFT')
    final = load('FINAL-v1.json')
    require(final['source'] == source['candidate'] and final['checks']['fullUnit']['totals'] == {'pass': 3450, 'skip': 11, 'fail': 0}, 'TEST_TOTAL_DRIFT')
    require(final['checks']['focused']['totals'] == {'pass': 22, 'skip': 0, 'fail': 0}, 'FOCUSED_DRIFT')
    for row in final['checks'].values():
        require(row['exit'] == 0 and sha((ROOT / row['file']).read_bytes()) == row['sha256'], 'CHECK_DRIFT')
    build = load(final['build'])
    for field, path in [('myReviewsSourceSha256', 'apps/web/app/mypage/reviews/page.tsx'),
                        ('privateImageHandlerSha256', 'apps/web/lib/reviews/private-verification-handler.ts'),
                        ('cleanupQueueSha256', 'apps/web/lib/reviews/latest-owner-cleanup.ts')]:
        require(build[field] == source['files'][path], 'BUILD_SOURCE_DRIFT')
    require(build['buildExit'] == 0 and build['cssExit'] == 0 and not build['deploymentVerified'], 'BUILD_CLAIM_DRIFT')
    boundaries = load(final['directBoundary'])
    require(len(boundaries['images']) == 6 and sum(row['before'] == 404 and row['after'] == 503 for row in boundaries['images']) == 5, 'IMAGE_BOUNDARY_DRIFT')
    require(all(row['after'] == row['expected'] for row in boundaries['images']), 'IMAGE_STATUS_DRIFT')
    before, after = boundaries['cleanup']
    require(before['calls'] == ['A'] and not before['latestOwnerPending']
            and after['calls'] == ['A', 'B'] and after['latestOwnerPending'], 'OWNER_BOUNDARY_DRIFT')
    browser = load(final['browser'])
    require(browser['passed'] and len(browser['cases']) == 3 and browser['pageErrors'] == 0, 'BROWSER_DRIFT')
    require(all(row['documentScansDuring12MapDrags'] == 0 for row in browser['cases']), 'SCROLL_DRIFT')
    require(final['performanceAdmission'] == 0 and final['physicalFieldAdmission'] == 0
            and final['operatingWrites'] == 0 and not final['candidateDeployed'], 'CLAIM_DRIFT')
    print(json.dumps({'status': 'passed', 'files': len(actual), 'mapSha256': pin,
                      'sourceCommit': source['candidate'], 'sourceFiles': len(source['files']),
                      'performanceAdmission': 0, 'operatingWrites': 0, 'candidateDeployed': False}))


if __name__ == '__main__':
    main()
