"""Pinned local checks; save exact output and source identities without environment data."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import subprocess
import time

HERE = Path(__file__).resolve().parent
APP = HERE.parents[1]
ROOT = APP.parents[1]
NODE = '/Users/twoimo/.npm/_npx/387698761821791d/node_modules/node/bin/node'
COMMANDS = {
    'unit': [NODE, 'scripts/run-unit-tests.mjs'],
    'lint': [NODE, 'node_modules/eslint/bin/eslint.js', 'lib/admin/record-action-client.ts', 'tests-unit/admin-record-action-client.test.ts', 'tests-unit/nightly-regression-workflow.test.ts'],
    'parity': [NODE, 'scripts/run-typecheck.mjs', '--compiler', 'parity'],
}


def main():
    mode = argparse.ArgumentParser()
    mode.add_argument('check', choices=COMMANDS)
    mode = mode.parse_args().check
    output = HERE / f'{mode}-expiry-v1.json'
    log = HERE / f'{mode}-expiry-v1.log'
    if output.exists() or log.exists():
        raise ValueError('OUTPUT_EXISTS')
    version = subprocess.check_output([NODE, '--version'], text=True).strip()
    if version != 'v24.21.0':
        raise ValueError('RUNTIME_PIN_DENIED')
    files = subprocess.check_output(['git', 'diff', '--name-only'], cwd=ROOT, text=True).splitlines()
    source = {name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest() for name in files}
    env = {**os.environ, 'PATH': str(Path(NODE).parent) + ':/Users/twoimo/.bun/bin:' + os.environ['PATH']}
    start = time.monotonic()
    with log.open('x') as stream:
        result = subprocess.run(COMMANDS[mode], cwd=APP, env=env, stdout=stream, stderr=subprocess.STDOUT, timeout=360)
    text = log.read_text()
    totals = {key: sum(map(int, re.findall(rf'^\s+(\d+) {key}\s*$', text, re.M))) for key in ('pass', 'skip', 'fail')}
    record = {'check': mode, 'exit': result.returncode, 'node': version, 'command': COMMANDS[mode],
              'sourceHead': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
              'dirtyTrackedInputs': source, 'elapsedSeconds': time.monotonic() - start,
              'logSha256': hashlib.sha256(log.read_bytes()).hexdigest(), 'unitTotals': totals if mode == 'unit' else None,
              'localOnly': True, 'operatingWrites': 0}
    output.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps({'check': mode, 'exit': result.returncode, 'unitTotals': record['unitTotals']}))
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()
