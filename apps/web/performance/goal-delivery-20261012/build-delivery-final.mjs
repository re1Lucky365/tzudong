import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildFixtureLaunchPlan, PRODUCTION_DIST_DIR } from '../admin-header-consistency-20261011/launch.mjs';
import { readE2EAdminRouteBypassContract, WEB_ROOT } from '../admin-header-consistency-20261011/source-contract.mjs';
import { verifyBuildRouteCssBoundaries } from '../../scripts/verify-route-css-boundaries.mjs';

const NODE = '/opt/homebrew/opt/node@24/bin/node';
const OUT = resolve(WEB_ROOT, 'performance/goal-delivery-20261012');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const roots = ['app/admin', 'app/api/admin', 'app/insights', 'components/admin', 'components/ui', 'contexts', 'hooks', 'config', 'integrations', 'lib', 'styles', 'types', 'data/knowledge-graph'];
const extra = ['package.json', 'package-lock.json', 'tsconfig.json', 'next-env.d.ts', 'next.config.mjs', 'scripts/gemini-live-verification-io.ts', 'scripts/verify-ocr-gemini-live.ts', 'scripts/verify-storyboard-gemini-live.ts', 'scripts/verify-admin-sidebar-pages-browser.ts'];
function manifest() {
  const paths = new Set(extra);
  function walk(relative) {
    if (!existsSync(join(WEB_ROOT, relative))) return;
    for (const entry of readdirSync(join(WEB_ROOT, relative), { withFileTypes: true })) {
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) paths.add(path);
      else throw new Error('SOURCE_SYMLINK_NOT_ADMITTED');
    }
  }
  roots.forEach(walk);
  return [...paths].sort().map((path) => ({ path, sha256: sha(readFileSync(join(WEB_ROOT, path))) }));
}
function save(name, data) { writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
if (realpathSync(process.execPath) !== realpathSync(NODE) || process.versions.node !== '24.21.0') throw new Error('PINNED_NODE_REQUIRED');
for (const directory of [WEB_ROOT, resolve(WEB_ROOT, '../..')]) {
  for (const file of ['.env', '.env.local']) {
    if (existsSync(join(directory, file))) throw new Error('REPOSITORY_ENV_FILE_NOT_ADMITTED');
  }
}
const before = manifest();
const tsconfigBytes = readFileSync(join(WEB_ROOT, 'tsconfig.json'));
save('final-build-source-before.json', { roots, extra, rows: before, sha256: sha(JSON.stringify(before)) });
const prior = resolve(WEB_ROOT, PRODUCTION_DIST_DIR);
const preserved = resolve(WEB_ROOT, '.next-admin-header-third-before-20261012');
if (readFileSync(join(prior, 'BUILD_ID'), 'utf8').trim() !== 'S3htZTxU6dtVvs3lBNoM4' || existsSync(preserved)) throw new Error('PRIOR_BUILD_IDENTITY_MISMATCH');
renameSync(prior, preserved);
const plan = buildFixtureLaunchPlan(['--production'], readE2EAdminRouteBypassContract(), process.env, { productionBuildExists: true });
plan.nextEnvironment.PATH = '/opt/homebrew/opt/node@24/bin:/usr/bin:/bin:/usr/sbin:/sbin';
const argv = ['scripts/clean-next.mjs', '--skip-clean', '--', NODE, 'node_modules/next/dist/bin/next', 'build', '--webpack'];
const startedAt = new Date().toISOString();
const result = spawnSync(NODE, argv, { cwd: WEB_ROOT, env: plan.nextEnvironment, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
const stdout = result.stdout ?? '', stderr = result.stderr ?? '';
writeFileSync(join(OUT, 'final-build-output.txt'), stdout + stderr, { flag: 'wx', mode: 0o600 });
process.stdout.write(stdout + stderr);
const generated = new Set([`${PRODUCTION_DIST_DIR}/types/**/*.ts`, `${PRODUCTION_DIST_DIR}/dev/types/**/*.ts`]);
const current = JSON.parse(readFileSync(join(WEB_ROOT, 'tsconfig.json'), 'utf8'));
const original = JSON.parse(tsconfigBytes.toString('utf8'));
current.include = current.include.filter((path) => !generated.has(path));
if (JSON.stringify(current) !== JSON.stringify(original)) throw new Error('UNEXPECTED_TSCONFIG_CHANGE_PRESERVED');
writeFileSync(join(WEB_ROOT, 'tsconfig.json'), tsconfigBytes);
const after = manifest();
const unchanged = JSON.stringify(before) === JSON.stringify(after);
save('final-build-source-after.json', { rows: after, sha256: sha(JSON.stringify(after)), unchanged });
const css = result.status === 0 ? verifyBuildRouteCssBoundaries({ nextDirectory: prior }) : null;
const artifacts = ['BUILD_ID', 'build-manifest.json', 'app-build-manifest.json', 'routes-manifest.json', 'required-server-files.json']
  .filter((path) => existsSync(join(prior, path)))
  .map((path) => ({ path, sha256: sha(readFileSync(join(prior, path))) }));
const receipt = { schema: 'tzudong-local-build/v1', startedAt, completedAt: new Date().toISOString(), status: result.status, signal: result.signal, argv, node: process.versions.node, next: JSON.parse(readFileSync(join(WEB_ROOT, 'node_modules/next/package.json'))).version, buildId: existsSync(join(prior, 'BUILD_ID')) ? readFileSync(join(prior, 'BUILD_ID'), 'utf8').trim() : null, sourceUnchanged: unchanged, sourceManifestSha256: sha(JSON.stringify(before)), sourceFileCount: before.length, artifacts, css, environment: { inheritedAllowlistOnly: true, hostedProviderCredentials: false, hostedDatabaseCredentials: false, syntheticLoopback: true }, limits: ['Local build and synthetic fixture only; no deployment or production mutation.'] };
save('final-build-receipt.json', receipt);
if (result.status !== 0 || !unchanged) process.exit(1);
process.stdout.write(JSON.stringify({ buildId: receipt.buildId, status: receipt.status, sourceUnchanged: unchanged, sourceFileCount: before.length, css }) + '\n');
