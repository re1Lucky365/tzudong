// Public configuration is read into RAM only. Existing env files stay intact.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { parse } from 'dotenv';
const root = '/Users/twoimo/.codex/worktrees/swipe-cache-control-20261009/tzudong';
const app = root + '/apps/web';
const output = '/Users/twoimo/.codex/worktrees/swipe-cache-control-20261009/tzudong/apps/web/performance/motion-delivery-review-20261012';
const dist = '.next-motion-delivery-review-v2';
const sha = x => createHash('sha256').update(x).digest('hex');
if (process.version !== 'v24.21.0' || existsSync(app + '/' + dist)) throw Error('FRESH_PINNED_BUILD_REQUIRED');
const config = parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
const permitted = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_NAVER_CLIENT_ID',
  'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY', 'NEXT_PUBLIC_SITE_URL', 'NEXT_PUBLIC_SENTRY_DSN'];
const env = { ...process.env, NODE_ENV: 'production', TZUDONG_NEXT_DIST_DIR: dist,
  ...Object.fromEntries(permitted.filter(key => config[key] !== undefined).map(key => [key, config[key]])) };
const tsconfigBefore = readFileSync(app + '/tsconfig.json');
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const started = Date.now();
const build = spawnSync(process.execPath, ['scripts/clean-next.mjs', '--', process.execPath, 'node_modules/next/dist/bin/next', 'build', '--webpack'],
  { cwd: app, env, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
writeFileSync(output + '/configured-build-review-v2.log', (build.stdout ?? '') + (build.stderr ?? ''), { flag: 'wx', mode: 0o600 });
const after = readFileSync(app + '/tsconfig.json');
if (!after.equals(tsconfigBefore)) {
  const original = JSON.parse(tsconfigBefore), generated = JSON.parse(after);
  generated.include = generated.include.filter(x => ![dist + '/types/**/*.ts', dist + '/dev/types/**/*.ts'].includes(x));
  if (JSON.stringify(generated) !== JSON.stringify(original)) throw Error('UNEXPECTED_TSCONFIG_CHANGE');
  writeFileSync(output + '/tsconfig-generated-configured-review-v2.json', after, { flag: 'wx', mode: 0o600 });
  writeFileSync(app + '/tsconfig.json', tsconfigBefore);
}
if (build.status !== 0) throw Error('PRODUCTION_BUILD_FAILED');
const css = spawnSync(process.execPath, ['scripts/verify-route-css-boundaries.mjs'], { cwd: app, env, encoding: 'utf8' });
writeFileSync(output + '/configured-css-review-v2.log', (css.stdout ?? '') + (css.stderr ?? ''), { flag: 'wx', mode: 0o600 });
const result = { sourceHead, sourceDirty:execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim().length>0, stampSourceSha256:sha(readFileSync(app+'/app/stamp/page.tsx')), myPageSourceSha256:sha(readFileSync(app+'/app/mypage/mypage-layout-content.tsx')), recordClientSha256:sha(readFileSync(app+'/lib/admin/record-action-client.ts')), ocrRouteSha256:sha(readFileSync(app+'/app/api/admin/ocr-receipts/process/route.ts')), cleanupHelperSha256:sha(readFileSync(app+'/lib/reviews/admin-verification-cleanup.ts')), node: process.version, next: JSON.parse(readFileSync(app + '/node_modules/next/package.json')).version,
  distDir: dist, buildId: readFileSync(app + '/' + dist + '/BUILD_ID', 'utf8').trim(), buildExit: build.status, cssExit: css.status,
  elapsedBuildAndCssMs: Date.now() - started, packageLockSha256: sha(readFileSync(app + '/package-lock.json')),
  publicConfigurationOnly: true, credentialsPersisted: false, tsconfigPreserved: readFileSync(app + '/tsconfig.json').equals(tsconfigBefore),
  operatingWrites: 0, deploymentVerified: false };
writeFileSync(output + '/configured-build-review-v2.json', JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify(result)); if (css.status !== 0) process.exitCode = 1;
