"""Independent complete-tree bytes and result-boundary admission; no network."""
from pathlib import Path, PurePosixPath
from collections import Counter
import hashlib
import json

REPO = Path(__file__).resolve().parents[2]
PACKAGES = ['readiness-delivery-20261011', 'tzuyang-review-source-20261011']


def verify_package(name):
    root = REPO / 'apps/web/performance' / name
    if root.is_symlink() or any(p.is_symlink() for p in root.parents) or any(p.is_symlink() for p in root.rglob('*')):
        raise ValueError('DELIVERY_SYMLINK_DENIED')
    map_path = root / 'artifact-map-v3.json'
    raw = map_path.read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != (REPO / f'docs/evidence/{name}-map-v3.sha256').read_text().strip():
        raise ValueError('DELIVERY_DETACHED_PIN_DRIFT')
    package = json.loads(raw)
    if type(package['performanceAdmission']) is not int or package['performanceAdmission'] != 0:
        raise ValueError('DELIVERY_PERFORMANCE_UNPROVEN')
    seen = set()
    for entry in package['artifacts']:
        if set(entry) != {'path', 'bytes', 'sha256'} or not isinstance(entry['path'], str):
            raise ValueError('DELIVERY_MAP_FIELDS')
        path = PurePosixPath(entry['path'])
        if path.is_absolute() or '..' in path.parts or str(path) != entry['path'] or '\\' in str(path) or str(path) in seen:
            raise ValueError('DELIVERY_MAP_PATH')
        seen.add(str(path))
        actual = root.joinpath(*path.parts)
        if root.resolve() not in actual.resolve().parents:
            raise ValueError('DELIVERY_MAP_ESCAPE')
        value = actual.read_bytes()
        if type(entry['bytes']) is not int or len(value) != entry['bytes'] or hashlib.sha256(value).hexdigest() != entry['sha256']:
            raise ValueError('DELIVERY_BYTES_DRIFT')
    expected = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p != map_path}
    if seen != expected:
        raise ValueError('DELIVERY_TREE_DRIFT')
    return {'package': name, 'files': len(seen), 'mapSha256': digest, 'byteEquality': True}


def verify():
    results = [verify_package(name) for name in PACKAGES]
    source = REPO / 'apps/web/performance/tzuyang-review-source-20261011'
    data = json.loads((source / 'source-complete-v2.json').read_bytes())
    rows = data['observations']
    observed = Counter(row['status'] for row in rows)
    if len(rows) != 161 or len({r['key'] for r in rows}) != 161 or observed != {
        'propose_fix': 78, 'needs_visual': 36, 'insufficient_source': 35, 'keep': 7, 'quote_rejected': 5,
    } or data['actualModel'] != 'gemini-3.8-flash' or data['thinkingLevel'] != 'HIGH':
        raise ValueError('SOURCE_MODEL_COVERAGE_DRIFT')
    if data['operatingWrites'] or data['sourceSemanticCertification'] or data['videoVisualCertification']:
        raise ValueError('SOURCE_SCOPE_UNPROVEN')
    for row in rows:
        if row.get('independentSemanticApproval', False) or row.get('operatingApplied', False):
            raise ValueError('SOURCE_ROW_SCOPE_UNPROVEN')
    fresh = json.loads((source / 'fresh-proposal-preflight-v2.json').read_bytes())
    if fresh['records'] != 78 or fresh['unchanged'] != 78 or fresh['changed'] or fresh['operatingWrites']:
        raise ValueError('SOURCE_FRESH_PREFLIGHT_DRIFT')
    delivery = REPO / 'apps/web/performance/readiness-delivery-20261011'
    proof = json.loads((delivery / 'admin-forward-exact-pg17-v5.json').read_bytes())
    migration = REPO / 'backend/supabase/migrations/20261011072824_admin_review_media_completion.sql'
    if proof['migrationSha256'] != hashlib.sha256(migration.read_bytes()).hexdigest():
        raise ValueError('FORWARD_SOURCE_PROOF_DRIFT')
    if not proof['rollbackExact'] or proof['before'] != proof['after'] or proof['operatingWrites']:
        raise ValueError('FORWARD_ROLLBACK_SCOPE_DRIFT')
    if not proof['baselineLockContention']['deadlock'] or proof['candidateLockContention']['deadlock']:
        raise ValueError('FORWARD_LOCK_COMPARISON_DRIFT')
    admin = next(x for x in proof['candidateLockContention']['outcomes'] if x['role'] == 'admin')
    if admin['fixedErrors'] != ['RECORD_ACTION_STALE']:
        raise ValueError('FORWARD_ADMIN_CONFLICT_DRIFT')
    browser = json.loads((delivery / 'browser-readiness-admin-media-v35.json').read_bytes())
    if not browser['passed'] or len(browser['cases']) != 14 or browser['errors']['page'] or browser['errors']['unsupportedFixture']:
        raise ValueError('DELIVERY_RENDER_SCOPE_DRIFT')
    if browser['physicalDevice'] or browser['fieldAdmission'] or browser['actualAccountCreated'] or browser['actualReviewWritten']:
        raise ValueError('DELIVERY_RENDER_UNPROVEN')
    return {'status': 'passed', 'packages': results, 'sourceRows': 161, 'sourceRejected': 5,
            'performanceAdmission': 0, 'operatingWrites': 0, 'physicalOrFieldAdmission': 0}


if __name__ == '__main__':
    print(json.dumps(verify()))
