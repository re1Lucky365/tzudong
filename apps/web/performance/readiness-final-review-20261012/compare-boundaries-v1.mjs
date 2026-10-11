// Execute exact historical/current boundaries with synthetic dependencies only.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { StorageApiError } from '@supabase/supabase-js';
import { getOwnedReviewPhotoObjectPath } from '../../lib/review-photo-url.ts';
import { readPrivateVerificationImage } from '../../lib/reviews/private-verification-handler.ts';
import { createLatestOwnerCleanup } from '../../lib/reviews/latest-owner-cleanup.ts';
const output = new URL('boundary-comparison-v1.json', import.meta.url);
if (existsSync(output)) throw Error('OUTPUT_EXISTS');
const root = new URL('../../../../', import.meta.url).pathname;
const base = '1893c854bc52c19633f6a772bcc3784f7fc59022';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const historical = path => execFileSync('git', ['show', `${base}:${path}`], { cwd: root, encoding: 'utf8' });
const rawHandler = historical('apps/web/lib/reviews/private-verification-handler.ts');
const handlerJs = new Bun.Transpiler({ loader: 'ts' }).transformSync(rawHandler)
  .replace(/^import .*?;\s*$/gm, '').replace('export async function', 'async function');
const beforeHandler = new Function('getOwnedReviewPhotoObjectPath', `${handlerJs};return readPrivateVerificationImage;`)(getOwnedReviewPhotoObjectPath);
const owner = '11111111-1111-4111-8111-111111111111', review = '22222222-2222-4222-8222-222222222222';
const cases = [
  ['database-timeout', 'read', { code: 'fixture-timeout' }, 503],
  ['credential', 'download', new StorageApiError('fixture', 401, '401', 'storage', 'InvalidJWT'), 503],
  ['bucket', 'download', new StorageApiError('fixture', 404, '404', 'storage', 'NoSuchBucket'), 503],
  ['outage', 'download', new StorageApiError('fixture', 503, '503', 'storage', 'NoSuchKey'), 503],
  ['timeout', 'download', new Error('fixture-timeout'), 503],
  ['missing-object', 'download', new StorageApiError('Object not found', 404, '404', 'storage', 'NoSuchKey'), 404],
];
const images = [];
for (const [name, phase, error, expected] of cases) {
  const deps = { authorize: async () => ({ ok: true }),
    read: async () => ({ data: { user_id: owner, verification_photo: `${owner}/reviews/${review}/verification/proof.webp` }, error: phase === 'read' ? error : null }),
    download: async () => ({ data: null, error: phase === 'download' ? error : null }) };
  const before = await beforeHandler(Promise.resolve({ reviewId: review }), deps);
  const after = await readPrivateVerificationImage(Promise.resolve({ reviewId: review }), deps);
  if (after.status !== expected || after.headers.get('cache-control') !== 'private, no-store') throw Error('IMAGE_BOUNDARY_FAILED');
  images.push({ name, expected, before: before.status, after: after.status });
}
const rawPage = historical('apps/web/app/mypage/reviews/page.tsx');
const callback = rawPage.split('const retryCleanup = useCallback(')[1].split('\n  }, []);')[0] + '\n  }';
const makeBefore = new Function('ownerRef', 'cleanupBusy', 'setIsCleaning', 'retryReviewMediaCleanup', 'createReviewMediaDependencies', 'supabase', 'setCleanupPending', `return (${callback});`);
const cleanup = [];
for (const variant of ['before', 'after']) {
  const ownerRef = { current: 'A' }, calls = [], busy = []; let pending = false, finish;
  const gate = new Promise(resolve => { finish = resolve; });
  const run = (_deps, id) => { calls.push(id); return id === 'A' ? gate : Promise.resolve(false); };
  const setPending = value => { pending = value; };
  const request = variant === 'before'
    ? makeBefore(ownerRef, { current: false }, value => busy.push(value), run, () => ({}), {}, setPending)
    : createLatestOwnerCleanup({ owner: () => ownerRef.current, run: id => run({}, id), result: (_id, value) => setPending(value), busy: value => busy.push(value) }).request;
  const a = request(); await Promise.resolve(); ownerRef.current = 'B'; pending = false;
  const b = request(); finish(true); await Promise.all([a, b]); cleanup.push({ variant, calls, latestOwnerPending: pending, busy });
}
if (cleanup[0].calls.join() !== 'A' || cleanup[0].latestOwnerPending || cleanup[1].calls.join() !== 'A,B' || !cleanup[1].latestOwnerPending) throw Error('OWNER_COMPARISON_FAILED');
const result = { historicalSource: base, sourceHashes: { handlerBefore: sha(rawHandler), pageBefore: sha(rawPage),
  handlerAfter: sha(readFileSync(new URL('../../lib/reviews/private-verification-handler.ts', import.meta.url))),
  queueAfter: sha(readFileSync(new URL('../../lib/reviews/latest-owner-cleanup.ts', import.meta.url))) },
  images, cleanup, performanceAdmission: 0, operatingWrites: 0, physicalFieldAdmission: 0,
  independentProcesses: 1, directBoundaryFixture: true, fullUIClaim: false };
writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
console.log(JSON.stringify({ imageCases: images.length, changed404To503: images.filter(row => row.before === 404 && row.after === 503).length, ownerBDiscovered: true }));
