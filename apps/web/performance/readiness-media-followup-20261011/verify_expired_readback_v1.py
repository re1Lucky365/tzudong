"""Fresh exact PG17 clones: terminal expiry, applied receipt, lock race and rollback.

Only synthetic rows and fixed error codes are emitted. Existing clones are not reset.
"""
from pathlib import Path
import importlib.util
import json
import hashlib
import re
import selectors
import subprocess
import time

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
spec = importlib.util.spec_from_file_location('owned_fixture', HERE.parent / 'readiness-delivery-20261011/verify_admin_media_forward_v1.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
TEMPLATE = 'readiness_admin_forward_v5_20261011'
FORWARD = ROOT / 'backend/supabase/migrations/20261011100730_admin_record_expired_preview_readback.sql'
REVISION = ROOT / 'backend/supabase/migrations/20261011094346_admin_evaluation_revision_safeupdate.sql'
TARGET = '44444444-4444-4444-8444-444444444444'
PAYLOAD = json.dumps({'changes': {}, 'perTargetChanges': [{'id': TARGET, 'changes': {'tzuyang_review': 'Synthetic expiry recovery proof.'}}]})


def call(phase, op, preview_hash=None):
    hashed = 'NULL' if preview_hash is None else "'" + preview_hash + "'"
    return f"SELECT public.admin_record_action('{m.OWNER}','{phase}','{op}','restaurant.edit',ARRAY['{TARGET}']::uuid[],'{PAYLOAD}'::jsonb,{hashed});"


def invoke(db, sql):
    p = subprocess.run(m.command(db) + ['-v', 'VERBOSITY=default'], input="LOAD 'safeupdate'; SET ROLE service_role;\n" + sql,
                       text=True, capture_output=True, timeout=12)
    lines = p.stdout.strip().splitlines()
    return {'exit': p.returncode, 'sqlstates': re.findall(r'(?:ERROR|FATAL):\s+([0-9A-Z]{5})', p.stderr),
            'codes': re.findall(r'(RECORD_ACTION_[A-Z_]+)', p.stderr),
            'receipt': json.loads(lines[-1]) if p.returncode == 0 and lines else None}


def expired_preview(db, op):
    preview = invoke(db, call('preview', op))
    if preview['exit']:
        raise ValueError('PREVIEW_FAILED')
    m.run(db, f"UPDATE pipeline_control.admin_record_operations SET expires_at=clock_timestamp()-interval '1 second' WHERE id='{op}';")
    result = invoke(db, call('readback', op))
    return {'exit': result['exit'], 'codes': result['codes'], 'returnedState': (result['receipt'] or {}).get('state'),
            'auditCount': int(m.run(db, f"SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id='{op}';"))}


def race(db, op, allow_timeout):
    preview = invoke(db, call('preview', op))['receipt']
    gate = m.background(db, 'expiry_apply_gate', "LOAD 'safeupdate'; BEGIN; SET LOCAL ROLE service_role;\n" +
                        call('apply', op, preview['previewHash']) + f"\nUPDATE pipeline_control.admin_record_operations SET expires_at=clock_timestamp()-interval '1 second' WHERE id='{op}'; SELECT 'APPLY_HELD';\n")
    checked = None
    try:
        reader = selectors.DefaultSelector()
        reader.register(gate.stdout, selectors.EVENT_READ)
        if not reader.select(5):
            raise ValueError('APPLY_GATE_NOT_READY')
        applied = json.loads(gate.stdout.readline())
        if applied['state'] != 'applied' or gate.stdout.readline().strip() != 'APPLY_HELD':
            raise ValueError('APPLY_GATE_DRIFT')
        reader.close()
        checked = m.background(db, 'expiry_readback_wait', 'SET ROLE service_role;\n' + call('readback', op) + '\n')
        checked.stdin.close(); checked.stdin = None
        for _ in range(100):
            if m.run(db, "SELECT count(*) FROM pg_stat_activity WHERE application_name='expiry_readback_wait' AND wait_event='advisory';") == '1':
                break
            time.sleep(.01)
        else:
            raise ValueError('READBACK_NOT_SERIALIZED')
        if allow_timeout:
            stdout, stderr = checked.communicate(timeout=5)
            if checked.returncode == 0 or '55P03' not in stderr or 'RECORD_ACTION_PREVIEW_EXPIRED' in stderr:
                raise ValueError('LOCK_TIMEOUT_NOT_UNCERTAIN')
        gate.stdin.write('COMMIT;\n'); gate.stdin.flush(); gate.stdin.close(); gate.stdin = None
        gate.communicate(timeout=5)
        if gate.returncode:
            raise ValueError('APPLY_COMMIT_FAILED')
        if not allow_timeout:
            stdout, stderr = checked.communicate(timeout=5)
            if checked.returncode or json.loads(stdout.strip().splitlines()[-1])['state'] != 'applied':
                raise ValueError('WAITED_READBACK_NOT_APPLIED')
        final = invoke(db, call('readback', op))['receipt']
        audit_count = int(m.run(db, f"SELECT count(*) FROM pipeline_control.admin_record_audit WHERE operation_id='{op}';"))
        repeated = invoke(db, call('apply', op, preview['previewHash']))['receipt']
        if final['state'] != 'applied' or repeated['auditId'] != final['auditId'] or audit_count != 1:
            raise ValueError('EXPIRED_APPLIED_IDEMPOTENCY_FAILED')
        return {'serializedOnOperationLock': True, 'lockTimeoutStayedUncertain': allow_timeout,
                'expiredAppliedReadback': 'applied', 'repeatedApplySameAudit': True, 'auditCount': audit_count}
    finally:
        for process in (gate, checked):
            if process and process.poll() is None:
                process.terminate(); process.communicate(timeout=5)


def main():
    output = HERE / 'expired-readback-pg17-v1.json'
    if output.exists():
        raise ValueError('OUTPUT_EXISTS')
    config = json.loads(subprocess.check_output(['docker', '--context', m.CONTEXT, 'inspect', m.CONTAINER]))[0]
    if config['HostConfig']['NetworkMode'] != 'none' or config['NetworkSettings']['Ports']:
        raise ValueError('ISOLATION_DENIED')
    if m.run(TEMPLATE, "SELECT current_setting('server_version');") != '17.6':
        raise ValueError('ENGINE_DENIED')
    if m.run(TEMPLATE, 'SELECT (SELECT count(*) FROM auth.users)+(SELECT count(*) FROM public.reviews);') != '0':
        raise ValueError('TEMPLATE_DATA_DENIED')
    before, after, rollback = ('readiness_expiry_before_v1_20261011', 'readiness_expiry_after_v1_20261011', 'readiness_expiry_rollback_v1_20261011')
    for db in (before, after, rollback):
        m.fresh(db, TEMPLATE)
    fingerprint = json.loads(m.run(rollback, m.FP))
    m.run(rollback, FORWARD.read_text().rsplit('COMMIT;', 1)[0] + 'ROLLBACK;', 'postgres')
    if json.loads(m.run(rollback, m.FP)) != fingerprint:
        raise ValueError('ROLLBACK_DRIFT')
    m.run(after, FORWARD.read_text(), 'postgres')
    for db in (before, after):
        m.run(db, 'INSERT INTO pipeline_control.admin_evaluation_catalog_revision(singleton) VALUES(true);')
        m.run(db, REVISION.read_text(), 'postgres')
        m.fixture(db)
    base = expired_preview(before, '77777777-7777-4777-8777-777777777701')
    candidate = expired_preview(after, '77777777-7777-4777-8777-777777777702')
    if base != {'exit': 0, 'codes': [], 'returnedState': 'preview', 'auditCount': 0}:
        raise ValueError('BASELINE_DRIFT')
    if candidate != {'exit': 3, 'codes': ['RECORD_ACTION_PREVIEW_EXPIRED'], 'returnedState': None, 'auditCount': 0}:
        raise ValueError('TERMINAL_EXPIRY_NOT_PROVEN')
    races = [race(after, '77777777-7777-4777-8777-777777777703', True), race(after, '77777777-7777-4777-8777-777777777704', False)]
    privileges = json.loads(m.run(after, "SELECT jsonb_build_object('anonDenied',NOT has_function_privilege('anon','public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','EXECUTE'),'authenticatedDenied',NOT has_function_privilege('authenticated','public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','EXECUTE'),'serviceAllowed',has_function_privilege('service_role','public.admin_record_action(uuid,text,uuid,text,uuid[],jsonb,text)','EXECUTE'));"))
    if not all(privileges.values()):
        raise ValueError('PRIVILEGE_DRIFT')
    result = {'engine': '17.6', 'context': m.CONTEXT, 'container': m.CONTAINER, 'network': 'none', 'ports': 'none',
              'sourceSha256': hashlib.sha256(FORWARD.read_bytes()).hexdigest(), 'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'synthetic': True, 'baseline': base, 'candidate': candidate, 'lockRaces': races, 'privileges': privileges,
              'rollbackExact': True, 'rollbackFingerprint': fingerprint, 'safeupdateEnabledInRuntime': True,
              'operatingDDL': 0, 'productionContentCommitVerified': False}
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'baselineState': 'preview', 'afterCode': 'RECORD_ACTION_PREVIEW_EXPIRED', 'lockRaces': len(races), 'rollbackExact': True}))


if __name__ == '__main__':
    main()
