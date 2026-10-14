import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanupFailure,
  cleanupPrivacyFixtureBuild,
  prepareFixtureDependencies,
  resolveFixtureDependencies,
  resolveFixtureRun,
  sanitizeFixtureOutput,
  validateFixtureDependencies,
} from './privacy-fixture-runtime.mjs';

const NODE = process.execPath;
const WEB_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = resolve(WEB_ROOT, '../..');
const EVIDENCE_ROOT = resolve(WEB_ROOT, 'performance/admin-route-consistency-20261012');
const DEFAULT_BASE_PORT = 18940;
const run = resolveFixtureRun({
  argv: process.argv.slice(2),
  defaultOut: EVIDENCE_ROOT,
  defaultDist: '.next-privacy-incidents-20261012',
  defaultBasePort: DEFAULT_BASE_PORT,
});
const OUT = run.out;
const DIST = run.dist;
const NODE_MODULES = join(WEB_ROOT, 'node_modules');
const EXPECTED_LOCK_SHA256 = '607175eda02d7746caf5593d34835cef317bf197ca6d5428fa1266cdb2aae5f4';
const excludedBuildInputRoots = new Set([
  '.lazyweb',
  '.omx',
  '.vercel',
  'node_modules',
  'performance',
]);
const excludedBuildInputPaths = new Set(['supabase/.temp']);

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const relativePath = (path) => relative(WEB_ROOT, path).replaceAll('\\', '/');

function save(name, value) {
  writeFileSync(join(OUT, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
}

function manifest() {
  const paths = [];
  function walk(path = '') {
    const absolute = path ? join(WEB_ROOT, path) : WEB_ROOT;
    for (const entry of readdirSync(absolute, { withFileTypes: true })) {
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (
        (!path && (excludedBuildInputRoots.has(entry.name) || entry.name === '.next' || entry.name.startsWith('.next-')))
        || excludedBuildInputPaths.has(child)
      ) continue;
      if (entry.isDirectory()) walk(child);
      else if (entry.isFile()) paths.push(child);
      else throw new Error(`SOURCE_SYMLINK_NOT_ADMITTED:${child}`);
    }
  }
  walk();
  return paths.sort().map((path) => {
    const bytes = readFileSync(join(WEB_ROOT, path));
    return { path, bytes: bytes.byteLength, sha256: sha256(bytes) };
  });
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
for (const root of [WEB_ROOT, REPO_ROOT]) {
  for (const name of ['.env', '.env.local']) {
    if (existsSync(join(root, name))) throw new Error(`REPOSITORY_ENV_FILE_NOT_ADMITTED:${relativePath(join(root, name))}`);
  }
}
if (existsSync(join(WEB_ROOT, DIST))) throw new Error('DIST_ALREADY_EXISTS');
const packageLockBytes = readFileSync(join(WEB_ROOT, 'package-lock.json'));
if (sha256(packageLockBytes) !== EXPECTED_LOCK_SHA256) throw new Error('PACKAGE_LOCK_MISMATCH');
const expectedNextVersion = JSON.parse(packageLockBytes.toString('utf8')).packages?.['node_modules/next']?.version;
const dependencyPlan = resolveFixtureDependencies({ webRoot: WEB_ROOT, dependencyPath: run.dependencyPath });
const nextVersion = validateFixtureDependencies(dependencyPlan, { expectedNextVersion });

mkdirSync(OUT, { recursive: true });
const before = manifest();
const beforeHash = sha256(JSON.stringify(before));
const tsconfig = readFileSync(join(WEB_ROOT, 'tsconfig.json'));
const nextEnvPath = join(WEB_ROOT, 'next-env.d.ts');
const nextEnv = existsSync(nextEnvPath) ? readFileSync(nextEnvPath) : null;
save('privacy-build-source-before.json', { baseHead: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: WEB_ROOT, encoding: 'utf8' }).stdout.trim(), rows: before, sha256: beforeHash });

let result;
let css = null;
let primaryError = null;
try {
  prepareFixtureDependencies(dependencyPlan);
  result = spawnSync(NODE, ['scripts/clean-next.mjs', '--skip-clean', '--', NODE, 'node_modules/next/dist/bin/next', 'build', '--webpack'], {
    cwd: WEB_ROOT,
    env: safeEnvironment(),
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status === 0) {
    const { verifyBuildRouteCssBoundaries } = await import('../../scripts/verify-route-css-boundaries.mjs');
    css = verifyBuildRouteCssBoundaries({ nextDirectory: join(WEB_ROOT, DIST) });
  }
} catch (error) {
  primaryError = error;
}
const cleanup = cleanupPrivacyFixtureBuild({
  webRoot: WEB_ROOT,
  dist: DIST,
  tsconfigBefore: tsconfig,
  nextEnvBefore: nextEnv,
  dependencyPlan,
});
if (cleanup.failures.length > 0) throw cleanupFailure(cleanup, primaryError);
if (primaryError) throw primaryError;

const output = sanitizeFixtureOutput(`${result?.stdout ?? ''}${result?.stderr ?? ''}`, [
  WEB_ROOT,
  REPO_ROOT,
  dependencyPlan.source,
]);
writeFileSync(join(OUT, 'privacy-build-output.log'), output, { flag: 'wx', mode: 0o600 });
const after = manifest();
const sourceUnchanged = JSON.stringify(before) === JSON.stringify(after);
save('privacy-build-source-after.json', { rows: after, sha256: sha256(JSON.stringify(after)), unchanged: sourceUnchanged });
const buildDirectory = join(WEB_ROOT, DIST);
const buildId = existsSync(join(buildDirectory, 'BUILD_ID')) ? readFileSync(join(buildDirectory, 'BUILD_ID'), 'utf8').trim() : null;
const artifacts = ['BUILD_ID', 'build-manifest.json', 'app-build-manifest.json', 'routes-manifest.json', 'required-server-files.json']
  .filter((path) => existsSync(join(buildDirectory, path)))
  .map((path) => ({ path, sha256: sha256(readFileSync(join(buildDirectory, path))) }));
const receipt = {
  schema: 'tzudong-privacy-incidents-local-build/v1',
  status: result?.status ?? 1,
  signal: result?.signal ?? null,
  node: process.versions.node,
  next: nextVersion,
  ...(run.runId !== null || run.basePort !== DEFAULT_BASE_PORT ? { runId: run.runId, basePort: run.basePort } : {}),
  distDir: DIST,
  buildId,
  sourceManifestSha256: beforeHash,
  sourceFileCount: before.length,
  sourceUnchanged,
  tsconfigRestored: readFileSync(join(WEB_ROOT, 'tsconfig.json')).equals(tsconfig),
  dependencyLockSha256: EXPECTED_LOCK_SHA256,
  dependenciesPath: dependencyPlan.receiptPath,
  dependencyMode: dependencyPlan.mode,
  dependencyLinkRemoved: dependencyPlan.mode === 'workspace' || !existsSync(NODE_MODULES),
  artifacts,
  css,
  environment: {
    inheritedAllowlistOnly: true,
    repositoryEnvFilesAdmitted: false,
    hostedCredentialsAdmitted: false,
    syntheticLoopbackOnly: true,
  },
  limitations: ['Local production bundle only; no browser render, OAuth, hosted database, provider, deployment, or production evidence.'],
};
save('privacy-build-receipt.json', receipt);
process.stdout.write(`${JSON.stringify(receipt)}\n`);
if (receipt.status !== 0 || !sourceUnchanged || !receipt.tsconfigRestored || !receipt.dependencyLinkRemoved || !buildId) process.exit(1);
