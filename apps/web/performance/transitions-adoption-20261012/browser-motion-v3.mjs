import { chromium, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { catalog, serve, origin } from '../swipe-memory-diagnostic-20261011/real-sdk-runtime-v7.mjs';
import { fixtureQuery } from '../swipe-memory-diagnostic-20261011/fixture-query-v7.mjs';

const [variant, iteration = '0', distDir = '.next-media-followup-v7'] = process.argv.slice(2);
if (!['before', 'after'].includes(variant) || !/^\d+$/.test(iteration)) throw Error('EXPLICIT_RUN_ID_REQUIRED');
const app = new URL('../../', import.meta.url).pathname.replace(/\/$/, '');
const rows = catalog(735);
const out = file => new URL(file, import.meta.url);
const result = { variant, iteration: Number(iteration), production: true, distDir,
  buildId: readFileSync(`${app}/${distDir}/BUILD_ID`, 'utf8').trim(), node: process.version,
  fixtureSha256: createHash('sha256').update(readFileSync(new URL('../swipe-memory-diagnostic-20261011/fixture-query-v7.mjs', import.meta.url))).digest('hex'),
  fieldAdmission: 0, physicalDevice: false, data: 'Synthetic REST735 / Auth401',
  startedUtc: new Date().toISOString(), cases: [], pageErrors: 0, consoleErrors: {}, passed: false };
const server = await serve({ root: app, distDir });
let browser, currentPage;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  result.browser = browser.version();
  for (const viewport of [{ width: 390, height: 844 }, { width: 820, height: 1180 }, { width: 1440, height: 900 }]) {
    const context = await browser.newContext({ viewport, isMobile: viewport.width < 1024,
      hasTouch: viewport.width < 1024, locale: 'ko-KR', serviceWorkers: 'block' });
    const page = await context.newPage(); currentPage = page;
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    page.on('pageerror', () => result.pageErrors++);
    page.on('console', m => { if (m.type() !== 'error') return;
      const key = /Content Security Policy/i.test(m.text()) ? 'CSP' : /401/.test(m.text()) ? 'fixture401' : 'other';
      result.consoleErrors[key] = (result.consoleErrors[key] ?? 0) + 1; });
    await page.route('https://localhost:3000/**', async route => {
      if (route.request().method() !== 'GET') return route.abort();
      const url = new URL(route.request().url()); url.protocol = 'http:';
      const reply = await fetch(url), headers = Object.fromEntries(reply.headers);
      delete headers['content-encoding']; delete headers['content-length'];
      await route.fulfill({ status: reply.status, headers, body: Buffer.from(await reply.arrayBuffer()) });
    });
    await page.route('**/_vercel/**', route => route.abort());
    await page.route('**/api/performance/**', route => route.fulfill({ status: 204 }));
    await page.route('**/auth/v1/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{"code":"session_not_found"}' }));
    await page.route('**/rest/v1/**', async route => {
      if (!['GET', 'HEAD'].includes(route.request().method())) throw Error('UNAUTHORIZED_WRITE');
      const url = new URL(route.request().url());
      const response = url.pathname.endsWith('/restaurants') ? fixtureQuery(rows, url.searchParams) : { data: [], total: 0 };
      return route.fulfill({ status: 200, contentType: 'application/json',
        headers: { 'content-range': `${response.data.length ? `0-${response.data.length - 1}` : '*'}/${response.total}` }, body: JSON.stringify(response.data) });
    });
    await page.goto(origin, { waitUntil: 'domcontentloaded' });
    const mobile = viewport.width < 1024;
    const category = mobile ? page.getByRole('button', {name: /^카테고리 필터 열기/}).first() : page.getByRole('combobox', {name: '카테고리 필터', exact: true}).first();
    await expect(category).toBeVisible({timeout:30000});
    const menu = mobile ? page.locator('[data-bottom-sheet-layout-source="mobile-control-overlay-sheet"]') : page.getByRole('dialog').filter({has:page.getByPlaceholder('카테고리 검색…')});
    await category.click(); await expect(menu).toBeVisible();
    const normal = await menu.evaluate(el => { const s=getComputedStyle(el);return {animation:s.animationName,animationMs:parseFloat(s.animationDuration)*1000,transition:s.transitionProperty,filter:s.filter,willChange:s.willChange};});
    if (!mobile) {
      await page.getByPlaceholder('카테고리 검색…').fill('존재하지않는카테고리');
      await expect(page.getByText('카테고리를 찾을 수 없습니다.', {exact:true})).toBeVisible();
    }
    await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
    if (!mobile) await expect(category).toBeFocused();
    for(let i=0;i<6;i++){await category.click();await expect(menu).toBeVisible();await page.keyboard.press('Escape');await expect(menu).toHaveCount(0);}
    await page.emulateMedia({reducedMotion:'reduce'});await category.click();
    const reduced=await menu.evaluate(el=>{const s=getComputedStyle(el);return {animation:s.animationName,transition:s.transitionProperty};});
    await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto(`${origin}/?restaurant=${rows[1].id}`, { waitUntil: 'domcontentloaded' });
    const share = page.getByRole('button', { name: '맛집 공유 링크 복사', exact: true }).first();
    await expect(share).toBeVisible({ timeout: 30000 });
    const samples = [];
    for (let i = 0; i < 6; i++) {
      await share.click();
      const root = page.locator('[data-state="open"][data-swipe-direction="right"]').first();
      await expect(root).toBeVisible();
      const sample = await root.evaluate(async el => {
        const cs = getComputedStyle(el), animation = el.getAnimations()[0];
        const duration = animation?.effect?.getTiming().duration ?? 0;
        const begin = performance.now(), frames = [];
        await new Promise(resolve => { const frame = now => { const s = getComputedStyle(el);
          if (frames.length < 120) frames.push({ elapsedMs: now - begin, opacity: Number(s.opacity), transform: s.transform });
          if (now - begin >= 220) resolve(); else requestAnimationFrame(frame); }; requestAnimationFrame(frame); });
        return { animationMs: duration, transition: cs.transitionProperty, willChange: cs.willChange, filter: cs.filter, frames };
      });
      samples.push(sample);
      await root.locator('[toast-close]').click();
      await expect(root).toHaveCount(0);
      if (i < 5) await expect(share).toBeVisible({ timeout: 5000 });
    }
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await share.click();
    const root = page.locator('[data-state="open"][data-swipe-direction="right"]').first();
    await expect(root).toBeVisible();
    const toastReduced = await root.evaluate(el => { const s = getComputedStyle(el); return { animation: s.animationName,
      animationMs: parseFloat(s.animationDuration) * 1000, transition: s.transitionProperty }; });
    await page.screenshot({ path: out(`${variant}-${iteration}-${viewport.width}.png`).pathname });
    result.cases.push({ viewport, normal, reduced, toastReduced, samples, functional: { emptyResult: !mobile, focusRestored: !mobile, rapidReopens: 6, shareSuccess: 7 } });
    await context.close();
  }
  result.passed = result.pageErrors === 0;
} catch (error) {
  if (currentPage && !currentPage.isClosed()) { await currentPage.screenshot({path:out(`${variant}-${iteration}-failure.png`).pathname}); result.dom = await currentPage.locator('body').innerText(); }
  result.failure = String(error.message).slice(0, 160); process.exitCode = 1;
} finally {
  await browser?.close(); await server.close();
  result.endedUtc = new Date().toISOString();
  writeFileSync(out(`${variant}-${iteration}.json`), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: result.passed, cases: result.cases.length, failure: result.failure, pageErrors: result.pageErrors, consoleErrors: result.consoleErrors }));
}
