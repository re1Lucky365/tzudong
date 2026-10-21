import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser } from '@playwright/test';

const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const localTest = existsSync(chrome) ? test : test.skip;
const A = '11111111-1111-4111-8111-111111111111';
let browser: Browser | undefined;
let script: string;

beforeAll(async () => {
  if (!existsSync(chrome)) return;
  const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { LocalStoryboardWorkspace } from './components/admin/storyboard/LocalStoryboardWorkspace';
import { STORYBOARD_WORKFLOW } from './lib/admin/storyboard/production-contract';
import { STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL, STORYBOARD_GEMINI_TEXT_MODEL, storyboardGeminiDeclaredModels } from './lib/admin/storyboard/gemini-models';
const A = '${A}', now = '2026-10-05T00:00:00.000Z';
const READY = Object.freeze({ schemaVersion: 1, status: 'ready', code: 'FEATURE_DATABASE_READY' });
const scene = (n, revision) => ({ sceneNo: n, title: 'Scene ' + n, durationSec: 10, description: 'Description v' + revision, visualDirection: 'Camera',
  narration: 'Narration', caption: 'Caption', productionNotes: ['Note'], imagePrompt: 'Image', sourceIds: [], revision, image: null, imageError: null });
const doc = revision => ({ schema: STORYBOARD_WORKFLOW, projectId: A, revision, generatedAt: now, title: 'Project A v' + revision, logline: 'Fixture',
  textProvenance: { providerId: 'gemini-api', model: STORYBOARD_GEMINI_TEXT_MODEL, verification: 'official-api', generatedAt: now, requestId: A, responseId: 'fixture-response', responseModel: STORYBOARD_GEMINI_TEXT_MODEL, modelEvidence: 'response' },
  scenes: Array.from({ length: 5 }, (_, i) => scene(i + 1, revision)) });
const project = { id: A, revision: 3, status: 'partial', createdAt: now, updatedAt: now,
  request: { workflow: STORYBOARD_WORKFLOW, requestId: A, prompt: 'Fixture', sceneCount: 5, retrieval: 'none', sources: [], imageWidth: 1024, imageHeight: 576,
    providers: { externalAI: true, text: { id: 'gemini-api', model: STORYBOARD_GEMINI_TEXT_MODEL }, image: { id: 'gemini-api', model: STORYBOARD_GEMINI_DEFAULT_IMAGE_MODEL } } },
  document: doc(3) };
const workers = [{ id: 'fixture-gemini-worker', online: true, lastHeartbeat: now, models: storyboardGeminiDeclaredModels() }];
const state = window.storyboardHistoryFixture = { failPreview: '1', restores: 0 };
crypto.randomUUID ??= () => '22222222-2222-4222-8222-222222222222';
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
window.fetch = async (url, init = {}) => {
  const parsed = new URL(url, location.href), method = init.method || 'GET';
  if (parsed.pathname === '/api/admin/storyboard/production' && method === 'GET') return reply({ ok: true, readiness: READY, workers,
    projects: [{ id: A, revision: project.revision, status: 'partial', title: 'Project A', createdAt: now, updatedAt: now }] });
  if (parsed.pathname !== '/api/admin/storyboard/production/' + A) throw new Error('Unexpected fixture request');
  if (method === 'GET' && parsed.searchParams.get('versions') === '1') {
    const target = parsed.searchParams.get('targetRevision');
    if (target && target === state.failPreview) throw new TypeError('Fixture offline');
    const versions = Array.from({ length: project.revision }, (_, i) => ({ revision: i + 1, createdAt: now, title: 'Project A v' + (i + 1), sceneCount: 5 }));
    return reply({ ok: true, versions, preview: target ? doc(Number(target)) : null });
  }
  if (method === 'GET') return reply({ ok: true, project: structuredClone(project), job: null, events: [] });
  const body = JSON.parse(init.body);
  if (body.action !== 'restore' || body.revision !== project.revision) throw new Error('Unexpected mutation');
  state.restores++;
  project.revision++;
  project.document = { ...doc(body.targetRevision), revision: project.revision };
  return reply({ ok: true, project: structuredClone(project), job: null, events: [] });
};
createRoot(document.getElementById('root')).render(<LocalStoryboardWorkspace />);
`;
  const bundle = await Bun.build({
    entrypoints: ['storyboard-history-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'offline-storyboard', setup(builder) {
      builder.onResolve({ filter: /^storyboard-history-fixture$/ }, () => ({ path: 'fixture.tsx', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: fixture, loader: 'tsx', resolveDir: join(import.meta.dir, '..') }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, join(import.meta.dir, '..')) }));
    } }],
  });
  expect(bundle.success).toBe(true);
  script = await bundle.outputs[0].text();
  browser = await chromium.launch({ executablePath: chrome, headless: true });
});
afterAll(async () => { await browser?.close(); });

declare global { interface Window { storyboardHistoryFixture: { failPreview: string | null; restores: number } } }

localTest('version history keeps keyboard focus when picking, failing a preview and restoring', async () => {
  if (!browser) throw new Error('Local Chrome prerequisite missing');
  for (const width of [1280, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const errors: string[] = [], blocked: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      if (route.request().isNavigationRequest() && route.request().url().startsWith('http://storyboard.fixture.test/')) {
        return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
      }
      blocked.push(route.request().url()); return route.abort();
    });
    try {
      await page.goto(`http://storyboard.fixture.test/admin?module=storyboard&storyboardProject=${A}`);
      await page.addScriptTag({ content: script });
      await page.getByRole('button', { name: '버전 이력' }).click();
      const select = page.locator('#local-history-version');
      await select.focus();
      await select.selectOption('2');
      await playwrightExpect(page.getByText('v2 미리보기 · Project A v2')).toBeVisible();
      await playwrightExpect(select).toBeFocused();

      await select.selectOption('1');
      await playwrightExpect(page.locator('section[aria-labelledby="local-version-title"] [role="alert"]')).toBeVisible();
      await playwrightExpect(select).toBeVisible();
      await playwrightExpect(select).toBeFocused();
      await playwrightExpect(page.getByText(/v1 미리보기/)).toHaveCount(0);

      await select.selectOption('2');
      await playwrightExpect(page.getByText('v2 미리보기 · Project A v2')).toBeVisible();
      await page.getByRole('checkbox').check();
      const restore = page.getByRole('button', { name: '프로젝트 전체 복원' });
      await restore.focus();
      await page.keyboard.press('Enter');
      await playwrightExpect(page.locator('#local-history-version option[value="4"]')).toHaveCount(1);
      await playwrightExpect(select).toHaveValue('');
      await playwrightExpect(page.getByRole('button', { name: '버전 목록 새로고침' })).toBeFocused();
      expect(await page.evaluate(() => window.storyboardHistoryFixture.restores)).toBe(1);
      expect(errors).toEqual([]); expect(blocked).toEqual([]);
    } finally {
      await context.close();
    }
  }
}, 40_000);
