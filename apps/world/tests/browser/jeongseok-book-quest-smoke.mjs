// Bounded, offline module smoke. Synthetic RPC/account selection; NOT real Auth or DB E2E.
// Existing browser dependencies only; no install, grant, migration, reward or external service.
// JSL_C1_HEAD_SHA=<reviewed head> WORLD_SMOKE_DISABLE_WEBGPU=1 node <this file>
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSmoke } from './harness.mjs';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
if (process.env.JSL_C1_HEAD_SHA) assert.equal(head, process.env.JSL_C1_HEAD_SHA, 'requested exact head');
const output = resolve(repoRoot, process.env.JSL_C1_OUTPUT || 'test-results/jeongseok-book-quest');
await mkdir(output, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const sourcePaths = [
  'src/jeongseok/book-quest.js', 'src/input/input-focus-manager.js', 'src/input/input-focus-owner.js',
  'src/quest/quest-registry.js', 'src/jeongseok/lobby-layout.js', 'src/jeongseok/interior-evidence.js',
  'src/jeongseok/interior-kit.js', 'src/player-dimensions.js', 'npc-factory/quest-contract.mjs',
  'npc-factory/main2-quest-contract.mjs', 'npc-factory/npc-presence.mjs'
];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path =>
  [path, hash(await readFile(new URL(`../../${path}`, import.meta.url)))])));
const report = {
  head, expectedHead: process.env.JSL_C1_HEAD_SHA || null, status: 'RUNNING', sourceHashes,
  scriptSha256: hash(await readFile(fileURLToPath(import.meta.url))),
  workingTreeDiffSha256: hash(execFileSync('git', ['diff', 'HEAD', '--binary'], { cwd: repoRoot })),
  cases: [], limits: [
    'Actual production quest and InputFocus modules, fetched unchanged from this checkout; synthetic in-memory RPC and account selection.',
    'No real Auth, PostgREST, database, grants, migrations, economic rewards or external requests. Not full World/main.js integration.',
    'Three sequential Chromium viewport contexts with native keyboard events; mobile sizes are emulation, not physical Android/iOS.',
    'The fixture canvas is only a focus target; no WebGL/WebGPU context is created. This is not GPU/performance evidence.',
    'One attempt per viewport, 10-second individual waits, 45-second case deadline after browser startup; stop on first failure.'
  ]
};
const save = () => writeFile(resolve(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);

const fixture = `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="data:,"><title>JSL-C1 synthetic RPC keyboard fixture</title>
<style>body{margin:16px;background:#e8edf2;font:16px/1.4 sans-serif}button{padding:8px;margin:4px}#application{display:block;width:200px;height:50px;border:1px solid #667}</style>
<p>Local synthetic RPC fixture. No authentication or database connection.</p>
<canvas id="application" tabindex="-1" aria-label="Focus fallback only; no graphics context"></canvas>
<button id="open-librarian">가상 사서 열기</button><button id="open-kiosk">도서 검색 열기</button>
<div id="other" hidden><button id="other-close">다른 창 닫기</button></div>
<script type="module">
import { createJeongseokBookQuest, JSL_BOOK_ANCHORS, JSL_BOOK_RPC } from '/src/jeongseok/book-quest.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '/src/input/input-focus-manager.js';
const inputFocus = createInputFocusManager(), calls = [], progress = [], events = [], pending = new Map();
const records = new Map([['synthetic-A', 0], ['synthetic-B', 0]]);
const context = { space: 'ROOM_JEONGSEOK_LOBBY', position: { ...JSL_BOOK_ANCHORS.librarian }, grounded: true, mounted: false, busy: false };
let identity = null, holdEvent = null, otherToken = null;
const client = { rpc(name, args) {
  if (name !== JSL_BOOK_RPC || !records.has(identity)) throw new Error('Unexpected synthetic RPC/account');
  const account = identity, event = args.p_event, index = calls.length;
  let stage = records.get(account);
  const nextEvent = ['start', 'search', 'select:pride_prejudice', 'report'][stage];
  if (event === nextEvent) { stage++; records.set(account, stage); }
  else if (event !== 'status') throw new Error('Unexpected synthetic progression event: ' + event);
  const response = { data: { quest_id: 'jsl_first_book_search_v1', stage, reward: null }, error: null };
  const call = { index, account, name, event, stage, held: event === holdEvent, released: false, aborted: false, reward: null };
  calls.push(call);
  const operation = call.held ? new Promise(resolve => pending.set(index, () => {
    pending.delete(index); call.released = true; resolve(response);
  })) : Promise.resolve(response);
  if (call.held) holdEvent = null;
  // Deliberately retain a held reply after abort, to exercise the production epoch fence.
  operation.abortSignal = signal => { signal.addEventListener('abort', () => { call.aborted = true; }, { once: true }); return operation; };
  return operation;
} };
const quest = createJeongseokBookQuest({ getClient: () => client, getContext: () => context, inputFocus,
  onProgress: value => progress.push(value) });
for (const which of ['librarian', 'kiosk']) document.getElementById('open-' + which).addEventListener('click', () => {
  context.position = { ...JSL_BOOK_ANCHORS[which] };
  quest.observe(which)?.trigger();
});
document.addEventListener('keydown', event => events.push({ type: event.type, code: event.code, trusted: event.isTrusted }), true);
document.addEventListener('click', event => events.push({ type: event.type, text: event.target.textContent, trusted: event.isTrusted }), true);
document.getElementById('other-close').addEventListener('click', () => {
  inputFocus.release(otherToken); otherToken = null; document.getElementById('other').hidden = true;
});
window.__JSL_C1__ = {
  quest, calls, progress, events, context, inputFocus,
  switchAccount(id) { identity = id; return quest.setAccount(id); },
  holdNext(event) { if (holdEvent) throw new Error('Already holding next request'); holdEvent = event; },
  release(index) { const release = pending.get(index); if (!release) throw new Error('No pending reply ' + index); release(); },
  openOther() { otherToken = inputFocus.claim('synthetic-other-dialog', INPUT_FOCUS_POLICY.BLOCKING_UI);
    document.getElementById('other').hidden = false; document.getElementById('other-close').focus(); },
  snapshot() { return { quest: quest.status(), focus: inputFocus.snapshot(), records: Object.fromEntries(records),
    focusInside: document.querySelector('[role=dialog]').contains(document.activeElement), activeId: document.activeElement.id,
    activeText: document.activeElement.textContent, pending: [...pending.keys()] }; }
};
</script></html>`;

const snapshot = page => page.evaluate(() => window.__JSL_C1__.snapshot());
const focused = locator => locator.evaluate(node => document.activeElement === node);
async function press(page, locator, key) {
  await locator.focus(); await page.keyboard.press(key);
}
async function stage(page, value) {
  await page.waitForFunction(value => {
    const s = window.__JSL_C1__.quest.status(); return s.stage === value && !s.busy;
  }, value);
  const s = await snapshot(page);
  assert.equal(s.focusInside, true, 'native keyboard focus survives reply rerender');
  assert.equal(s.focus.worldAction, false, 'open quest owns world input');
}
async function open(page, which, key = 'Enter') {
  await press(page, page.locator(`#open-${which}`), key);
  await page.getByRole('dialog').waitFor({ state: 'visible' });
  assert.equal(await focused(page.getByRole('button', { name: '닫기', exact: true })), true);
  assert.equal((await snapshot(page)).focus.worldAction, false);
}
async function close(page, which, key = 'Escape') {
  if (key === 'Escape') await page.keyboard.press(key);
  else await press(page, page.getByRole('button', { name: '닫기', exact: true }), key);
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  assert.equal(await focused(page.locator(`#open-${which}`)), true, 'native close restores exact opener');
  assert.equal((await snapshot(page)).focus.worldAction, true);
}
async function trap(page) {
  const lastText = await page.getByRole('dialog').evaluate(panel => [...panel.querySelectorAll('button:not([disabled]), a[href]')].at(-1).textContent);
  await page.keyboard.press('Shift+Tab');
  assert.equal((await snapshot(page)).activeText, lastText, 'Shift+Tab wraps to final focusable');
  await page.keyboard.press('Tab');
  assert.equal(await focused(page.getByRole('button', { name: '닫기', exact: true })), true, 'Tab wraps to close');
}
async function steps(page, entry) {
  await page.waitForFunction(() => Boolean(window.__JSL_C1__));
  entry.servedSourceHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
    const bytes = await (await fetch('/' + path)).arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [path, [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')];
  }))), sourcePaths);
  assert.deepEqual(entry.servedSourceHashes, sourceHashes, 'actual served production modules match checkout');
  await page.evaluate(() => window.__JSL_C1__.switchAccount('synthetic-A'));
  await open(page, 'librarian', 'Enter'); await trap(page);
  await close(page, 'librarian'); await open(page, 'librarian', 'Space');
  await close(page, 'librarian', 'Space'); await open(page, 'librarian', 'Enter');
  entry.checks.push('native Enter/Space open-close-reopen, Escape, exact opener restore, boundary Tab/Shift+Tab');
  await page.locator('#open-librarian').evaluate(node => { node.hidden = true; });
  await page.keyboard.press('Escape');
  assert.equal(await focused(page.locator('#application')), true, 'hidden HUD opener falls back to visible World canvas');
  assert.equal((await snapshot(page)).focus.worldAction, true);
  await page.locator('#open-librarian').evaluate(node => { node.hidden = false; });
  await open(page, 'librarian', 'Space');
  entry.checks.push('native Escape with hidden HUD opener restores visible tabindex=-1 canvas; normal opener works after reopening');
  await press(page, page.getByRole('button', { name: '첫 도서 찾기 시작', exact: true }), 'Space'); await stage(page, 1);
  await close(page, 'librarian'); await open(page, 'kiosk', 'Space'); await trap(page);
  await press(page, page.getByRole('button', { name: '검색 단말 사용하기', exact: true }), 'Enter'); await stage(page, 2);
  await press(page, page.getByRole('button', { name: '오만과 편견 · 제인 오스틴 (문학)', exact: true }), 'Space'); await stage(page, 3);
  await close(page, 'kiosk'); await open(page, 'librarian');
  await press(page, page.getByRole('button', { name: '책 찾은 결과 보고', exact: true }), 'Enter'); await stage(page, 4);
  assert.equal(await page.getByText('완료 기록이 서버에 저장됐어요. 인덕코인·XP 지급은 없습니다.', { exact: true }).isVisible(), true);
  entry.checks.push('synthetic stage 0→1 librarian, 1→2→3 kiosk, 3→4 librarian; real module renders every response, reward remains null');

  const old = await page.evaluate(() => {
    const f = window.__JSL_C1__; f.holdNext('status'); void f.quest.refresh(); return f.calls.at(-1).index;
  });
  assert.equal((await snapshot(page)).focusInside, true, 'pending refresh retains focus');
  await page.evaluate(() => window.__JSL_C1__.switchAccount('synthetic-B'));
  assert.equal(await focused(page.locator('#open-librarian')), true, 'account change closes and restores opener');
  assert.equal((await snapshot(page)).quest.stage, 0);
  await open(page, 'librarian', 'Space');
  await page.evaluate(() => window.__JSL_C1__.holdNext('start'));
  await press(page, page.getByRole('button', { name: '첫 도서 찾기 시작', exact: true }), 'Enter');
  const current = await page.evaluate(() => window.__JSL_C1__.calls.at(-1).index);
  await page.evaluate(index => window.__JSL_C1__.release(index), old);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  let s = await snapshot(page);
  assert.equal(s.quest.accountId, 'synthetic-B'); assert.equal(s.quest.stage, 0);
  assert.equal(s.quest.busy, true, 'late A response cannot unlock B pending command');
  assert.equal(s.focusInside, true);
  await page.evaluate(index => window.__JSL_C1__.release(index), current); await stage(page, 1);
  await page.evaluate(() => window.__JSL_C1__.switchAccount('synthetic-A'));
  s = await snapshot(page); assert.equal(s.quest.stage, 4);
  assert.deepEqual(s.records, { 'synthetic-A': 4, 'synthetic-B': 1 });
  assert.equal(s.quest.open, false); assert.equal(s.focus.worldAction, true);
  entry.checks.push('synthetic A→B→A records preserved; aborted held A reply cannot replace or unlock B pending write');

  await open(page, 'librarian'); await page.evaluate(() => window.__JSL_C1__.openOther());
  s = await snapshot(page); assert.equal(s.quest.open, false); assert.equal(s.focus.activeClaimCount, 1);
  assert.equal(s.activeId, 'other-close', 'quest yields focus to another blocking dialog');
  await page.keyboard.press('Escape'); assert.equal((await snapshot(page)).activeId, 'other-close');
  await page.keyboard.press('Space'); assert.equal((await snapshot(page)).focus.worldAction, true);
  await page.evaluate(() => window.__JSL_C1__.switchAccount(null));
  const beforeGuest = await page.evaluate(() => window.__JSL_C1__.calls.length);
  await open(page, 'kiosk', 'Space'); await trap(page);
  assert.equal(await page.getByRole('button', { name: /오만과 편견/ }).isDisabled(), true);
  assert.equal(await page.getByRole('link', { name: '현실 도서 검색은 정석 공식 홈페이지에서 확인' }).getAttribute('href'), 'https://lib.inha.ac.kr/');
  await close(page, 'kiosk');
  assert.equal(await page.evaluate(() => window.__JSL_C1__.calls.length), beforeGuest, 'guest browsing makes no synthetic RPC');
  entry.checks.push('competing modal releases only quest claim; guest catalog/link remains accessible without progress RPC');
  entry.calls = await page.evaluate(() => window.__JSL_C1__.calls);
  assert.ok(entry.calls.every(call => call.name === 'advance_jeongseok_book_quest_v1' && call.reward === null));
  entry.trustedEvents = await page.evaluate(() => window.__JSL_C1__.events.filter(event => event.trusted));
  for (const code of ['Enter', 'Space', 'Tab', 'Escape']) assert.ok(entry.trustedEvents.some(event => event.code === code), `native trusted ${code}`);
  assert.equal(await page.evaluate(() => window.__JSL_C1__.progress.filter(Boolean).every(value => value.rewardRefs.length === 0)), true);
  entry.final = await snapshot(page);
  await page.screenshot({ path: resolve(output, `${entry.name}-completed.png`) });
  entry.screenshot = `${entry.name}-completed.png`;
}

async function runCase(name, viewport, mobile) {
  const entry = { name, viewport, mobileEmulation: mobile, status: 'RUNNING', checks: [] };
  report.cases.push(entry); await save();
  let smoke, page, timer;
  const requests = [];
  try {
    smoke = await startSmoke({ viewport, contextOptions: { isMobile: mobile, hasTouch: mobile, reducedMotion: 'reduce' } });
    assert.match(smoke.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
    await smoke.context.route(`${smoke.origin}/__jsl-c1-fixture`, route => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: fixture }));
    page = await smoke.context.newPage(); page.setDefaultTimeout(10000);
    page.on('request', request => requests.push(request.url()));
    const fatal = smoke.watch(page);
    entry.browserVersion = smoke.context.browser().version();
    await Promise.race([
      (async () => { await page.goto(`${smoke.origin}/__jsl-c1-fixture`, { waitUntil: 'domcontentloaded' }); await steps(page, entry); })(),
      fatal,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('45-second case deadline exceeded')), 45000); })
    ]);
    assert.deepEqual(smoke.problems, []);
    assert.ok(requests.every(url => new URL(url).origin === smoke.origin), 'all requests remain on the loopback fixture');
    assert.ok(requests.every(url => !new URL(url).pathname.startsWith('/api/') && !url.endsWith('/src/main.js')), 'no API or full World main was loaded');
    entry.status = 'PASS';
  } catch (error) {
    entry.status = 'FAIL'; entry.error = error.stack || String(error);
    entry.failureSnapshot = page ? await snapshot(page).catch(() => null) : null;
    await page?.screenshot({ path: resolve(output, `${name}-failure.png`) }).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer); entry.requests = requests; entry.problems = smoke?.problems || [];
    await page?.close().catch(() => {}); await smoke?.close(); await save();
  }
}
try {
  for (const [name, viewport, mobile] of [
    ['desktop', { width: 1280, height: 800 }, false],
    ['portrait', { width: 390, height: 844 }, true],
    ['landscape', { width: 844, height: 390 }, true]
  ]) await runCase(name, viewport, mobile);
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.error = error.stack || String(error); process.exitCode = 1; }
finally { await save(); console.log(JSON.stringify({ status: report.status, head, report: resolve(output, 'report.json') })); }
