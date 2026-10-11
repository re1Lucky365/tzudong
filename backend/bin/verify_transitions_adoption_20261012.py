"""Verify frozen packets without rewriting samples or claiming release approval."""
import hashlib
import json
import pathlib
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[2]


def digest(data):
    return hashlib.sha256(data).hexdigest()


for name in ['readiness-gemini-integration-20261011',
             'readiness-delivery-integration-20261012',
             'transitions-adoption-20261012']:
    root = REPO / 'apps/web/performance' / name
    map_path = root / 'artifact-map-v1.json'
    pin = (REPO / 'docs/evidence' / (name + '-map-v1.sha256')).read_text().strip()
    assert digest(map_path.read_bytes()) == pin, 'map pin mismatch'
    manifest = json.loads(map_path.read_text())
    actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
    assert actual == set(manifest['artifacts']) | {'artifact-map-v1.json'}, 'file inventory mismatch'
    for relative, expected in manifest['artifacts'].items():
        path = root / relative
        assert not path.is_symlink() and path.resolve().is_relative_to(root), 'unsafe path'
        assert digest(path.read_bytes()) == expected, 'artifact mismatch'
    print(json.dumps({'package': name, 'files': len(manifest['artifacts']),
                      'mapSha256': pin, 'status': 'passed'}))

root = REPO / 'apps/web/performance/transitions-adoption-20261012'
source = json.loads((root / 'source-manifest-v1.json').read_text())
for path, expected in source['files'].items():
    body = subprocess.check_output(['git', 'show', source['candidate'] + ':' + path], cwd=REPO)
    assert digest(body) == expected, 'historical source mismatch'
for path, expected in source['dependencyFiles'].items():
    assert digest((REPO / path).read_bytes()) == expected, 'fixture/runtime mismatch'
summary = json.loads((root / 'summary-v1.json').read_text())
assert summary['pendingTimerResult']['beforeAfter6'] == 6
assert summary['pendingTimerResult']['afterAfter6'] == 1
assert summary['unit'] == {'pass': 3435, 'skip': 11, 'fail': 0}
assert summary['performanceAdmission'] == 0 and not summary['deployed']
basis = json.loads((root / 'canonical-zero-v3/basis.json').read_text())
scored = json.loads((root / 'canonical-zero-v3/backlog.scored.json').read_text())
assert basis['items'] == 0 and basis['consoleIncidents'] == 40
assert scored['items'] == []
subprocess.run(basis['commands'][1], cwd=REPO / 'apps/web', check=True)
print(json.dumps({'sourceBindings': 'passed', 'canonicalValidator': 'passed',
                  'performanceAdmission': 0, 'physicalDevice': False,
                  'operatingDeliveryVerified': False}))
