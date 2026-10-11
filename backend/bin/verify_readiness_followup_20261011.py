"""Independently verify complete packet bytes, actual source bindings and claim limits.

Read-only. No provider/browser/DB calls; this does not replace their execution.
"""
from pathlib import Path, PurePosixPath
import hashlib
import json
import subprocess

REPO = Path(__file__).resolve().parents[2]
PACKAGES = ('readiness-media-followup-20261011', 'tzuyang-review-minimal-20261011')
SOURCE_COMMIT = '592b1415b79b4d5f595498dfa23d85fb730099fb'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def source_bytes(relative):
    path = PurePosixPath(relative)
    if path.is_absolute() or '..' in path.parts or str(path) != relative or '\\' in relative:
        raise ValueError('FOLLOWUP_SOURCE_PATH')
    return subprocess.check_output(['git', 'show', f'{SOURCE_COMMIT}:{relative}'], cwd=REPO)


def source_sha(relative):
    return hashlib.sha256(source_bytes(relative)).hexdigest()


def load(root, name):
    return json.loads((root / name).read_bytes())


def verify_package(name):
    root = REPO / 'apps/web/performance' / name
    if root.is_symlink() or any(p.is_symlink() for p in root.parents) or any(p.is_symlink() for p in root.rglob('*')):
        raise ValueError('FOLLOWUP_SYMLINK_DENIED')
    map_path = root / 'artifact-map-v1.json'
    digest = sha(map_path)
    if digest != (REPO / f'docs/evidence/{name}-map-v1.sha256').read_text().strip():
        raise ValueError('FOLLOWUP_DETACHED_PIN_DRIFT')
    packet = load(root, map_path.name)
    if {k: packet[k] for k in ('performanceAdmission', 'physicalFieldAdmission', 'operatingDDL', 'operatingContentCommitsVerified', 'operatingApplyAttempts')} != {
        'performanceAdmission': 0, 'physicalFieldAdmission': 0, 'operatingDDL': 0,
        'operatingContentCommitsVerified': 0, 'operatingApplyAttempts': 1,
    }:
        raise ValueError('FOLLOWUP_CLAIM_DRIFT')
    seen = set()
    for entry in packet['artifacts']:
        if set(entry) != {'path', 'bytes', 'sha256'} or not isinstance(entry['path'], str):
            raise ValueError('FOLLOWUP_MAP_FIELDS')
        path = PurePosixPath(entry['path'])
        if path.is_absolute() or '..' in path.parts or str(path) != entry['path'] or '\\' in str(path) or str(path) in seen:
            raise ValueError('FOLLOWUP_MAP_PATH')
        seen.add(str(path))
        actual = root.joinpath(*path.parts)
        if root.resolve() not in actual.resolve().parents or type(entry['bytes']) is not int or actual.stat().st_size != entry['bytes'] or sha(actual) != entry['sha256']:
            raise ValueError('FOLLOWUP_MAP_BYTES')
    expected = {p.relative_to(root).as_posix() for p in root.rglob('*') if p.is_file() and p != map_path}
    if seen != expected:
        raise ValueError('FOLLOWUP_COMPLETE_TREE_DRIFT')
    return {'package': name, 'files': len(seen), 'mapSha256': digest}


def verify():
    packages = [verify_package(name) for name in PACKAGES]
    root = REPO / 'apps/web/performance' / PACKAGES[0]
    manifest = load(root, 'source-manifest-v1.json')
    for row in manifest['files']:
        body = source_bytes(row['path'])
        if len(body) != row['bytes'] or hashlib.sha256(body).hexdigest() != row['sha256']:
            raise ValueError('FOLLOWUP_SOURCE_DRIFT')
    migration = REPO / 'backend/supabase/migrations/20261011100730_admin_record_expired_preview_readback.sql'
    expiry = load(root, 'expired-readback-pg17-v1.json')
    if expiry['sourceSha256'] != source_sha(migration.relative_to(REPO).as_posix()) or expiry['scriptSha256'] != sha(root / 'verify_expired_readback_v1.py') or not expiry['rollbackExact']:
        raise ValueError('EXPIRY_PROOF_BINDING_DRIFT')
    if expiry['baseline'] != {'exit': 0, 'codes': [], 'returnedState': 'preview', 'auditCount': 0} or expiry['candidate'] != {'exit': 3, 'codes': ['RECORD_ACTION_PREVIEW_EXPIRED'], 'returnedState': None, 'auditCount': 0}:
        raise ValueError('EXPIRY_PROOF_RESULT_DRIFT')
    if len(expiry['lockRaces']) != 2 or not all(r['serializedOnOperationLock'] and r['expiredAppliedReadback'] == 'applied' and r['auditCount'] == 1 and r['repeatedApplySameAudit'] for r in expiry['lockRaces']) or not all(expiry['privileges'].values()):
        raise ValueError('EXPIRY_LOCK_BOUNDARY_DRIFT')
    revision = REPO / 'backend/supabase/migrations/20261011094346_admin_evaluation_revision_safeupdate.sql'
    deletion = load(root, 'owner-delete-safeupdate-v9.json')
    if deletion['migrationSha256'] != source_sha(revision.relative_to(REPO).as_posix()) or deletion['scriptSha256'] != sha(root / 'owner-delete-safeupdate-v9.py'):
        raise ValueError('REVISION_PROOF_BINDING_DRIFT')
    before, after = deletion['outcomes']
    if before['sqlstates'] != ['21000'] or after['result'] != ['REVIEW_COMMITTED'] or after['sqlstates'] or before['outcome'] != {'queuedCount': 0, 'reviewCount': 1, 'receiptCount': 0} or after['outcome'] != {'queuedCount': 2, 'reviewCount': 0, 'receiptCount': 1}:
        raise ValueError('REVISION_DELETE_RESULT_DRIFT')
    shared = load(root, 'shared-cleanup-exact-pg17-v2.json')
    if shared['migrationSha256'] != source_sha('backend/supabase/migrations/20261011085342_review_legacy_shared_cleanup.sql') or shared['before'] != shared['after'] or not shared['rollbackExact'] or shared['baseline']['lastReviewReadyItems'] != 0 or shared['candidate']['lastReviewReadyItems'] != 1:
        raise ValueError('SHARED_PROOF_DRIFT')
    build = load(root, 'configured-build-v4.json')
    if build['recordClientSha256'] != source_sha('apps/web/lib/admin/record-action-client.ts') or build['myPageSourceSha256'] != source_sha('apps/web/app/mypage/mypage-layout-content.tsx') or build['buildExit'] or build['cssExit'] or not build['tsconfigPreserved']:
        raise ValueError('BUILD_SOURCE_BINDING_DRIFT')
    for name in ('unit', 'lint', 'parity'):
        checked = load(root, f'{name}-expiry-v1.json')
        if checked['exit'] or checked['logSha256'] != sha(root / f'{name}-expiry-v1.log') or checked['node'] != 'v24.21.0':
            raise ValueError('CHECK_RESULT_DRIFT')
    if load(root, 'unit-expiry-v1.json')['unitTotals'] != {'pass': 3419, 'skip': 11, 'fail': 0}:
        raise ValueError('UNIT_COUNT_DRIFT')
    baseline = load(root, 'browser-upload-recovery-v6.json')
    browser = load(root, 'browser-upload-recovery-v13.json')
    if baseline['pageErrors'] != 9 or not browser['passed'] or len(browser['cases']) != 12 or browser['pageErrors'] or browser['consoleErrors'] or browser['unsupportedFixture']:
        raise ValueError('MY_RENDER_RESULT_DRIFT')
    admin = load(root, 'browser-admin-expiry-v3.json')
    if not admin['functionalFlowsPassed'] or admin['browserHealthClean'] or len(admin['cases']) != 9 or admin['pageErrors'] or admin['unsupportedFixture'] or admin['consoleKinds'] != {'CSP': 3, 'unclassified': 3, 'expectedExpiry409': 3}:
        raise ValueError('ADMIN_RENDER_BOUNDARY_DRIFT')
    if any(r.get('recordPosts', 0) != 0 for r in admin['cases']):
        raise ValueError('ADMIN_REPLAY_DRIFT')
    observation = load(root, 'operating-edit-observation-v2.json')
    if observation['previewCalls'] != 1 or observation['applyAttempts'] != 1 or observation['resends'] or observation['observation'] != {'state': 'preview', 'expired': True, 'auditCount': 0, 'activeRecordCalls': 0}:
        raise ValueError('OPERATING_TRUTH_DRIFT')
    minimal = REPO / 'apps/web/performance' / PACKAGES[1]
    plan, preflight = load(minimal, 'minimal-review-plan-v1.json'), load(minimal, 'fresh-minimal-preflight-v1.json')
    if (plan['minimalDrafts'], plan['editorialDrafts'], plan['sourceCorrectionDrafts'], plan['preservedAdminEdits'], plan['needsContext']) != (23, 15, 8, 47, 8) or preflight['unchanged'] != 23 or preflight['changed'] or plan['privatePlanSha256'] != preflight['privatePlanSha256']:
        raise ValueError('MINIMAL_COVERAGE_DRIFT')
    return {'status': 'passed', 'packages': packages, 'sourceFiles': len(manifest['files']), 'sourceCommit': SOURCE_COMMIT, 'sourceBindingsVerified': True,
            'performanceAdmission': 0, 'operatingApplyAttempts': 1, 'operatingContentCommitsVerified': 0,
            'browserHealthClean': False, 'physicalFieldAdmission': 0}


if __name__ == '__main__':
    print(json.dumps(verify()))
