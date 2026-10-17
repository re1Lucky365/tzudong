import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  closeSync,
  constants,
  createWriteStream,
  existsSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
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
  verifyBuildRuntimeArtifactClosure,
} from '../privacy-fixture-runtime.mjs';

const NODE = process.execPath;
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const EVIDENCE_ROOT = resolve(WEB_ROOT, 'performance/admin-route-consistency-20261012');
const DEFAULT_BASE_PORT = 18950;
const run = resolveFixtureRun({
  argv: process.argv.slice(2),
  defaultOut: resolve(EVIDENCE_ROOT, 'v2'),
  defaultDist: '.next-privacy-incidents-v2-20261012',
  defaultBasePort: DEFAULT_BASE_PORT,
  allowRuntimeAttempt: true,
});
const BUILD_OUT = run.out;
const RUNTIME_OUT = run.runtimeOut;
const DIST = run.dist;
const FIXTURE_SERVER = resolve(EVIDENCE_ROOT, 'v2/fixture-server.mjs');
const BUILD_RECEIPT = join(BUILD_OUT, 'privacy-build-receipt.json');
const EXPECTED_LOCK_SHA256 = '607175eda02d7746caf5593d34835cef317bf197ca6d5428fa1266cdb2aae5f4';
const REQUIRED_BUILD_ARTIFACTS = Object.freeze([
  'BUILD_ID',
  'build-manifest.json',
  'routes-manifest.json',
  'required-server-files.json',
]);
const BUILD_ARTIFACT_CANDIDATES = Object.freeze([
  'BUILD_ID',
  'build-manifest.json',
  'app-build-manifest.json',
  'routes-manifest.json',
  'required-server-files.json',
]);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function revalidateBuildArtifacts(receipt) {
  const buildDirectory = resolve(WEB_ROOT, DIST);
  if (buildDirectory === WEB_ROOT || !buildDirectory.startsWith(`${WEB_ROOT}${sep}`)) {
    throw new Error('BUILD_ARTIFACT_ROOT_INVALID');
  }
  const buildDirectoryStat = lstatSync(buildDirectory);
  if (!buildDirectoryStat.isDirectory() || buildDirectoryStat.isSymbolicLink()) {
    throw new Error('BUILD_ARTIFACT_ROOT_INVALID');
  }
  const expectedBuildArtifacts = BUILD_ARTIFACT_CANDIDATES.filter((path) => existsSync(join(buildDirectory, path)));
  if (!REQUIRED_BUILD_ARTIFACTS.every((path) => expectedBuildArtifacts.includes(path))
    || !Array.isArray(receipt.artifacts)
    || receipt.artifacts.length !== expectedBuildArtifacts.length
    || receipt.artifacts.some((entry, index) => entry?.path !== expectedBuildArtifacts[index])) {
    throw new Error('BUILD_ARTIFACT_LIST_INVALID');
  }

  const realBuildDirectory = realpathSync(buildDirectory);
  const snapshots = receipt.artifacts.map((entry) => {
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256)) {
      throw new Error('BUILD_ARTIFACT_HASH_INVALID');
    }
    const artifactPath = resolve(buildDirectory, entry.path);
    if (!artifactPath.startsWith(`${buildDirectory}${sep}`)) throw new Error('BUILD_ARTIFACT_PATH_INVALID');
    const realArtifactPath = realpathSync(artifactPath);
    if (!realArtifactPath.startsWith(`${realBuildDirectory}${sep}`)) throw new Error('BUILD_ARTIFACT_PATH_INVALID');
    const artifactFd = openSync(artifactPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      if (!fstatSync(artifactFd).isFile()) throw new Error('BUILD_ARTIFACT_PATH_INVALID');
      bytes = readFileSync(artifactFd);
    } finally {
      closeSync(artifactFd);
    }
    const actualSha256 = sha256(bytes);
    if (actualSha256 !== entry.sha256) throw new Error('BUILD_ARTIFACT_HASH_MISMATCH');
    return { path: entry.path, sha256: actualSha256, size: bytes.length, bytes };
  });
  const buildId = snapshots.find((entry) => entry.path === 'BUILD_ID')?.bytes.toString('utf8').trim() ?? '';
  if (!buildId || receipt.buildId !== buildId) throw new Error('BUILD_RECEIPT_INVALID');
  const runtimeArtifactClosure = verifyBuildRuntimeArtifactClosure({
    buildDirectory,
    expected: receipt.runtimeArtifactClosure,
  });
  return {
    buildId,
    artifacts: snapshots.map(({ path, sha256: artifactSha256, size }) => ({
      path,
      sha256: artifactSha256,
      size,
    })),
    runtimeArtifactClosure: {
      schema: runtimeArtifactClosure.schema,
      mutableExclusions: runtimeArtifactClosure.mutableExclusions,
      fileCount: runtimeArtifactClosure.fileCount,
      bytes: runtimeArtifactClosure.bytes,
      sha256: runtimeArtifactClosure.sha256,
    },
  };
}

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
      schema: 'tzudong-privacy-incidents-loopback-reservation/v2',
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
const buildReceiptBytes = readFileSync(BUILD_RECEIPT);
const receipt = JSON.parse(buildReceiptBytes.toString('utf8'));
if (receipt.status !== 0 || receipt.distDir !== DIST || !receipt.sourceUnchanged || !receipt.tsconfigRestored
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

let closing = false;
let exitCode = 0;
let launchSettled = false;
let finalized = false;
let runtimeStartOpen = true;
let shutdownTimer = null;
const children = [];
const closedChildren = new Set();

function closeRuntimeStartReservation() {
  if (!runtimeStartOpen) return;
  runtimeStartOpen = false;
  try {
    closeSync(runtimeEvidence.startFd);
  } catch {
    // Preserve the original launch error; cleanup continues below.
  }
}

function finalize() {
  if (finalized || !launchSettled || closedChildren.size !== children.length) return;
  finalized = true;
  if (shutdownTimer !== null) clearTimeout(shutdownTimer);
  closeRuntimeStartReservation();
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

function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  exitCode = code;
  for (const { child } of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  }
  if (children.some(({ child }) => child.exitCode === null && child.signalCode === null)) {
    shutdownTimer = setTimeout(() => {
      for (const { child } of children) {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }
    }, 5_000);
    shutdownTimer.unref();
  }
  finalize();
}

function registerChild(name, child) {
  children.push({ name, child });
  child.on('error', (error) => {
    runtimeLog.write(`[${name}:error] ${error.name}\n`);
    shutdown(1);
  });
  child.on('close', (code, signal) => {
    closedChildren.add(name);
    runtimeLog.write(`[${name}:close] code=${code} signal=${signal}\n`);
    if (!closing) shutdown(code || 1);
    finalize();
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => shutdown(0));
process.on('uncaughtException', (error) => {
  runtimeLog.write(`[launcher:uncaughtException] ${error.name}\n`);
  launchSettled = true;
  closeRuntimeStartReservation();
  shutdown(1);
});
process.on('unhandledRejection', (reason) => {
  runtimeLog.write(`[launcher:unhandledRejection] ${reason instanceof Error ? reason.name : 'Error'}\n`);
  launchSettled = true;
  closeRuntimeStartReservation();
  shutdown(1);
});

try {
  prepareFixtureDependencies(dependencyPlan);
  const buildSnapshot = revalidateBuildArtifacts(receipt);
  const next = spawn(NODE, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(run.ports.next)], {
    cwd: WEB_ROOT,
    env: safeEnvironment(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  registerChild('next', next);
  const gateway = spawn(NODE, fixtureInvocation.args, {
    cwd: WEB_ROOT,
    env: safeEnvironment(),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  registerChild('gateway', gateway);
  mirror('next:stdout', next.stdout, process.stdout);
  mirror('next:stderr', next.stderr, process.stderr);
  mirror('gateway:stdout', gateway.stdout, process.stdout);
  mirror('gateway:stderr', gateway.stderr, process.stderr);

  commitRuntimeStart(runtimeEvidence.startFd, {
    schema: 'tzudong-privacy-incidents-loopback/v2',
    node: process.versions.node,
    ...(run.runId !== null || run.basePort !== DEFAULT_BASE_PORT ? { runId: run.runId, basePort: run.basePort } : {}),
    ...(run.runtimeAttempt !== null ? { runtimeAttempt: run.runtimeAttempt } : {}),
    buildId: buildSnapshot.buildId,
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
      buildReceiptSha256: sha256(buildReceiptBytes),
      buildArtifacts: buildSnapshot.artifacts,
      buildRuntimeArtifactClosure: buildSnapshot.runtimeArtifactClosure,
    },
    boundaries: {
      loopbackOnly: true,
      syntheticDataOnly: true,
      browserMutationMethodsAllowed: false,
      hostedCredentialsAdmitted: false,
      dependencyMode: dependencyPlan.mode,
    },
  });
  runtimeStartOpen = false;
  launchSettled = true;
  process.stdout.write(`build_id=${buildSnapshot.buildId}\nfixture_start=http://127.0.0.1:${run.ports.gateway}/__fixture/start\n`);
  finalize();
} catch (error) {
  launchSettled = true;
  closeRuntimeStartReservation();
  runtimeLog.write(`[launcher:error] ${error instanceof Error ? error.name : 'Error'}\n`);
  shutdown(1);
  finalize();
}
