"""Exact PG17 local before/after, permission fence and rollback, no hosted URL."""
from pathlib import Path
import importlib.util
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
SOURCE = ROOT / 'backend/supabase/migrations/20261011085342_review_legacy_shared_cleanup.sql'
TEMPLATE = 'readiness_admin_forward_v5_20261011'
loader = importlib.util.spec_from_file_location('previous_media_proof', HERE.parent / 'readiness-delivery-20261011/verify_admin_media_forward_v1.py')
helper = importlib.util.module_from_spec(loader)
loader.loader.exec_module(helper)


def verify():
    target = HERE / 'shared-cleanup-exact-pg17-v1.json'
    if target.exists():
        raise ValueError('SHARED_EVIDENCE_EXISTS')
    inspected = json.loads(subprocess.run(['docker', '--context', helper.CONTEXT, 'inspect', helper.CONTAINER], capture_output=True, check=True).stdout)[0]
    if inspected['HostConfig']['NetworkMode'] != 'none' or inspected['NetworkSettings']['Ports'] or not inspected['State']['Running']:
        raise ValueError('SHARED_ISOLATION_DENIED')
    if helper.run(TEMPLATE, 'SELECT count(*) FROM auth.users;') != '0' or helper.run(TEMPLATE, 'SELECT count(*) FROM public.reviews;') != '0':
        raise ValueError('SHARED_TEMPLATE_HAS_USER_DATA')
    before = 'readiness_shared_before_v1_20261011'
    after = 'readiness_shared_after_v1_20261011'
    rollback = 'readiness_shared_rollback_v1_20261011'
    for name in (before, after, rollback):
        helper.fresh(name, TEMPLATE)
    if helper.run(after, 'SHOW server_version_num;') != '170006':
        raise ValueError('SHARED_SERVER_VERSION_DRIFT')
    sql = SOURCE.read_text()
    fp_before = json.loads(helper.run(rollback, helper.FP))
    helper.run(rollback, sql.rsplit('COMMIT;', 1)[0] + 'ROLLBACK;', 'postgres')
    fp_after = json.loads(helper.run(rollback, helper.FP))
    if fp_before != fp_after:
        raise ValueError('SHARED_ROLLBACK_DRIFT')
    helper.run(after, sql, 'postgres')
    probe = (HERE / 'shared_legacy_probe_v1.sql').read_text()
    baseline = json.loads(helper.run(before, probe.replace('__EXPECTED_READY__', '0')).splitlines()[-1])
    candidate = json.loads(helper.run(after, probe.replace('__EXPECTED_READY__', '1')).splitlines()[-1])
    result = {'migrationSha256': hashlib.sha256(sql.encode()).hexdigest(),
              'serverVersionNum': '170006', 'network': 'none', 'ports': 'none',
              'fixtureHistoricalGuardSuspendedOnlyForSeed': True, 'runtimeGuardRestored': True,
              'baseline': baseline, 'candidate': candidate, 'rollbackExact': True,
              'before': fp_before, 'after': fp_after, 'operatingWrites': 0,
              'actualStorageHttpOrProviderVerified': False, 'physicalOrFieldAdmission': 0}
    with target.open('x') as output:
        output.write(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    print(json.dumps(verify()))
