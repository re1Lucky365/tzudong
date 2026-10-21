import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminKnowledgeGraphPanel } from './components/admin/AdminKnowledgeGraphPanel';
  const coverage = { inventoryCount: null, eligibleCount: null, analyzedCount: 0, pendingCount: null, failedCount: 0, excludedShortsCount: null, asOf: null };
  const graphPage = n => ({ revision: 'a'.repeat(64), generatedAt: '2026-10-21T00:00:00Z', coverage,
    nodes: [{ id: 'node-' + n, label: '페이지 ' + n + ' 노드', kind: 'hub', summary: '', evidence: [] }], edges: [], selected: null,
    totalNodes: 3, totalEdges: 0, filteredTotal: 3, omittedEdges: 0, nextCursor: n < 3 ? 'cursor-' + (n + 1) : null });
  const fixture = { fail: null, cursors: [] };
  globalThis.__knowledgeFixture = fixture;
  globalThis.fetch = async input => {
    const url = new URL(String(input), location.href);
    if (url.pathname !== '/api/admin/knowledge-graph') throw new Error('OFFLINE_ONLY');
    const cursor = url.searchParams.get('cursor');
    fixture.cursors.push(cursor);
    if (cursor && cursor === fixture.fail) return new Response('', { status: 503 });
    return new Response(JSON.stringify(graphPage(cursor ? Number(cursor.slice(7)) : 1)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><AdminKnowledgeGraphPanel /></main></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['knowledge-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'knowledge-fixture', setup(builder) {
      builder.onResolve({ filter: /^knowledge-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

type Fixture = { fail: string | null; cursors: Array<string | null> };
const fixture = (page: Page) => page.evaluate(() => (globalThis as unknown as { __knowledgeFixture: Fixture }).__knowledgeFixture);
const press = async (target: ReturnType<Page['locator']>) => { await target.focus(); await target.press('Enter'); };
const setFail = (page: Page, fail: string | null) => page.evaluate(value => { (globalThis as unknown as { __knowledgeFixture: Fixture }).__knowledgeFixture.fail = value; }, fail);

(existsSync(chrome) ? test : test.skip)('retrying a failed knowledge page reads the same page instead of returning to page one', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5_000);
        const pageErrors: string[] = [];
        let externalRequests = 0;
        page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://knowledge.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          externalRequests++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://knowledge.test/admin');
        await page.addScriptTag({ content: script });

        const node = (n: number) => page.locator(`[data-knowledge-node="node-${n}"]`);
        await playwrightExpect(node(1)).toBeVisible();
        await press(page.getByRole('button', { name: '다음 지식 페이지' }));
        await playwrightExpect(node(2)).toBeVisible();
        await setFail(page, 'cursor-3');
        await press(page.getByRole('button', { name: '다음 지식 페이지' }));
        const alert = page.getByRole('alert').filter({ hasText: '지식 그래프를 불러오지 못했습니다.' });
        await playwrightExpect(alert).toBeVisible();

        await setFail(page, null);
        await press(alert.getByRole('button'));
        await playwrightExpect(node(3)).toBeVisible();
        await playwrightExpect(alert).toHaveCount(0);
        expect((await fixture(page)).cursors).toEqual([null, 'cursor-2', 'cursor-3', 'cursor-3']);
        expect(externalRequests).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);
