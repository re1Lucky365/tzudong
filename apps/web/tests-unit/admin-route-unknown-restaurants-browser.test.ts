import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect, type Browser, type Page } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const routeEntry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import { AdminOverviewDashboard } from './components/admin/AdminOverviewDashboard';
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0, refetchOnWindowFocus: false, refetchOnMount: false, refetchOnReconnect: false } } });
  const bounds = { getSW: () => ({ lat: () => 37.4, lng: () => 126.8 }), getNE: () => ({ lat: () => 37.7, lng: () => 127.2 }) };
  const stub = () => new Proxy(function () {}, {
    get: (_, key) => typeof key === 'symbol' || key === 'then' ? undefined
      : key === 'getBounds' ? () => bounds
      : key === 'getZoom' ? () => 12
      : key === 'valueOf' ? () => 0
      : key === 'toString' ? () => ''
      : stub(),
    apply: () => stub(),
    construct: () => stub(),
  });
  window.naver = { maps: stub() };
  globalThis.fetch = async input => {
    const url = String(input).split('?')[0];
    if (url === '/api/dashboard/restaurants') return new Response(JSON.stringify({ error: 'Failed to build dashboard restaurants.' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    return new Response('', { status: 503 });
  };
  const stats = { pendingSubmissions: 0, pendingReviews: 0, totalRestaurants: 3, totalVideos: 0, activeBanners: 0 };
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh' }}><AdminOverviewDashboard stats={stats} isLoading={false} hasError={false} onSelectModule={() => {}} /></main></QueryClientProvider>);
`;

async function bundle(entry: string) {
  const built = await Bun.build({
    entrypoints: ['dashboard-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'dashboard-fixture', setup(builder) {
      builder.onResolve({ filter: /^dashboard-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/hooks\/use-naver-maps$/ }, () => ({ path: 'naver', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: {
        auth: "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false, profileNickname: '관리자' }; export const useAuth = () => value; export const AuthProvider = ({ children }) => children;",
        client: "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); }, auth: { getSession: async () => ({ data: { session: null } }) } };",
        naver: "const state = { isLoaded: true, loadError: null, isLoading: false, load() {} }; export const useNaverMaps = () => state;",
        navigation: "const params = new URLSearchParams('module=overview'); const router = { push() {}, replace() {}, refresh() {}, prefetch() {} }; export const useRouter = () => router; export const usePathname = () => '/admin'; export const useSearchParams = () => params;",
        image: "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }",
        link: "import React from 'react'; export default function Link({ href, children, prefetch, ...props }) { return <a href={typeof href === 'string' ? href : '#'} {...props}>{children}</a>; }",
        dynamic: "import React from 'react'; export default function dynamic() { return function Dynamic() { return null; }; }",
      }[args.path] }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}


(existsSync(chrome) ? test : test.skip)('a failed restaurant read does not show an empty local route', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle(routeEntry);
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(8_000);
      const pageErrors: string[] = [];
      let externalRequests = 0;
      page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
      await page.route('**/*', route => {
        if (route.request().url() === 'https://routes.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
        if (!route.request().url().startsWith('https://routes.test/')) externalRequests++;
        return route.abort();
      });
      await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
      try {
        await page.goto('https://routes.test/admin');
        await page.addScriptTag({ content: script });
        const quality = page.locator('[data-admin-route-quality-panel]');
        await quality.scrollIntoViewIfNeeded();
        const cell = (label: string) => quality.getByText(label, { exact: true }).locator('xpath=following-sibling::p');
        await playwrightExpect(cell('좌표 맛집')).toHaveText('미확인');
        await playwrightExpect(cell('추천 지점')).toHaveText('미확인');
        await playwrightExpect(cell('도로 경로')).toHaveText('미확인');
        await playwrightExpect(page.getByText('거리 기반 후보', { exact: true })).toHaveCount(0);
        await playwrightExpect(page.getByText('로컬 후보', { exact: true })).toHaveCount(0);
        await playwrightExpect(page.getByText('동선 미확인')).toBeVisible();
        const overlay = page.locator('[data-admin-map-status-overlay]');
        await playwrightExpect(overlay).toContainText('좌표 맛집 목록을 불러오지 못했습니다.');
        await playwrightExpect(overlay).not.toContainText('요약 API가 실패하면');
        expect(pageErrors).toEqual([]);
        expect(externalRequests).toBe(0);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 90_000);
