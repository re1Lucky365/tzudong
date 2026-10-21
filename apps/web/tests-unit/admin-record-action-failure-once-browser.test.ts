import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const entry = `
  import React from 'react';
  import { createRoot } from 'react-dom/client';
  import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
  import AdminEvaluationRoutePage from './app/admin/evaluations/page';
  import { AppToaster } from './components/ui/app-toaster';
  const id = '33333333-3333-4333-8333-333333333333';
  const fixture = { recordActionPosts: 0 };
  globalThis.__fixture = fixture;
  const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
  const onePage = { records: [{ id, name: '권한 확인 맛집', status: 'pending' }], revision: '1', filteredTotal: 1, nextCursor: null,
    warnings: { [id]: { sameVideo: { count: 0, candidates: [], message: '' }, identity: [] } },
    stats: { total: 0, pending: 0, approved: 0, hold: 0, db_conflict: 0, ready_for_approval: 0, unconfirmed_map: 0, missing: 0, not_selected: 0, deleted: 0 } };
  globalThis.fetch = async (input) => {
    const url = new URL(String(input), location.href);
    if (url.pathname === '/api/admin/evaluations' && url.searchParams.get('view') === 'page') {
      return json(onePage);
    }
    if (url.pathname === '/api/admin/record-actions') {
      fixture.recordActionPosts++;
      return json({ code: 'RECORD_ACTION_FORBIDDEN' }, 403);
    }
    return new Response('', { status: 503 });
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  createRoot(document.body.appendChild(document.createElement('div'))).render(
    <QueryClientProvider client={client}><main style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}><AdminEvaluationRoutePage.Embedded embedded /></main><AppToaster /></QueryClientProvider>);
`;

async function bundle() {
  const built = await Bun.build({
    entrypoints: ['record-action-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' },
    plugins: [{ name: 'record-action-fixture', setup(builder) {
      builder.onResolve({ filter: /^record-action-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/contexts\/AuthContext$/ }, () => ({ path: 'auth', namespace: 'inert' }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'link', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: 'dynamic', namespace: 'inert' }));
      // Under `bun test`, Bun.build misses tsconfig `paths` for this import graph.
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync(`./${args.path.slice(2)}`, appRoot) }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: {
        auth: "const value = { user: { id: 'admin-self' }, isAdmin: true, isLoading: false, profileNickname: '관리자' }; export const useAuth = () => value; export const AuthProvider = ({ children }) => children;",
        client: "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); }, storage: { from() { throw new Error('OFFLINE_ONLY'); } }, auth: { getSession: async () => ({ data: { session: null } }) } };",
        navigation: "const params = new URLSearchParams('module=evaluations'); const router = { push() {}, replace() {}, refresh() {}, prefetch() {} }; export const useRouter = () => router; export const usePathname = () => '/admin'; export const useSearchParams = () => params;",
        image: "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }",
        link: "import React from 'react'; export default React.forwardRef(function Link({ href, ...props }, ref) { return <a ref={ref} href={String(href)} {...props} />; });",
        dynamic: "export default function dynamic() { return function Dynamic() { return null; }; }",
      }[args.path] }));
    }}],
  });
  if (!built.success) throw new Error(built.logs.map(log => String(log)).join('\n').slice(0, 2000));
  return built.outputs.find(output => output.path.endsWith('.js'))!.text();
}

(existsSync(chrome) ? test : test.skip)('a record action failure shown in its dialog is not repeated as a toast', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      try {
        const page = await context.newPage();
        page.setDefaultTimeout(5_000);
        const pageErrors: string[] = [];
        const external = { count: 0 };
        page.on('pageerror', error => pageErrors.push(error.message.slice(0, 200)));
        await page.route('**/*', route => {
          if (route.request().url() === 'https://record-actions.test/admin') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
          if (!route.request().url().startsWith('https://record-actions.test/')) external.count++;
          return route.abort();
        });
        await page.addInitScript(() => { (globalThis as unknown as { process: unknown }).process = { env: { NODE_ENV: 'test' } }; });
        await page.goto('https://record-actions.test/admin');
        await page.addScriptTag({ content: script });

        await page.getByRole('button', { name: '검수 항목 삭제' }).filter({ visible: true }).first().click();
        const dialog = page.getByRole('dialog');
        await playwrightExpect(dialog.getByRole('alert')).toHaveText('관리자 권한을 확인한 뒤 다시 시도하세요.');
        await page.waitForTimeout(300);
        await playwrightExpect(page.getByText('변경 확인 필요')).toHaveCount(0);
        await playwrightExpect(page.getByText('관리자 권한을 확인한 뒤 다시 시도하세요.')).toHaveCount(1);
        expect(await page.evaluate(() => (globalThis as unknown as { __fixture: { recordActionPosts: number } }).__fixture.recordActionPosts)).toBe(1);
        expect(external.count).toBe(0);
        expect(pageErrors).toEqual([]);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
}, 90_000);
