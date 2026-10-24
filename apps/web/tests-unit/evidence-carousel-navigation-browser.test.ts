import { expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import ts from '@typescript/old';
import { chromium, expect as ui } from '@playwright/test';

const appRoot = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const localTest = existsSync(chrome) ? test : test.skip;
const rows = JSON.parse(readFileSync(resolve(appRoot, '../../docs/evidence/marker-evidence-live-20261021-v1/reviewed-frames.json'), 'utf8'));
const frames = rows.frames.slice(0, 3).map((row: { frame: unknown }) => row.frame);

function actualPanelSwipeDeclarations(): string {
  const source = ts.createSourceFile('RestaurantDetailPanel.tsx', readFileSync(join(appRoot, 'components/restaurant/RestaurantDetailPanel.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set(['RESTAURANT_DETAIL_SWIPE_THRESHOLD', 'RESTAURANT_DETAIL_SWIPE_INTENT_RATIO',
    'contentSwipeStartXRef', 'contentSwipeStartYRef', 'contentSwipeDirectionRef', 'isContentSwipingRef',
    'handleContentSwipeStart', 'handleContentSwipeMove', 'handleContentSwipeEnd', 'handleContentSwipeCancel']);
  const declarations: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && names.has(node.name.text)) {
      names.delete(node.name.text);
      declarations.push(`const ${node.getText(source)};`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  expect([...names]).toEqual([]);
  return declarations.join('\n');
}

async function bundle() {
  const entry = `import React, { useCallback, useRef } from 'react'; import { createRoot } from 'react-dom/client';
    import { RestaurantEvidenceCarousel } from './components/restaurant/RestaurantEvidenceCarousel';
    import { handleDesktopArrowNavigationEvent } from './lib/home-map-keyboard-navigation';
    let navigations = 0, panelStarts = 0;
    window.sceneFixture = { reset: () => { navigations = 0; panelStarts = 0; }, count: () => navigations, starts: () => panelStarts };
    window.addEventListener('keydown', event => handleDesktopArrowNavigationEvent({ event,
      isDesktop: innerWidth >= 1024, isPanelOpen: true, hasCurrentRestaurant: true, swipeableCount: 2,
      onNavigate: () => { navigations++; return true; } }));
    function App() {
      const onSwipeLeft = () => { navigations++; }, onSwipeRight = onSwipeLeft, hideSwipeHint = () => { panelStarts++; };
      ${actualPanelSwipeDeclarations()}
      return <div onTouchStart={handleContentSwipeStart} onTouchMove={handleContentSwipeMove}
        onTouchEnd={handleContentSwipeEnd} onTouchCancel={handleContentSwipeCancel}>
        <div id='outside' tabIndex={0} style={{height:100}}>Restaurant navigation area</div>
        <RestaurantEvidenceCarousel frames={[${JSON.stringify(frames)}]} />
      </div>;
    }
    createRoot(document.getElementById('root')).render(<App />);`;
  const built = await Bun.build({ entrypoints: ['scene-navigation-fixture'], target: 'browser', format: 'iife', write: false,
    define: { 'process.env.NODE_ENV': '"test"' }, plugins: [{ name: 'scene-navigation', setup(builder) {
      builder.onResolve({ filter: /^scene-navigation-fixture$/ }, () => ({ path: 'entry', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: entry, loader: 'tsx', resolveDir: appRoot }));
      builder.onResolve({ filter: /^@\// }, args => ({ path: Bun.resolveSync('./' + args.path.slice(2), appRoot) }));
    }}] });
  expect(built.success).toBe(true);
  return built.outputs[0].text();
}

for (const width of [1440, 390, 820]) {
  localTest(`scene navigation keeps the restaurant selected at ${width}px`, async () => {
    const browser = await chromium.launch({ executablePath: chrome, headless: true });
    try {
      const context = await browser.newContext({ viewport: { width, height: 1000 }, hasTouch: true });
      const page = await context.newPage();
      const errors: string[] = [], external: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== 'https://scene-navigation.test') { external.push(url.origin); return route.abort(); }
        if (url.pathname.startsWith('/evidence-frames/')) return route.fulfill({contentType:'image/webp', body:readFileSync(join(appRoot,'public',url.pathname))});
        return route.fulfill({contentType:'text/html; charset=utf-8',body:`<div id="root"></div><style>
          [aria-label="영상 장면 가로 스크롤"] { display:flex; width:min(100%,420px); overflow-x:auto; gap:12px; }
          [aria-label="영상 장면 가로 스크롤"] a { display:block; flex:0 0 280px; }
          img { width:280px; height:158px; } </style>`});
      });
      await page.goto('https://scene-navigation.test/'); await page.addScriptTag({ content: await bundle() });
      const scroller = page.getByLabel('영상 장면 가로 스크롤', {exact:true});
      await ui(scroller.locator('img')).toHaveCount(3);
      const metrics = await scroller.evaluate(element => ({width:element.clientWidth, contentWidth:element.scrollWidth, overflow:getComputedStyle(element).overflowX}));
      expect(metrics.overflow).toBe('auto');
      expect(metrics.contentWidth).toBeGreaterThan(metrics.width);
      const count = () => page.evaluate(() => (window as unknown as {sceneFixture:{count():number}}).sceneFixture.count());
      const starts = () => page.evaluate(() => (window as unknown as {sceneFixture:{starts():number}}).sceneFixture.starts());
      const reset = () => page.evaluate(() => (window as unknown as {sceneFixture:{reset():void}}).sceneFixture.reset());
      if (width === 1440) {
        await scroller.focus(); await page.keyboard.press('ArrowRight');
        expect(await count()).toBe(0);
        await ui.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
        await page.locator('#outside').focus(); await page.keyboard.press('ArrowRight');
        expect(await count()).toBe(1);
        await reset();
      }
      const session = await context.newCDPSession(page);
      async function swipe(selector: string) {
        const box = await page.locator(selector).boundingBox();
        if (!box) throw new Error('SWIPE_TARGET_MISSING');
        const x = box.x + Math.min(box.width - 20, 300), y = box.y + Math.min(box.height / 2, 80);
        await session.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[{x,y,id:1}]});
        for (let step = 1; step <= 8; step++) {
          await session.send('Input.dispatchTouchEvent', {type:'touchMove',touchPoints:[{x:x-step*25,y,id:1}]});
          await page.waitForTimeout(20);
        }
        await session.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
      }
      await swipe('[aria-label="영상 장면 가로 스크롤"]');
      expect(await starts()).toBe(0);
      expect(await count()).toBe(0);
      await ui.poll(() => scroller.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
      await swipe('#outside');
      expect(await starts()).toBe(1);
      expect(await count()).toBe(1);
      expect(external).toEqual([]); expect(errors).toEqual([]);
      await context.close();
    } finally { await browser.close(); }
  }, 60_000);
}
