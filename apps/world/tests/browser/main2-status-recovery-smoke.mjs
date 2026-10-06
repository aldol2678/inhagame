// Real Chromium, committed markup/CSS and quest client/runtime/HUD controllers.
// All sessions and server results are synthetic. No production service is called.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';

const worldRoot = fileURLToPath(new URL('../../', import.meta.url));
const html = await readFile(resolve(worldRoot, 'campus/index.html'), 'utf8');
const hud = html.match(/<section\b[^>]*id="quest-hud"[^>]*>[\s\S]*?<\/section>/)?.[0];
const minimap = html.match(/<aside\b[^>]*id="minimap"[^>]*>[\s\S]*?<\/aside>/)?.[0];
assert.ok(hud && minimap);
const fixture = `
import { createMain2QuestClient } from '/npc-factory/main2-quest-client.mjs';
import { MAIN2_QUEST_ID } from '/npc-factory/main2-quest-contract.mjs';
import { createNextDiscovery } from '/src/next-discovery.js';
import { createQuestRuntime } from '/src/quest/quest-runtime.js';
import { createTrackedQuestHud } from '/src/quest/quest-hud.js';
const el = id => document.getElementById(id);
const runtime = createQuestRuntime();
const timers = new Map();
window.fixture = { requests: [], delays: [], mode: 'fail', available: true, navigations: 0 };
const deferred = new Map();
const response = (ok, available = true) => ok
  ? { ok: true, json: async () => ({ quest_id: MAIN2_QUEST_ID, stage: 0, available }) }
  : { ok: false };
const state = window.fixture;
let seq = 0;
const client = createMain2QuestClient({ enabled: true, endpoint: '/fixture-only',
  getSession: async () => 'synthetic-token',
  setTimer: (fn, delay) => { const id = ++seq; timers.set(id, { fn, delay }); return id; },
  clearTimer: id => timers.delete(id),
  fetcher: async (_url, options) => {
    state.requests.push(JSON.parse(options.body));
    if (state.mode === 'deferred') return new Promise(resolve => deferred.set(state.requests.length - 1, resolve));
    return response(state.mode === 'success', state.available);
  }
});
const tracked = createTrackedQuestHud({ root: el('quest-hud'), openButton: el('quest-hud-open'),
  headingElement: el('quest-hud-heading'), objectiveElement: el('quest-hud-objective'), bearingElement: el('quest-hud-bearing'), runtime });
const discovery = createNextDiscovery({ root: el('next-discovery'), primaryButton: el('next-discovery-primary'),
  onProgress: progress => runtime.update(progress), onRetry: () => { state.retryPromise = client.refresh(); return state.retryPromise; }, onPrimary: () => { state.navigations++; return true; } });
client.onChange(main2Quest => discovery.syncProgress({ quest: { enabled: true, signedIn: true, ready: true, stage: 5, complete: true }, main2Quest }));
state.status = () => client.status();
state.signOut = () => client.setSignedIn(false);
state.signIn = () => client.setSignedIn(true);
state.timerCount = () => timers.size;
state.release = (index, ok) => { deferred.get(index)(response(ok)); deferred.delete(index); };
state.drain = async () => {
  while (timers.size) {
    const [id, { fn, delay }] = timers.entries().next().value;
    timers.delete(id); state.delays.push(delay); fn();
    for (let i = 0; i < 20; i++) await Promise.resolve();
  }
};
el('minimap').hidden = false;
el('minimap').removeAttribute('data-minimap-state');
await client.setSignedIn(true);
await state.drain();
state.ready = true;
if (new URL(location.href).searchParams.has('retrySuccess')) state.mode = 'success';
`;
const server = createServer(async (req, res) => {
  try {
    if (new URL(req.url, 'http://localhost').pathname === '/') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body data-space="campus">${hud}${minimap}<script type="module" src="/fixture.mjs"></script></body></html>`);
      return;
    }
    if (req.url === '/fixture.mjs') { res.setHeader('Content-Type', 'text/javascript'); res.end(fixture); return; }
    const path = resolve(worldRoot, `.${new URL(req.url, 'http://localhost').pathname}`);
    if (!path.startsWith(worldRoot.endsWith(sep) ? worldRoot : worldRoot + sep)) throw Error('invalid path');
    res.setHeader('Content-Type', extname(path) === '.css' ? 'text/css' : 'text/javascript');
    res.end(await readFile(path));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
if (process.env.WORLD_SMOKE_SERVE_ONLY === '1') {
  console.log('Isolated Main2 recovery fixture: ' + origin + '/?retrySuccess=1');
} else try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.WORLD_SMOKE_EXECUTABLE ? { executablePath: process.env.WORLD_SMOKE_EXECUTABLE } : {}) });
  const page = await browser.newPage({ serviceWorkers: 'block' });
  const errors = [], offOrigin = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    offOrigin.push(route.request().url()); return route.abort('blockedbyclient');
  });
  await page.goto(origin);
  await page.waitForFunction(() => window.fixture?.ready);
  assert.deepEqual(await page.evaluate(() => fixture.delays), [1000, 3000, 8000]);
  assert.equal(await page.evaluate(() => fixture.requests.length), 4);
  assert.equal(await page.evaluate(() => fixture.status().statusState), 'UNAVAILABLE');
  assert.equal(await page.locator('#quest-hud-open').isDisabled(), true);
  const output = process.env.WORLD_SMOKE_EVIDENCE_DIR;
  if (output) await mkdir(output, { recursive: true });
  for (const width of [360, 390, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    assert.equal(await page.getByRole('button', { name: 'Main 2 퀘스트 다시 불러오기' }).isVisible(), true);
    const layout = await page.evaluate(() => {
      const r = document.getElementById('quest-hud').getBoundingClientRect();
      const b = document.getElementById('next-discovery-primary').getBoundingClientRect();
      const m = document.getElementById('minimap').getBoundingClientRect();
      return { inside: b.left >= r.left && b.right <= r.right && b.top >= r.top && b.bottom <= r.bottom,
        onScreen: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight,
        overlapsMinimap: r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top };
    });
    assert.ok(layout.inside && layout.onScreen && !layout.overlapsMinimap, JSON.stringify({ width, ...layout }));
    if (output) await page.screenshot({ path: resolve(output, `main2-unavailable-${width}.png`) });
    console.log('Main2 unavailable layout PASS', JSON.stringify({ width, ...layout }));
  }
  await page.evaluate(() => { fixture.mode = 'success'; });
  await page.getByRole('button', { name: 'Main 2 퀘스트 다시 불러오기' }).click();
  await page.waitForFunction(() => fixture.status().statusState === 'READY');
  assert.equal(await page.evaluate(() => fixture.requests.length), 5);
  assert.equal(await page.getByRole('button', { name: '후문 안내 학생까지 길 안내' }).isVisible(), true);
  assert.equal(await page.locator('#quest-hud-open').isDisabled(), false);
  await page.getByRole('button', { name: '후문 안내 학생까지 길 안내' }).click();
  assert.equal(await page.evaluate(() => fixture.navigations), 1);
  if (output) await page.screenshot({ path: resolve(output, 'main2-recovered-1280.png') });
  await page.evaluate(() => fixture.signOut());
  assert.equal(await page.locator('#quest-hud').isVisible(), false);
  await page.evaluate(() => fixture.signIn());
  assert.equal(await page.getByRole('button', { name: '후문 안내 학생까지 길 안내' }).isVisible(), true);
  for (const lateSuccess of [true, false]) {
    await page.evaluate(async () => { fixture.mode = 'fail'; await fixture.signIn(); await fixture.drain(); });
    assert.equal(await page.evaluate(() => fixture.status().statusState), 'UNAVAILABLE');
    const oldRequest = await page.evaluate(() => { fixture.mode = 'deferred'; return fixture.requests.length; });
    await page.getByRole('button', { name: 'Main 2 퀘스트 다시 불러오기' }).click();
    await page.waitForFunction(index => fixture.requests.length === index + 1, oldRequest);
    assert.equal(await page.evaluate(() => fixture.status().statusState), 'LOADING');
    await page.evaluate(async () => { fixture.mode = 'success'; fixture.available = false; await fixture.signIn(); });
    await page.evaluate(async ({ index, ok }) => {
      fixture.release(index, ok); await fixture.retryPromise.catch(() => {});
    }, { index: oldRequest, ok: lateSuccess });
    assert.deepEqual(await page.evaluate(() => ({ state: fixture.status().statusState,
      available: fixture.status().available, timers: fixture.timerCount() })),
      { state: 'READY', available: false, timers: 0 });
    assert.equal(await page.locator('#next-discovery-primary').isVisible(), false);
    assert.equal(await page.locator('#quest-hud').isVisible(), false);
    assert.equal(await page.locator('#quest-hud-open').isDisabled(), true);
    assert.equal(await page.evaluate(() => fixture.requests.length), oldRequest + 2);
    console.log('Main2 account-switch stale ' + (lateSuccess ? 'success' : 'failure') + ' PASS');
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(offOrigin, []);
  if (output) await writeFile(resolve(output, 'main2-recovery-result.json'), JSON.stringify({
    result: 'PASS', browserVersion: browser.version(), fixture: 'committed client/runtime/HUD with synthetic sessions and responses',
    widths: [360, 390, 1280], retryDelaysMs: [1000, 3000, 8000], initialFailedRequests: 4,
    manualRetryAndGuideClick: true, signOutAndReconnect: true, lateAccountSuccessIgnored: true, lateAccountFailureIgnored: true,
    pageErrors: errors, offOriginRequests: offOrigin
  }, null, 2) + '\n');
  console.log(`Main2 recovery browser smoke PASS: Chromium ${browser.version()}, real client + HUD, synthetic responses only`);
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
