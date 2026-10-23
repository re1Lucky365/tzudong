/* global Bun */
import { expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const root = join(import.meta.dir, '..');
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = existsSync(chrome) ? chrome : chromium.executablePath();

// Import the real pool and markup. Only the provider is substituted; HTML is
// parsed and compared by Chromium, not by a copy of the production patcher.
const entry = `
import { markerPool } from './lib/marker-pool';
import { wrapMarkerWithPopularityTier } from './lib/evidence-engineering/popularity-marker';
const map = document.body.appendChild(document.createElement('main'));
let clicks = [];
class Marker {
  constructor({position, icon, map: target}) {
    this.position = position; this.icon = icon; this.map = target;
    this.element = document.createElement('div'); this.element.innerHTML = icon.content;
    target.append(this.element); this.iconChanges = 0;
  }
  getMap() { return this.map; }
  setMap(target) { if (this.failDetach && target === null) throw Error('provider unavailable');
    this.map = target; this.element.remove(); target?.append(this.element); }
  getPosition() { return this.position; }
  setPosition(position) { this.position = position; }
  getIcon() { return this.icon; }
  setIcon(icon) { this.icon = icon; this.element.innerHTML = icon.content; this.iconChanges++; }
  getElement() { return this.element; }
  setZIndex() {}
}
window.naver = { maps: { Marker, Event: {
  addListener(marker, event, callback) { marker.providerClick = callback; return marker; },
  removeListener(marker) { marker.providerClick = undefined; },
} } };
const position = { equals: other => other === position };
const tiers = ['standard', 'rainbow', 'ember', 'fire'];
const variants = tiers.flatMap(tier => [0, 1].flatMap(alt => [1, 2].flatMap(visits => [0, 1].map(bubble => ({tier, alt, visits, bubble})))));
function html(id, value) {
  const bubble = value.bubble ? '<div data-visible-marker-review-bubble="true">현재 리뷰</div>' : '';
  return wrapMarkerWithPopularityTier('<div data-testid="marker" data-restaurant-id="' + id + '" style="width:32px" role="button" tabindex="0" aria-label="식당">'
    + bubble + '<span data-tzuyang-visit-count-badge="true">' + value.visits + '</span><img src="/same.webp" alt="설명 ' + value.alt + '"></div>', value.tier);
}
function acquire(id, value) {
  return markerPool.acquire(id, position, {content: html(id, value), anchor: {x: 1, y: 1}}, map, () => clicks.push(id + ':' + value.tier));
}
function view(marker) {
  const element = marker.getElement();
  return { tier: element.querySelector('[data-popularity-tier]')?.getAttribute('data-popularity-tier'),
    flames: element.querySelectorAll('svg.tz-popularity-flame').length,
    alt: element.querySelector('img')?.getAttribute('alt'),
    visits: element.querySelector('[data-tzuyang-visit-count-badge]')?.textContent,
    bubbles: element.querySelectorAll('[data-visible-marker-review-bubble]').length };
}
window.__formal = {
  visualPairs() {
    let checked = 0;
    for (const before of variants) for (const after of variants) for (const released of [false, true]) {
      markerPool.clear();
      const marker = acquire('a', before);
      if (released) markerPool.release('a');
      const next = acquire('a', after); const actual = view(next);
      const expected = {tier: after.tier, flames: after.tier === 'standard' ? 0 : 1,
        alt: '설명 ' + after.alt, visits: String(after.visits), bubbles: after.bubble};
      checked++;
      if (next !== marker || JSON.stringify(actual) !== JSON.stringify(expected)) return {checked, before, after, released, actual, expected};
    }
    markerPool.clear(); return {checked};
  },
  bubbleIdentity() {
    markerPool.clear(); const marker = acquire('a', variants[0]);
    const image = marker.getElement().querySelector('img');
    const changes = marker.iconChanges;
    acquire('a', {...variants[0], bubble: 1});
    const retained = image === marker.getElement().querySelector('img');
    const result = {retained, iconChanges: marker.iconChanges - changes, ...view(marker)};
    markerPool.clear(); return result;
  },
  ownershipTraces() {
    const actions = ['a:fire', 'a:standard', 'b:ember', 'release:a', 'release:b', 'click:a', 'click:b', 'clear'];
    let checked = 0;
    function replay(trace) {
      markerPool.clear(); clicks = []; const active = new Map(); const handles = new Map();
      for (const action of trace) {
        const [id, tier] = action.split(':');
        if (id === 'release') { markerPool.release(tier); active.delete(tier); }
        else if (id === 'clear') { markerPool.clear(); active.clear(); }
        else if (id === 'click') {
          const before = clicks.length; handles.get(tier)?.providerClick?.();
          // A recycled provider handle now belongs to its current restaurant.
          // Clicking that object is not an event for its former restaurant ID.
          const owner = [...active.keys()].find(id => handles.get(id) === handles.get(tier));
          const expected = owner && active.get(owner);
          if (clicks.length !== before + (expected ? 1 : 0) || (expected && clicks.at(-1) !== owner + ':' + expected)) return {trace, action, clicks, expected};
        } else {
          const marker = acquire(id, {...variants[0], tier}); handles.set(id, marker); active.set(id, tier);
        }
        if (markerPool.getStats().activeCount !== active.size) return {trace, action, activeCount: markerPool.getStats().activeCount, expected: active.size};
        checked++;
      }
      return null;
    }
    function visit(trace) {
      const failure = replay(trace); if (failure) return failure;
      if (trace.length === 4) return null;
      for (const action of actions) { const failure = visit([...trace, action]); if (failure) return failure; }
      return null;
    }
    const failure = visit([]); markerPool.clear(); return {checked, failure};
  },
};
`;

let bundle;
let reportedBrowser = false;
async function withFixture(run) {
  if (!existsSync(executablePath)) throw new Error('FORMAL_BROWSER_REQUIRED: install the project Playwright Chromium or Google Chrome');
  bundle ??= (async () => {
    const build = await Bun.build({ entrypoints: ['marker-formal-fixture'], target: 'browser', format: 'iife', write: false,
      plugins: [{ name: 'marker-formal', setup(builder) {
        builder.onResolve({ filter: /^marker-formal-fixture$/ }, () => ({ path: 'entry', namespace: 'formal' }));
        builder.onLoad({ filter: /.*/, namespace: 'formal' }, () => ({ contents: entry, loader: 'ts', resolveDir: root }));
      } }],
    });
    if (!build.success) throw new Error(build.logs.map(String).join('\n'));
    return build.outputs[0].text();
  })();
  const browser = await chromium.launch({ executablePath, headless: true });
  if (!reportedBrowser) { console.log('FORMAL_BROWSER', browser.version()); reportedBrowser = true; }
  try {
    const page = await browser.newPage();
    await page.route('**/*', route => route.request().url() === 'https://marker-formal.test/'
      ? route.fulfill({ contentType: 'text/html', body: '<!doctype html><body></body>' }) : route.abort());
    await page.goto('https://marker-formal.test/');
    await page.addScriptTag({ content: await bundle });
    await run(page);
  } finally { await browser.close(); }
}

test('all 2,048 active/reacquired visual transitions show the current static marker and bubble', async () => {
  await withFixture(async page => {
    const result = await page.evaluate(() => window.__formal.visualPairs());
    expect(result).toEqual({ checked: 2048 });
    console.log('FORMAL_VISUAL_TRANSITIONS', result.checked);
  });
}, 60000);

test('a review-only transition retains the image and avoids an SDK icon replacement', async () => {
  await withFixture(async page => {
    expect(await page.evaluate(() => window.__formal.bubbleIdentity()))
      .toMatchObject({ retained: true, iconChanges: 0, bubbles: 1 });
  });
}, 60000);

test('every pool/click action sequence through depth four keeps current callback ownership', async () => {
  await withFixture(async page => {
    const result = await page.evaluate(() => window.__formal.ownershipTraces());
    expect(result.failure).toBeNull();
    expect(result.checked).toBe(18056);
    console.log('FORMAL_OWNERSHIP_STEPS', result.checked);
  });
}, 60000);
