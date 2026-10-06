// Real Chromium integration of committed receipt, client, main presentation seams and DOM/CSS.
// All accounts, sessions, RPC state and telemetry acknowledgements are synthetic and loopback-only.
// No live authentication, rewards, database, full 3D gameplay or native-mobile QA is claimed.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createReceiptFixture, worldRoot } from './core15-receipt-recovery-fixture.mjs';

const output = process.env.WORLD_SMOKE_EVIDENCE_DIR;
if (output) await mkdir(output, { recursive: true });
const fixture = await createReceiptFixture();
const result = { result: 'RUNNING', scope: 'Chromium component integration using committed controllers, DOM/CSS, extracted main.js presentation callbacks, actual cloud handler/store and in-memory synthetic RPC ledger',
  limitations: ['No 3D runtime boot or movement', 'No live authentication or production reward/database calls', 'Viewport tests are Chromium emulation, not native mobile device tests', 'NPC panel markup and input owner are real; NPC actor/conversation runtime is not booted'],
  sourceHashes: fixture.sourceHashes, scenarios: [], pageErrors: [], offOriginRequests: [] };
let browser;
const contexts = [];
const events = account => fixture.telemetry.filter(row => row.account === account).map(row => row.event);
const count = (account, event) => events(account).filter(type => type === event).length;
const calls = (account, event) => fixture.requests.filter(row => row.account === account && row.event === event);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, label, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (!check()) { assert.ok(Date.now() < deadline, `timed out: ${label}`); await sleep(20); }
}
const post = async (account, event) => {
  const response = await fetch(fixture.origin + '/__fixture/quest', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer synthetic:${account}` }, body: JSON.stringify({ event }) });
  return { status: response.status, body: await response.json() };
};
async function contract() {
  fixture.seed('contract');
  assert.equal((await post('contract', 'status')).body.stage, 4);
  const fresh = await post('contract', 'talk_001');
  const replay = await post('contract', 'talk_001');
  assert.equal(fresh.status, 200); assert.equal(fresh.body.reward.replayed, false);
  assert.equal(replay.body.reward, undefined); assert.equal(replay.body.rewardReceipt.replayed, true);
  assert.equal(replay.body.rewardReceipt.rewardTransactionId, fresh.body.reward.rewardTransactionId);
  assert.equal(fixture.get('contract').grants, 1);
  assert.doesNotMatch(JSON.stringify(replay.body), /userId|idempotencyKey|sourceType|attempts/);
  const receiptReads = fixture.rpcCalls.filter(row => row.rpc === 'world_reward_get_result_v1').length;
  assert.equal((await post('contract', 'status')).body.rewardReceipt, undefined);
  assert.equal(fixture.rpcCalls.filter(row => row.rpc === 'world_reward_get_result_v1').length, receiptReads);
  fixture.seed('contract-failure', { statusFailures: 1 });
  assert.equal((await post('contract-failure', 'status')).status, 503);
  assert.equal((await post('contract-failure', 'status')).body.stage, 4);
  assert.equal((await post('unregistered', 'status')).status, 401);
  const pageSource = await readFile(resolve(worldRoot, 'tests/browser/core15-receipt-recovery-page.mjs'), 'utf8');
  assert.doesNotMatch(pageSource, /\.(rewardSeen|growthSeen|nextGoalSeen)\s*\(|\.mark\s*\(/, 'fixture never injects completion milestones');
  assert.doesNotMatch(pageSource, /fetch\s*\(\s*['"]https?:/, 'browser fixture contains no absolute external endpoint');
  assert.match(fixture.seams, /onQuestReward|firstCampusCompletion.accept/);
  assert.match(fixture.seams, /inputFocus.can\("WORLD_ACTION"\)/);
  assert.match(fixture.seams, /core15Funnel\?\.nextDiscoveryClick\(\)/);
  assert.deepEqual(fixture.failures, []);
  console.log('CORE-15 fixture contracts PASS: real handler/store, one synthetic grant, replay receipt, status failure, exact main seams');
}
async function open(account, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block', ...options });
  contexts.push(context);
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin === fixture.origin) return route.continue();
    result.offOriginRequests.push(route.request().url()); return route.abort('blockedbyclient');
  });
  await context.routeWebSocket('**/*', socket => { result.offOriginRequests.push(socket.url()); socket.close(); });
  context.on('page', page => page.on('pageerror', error => result.pageErrors.push({ account, error: error.message })));
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  await page.goto(`${fixture.origin}/?account=${account}`);
  await page.waitForFunction(() => window.fixture?.ready);
  return { page, context };
}
async function seen(page, event) { await page.waitForFunction(type => fixture.status().telemetry.seen.includes(type), event); }
async function notSeen(page, ...types) {
  // Observe multiple actual animation frames, not only synchronous pre-paint state.
  const start = await page.evaluate(() => fixture.frameCount);
  await page.waitForFunction(frame => fixture.frameCount >= frame + 3, start);
  const actual = await page.evaluate(() => fixture.status().telemetry);
  for (const type of types) { assert.ok(!actual.seen.includes(type), `${type} must not be seen`); assert.ok(!actual.pending[type], `${type} must not be pending`); }
}
async function complete(page) { await page.evaluate(() => fixture.complete()); }
async function capture(page, name) { if (output) await page.screenshot({ path: resolve(output, name + '.png') }); }
function record(name, data = {}) { result.scenarios.push({ name, result: 'PASS', ...data }); console.log(`CORE-15 ${name} PASS`, JSON.stringify(data)); }

try {
  await contract();
  if (process.argv.includes('--contract')) {
    result.result = 'CONTRACT_PASS';
    result.limitations.push('Chromium not run in contract-only mode');
  } else {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true, ...(process.env.WORLD_SMOKE_EXECUTABLE ? { executablePath: process.env.WORLD_SMOKE_EXECUTABLE } : {}) });
    result.browserVersion = browser.version();
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }, { width: 740, height: 360 }]) {
      const account = `fresh-${viewport.width}`;
      fixture.seed(account, { holdProgression: true });
      const { page, context } = await open(account, { viewport, ...(viewport.width < 960 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 1 } : {}) });
      await page.evaluate(() => fixture.queueExistingToast(800));
      await complete(page);
      await notSeen(page, 'reward_seen', 'growth_seen', 'core15_complete');
      await seen(page, 'reward_seen');
      await notSeen(page, 'growth_seen', 'core15_complete');
      assert.equal(await page.evaluate(() => fixture.status().progression.snapshot.level), 1, 'stale initial HUD cannot stand in for reward readback');
      assert.equal(await page.locator('.mcm26-toast').isVisible(), true);
      assert.match(await page.locator('.mcm26-toast').innerText(), /정문 첫걸음 배지/);
      assert.match(await page.locator('.mcm26-toast').innerText(), /100 EXP/);
      await until(() => fixture.holds.has(`progression:${account}`), 'reward readback held');
      fixture.get(account).holdProgression = false; fixture.release(`progression:${account}`);
      await seen(page, 'core15_complete');
      if (viewport.height === 360) await page.evaluate(() => {
        for (const id of ['context-action', 'transport-action']) document.getElementById(id).hidden = false;
        fixture.moveToGuide();
      });
      if (viewport.height === 360) await page.waitForFunction(() => document.getElementById('quest-hud-bearing').textContent.includes('상호작용으로 대화'));
      const layout = await page.evaluate(() => {
        const rect = selector => { const node = document.querySelector(selector), r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
        const pill = document.getElementById('progression-hud');
        const growthSelector = getComputedStyle(pill).display === 'none' ? '#progression-badge' : '#progression-hud';
        const surfaces = { reward: rect('.mcm26-toast'), growth: rect(growthSelector), quest: rect('#quest-hud'), cta: rect('#next-discovery-primary'), minimap: rect('#minimap') };
        if (innerHeight === 360) { surfaces.context = rect('#context-action'); surfaces.transport = rect('#transport-action'); surfaces.bearing = rect('#quest-hud-bearing'); }
        return { viewport: { width: innerWidth, height: innerHeight }, level: document.querySelector(growthSelector).textContent, surfaces };
      });
      assert.match(layout.level, /Lv\.2/);
      for (const [name, box] of Object.entries(layout.surfaces)) assert.ok(box.width > 0 && box.height > 0 && box.left >= 0 && box.top >= 0 && box.right <= viewport.width + 1 && box.bottom <= viewport.height + 1, `${name} inside viewport ${JSON.stringify(layout)}`);
      const { cta, quest: questBox, reward: rewardBox, growth, minimap } = layout.surfaces;
      assert.ok(cta.left >= questBox.left && cta.right <= questBox.right && cta.top >= questBox.top && cta.bottom <= questBox.bottom, 'CTA inside Quest HUD');
      const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
      assert.ok(!overlaps(questBox, minimap) && !overlaps(rewardBox, growth) && !overlaps(rewardBox, cta), 'essential UI surfaces are separately readable');
      if (layout.surfaces.context) assert.ok(!overlaps(cta, layout.surfaces.context) && !overlaps(cta, layout.surfaces.transport), 'short-landscape CTA is not covered by active world controls');
      if (layout.surfaces.bearing) assert.ok(!overlaps(cta, layout.surfaces.bearing), 'real nearby-NPC bearing remains separate from the CTA');
      await capture(page, `core15-reward-growth-next-${viewport.width}x${viewport.height}`);
      await page.getByRole('button', { name: '후문 안내 학생까지 길 안내', exact: true }).click();
      await seen(page, 'next_discovery_click');
      const nav = await page.evaluate(() => fixture.status().navigation);
      assert.equal(nav.active, true); assert.equal(nav.destination.id, 'poi:core15.main2-guide');
      assert.ok(nav.routePoints.length > 1, 'actual campus navigation produced a route');
      assert.equal(await page.locator('#nav-guidance').isVisible(), true);
      assert.equal(fixture.get(account).grants, 1); assert.equal(count(account, 'core15_complete'), 1);
      assert.equal(count(account, 'core_loop_complete'), 1);
      record(`fresh-visible-${viewport.width}x${viewport.height}`, { layout, routePoints: nav.routePoints.length, grants: 1 });
      await context.close();
    }
    {
      const account = 'lost-response'; fixture.seed(account);
      const { page, context } = await open(account);
      await page.evaluate(() => { fixture.dropCompletionResponseOnce = true; });
      await complete(page);
      assert.equal(await page.evaluate(() => fixture.lastCompletionError), 'SYNTHETIC_LOST_COMPLETION_RESPONSE');
      assert.equal(await page.evaluate(() => fixture.status().recovery), true);
      assert.equal(fixture.get(account).grants, 1); assert.equal(count(account, 'first_reward'), 0);
      // Real navigation/reload retains only the production sessionStorage presentation intent.
      await page.reload(); await page.waitForFunction(() => window.fixture?.ready);
      await seen(page, 'core15_complete');
      assert.equal(await page.evaluate(() => fixture.rewards.length), 1);
      assert.equal(await page.evaluate(() => fixture.rewards[0].replayed), true);
      assert.equal(await page.evaluate(() => fixture.rewards[0].rewardTransactionId), fixture.get(account).receipt.rewardTransactionId);
      assert.equal(calls(account, 'talk_001').length, 2); assert.equal(fixture.get(account).grants, 1);
      assert.equal(count(account, 'core15_complete'), 1); assert.equal(count(account, 'core_loop_complete'), 0);
      assert.equal(await page.evaluate(() => sessionStorage.getItem('inhagame-first-campus-presentation-v1:lost-response')), null);
      await capture(page, 'core15-recovered-after-reload');
      record('lost-completion-response-real-reload', { grants: 1, completingRequests: 2, replayedReceipt: true }); await context.close();
    }
    {
      const account = 'normal-completed'; fixture.seed(account, { stage: 5 });
      const { page, context } = await open(account);
      await page.waitForFunction(() => fixture.status().main2.ready && fixture.status().quest.ready);
      await notSeen(page, 'first_reward', 'reward_seen', 'growth_seen', 'next_goal_seen', 'core15_complete');
      assert.equal(await page.locator('.mcm26-toast').isVisible(), false);
      assert.equal(calls(account, 'talk_001').length, 0); assert.equal(fixture.get(account).grants, 0);
      assert.equal(fixture.rpcCalls.some(row => row.rpc === 'world_reward_get_result_v1' && row.body.p_idempotency_key.endsWith(account)), false);
      record('normal-completed-account-no-replay'); await context.close();
    }
    {
      const account = 'status-recovery'; fixture.seed(account, { statusFailures: 1 });
      const { page, context } = await open(account);
      assert.equal(await page.evaluate(() => fixture.status().quest.statusState), 'RETRY');
      await notSeen(page, 'core15_complete');
      await page.waitForFunction(() => fixture.status().quest.ready);
      assert.equal(calls(account, 'status').filter(row => row.questId === 'campus_first_walk_v1').length, 2);
      await complete(page); await seen(page, 'core15_complete'); assert.equal(fixture.get(account).grants, 1);
      record('initial-status-failure-automatic-recovery'); await context.close();
    }
    {
      fixture.seed('late-A', { holdCompletion: true }); fixture.seed('late-B', { stage: 0 });
      const { page, context } = await open('late-A');
      await page.evaluate(() => { window.oldComplete = fixture.complete(); });
      await until(() => fixture.holds.has('completion:late-A'), 'old account completing response held');
      await page.evaluate(() => fixture.setAccount('late-B'));
      fixture.get('late-A').holdCompletion = false; fixture.release('completion:late-A');
      await page.evaluate(() => window.oldComplete);
      await notSeen(page, 'first_reward', 'reward_seen', 'growth_seen', 'core15_complete');
      assert.deepEqual(await page.evaluate(() => fixture.rewards), []);
      assert.equal(await page.evaluate(() => fixture.status().quest.stage), 0);
      assert.equal(await page.evaluate(() => fixture.status().progression.snapshot.level), 1);
      assert.equal(fixture.get('late-A').grants, 1); assert.equal(fixture.get('late-B').grants, 0);
      record('account-switch-discards-delayed-completion'); await context.close();
    }
    {
      fixture.seed('queue-A', { holdProgression: true }); fixture.seed('queue-B', { stage: 0 });
      const { page, context } = await open('queue-A');
      await page.evaluate(() => fixture.queueExistingToast(1400)); await complete(page);
      await until(() => fixture.holds.has('progression:queue-A'), 'old account reward readback held');
      await notSeen(page, 'reward_seen', 'core15_complete');
      await page.evaluate(() => fixture.setAccount('queue-B'));
      fixture.get('queue-A').holdProgression = false; fixture.release('progression:queue-A');
      await page.waitForTimeout(1700);
      await notSeen(page, 'reward_seen', 'growth_seen', 'core15_complete');
      assert.equal(await page.locator('.mcm26-toast').isVisible(), false);
      assert.equal(await page.evaluate(() => fixture.status().progression.snapshot.level), 1);
      assert.equal(count('queue-A', 'reward_seen'), 0); assert.equal(count('queue-B', 'core15_complete'), 0);
      record('account-switch-invalidates-queued-toast-and-readback'); await context.close();
    }
    {
      fixture.seed('dialogue'); const { page, context } = await open('dialogue');
      await page.evaluate(() => fixture.setDialogue(true)); await complete(page); await seen(page, 'reward_seen');
      assert.equal(await page.evaluate(() => fixture.status().visible.worldActionAllowed), false);
      await notSeen(page, 'growth_seen', 'next_goal_seen', 'core15_complete');
      await capture(page, 'core15-npc-dialogue-reward-visible');
      await page.waitForFunction(() => document.querySelector('.mcm26-toast').hidden, null, { timeout: 10000 });
      assert.equal(await page.locator('#npc-test-conversation').isVisible(), true);
      await notSeen(page, 'growth_seen', 'core15_complete');
      await page.getByRole('button', { name: '대화 닫기', exact: true }).click();
      await seen(page, 'core15_complete'); assert.equal(count('dialogue', 'core15_complete'), 1);
      record('long-npc-dialogue-reward-expires-before-input-unblocks'); await context.close();
    }
    {
      fixture.seed('hidden-surfaces'); const { page, context } = await open('hidden-surfaces');
      await page.evaluate(() => {
        document.querySelector('.mcm26-toast').style.visibility = 'hidden';
        for (const id of ['progression-hud', 'progression-badge', 'next-discovery']) document.getElementById(id).style.visibility = 'hidden';
      });
      await complete(page); await notSeen(page, 'reward_seen', 'growth_seen', 'next_goal_seen', 'core15_complete');
      await page.evaluate(() => { document.querySelector('.mcm26-toast').style.visibility = ''; }); await seen(page, 'reward_seen');
      await notSeen(page, 'growth_seen', 'next_goal_seen', 'core15_complete');
      await page.evaluate(() => { for (const id of ['progression-hud', 'progression-badge']) document.getElementById(id).style.visibility = ''; }); await seen(page, 'growth_seen');
      await notSeen(page, 'next_goal_seen', 'core15_complete');
      await page.evaluate(() => { document.getElementById('next-discovery').style.visibility = ''; }); await seen(page, 'core15_complete');
      record('actual-css-hidden-surfaces-gate-each-milestone'); await context.close();
    }
    {
      fixture.seed('clipped-cta'); const { page, context } = await open('clipped-cta');
      await page.evaluate(() => { Object.assign(document.getElementById('next-discovery').style, { width: '1px', maxWidth: '1px', padding: '0', overflow: 'hidden' }); });
      await complete(page); await seen(page, 'growth_seen');
      const clipping = await page.evaluate(() => {
        const parent = document.getElementById('next-discovery').getBoundingClientRect();
        const button = document.getElementById('next-discovery-primary').getBoundingClientRect();
        return { ancestorRight: parent.right, buttonRight: button.right, viewportRight: innerWidth };
      });
      assert.ok(clipping.buttonRight > clipping.ancestorRight && clipping.buttonRight < clipping.viewportRight, 'real overflow clips an otherwise in-viewport CTA');
      await notSeen(page, 'next_goal_seen', 'core15_complete');
      await page.evaluate(() => { document.getElementById('next-discovery').removeAttribute('style'); });
      await seen(page, 'core15_complete');
      record('ancestor-clipped-cta-never-proves-next-goal', { clipping }); await context.close();
    }
    {
      fixture.seed('lobby'); const { page, context } = await open('lobby');
      await page.evaluate(() => fixture.setLobby(true)); await complete(page);
      await notSeen(page, 'reward_seen', 'growth_seen', 'core15_complete');
      assert.equal(await page.locator('.mcm26-toast').isVisible(), false);
      await page.evaluate(() => { fixture.setTransition(true); fixture.setLobby(false); });
      await page.waitForTimeout(4700); await notSeen(page, 'reward_seen', 'core15_complete');
      await page.evaluate(() => fixture.setTransition(false)); await seen(page, 'core15_complete');
      assert.equal(await page.locator('.mcm26-toast').isVisible(), true);
      record('lobby-and-transition-pause-reward-beyond-toast-duration', { lobbyState: 'injected runtime state; lobby 3D UI not booted', blockedMs: 4700 }); await context.close();
    }
    {
      fixture.seed('background'); const { page, context } = await open('background');
      const other = await context.newPage(); await other.goto('about:blank'); await other.bringToFront();
      const nativeHidden = await page.evaluate(() => document.visibilityState === 'hidden');
      const mode = nativeHidden ? 'native Chromium tab visibility' : 'injected document.visibilityState; native headless tab remained visible';
      if (!nativeHidden) await page.evaluate(() => fixture.injectVisibilityForTest(true));
      await complete(page); await page.waitForTimeout(4700);
      assert.equal(count('background', 'reward_seen'), 0); assert.equal(count('background', 'core15_complete'), 0);
      assert.equal(await page.evaluate(() => fixture.visible().visibilityState), 'hidden');
      await other.close(); await page.bringToFront();
      if (!nativeHidden) await page.evaluate(() => fixture.restoreNativeVisibility());
      await page.waitForFunction(() => document.visibilityState === 'visible'); await seen(page, 'core15_complete');
      assert.equal(await page.locator('.mcm26-toast').isVisible(), true);
      record('background-return-preserves-presentation', { visibilityMode: mode, blockedMs: 4700, events: await page.evaluate(() => fixture.visibilityEvents) }); await context.close();
    }
    {
      fixture.seed('photo-pause'); const { page, context } = await open('photo-pause');
      await page.evaluate(() => fixture.setPhotoMode(true)); await complete(page);
      await notSeen(page, 'reward_seen', 'growth_seen', 'next_goal_seen', 'core15_complete');
      await page.waitForTimeout(4700);
      assert.equal(await page.locator('.mcm26-toast').isVisible(), false);
      assert.equal(count('photo-pause', 'reward_seen'), 0);
      await page.evaluate(() => fixture.setPhotoMode(false));
      await seen(page, 'core15_complete');
      assert.equal(await page.locator('.mcm26-toast').isVisible(), true);
      assert.equal(fixture.get('photo-pause').grants, 1);
      record('photo-mode-return-preserves-unseen-receipt', { blockedMs: 4700, grants: 1 });
      await capture(page, 'core15-photo-mode-return'); await context.close();
    }
    // Every received completion was produced by the real telemetry reducer after its required acks.
    for (const account of new Set(fixture.telemetry.map(row => row.account))) {
      const rows = fixture.telemetry.filter(row => row.account === account);
      const completed = rows.findIndex(row => row.event === 'core15_complete');
      if (completed < 0) continue;
      for (const type of ['first_reward', 'reward_seen', 'growth_seen', 'next_goal_seen']) assert.ok(rows.findIndex(row => row.event === type) >= 0 && rows.findIndex(row => row.event === type) < completed, `${account}: ${type} before completion`);
      assert.equal(count(account, 'core15_complete'), 1);
      for (const row of rows.filter(row => ['reward_seen', 'growth_seen', 'next_goal_seen'].includes(row.event))) {
        assert.equal(row.visible.visibilityState, 'visible'); assert.equal(row.visible.lobby, false); assert.equal(row.visible.photo, false);
        assert.equal(row.visible[row.event === 'reward_seen' ? 'reward' : row.event === 'growth_seen' ? 'growth' : 'nextGoal'], true);
        if (row.event !== 'reward_seen') assert.equal(row.visible.worldActionAllowed, true);
        if (row.event === 'growth_seen') assert.equal(row.visible.progression.snapshot.level, 2);
      }
    }
    assert.deepEqual(result.pageErrors, []); assert.deepEqual(result.offOriginRequests, []); assert.deepEqual(fixture.failures, []);
    result.result = 'PASS';
    console.log(`CORE-15 receipt recovery browser PASS: ${result.scenarios.length} scenarios, Chromium ${result.browserVersion}, zero off-origin requests`);
  }
} catch (error) {
  result.result = 'FAIL'; result.failure = String(error.stack ?? error);
  if (output) for (const [index, context] of contexts.entries()) for (const [pageIndex, page] of context.pages().entries()) {
    await page.screenshot({ path: resolve(output, `failure-${index}-${pageIndex}.png`) }).catch(() => {});
  }
  throw error;
} finally {
  result.syntheticLedger = fixture.ledgerSummary();
  result.requests = fixture.requests; result.rpcCalls = fixture.rpcCalls; result.telemetry = fixture.telemetry; result.serverFailures = fixture.failures;
  if (output) await writeFile(resolve(output, 'core15-receipt-recovery-result.json'), JSON.stringify(result, null, 2) + '\n');
  await browser?.close(); await fixture.close();
}
