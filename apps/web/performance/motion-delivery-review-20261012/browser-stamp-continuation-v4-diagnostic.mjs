// Actual production page, synthetic Auth/REST; no operating account or write.
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { parse } from 'dotenv';
import { catalog, serve, origin } from '../swipe-memory-diagnostic-20261011/real-sdk-runtime-v7.mjs';
import { fixtureQuery } from '../swipe-memory-diagnostic-20261011/fixture-query-v7.mjs';
const [variant, distDir] = process.argv.slice(2);
if (!['before', 'after'].includes(variant) || !/^\.next-[\w-]+$/.test(distDir)) throw Error('EXPLICIT_BUILD_REQUIRED');
const output = new URL(`stamp-${variant}-v4-diagnostic.json`, import.meta.url);
if (existsSync(output)) throw Error('OUTPUT_EXISTS');
const root = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const config = parse(readFileSync('/Users/twoimo/Documents/projects/tzudong/apps/web/.env.local'));
const owner = '11111111-1111-4111-8111-111111111111', rows = catalog(735), restaurant = rows[1].id;
const user = { id: owner, aud: 'authenticated', role: 'authenticated', email: 'fixture@local.invalid', app_metadata: { provider: 'email' }, user_metadata: { nickname: 'Fixture' } };
const jwt = [{ alg: 'HS256', typ: 'JWT' }, { sub: owner, aud: 'authenticated', role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600, session_id: '88888888-8888-4888-8888-888888888888' }, 'fixture-signature']
  .map(value => typeof value === 'string' ? Buffer.from(value).toString('base64url') : Buffer.from(JSON.stringify(value)).toString('base64url')).join('.');
const session = { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, refresh_token: 'fixture-only', user };
const result = { variant, distDir, buildId: readFileSync(`${root}/${distDir}/BUILD_ID`, 'utf8').trim(),
  data: 'Synthetic REST735/client Auth; cookie-free guest SSR', serverAuthenticationVerified:false, physicalDevice: false, operatingWrites: 0, fieldAdmission: 0,
  pageErrors: 0, consoleKinds: {}, unsupportedFixture: 0, unsupportedNames: [], mutationAttempts: 0, cases: [], passed: false };
const server = await serve({ root, distDir });
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true }); result.browser = browser.version();
  for (const width of [390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, locale: 'ko-KR', serviceWorkers: 'block' });
    await context.addCookies([{ name: `sb-${new URL(config.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0]}-auth-token`,
      value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`, domain: 'localhost', path: '/', httpOnly: false, secure: false, sameSite: 'Lax' }]);
    const page = await context.newPage();
    page.on('pageerror', () => result.pageErrors++);
    page.on('console', message => { if (message.type() === 'error') { const key = /Content Security Policy/i.test(message.text()) ? 'CSP' : 'other'; result.consoleKinds[key] = (result.consoleKinds[key] ?? 0) + 1; } });
    await page.route('http://localhost:3000/**', async route => {
      if (route.request().method() !== 'GET') { result.mutationAttempts++; return route.abort(); }
      const allowed=new Set(['rsc','next-router-state-tree','next-router-prefetch','next-url']);
      const headers=Object.fromEntries(Object.entries(route.request().headers()).filter(([key])=>allowed.has(key)));
      const reply=await fetch(route.request().url(), {headers});const responseHeaders=Object.fromEntries(reply.headers);
      delete responseHeaders['content-encoding'];delete responseHeaders['content-length'];
      return route.fulfill({status:reply.status,headers:responseHeaders,body:Buffer.from(await reply.arrayBuffer())});
    });
    await page.route('https://localhost:3000/**', async route => {
      if (route.request().method() !== 'GET') { result.mutationAttempts++; return route.abort(); }
      const url = new URL(route.request().url()); url.protocol = 'http:';
      const reply = await fetch(url), headers = Object.fromEntries(reply.headers); delete headers['content-encoding']; delete headers['content-length'];
      return route.fulfill({ status: reply.status, headers, body: Buffer.from(await reply.arrayBuffer()) });
    });
    await page.route('**/_vercel/**', route => route.abort());
    await page.route('**/api/performance/**', route => route.fulfill({ status: 204 }));
    await page.route('**/auth/v1/**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) }));
    await page.route('**/rest/v1/**', route => {
      const url = new URL(route.request().url()), name = url.pathname.split('/').pop(); let data = [], total = 0;
      if (name === 'get_current_privacy_eligibility') data = { schemaVersion: 1, eligible: true, reasonCode: 'PRIVACY_ELIGIBLE', policyVersionId: owner, policyVersion: '2026-08-04.1', contentSha256: '6e42ced065a6ea0762b85d9b5e11500fcfc535543ab50d12ffbe6490086a110b' };
      else if (route.request().method() !== 'GET' && route.request().method() !== 'HEAD' && name !== 'read_public_profile_summaries') { result.mutationAttempts++; return route.abort(); }
      else if (name === 'restaurants') { const response = fixtureQuery(rows, url.searchParams); data = response.data; total = response.total; }
      else if (name === 'read_public_profile_summaries') data = [{ user_id: owner, nickname: 'Fixture', avatar_url: null }];
      else if (!['reviews', 'review_likes', 'user_roles', 'bookmarks', 'notifications', 'pending_review_media_cleanup'].includes(name)) { result.unsupportedFixture++; result.unsupportedNames.push(name); return route.fulfill({ status: 400, contentType: 'application/json', body: '{}' }); }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `*/${total}` }, body: JSON.stringify(data) });
    });
    const check = { width, composerVisible: false, writeReviewConsumed: false, composerClosed: false, desktopRouted: false, passed: false };
    try {
      await page.goto(`${origin}/stamp?restaurant=${restaurant}&writeReview=1`, { waitUntil: 'domcontentloaded' });
      const close = page.getByRole('button', { name: '리뷰 작성 닫기', exact: true }).or(page.getByRole('button', { name: 'Close', exact: true })).or(page.getByRole('button', { name: '취소', exact: true })).first();
      await close.waitFor({ state: 'visible', timeout: 12000 }); check.composerVisible = true;
      await page.waitForURL(url => !url.searchParams.has('writeReview'), { timeout: 6000 }); check.writeReviewConsumed = true;
      await close.click(); await close.waitFor({ state: 'hidden', timeout: 6000 }); check.composerClosed = true;
      if (width < 1024) await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForURL(url => url.pathname === '/' && url.searchParams.get('panel') === 'stamp' && url.searchParams.get('restaurant') === restaurant, { timeout: 6000 });
      check.desktopRouted = true; check.passed = true;
    } catch (error) { check.failureName = error.name; }
    result.cases.push(check); await context.close();
  }
  result.passed = result.cases.every(row => row.passed) && !result.pageErrors && !result.unsupportedFixture && !result.mutationAttempts;
} finally {
  await browser?.close(); await server.close();
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); console.log(JSON.stringify(result));
}
if (!result.passed) process.exitCode = 1;
