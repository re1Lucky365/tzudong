import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  closeSync,
  createWriteStream,
  existsSync,
  openSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupFixtureDependencies,
  fixtureServerInvocation,
  prepareFixtureDependencies,
  prepareRuntimeOutput,
  resolveFixtureDependencies,
  resolveFixtureRun,
  sanitizeFixtureOutput,
  validateFixtureDependencies,
} from './privacy-fixture-runtime.mjs';

const NODE = process.execPath;
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const EVIDENCE_ROOT = resolve(WEB_ROOT, 'performance/admin-route-consistency-20261012');
const DEFAULT_BASE_PORT = 18940;
const run = resolveFixtureRun({
  argv: process.argv.slice(2),
  defaultOut: EVIDENCE_ROOT,
  defaultDist: '.next-privacy-incidents-20261012',
  defaultBasePort: DEFAULT_BASE_PORT,
  allowRuntimeAttempt: true,
});
const BUILD_OUT = run.out;
const RUNTIME_OUT = run.runtimeOut;
const DIST = run.dist;
const FIXTURE_SERVER = resolve(EVIDENCE_ROOT, 'fixture-server.mjs');
const BUILD_RECEIPT = join(BUILD_OUT, 'privacy-build-receipt.json');
const EXPECTED_LOCK_SHA256 = '607175eda02d7746caf5593d34835cef317bf197ca6d5428fa1266cdb2aae5f4';
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function save(name, value) {
  writeFileSync(join(RUNTIME_OUT, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function reserveRuntimeEvidence() {
  const startPath = join(RUNTIME_OUT, 'privacy-runtime-start.json');
  const logPath = join(RUNTIME_OUT, 'privacy-runtime.log');
  const startFd = openSync(startPath, 'wx', 0o600);
  try {
    const logFd = openSync(logPath, 'wx', 0o600);
    return { startFd, logFd, logPath };
  } catch (error) {
    writeFileSync(startFd, `${JSON.stringify({
      schema: 'tzudong-privacy-incidents-loopback-reservation/v1',
      status: 'evidence-reservation-failed',
    }, null, 2)}\n`);
    closeSync(startFd);
    throw error;
  }
}

function commitRuntimeStart(fd, value) {
  writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`);
  closeSync(fd);
}

function safeEnvironment() {
  const inherited = Object.fromEntries(
    ['HOME', 'LANG', 'LC_ALL', 'SHELL', 'TERM', 'TMPDIR', 'TZ', 'USER']
      .filter((name) => typeof process.env[name] === 'string')
      .map((name) => [name, process.env[name]]),
  );
  return {
    ...inherited,
    PATH: `${dirname(NODE)}:/usr/bin:/bin:/usr/sbin:/sbin`,
    NODE_ENV: 'production',
    NEXT_TELEMETRY_DISABLED: '1',
    NEXT_PUBLIC_NAVER_MAPS_SCRIPT_URL: '/__local/naver-maps.js',
    NEXT_PUBLIC_SITE_URL: `http://127.0.0.1:${run.ports.gateway}`,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'synthetic-loopback-anon-key',
    NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${run.ports.supabase}`,
    NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME: '1',
    TZUDONG_NEXT_DIST_DIR: DIST,
    E2E_ADMIN_ROUTE_BYPASS: '1',
    E2E_ADMIN_ROUTE_BYPASS_CONTEXT: 'playwright',
    E2E_ADMIN_ROUTE_BYPASS_RUNTIME: 'local-production-bundle-smoke',
    E2E_ADMIN_ROUTE_BYPASS_TOKEN: 'privacy-incidents-synthetic-only',
    E2E_ADMIN_ROUTE_BYPASS_ALLOW_LOCAL_PRODUCTION_SMOKE: '1',
  };
}

if (Number.parseInt(process.versions.node.split('.')[0] ?? '', 10) !== 24) throw new Error('NODE_24_REQUIRED');
if (!existsSync(BUILD_RECEIPT)) throw new Error('BUILD_RECEIPT_MISSING');
const receipt = JSON.parse(readFileSync(BUILD_RECEIPT, 'utf8'));
const buildId = readFileSync(join(WEB_ROOT, DIST, 'BUILD_ID'), 'utf8').trim();
if (receipt.status !== 0 || receipt.distDir !== DIST || receipt.buildId !== buildId || !receipt.sourceUnchanged || !receipt.tsconfigRestored
  || (receipt.runId ?? null) !== run.runId || (receipt.basePort ?? DEFAULT_BASE_PORT) !== run.basePort) {
  throw new Error('BUILD_RECEIPT_INVALID');
}
const packageLockBytes = readFileSync(join(WEB_ROOT, 'package-lock.json'));
if (sha256(packageLockBytes) !== EXPECTED_LOCK_SHA256) throw new Error('PACKAGE_LOCK_MISMATCH');
const expectedNextVersion = JSON.parse(packageLockBytes.toString('utf8')).packages?.['node_modules/next']?.version;
const dependencyPlan = resolveFixtureDependencies({ webRoot: WEB_ROOT, dependencyPath: run.dependencyPath });
validateFixtureDependencies(dependencyPlan, { expectedNextVersion });
const fixtureInvocation = fixtureServerInvocation({
  sourcePath: FIXTURE_SERVER,
  evaluationRoot: WEB_ROOT,
  defaultBasePort: DEFAULT_BASE_PORT,
  basePort: run.basePort,
});
prepareRuntimeOutput({ buildOut: BUILD_OUT, runtimeOut: RUNTIME_OUT, runtimeAttempt: run.runtimeAttempt });

const runtimeEvidence = reserveRuntimeEvidence();
const runtimeLog = createWriteStream(runtimeEvidence.logPath, {
  fd: runtimeEvidence.logFd,
  autoClose: true,
});
prepareFixtureDependencies(dependencyPlan);
function mirror(name, stream, target) {
  let pending = '';
  stream.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    target.write(text);
    pending += text;
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) {
      runtimeLog.write(`[${name}] ${sanitizeFixtureOutput(line, [WEB_ROOT, dependencyPlan.source])}\n`);
    }
    if (pending.length > 64 * 1024) {
      runtimeLog.write(`[${name}] [OVERSIZED_LINE_OMITTED]\n`);
      pending = '';
    }
  });
  stream.on('end', () => {
    if (pending) runtimeLog.write(`[${name}] ${sanitizeFixtureOutput(pending, [WEB_ROOT, dependencyPlan.source])}\n`);
  });
}

const next = spawn(NODE, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(run.ports.next)], {
  cwd: WEB_ROOT,
  env: safeEnvironment(),
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});
const gateway = spawn(NODE, fixtureInvocation.args, {
  cwd: WEB_ROOT,
  env: safeEnvironment(),
  shell: false,
  stdio: ['ignore', 'pipe', 'pipe'],
});
mirror('next:stdout', next.stdout, process.stdout);
mirror('next:stderr', next.stderr, process.stderr);
mirror('gateway:stdout', gateway.stdout, process.stdout);
mirror('gateway:stderr', gateway.stderr, process.stderr);

commitRuntimeStart(runtimeEvidence.startFd, {
  schema: 'tzudong-privacy-incidents-loopback/v1',
  node: process.versions.node,
  ...(run.runId !== null || run.basePort !== DEFAULT_BASE_PORT ? { runId: run.runId, basePort: run.basePort } : {}),
  ...(run.runtimeAttempt !== null ? { runtimeAttempt: run.runtimeAttempt } : {}),
  buildId,
  distDir: DIST,
  launcherPid: process.pid,
  nextPid: next.pid,
  gatewayPid: gateway.pid,
  origins: {
    next: `http://127.0.0.1:${run.ports.next}`,
    supabase: `http://127.0.0.1:${run.ports.supabase}`,
    gateway: `http://127.0.0.1:${run.ports.gateway}`,
    visibleStart: `http://127.0.0.1:${run.ports.gateway}/__fixture/start`,
  },
  source: {
    fixtureServerSha256: fixtureInvocation.sourceSha256,
    runtimeFixtureServerSha256: fixtureInvocation.runtimeSha256,
    fixtureServerPortsPatched: fixtureInvocation.portsPatched,
    launcherSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    buildReceiptSha256: sha256(readFileSync(BUILD_RECEIPT)),
  },
  boundaries: {
    loopbackOnly: true,
    syntheticDataOnly: true,
    browserMutationMethodsAllowed: false,
    hostedCredentialsAdmitted: false,
    dependencyMode: dependencyPlan.mode,
  },
});

process.stdout.write(`build_id=${buildId}\nfixture_start=http://127.0.0.1:${run.ports.gateway}/__fixture/start\n`);

let closing = false;
let exitCode = 0;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  exitCode = code;
  for (const child of [gateway, next]) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  const timeout = setTimeout(() => {
    for (const child of [gateway, next]) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    }
  }, 5_000);
  timeout.unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
const closedChildren = new Set();
for (const [name, child] of [['next', next], ['gateway', gateway]]) {
  child.on('error', (error) => {
    runtimeLog.write(`[${name}:error] ${error.name}\n`);
    shutdown(1);
  });
  child.on('close', (code, signal) => {
    closedChildren.add(name);
    runtimeLog.write(`[${name}:close] code=${code} signal=${signal}\n`);
    if (!closing) shutdown(code || 1);
    if (closedChildren.size === 2) {
      const dependencyCleanup = cleanupFixtureDependencies(dependencyPlan);
      runtimeLog.end(() => {
        save('privacy-runtime-stop.json', {
          exitCode: dependencyCleanup.complete ? exitCode : 1,
          dependencyLinkRemoved: dependencyCleanup.complete,
          cleanupCode: dependencyCleanup.code,
        });
        process.exit(dependencyCleanup.complete ? exitCode : 1);
      });
    }
  });
}
