/** Real React editor + project CSS + isolated Chrome. Auth/API/data are synthetic;
 * this is browser behavior evidence, never hosted or provider execution proof. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import sharp from 'sharp';
import { thumbnailJob, type ThumbnailJob, type ThumbnailEditorDocument } from '../../lib/admin/youtube-thumbnail-generator/queue-contract';

const app = resolve(import.meta.dir, '../..');
const out = process.env.THUMBNAIL_BROWSER_EVIDENCE_DIR ?? `/private/tmp/thumbnail-editor-browser-${Date.now()}`;
mkdirSync(out, { recursive: true });
const owner = randomUUID();
const sourcePaths = ['components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator.tsx',
  'components/admin/thumbnail-generator/useThumbnailGeminiQueue.ts', 'lib/admin/youtube-thumbnail-generator/browser-queue.ts',
  'lib/admin/youtube-thumbnail-generator/browser-references.ts', 'lib/admin/youtube-thumbnail-generator/queue-contract.ts',
  'app/globals.css', 'app/app-globals.css', 'styles/admin-ui.css'];
const hashes = () => Object.fromEntries(sourcePaths.map((path) => [path, createHash('sha256').update(readFileSync(join(app, path))).digest('hex')]));
const before = hashes();
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
import {AdminYoutubeThumbnailGenerator} from './components/admin/thumbnail-generator/AdminYoutubeThumbnailGenerator';
createRoot(document.getElementById('root')).render(<main data-admin-console-shell="true" style={{height:'100dvh'}}><AdminYoutubeThumbnailGenerator /></main>);`;
const built = await Bun.build({ entrypoints: ['thumbnail-editor-fixture'], target: 'browser', format: 'iife', write: false,
  define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'isolated-editor', setup(builder) {
    builder.onResolve({ filter: /^thumbnail-editor-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ loader: 'tsx', contents: entry, resolveDir: app }));
    builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'seam' }));
    builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'seam' }));
    builder.onLoad({ filter: /.*/, namespace: 'seam' }, (args) => ({ loader: 'tsx', contents: args.path === 'auth'
      ? `export const useAuth=()=>({user:{id:${JSON.stringify(owner)}},isAdmin:true});`
      : "import React from 'react'; export default function Image({fill,unoptimized,priority,...props}) {return <img {...props}/>;}" }));
    builder.onResolve({ filter: /^@\// }, (args) => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, app) }));
  } }] });
assert.equal(built.success, true, built.logs.map(String).join('\n').slice(0, 2000));
const script = await built.outputs.find((file) => file.path.endsWith('.js'))!.text();
// Compile the actual imports/config/source inventory with pinned Tailwind, not a handwritten substitute.
const compiler = await compile('@import "./app/globals.css";\n@import "./app/app-globals.css";\n@import "./styles/admin-ui.css";', {
  base: app, onDependency() {},
});
const css = compiler.build(new Scanner({ sources: compiler.sources }).scan());
const png = await sharp({ create: { width: 1280, height: 720, channels: 3, background: '#215045' } }).png().toBuffer();
const refPng = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#a36022' } }).png().toBuffer();
let job: ThumbnailJob | null = null, editor: ThumbnailEditorDocument | undefined;
const calls: Array<{ path: string; method: string; owner: string | null }> = [];
let posts = 0, cancels = 0, referenceReads = 0, candidateReads = 0, ackLost = false;
let lastSubmitted: { model: string; roles: string[]; editor?: ThumbnailEditorDocument } | undefined;
const summary = (value: ThumbnailJob) => ({ id: value.id, requestId: value.requestId, model: value.model,
  state: value.state, cancelRequested: value.cancelRequested, createdAt: value.createdAt, updatedAt: value.updatedAt });
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, async fetch(request) {
  const url = new URL(request.url), path = url.pathname, method = request.method;
  if (path === '/bundle.js') return new Response(script, { headers: { 'Content-Type': 'text/javascript' } });
  if (path === '/style.css') return new Response(css, { headers: { 'Content-Type': 'text/css' } });
  if (path === '/admin') return new Response('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated thumbnail editor verification</title><link rel="stylesheet" href="/style.css"><div id="root"></div><script>globalThis.process={env:{NODE_ENV:"test"}};</script><script src="/bundle.js"></script></html>', { headers: { 'Content-Type': 'text/html' } });
  const publicPath = resolve(app, `public${path}`);
  if (publicPath.startsWith(join(app, 'public') + '/') && existsSync(publicPath)) return new Response(Bun.file(publicPath));
  if (!path.startsWith('/api/')) return new Response(null, { status: 404 });
  calls.push({ path: path + url.search, method, owner: request.headers.get('X-Thumbnail-Owner') });
  if (path.endsWith('/reference-candidates')) {
    candidateReads++; return Response.json({ channelId: 'UCfpaSruWW3S4dibonKXENjA', bucketStartedAt: '2026-10-23T12:00:00Z',
      references: [{ videoId: 'video000001', title: '합성 검증용 참고 영상', role: 'host' }] });
  }
  if (path.endsWith('/reference-image')) { referenceReads++; return new Response(new Uint8Array(refPng), { headers: { 'Content-Type': 'image/png' } }); }
  if (path.endsWith('/jobs')) {
    if (method === 'POST') {
      posts++; const form = await request.formData(); const input = JSON.parse(String(form.get('request')));
      lastSubmitted = input; editor = input.editor;
      const now = new Date().toISOString(), refs = [];
      for (const [index, role] of input.roles.entries()) {
        const file = form.get(`reference${index}`) as File;
        const hash = createHash('sha256').update(await file.bytes()).digest('hex');
        refs.push({ path: `${owner}/${input.requestId}/input/${index}-${hash}.png`, sha256: hash,
          mimeType: 'image/png', bytes: file.size, role });
      }
      job = thumbnailJob.parse({ id: randomUUID(), ownerId: owner, requestId: input.requestId, model: input.model,
        inputSha256: 'a'.repeat(64), input: { contract: 'thumbnail-gemini-image-v1', model: input.model, prompt: 'Synthetic browser fixture', references: refs },
        state: 'queued', workerId: null, attemptId: null, fence: 0, leaseExpiresAt: null, providerStartedAt: null,
        cancelRequested: false, result: null, createdAt: now, updatedAt: now });
      return ackLost ? new Response(null, { status: 503 }) : Response.json({ job });
    }
    return Response.json(url.searchParams.has('requestId') ? { job } : { jobs: job ? [summary(job)] : [] });
  }
  if (job && path.endsWith(`/jobs/${job.id}`)) {
    if (method === 'POST') { cancels++; job = { ...job, state: job.state === 'queued' ? 'cancelled' : job.state, cancelRequested: true }; return Response.json({ job }); }
    if (url.searchParams.has('document')) return Response.json({ document: editor ?? null });
    if (url.searchParams.has('variant')) return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
    return Response.json({ job });
  }
  if (path.endsWith('/history')) return Response.json({ runs: [], pagination: { total: 0 } });
  if (path.endsWith('/releases/current')) return Response.json({ status: 'empty' });
  if (path.endsWith('/release-candidates')) return Response.json({ status: 'empty', candidates: [] });
  return Response.json({ error: 'fixture_unhandled_route' }, { status: 400 });
} });
function succeed() {
  assert.ok(job); const now = new Date().toISOString(), attemptId = randomUUID(), prefix = `${owner}/${job.id}/${attemptId}/`;
  const asset = (name: string) => ({ path: `${prefix}${name}.png`, sha256: createHash('sha256').update(png).digest('hex'),
    bytes: png.length, width: 1280, height: 720, mimeType: 'image/png' });
  job = thumbnailJob.parse({ ...job, state: 'succeeded', workerId: randomUUID(), attemptId, fence: 1,
    providerStartedAt: now, result: { original: asset('original'), normalized: asset('normalized'),
      provenance: { providerId: 'gemini-api', model: job.model, responseModel: job.model, responseId: 'synthetic-editor',
        verification: 'official-api', modelEvidence: 'response', generatedAt: now, attemptId, inputSha256: job.inputSha256 } } });
}
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const origin = `http://127.0.0.1:${server.port}`;
const errors: string[] = [], geometry: unknown[] = []; let externalRequests = 0;
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
await context.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
await context.route('**/*', (route) => { if (new URL(route.request().url()).origin === origin) return route.continue(); externalRequests++; return route.abort(); });
const page = await context.newPage(); page.setDefaultTimeout(12_000); page.on('pageerror', (error) => errors.push(error.message.slice(0, 200)));
async function generate() {
  await page.getByRole('button', { name: '유튜브 썸네일 채팅 설정 열기' }).click();
  await page.locator('[data-thumbnail-gemini-generate]').click();
  await expect(page.locator('[data-thumbnail-gemini-status]')).toBeVisible();
  await expect.poll(() => posts).toBeGreaterThan(0);
}
try {
  await page.goto(`${origin}/admin`);
  await expect(page.locator('[data-thumbnail-chat-status-badge]')).toHaveText('접수 가능');
  if (process.env.THUMBNAIL_RUN_TASTE_INSPECTOR === '1') {
    const inspection = Bun.spawn(['/opt/homebrew/Cellar/node@24/24.22.0/bin/node',
      '/Users/twoimo/.codex/skills/taste-skill/scripts/inspect.mjs', `${origin}/admin`, '--out', join(out, 'taste'),
      '--widths', '1440,768,390', '--json'], { cwd: app, stdout: Bun.file(join(out, 'taste.stdout')), stderr: Bun.file(join(out, 'taste.stderr')) });
    const exitCode = await inspection.exited;
    writeFileSync(join(out, 'taste-exit.json'), JSON.stringify({ exitCode, dashboardConventionExceptionsRequireReview: true }));
  }
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.screenshot({ path: join(out, `editor-${width}.png`), fullPage: true });
    geometry.push(await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      canvas: document.querySelector('canvas')?.getBoundingClientRect().toJSON(),
      header: document.querySelector('[data-admin-page-header]')?.getBoundingClientRect().toJSON() })));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `horizontal overflow at ${width}`);
    const frame = await page.locator('[data-thumbnail-canvas-aspect-frame]').boundingBox();
    assert.ok(frame && frame.width > 200 && frame.height > 100, `canvas must remain visible at ${width}`);
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.getByRole('button', { name: '메인 선택', exact: true }).click();
  await page.getByRole('button', { name: '문구 수정', exact: true }).click();
  const editorField = page.locator('[data-thumbnail-canvas-inline-text-editor]');
  await editorField.fill('한상 검증 문구'); await editorField.press('Enter');
  await generate(); await expect.poll(() => job?.state).toBe('queued');
  assert.equal(posts, 1); assert.equal(lastSubmitted?.model, 'gemini-3.1-flash-image');
  assert.deepEqual(lastSubmitted?.roles, ['host']); assert.ok(editor?.textLayers.length); assert.ok(referenceReads && candidateReads);
  succeed(); await page.getByRole('button', { name: '생성 작업 상태 다시 확인' }).click();
  await expect(page.locator('[data-thumbnail-canvas-source]')).toContainText('Gemini');
  assert.equal(posts, 1);
  const download = page.waitForEvent('download'); await page.getByRole('button', { name: 'PNG 저장', exact: true }).click();
  const exported = await download; assert.ok(exported.suggestedFilename().endsWith('.png'));
  await exported.saveAs(join(out, 'export.png'));
  await page.reload(); await expect(page.locator('[data-thumbnail-chat-status-badge]')).toHaveText('접수 가능');
  await expect(page.locator('[data-thumbnail-canvas-source]')).not.toContainText('Gemini');
  await page.getByRole('button', { name: '생성 히스토리 열기' }).click();
  await page.locator(`[data-thumbnail-gemini-history-job="${job!.id}"]`).click();
  await expect(page.locator('[data-thumbnail-canvas-source]')).toContainText('Gemini');
  await page.getByRole('button', { name: '메인 선택', exact: true }).click();
  await page.getByRole('button', { name: '문구 수정', exact: true }).click();
  await expect(editorField).toHaveText(editor!.textLayers.find((layer) => layer.id === 'headline')!.content);
  await editorField.press('Enter');
  assert.equal(posts, 1);
  // A later user edit must protect the canvas from an otherwise valid result.
  await generate(); await expect.poll(() => posts).toBe(2);
  const lateId = job!.id;
  await page.locator('[data-thumbnail-add-text-layer]').click();
  await page.getByRole('button', { name: '문구 수정', exact: true }).click();
  const inline = page.locator('[data-thumbnail-canvas-inline-text-editor]');
  await expect(inline).toBeVisible(); await inline.fill('늦은 결과 보호 검증'); await inline.press('Escape');
  succeed(); await page.getByRole('button', { name: '생성 작업 상태 다시 확인' }).click();
  await expect(page.locator('[data-thumbnail-gemini-status]')).toContainText('원본');
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  assert.equal(calls.filter((call) => call.path === `/api/admin/youtube-thumbnail-generator/jobs/${lateId}?variant=normalized`).length, 0);
  await page.getByRole('button', { name: '문구 수정', exact: true }).click();
  await expect(inline).toHaveText('늦은 결과 보호 검증'); await inline.press('Escape');
  // The old successful image stays on canvas; current result is manually accessible.
  await generate(); await expect.poll(() => posts).toBe(3);
  await page.getByRole('button', { name: '중단 요청', exact: true }).click();
  await expect.poll(() => cancels).toBe(1); await expect.poll(() => job?.state).toBe('cancelled');
  // Lost enqueue acknowledgement is observed after reload, never re-submitted.
  ackLost = true; await generate(); await expect.poll(() => posts).toBe(4);
  await page.reload(); await expect(page.locator('[data-thumbnail-gemini-status]')).toBeVisible();
  await expect.poll(() => calls.filter((call) => call.method === 'GET' && call.path.includes('?requestId=')).length).toBeGreaterThan(0);
  assert.equal(posts, 4);
  assert.equal(calls.filter((call) => call.method === 'POST' && !call.path.endsWith('/jobs') && !call.path.includes('/jobs/')
    && !call.path.endsWith('/reference-candidates') && !call.path.endsWith('/reference-image')).length, 0);
  assert.equal(externalRequests, 0); assert.deepEqual(errors, []); assert.deepEqual(hashes(), before);
  writeFileSync(join(out, 'receipt.json'), JSON.stringify({ browser: browser.version(), sourceHashes: before, sourceStable: true,
    widths: [1440, 768, 390], geometry, realReactEditor: true, projectCss: true, nativeCanvas: true, reducedMotion: true,
    autoReferenceDecode: true, editorPersisted: true, sameRevisionAutoApply: true, laterEditProtected: true,
    reloadNotAutoApplied: true, historyDocumentRestored: true, pngExported: true, cancelReadback: true,
    ackLostReloadPosts: 1, totalEnqueuePosts: posts, externalRequests, providerCalls: 0,
    syntheticAuthAndApi: true, nextImageSeam: true, hostedAdminProof: false }, null, 2));
  process.stdout.write(JSON.stringify({ evidence: out, browser: browser.version(), status: 'passed', enqueuePosts: posts, externalRequests }) + '\n');
} catch (error) {
  await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => undefined);
  writeFileSync(join(out, 'failure.json'), JSON.stringify({ error: error instanceof Error ? error.message.slice(0, 2200) : 'failed',
    pageErrors: errors, posts, cancels, calls: calls.slice(-20) }, null, 2));
  throw error;
} finally { await context.close(); await browser.close(); await server.stop(true); }
