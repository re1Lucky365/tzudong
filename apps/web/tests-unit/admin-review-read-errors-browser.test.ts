import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect as playwrightExpect } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function bundle() {
  const entry = `
    import React, { useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { SubmissionListView } from './components/admin/SubmissionListView';
    const review = {
      id: 'review-fixture', user_id: 'user-fixture', restaurant_id: 'restaurant-fixture',
      title: '합성 리뷰', content: '합성 검수 내용', visited_at: '2026-10-01T00:00:00Z',
      verification_photo: '', food_photos: [], category: '한식', is_verified: false,
      admin_note: null, is_pinned: false, is_edited_by_admin: false,
      created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
      profiles: { nickname: '합성 작성자' }, restaurants: { name: '합성 식당', address: '' },
    };
    globalThis.fetch = async input => {
      if (input === '/api/admin/ocr-receipts') return new Response('', { status: 503 });
      throw new Error('OFFLINE_ONLY');
    };
    function Fixture() {
      const [state, setState] = useState('error');
      globalThis.__reviewFixture = {
        fail: () => setState('error'),
        success: () => setState('success'),
      };
      return <main>
        <SubmissionListView submissions={[]} reviews={state === 'success' ? [review] : []}
          initialTab="reviews" reviewsLoading={state === 'loading'} reviewsError={state === 'error'}
          onApprove={() => {}} onReject={() => {}} onDelete={() => {}}
          onRetryReviews={() => setState('loading')} />
      </main>;
    }
    createRoot(document.body.appendChild(document.createElement('div'))).render(<Fixture />);
  `;
  const built = await Bun.build({
    entrypoints: ['review-read-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"',
      'process.env.NEXT_PUBLIC_SUPABASE_URL': '""',
      'process.env.NEXT_PUBLIC_TZUDONG_LOCAL_RUNTIME': '"0"' },
    plugins: [{ name: 'review-read-fixture', setup(builder) {
      builder.onResolve({ filter: /^review-read-fixture$/ }, () => ({ path: 'fixture', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\/integrations\/supabase\/client$/ }, () => ({ path: 'client', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/image$/ }, () => ({ path: 'image', namespace: 'inert' }));
      builder.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'navigation', namespace: 'inert' }));
      builder.onLoad({ filter: /.*/, namespace: 'inert' }, args => ({ loader: 'tsx', contents: args.path === 'image'
        ? "import React from 'react'; export default function Image(props) { return <img alt={props.alt || ''} />; }"
        : args.path === 'navigation'
        ? "export const useRouter = () => ({ push() {}, replace() {}, refresh() {} }); export const usePathname = () => '/'; export const useSearchParams = () => new URLSearchParams();"
        : "export const supabase = { channel() { return { on() { return this; }, subscribe() { return this; } }; }, removeChannel() {}, from() { throw new Error('OFFLINE_ONLY'); } };" }));
    }}],
  });
  expect(built.success).toBe(true);
  if (process.env.TZUDONG_REVIEW_FIXTURE_OUTPUT) await Bun.write(process.env.TZUDONG_REVIEW_FIXTURE_OUTPUT, built.outputs[0]);
  return built.outputs[0].text();
}

(existsSync(chrome) ? test : test.skip)('real moderation component distinguishes retry states and restores focus only from removed review content', async () => {
  const browser = await chromium.launch({ executablePath: chrome, headless: true });
  try {
    const script = await bundle();
    for (const width of [1280, 1021]) {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    try {
    const page = await context.newPage();
    const pageErrors: string[] = [];
    let externalRequests = 0;
    page.on('pageerror', error => pageErrors.push(`${error.name}:${error.message.slice(0, 120)}:${error.stack?.match(/:(\d+):(\d+)/)?.slice(1).join(':') ?? 'no-line'}`));
    await page.route('**/*', route => {
      if (route.request().url() === 'https://review-errors.test/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' });
      externalRequests++;
      return route.abort();
    });
    await page.goto('https://review-errors.test/');
    await page.addScriptTag({ content: script });
    const error = page.locator('[data-admin-moderation-read-error="reviews"]');
    await playwrightExpect(error).toBeVisible();
    await playwrightExpect(page.locator('[data-admin-review-row]')).toHaveCount(0);
    const search = page.getByRole('searchbox', { name: '리뷰 검색' });
    await error.getByRole('button', { name: '다시 조회' }).click();
    await playwrightExpect(search).toBeFocused();
    await playwrightExpect(page.locator('[aria-label="리뷰 목록 로딩 중"]')).toHaveCount(1);
    await playwrightExpect(page.locator('[data-admin-review-row]')).toHaveCount(0);
    await page.evaluate(() => (window as unknown as { __reviewFixture: { success(): void } }).__reviewFixture.success());
    await playwrightExpect(page.locator('[data-admin-review-row="review-fixture"]')).toBeVisible();
    await playwrightExpect(error).toHaveCount(0);
    await playwrightExpect(search).toBeFocused();

    await search.focus();
    await page.evaluate(() => (window as unknown as { __reviewFixture: { fail(): void } }).__reviewFixture.fail());
    await playwrightExpect(error).toBeVisible();
    await playwrightExpect(search).toBeFocused();

    await page.evaluate(() => (window as unknown as { __reviewFixture: { success(): void } }).__reviewFixture.success());
    const row = page.locator('[data-admin-review-row="review-fixture"] button').first();
    await row.click();
    const detail = page.locator('[data-admin-moderation-inspector="true"]');
    await playwrightExpect(detail).toBeVisible();
    await playwrightExpect(page.locator('[data-admin-moderation-drawer]')).toHaveCount(width === 1021 ? 1 : 0);
    await playwrightExpect(detail).toBeFocused();
    await page.evaluate(() => (window as unknown as { __reviewFixture: { fail(): void } }).__reviewFixture.fail());
    await playwrightExpect(error).toBeVisible();
    await playwrightExpect(detail).toHaveCount(0);
    await playwrightExpect(error.getByRole('button', { name: '다시 조회' })).toBeFocused();
    expect(externalRequests).toBe(0);
    expect(pageErrors).toEqual([]);
    } finally {
      await context.close();
    }
    }
  } finally {
    await browser.close();
  }
}, 30_000);
