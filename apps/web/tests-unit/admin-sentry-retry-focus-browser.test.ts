import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function bundle() {
  const entry = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { AdminSentryPanel } from './components/admin/AdminSentryPanel';
    const fixture = { hold: false, release: () => {} };
    globalThis.__sentryRead = fixture;
    globalThis.fetch = async input => {
      if (!String(input).startsWith('/api/admin/sentry')) return new Response('', { status: 503 });
      if (fixture.hold) await new Promise(resolve => { fixture.release = resolve; });
      return new Response('', { status: 503 });
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
    createRoot(document.body.appendChild(document.createElement('div'))).render(
      <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminSentryPanel /></main></QueryClientProvider>);
  `;
  const built = await Bun.build({
    entrypoints: ['sentry-retry-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'sentry-retry-fixture', setup(builder) {
      builder.onResolve({ filter: /^sentry-retry-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'link'
        ? "import React from 'react'; export default React.forwardRef(function Link({ href, ...props }, ref) { return <a ref={ref} href={String(href)} {...props} />; });"
        : "export const useRouter = () => ({ push() {}, replace() {}, refresh() {} }); export const usePathname = () => '/'; export const useSearchParams = () => new URLSearchParams();" }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs[0].text();
}

declare global { interface Window { __sentryRead: { hold: boolean; release: () => void } } }

(existsSync(chrome) ? test : test.skip)('a failed sentry list keeps keyboard focus on retry', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://sentry-read.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://sentry-read.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://sentry-read.test/');
        await page.addScriptTag({ content: script });
        await playwrightExpect(page.getByRole('heading', { name: '오류 목록 조회 실패' })).toBeVisible();
        const retry = page.getByRole('button', { name: '다시 조회' });
        await page.evaluate(() => { window.__sentryRead.hold = true; });
        await retry.focus();
        await page.keyboard.press('Enter');
        await playwrightExpect(retry).toHaveAttribute('aria-busy', 'true');
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(page.getByRole('button', { name: '오류 목록 새로고침' })).not.toHaveAttribute('disabled');
        await page.evaluate(() => window.__sentryRead.release());
        await playwrightExpect(retry).toBeFocused();
        await playwrightExpect(page.getByRole('heading', { name: '오류 목록 조회 실패' })).toBeVisible();
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 60_000);
