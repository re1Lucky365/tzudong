"""Check retained scroll evidence; never infer latency, heap, or release admission."""
import hashlib
import json
import pathlib
import subprocess

repo = pathlib.Path(__file__).resolve().parents[2]
root = repo / 'apps/web/performance/scroll-transitions-20261012'
digest = lambda body: hashlib.sha256(body).hexdigest()
map_path = root / 'artifact-map-v1.json'
pin = (repo / 'docs/evidence/scroll-transitions-20261012-map-v1.sha256').read_text().strip()
assert digest(map_path.read_bytes()) == pin
manifest = json.loads(map_path.read_text())
assert {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()} == set(manifest['artifacts']) | {'artifact-map-v1.json'}
for name, expected in manifest['artifacts'].items():
    path = root / name
    assert path.resolve().is_relative_to(root) and not path.is_symlink()
    assert digest(path.read_bytes()) == expected
source = json.loads((root / 'source-manifest-v1.json').read_text())
for name, expected in source['files'].items():
    assert digest(subprocess.check_output(['git', 'show', source['candidate'] + ':' + name], cwd=repo)) == expected
for name, expected in source['fixtureDependencyFiles'].items():
    assert digest((repo / name).read_bytes()) == expected
before = json.loads((root / 'before-0.json').read_text())
after = json.loads((root / 'after-0.json').read_text())
assert before['passed'] and after['passed'] and after['pageErrors'] == 0
assert [x['documentScansDuring12MapDrags'] for x in before['cases']] == [24, 17, 19]
assert [x['documentScansDuring12MapDrags'] for x in after['cases']] == [0, 0, 0]
final = json.loads((root / 'FINAL-v1.json').read_text())
assert final['unitFinal'] == {'pass': 3441, 'skip': 11, 'fail': 0}
assert final['performanceAdmission'] == 0 and not final['deployed']
assert final['firstFullRunFailed']
print(json.dumps({'status': 'passed', 'files': len(manifest['artifacts']), 'mapSha256': pin,
                  'sourceBindings': 'passed', 'performanceAdmission': 0,
                  'physicalDevice': False, 'operatingDeliveryVerified': False}))
