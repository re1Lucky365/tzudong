"""Verify frozen packets without rewriting samples or claiming release approval."""
import hashlib
import json
import pathlib
import shutil
import subprocess

REPO = pathlib.Path(__file__).resolve().parents[2]


def require(condition, message='TRANSITIONS_EVIDENCE_INVALID'):
    if not condition:
        raise ValueError(message)


def validator_command(recorded, artifact_root):
    # The frozen command records the original host; only the validator's data
    # arguments are reused. Executable and repository paths belong to this host.
    require(len(recorded) == 24 and pathlib.PurePosixPath(recorded[1]).name == 'validate-performance-backlog.mjs', 'VALIDATOR_COMMAND_INVALID')
    require(recorded[2] == '--artifact-root', 'VALIDATOR_ROOT_INVALID')
    require(recorded[4::2] == ['--release-id', '--candidate-sha', '--candidate-tree', '--config-sha256', '--data-profile-sha256', '--frozen-as-of', '--input', '--artifact-map', '--artifact-map-sha256', '--scored'], 'VALIDATOR_ARGUMENTS_INVALID')
    node = shutil.which('node')
    require(node is not None, 'NODE24_REQUIRED')
    require(subprocess.check_output([node, '--version'], text=True).strip().startswith('v24.'), 'NODE24_REQUIRED')
    return [node, str(REPO / 'apps/web/scripts/validate-performance-backlog.mjs'), '--artifact-root', str(artifact_root), *recorded[4:]]


def digest(data):
    return hashlib.sha256(data).hexdigest()


for name in ['readiness-gemini-integration-20261011',
             'readiness-delivery-integration-20261012',
             'transitions-adoption-20261012']:
    root = REPO / 'apps/web/performance' / name
    map_path = root / 'artifact-map-v1.json'
    pin = (REPO / 'docs/evidence' / (name + '-map-v1.sha256')).read_text().strip()
    require(digest(map_path.read_bytes()) == pin, 'map pin mismatch')
    manifest = json.loads(map_path.read_text())
    actual = {str(p.relative_to(root)) for p in root.rglob('*') if p.is_file()}
    require(actual == set(manifest['artifacts']) | {'artifact-map-v1.json'}, 'file inventory mismatch')
    for relative, expected in manifest['artifacts'].items():
        path = root / relative
        require(not path.is_symlink() and path.resolve().is_relative_to(root), 'unsafe path')
        require(digest(path.read_bytes()) == expected, 'artifact mismatch')
    print(json.dumps({'package': name, 'files': len(manifest['artifacts']),
                      'mapSha256': pin, 'status': 'passed'}))

root = REPO / 'apps/web/performance/transitions-adoption-20261012'
source = json.loads((root / 'source-manifest-v1.json').read_text())
for path, expected in source['files'].items():
    body = subprocess.check_output(['git', 'show', source['candidate'] + ':' + path], cwd=REPO)
    require(digest(body) == expected, 'historical source mismatch')
for path, expected in source['dependencyFiles'].items():
    require(digest((REPO / path).read_bytes()) == expected, 'fixture/runtime mismatch')
summary = json.loads((root / 'summary-v1.json').read_text())
require(summary['pendingTimerResult']['beforeAfter6'] == 6, 'EVIDENCE_INVALID')
require(summary['pendingTimerResult']['afterAfter6'] == 1, 'EVIDENCE_INVALID')
require(summary['unit'] == {'pass': 3435, 'skip': 11, 'fail': 0}, 'EVIDENCE_INVALID')
require(summary['performanceAdmission'] == 0 and not summary['deployed'], 'EVIDENCE_INVALID')
basis = json.loads((root / 'canonical-zero-v3/basis.json').read_text())
scored = json.loads((root / 'canonical-zero-v3/backlog.scored.json').read_text())
require(basis['items'] == 0 and basis['consoleIncidents'] == 40, 'EVIDENCE_INVALID')
require(scored['items'] == [], 'EVIDENCE_INVALID')
subprocess.run(validator_command(basis['commands'][1], root / 'canonical-zero-v3'), cwd=REPO / 'apps/web', check=True)
print(json.dumps({'sourceBindings': 'passed', 'canonicalValidator': 'passed',
                  'performanceAdmission': 0, 'physicalDevice': False,
                  'operatingDeliveryVerified': False}))
