// Hosted-only acceptance of the unchanged /campus/ runtime. Local sockets/browsers are not used
// for verification in the coding environment. This is bounded interaction QA, NOT a walked route.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { assertMain3HostedExecution, createMain3CampusAuthority, installMain3CampusIdentity,
  MAIN3_CAMPUS_ACCOUNTS, MAIN3_CAMPUS_SHOP, MAIN3_CAMPUS_WALLET, assertMain3ServedSource } from './main3-campus-fixture.mjs';

// Fail before importing browser tooling, allocating a server, or writing evidence.
assertMain3HostedExecution(process.env);
const { startSmoke, TIMEOUT_MS } = await import('./harness.mjs');
const { MAIN3_QUEST_ID, MAIN3_QUEST_OBJECTIVES } = await import('../../npc-factory/main3-quest-contract.mjs');
const { MAIN2_GUIDE_NPC } = await import('../../npc-factory/main2-guide-contract.mjs');
const { STUDENT_CENTER_SHOP_ENTRY } = await import('../../src/shop/shop-world-interaction.js');
const { worldTimePayload, NPC_WORLD_EPOCH_MS, NPC_WORLD_PERIOD_MS } = await import('../../npc-factory/npc-world-time-contract.mjs');

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.resolve(process.env.MAIN3_CAMPUS_OUTPUT_DIR || 'test-results/main3-campus');
const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', timeout: 15000 }).trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const head = git(['rev-parse', 'HEAD']);
const sourcePaths = ['apps/world', 'apps/shared', 'packages', '.github/workflows', 'scripts'];
const report = {
  result: 'RUNNING', startedAt: new Date().toISOString(), head, expectedHead: process.env.MAIN3_EXPECTED_HEAD_SHA,
  tree: git(['rev-parse', 'HEAD^{tree}']), githubRunId: process.env.GITHUB_RUN_ID,
  githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT, runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
  scope: 'Actual /campus/ boot, NPC guide, shared HUD, shop, input owners, reload and synthetic account isolation',
  fixtures: [
    '127.0.0.2 document origin is fulfilled only from the harness 127.0.0.1 static server; unchanged production-mode hostname branch',
    'Pinned PlayCanvas and empty Supabase SDK script supplied by unchanged offline harness; every other off-origin request blocked',
    'Pre-boot fake Supabase interface supplies permanent synthetic accounts and shape-checked profile/shop/wallet/progression reads; no real login, credentials or account',
    'No-op Realtime channels have no peers and do not simulate network convergence',
    'Actual createQuestCloudHandler + createLocalQuestStore process /api/world-quest; only ordered Main1/Main2 prerequisite events are seeded',
    'Unrelated RPCs explicitly return MAIN3_OFFLINE_FIXTURE_UNAVAILABLE; fishing read returns an unavailable payload; degradations and all console warnings are recorded',
    'Fixture placement near authored MAIN2_GUIDE_NPC and STUDENT_CENTER_SHOP_ENTRY changes only local player/camera pose; no walked-route proof',
    'Fixed contract-shaped offline class_time clock; Main3 visit HTTP response is briefly held to reject optimistic progress'
  ],
  limits: ['No PostgreSQL, live Supabase, Production/Preview service, real purchase or reward validation',
    'Mobile is Chromium touch emulation at 390x844, not physical-device QA',
    'Browser account switches occur after settled responses; stale in-flight account response rejection is covered separately by client tests',
    'Framebuffer nonblank and screenshots are evidence capture, not independent visual approval'],
  visualReview: 'PENDING_INDEPENDENT_PIXEL_REVIEW', sources: [], cases: []
};
assert.equal(head, report.expectedHead, 'Checkout must be the exact PR head, not a merge ref');
const dirty = git(['status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths]);
assert.equal(dirty, '', 'Exact-head acceptance requires clean source, tests, harness and workflow inputs');
report.sourceStatus = 'clean';
for (const file of git(['ls-files', '--', ...sourcePaths]).split('\n').filter(Boolean).sort())
  report.sources.push({ path: file, sha256: sha(await readFile(path.join(repo, file))) });
const sourceHashes = new Map(report.sources.map(source => [source.path, source.sha256]));
await mkdir(output, { recursive: true });
const reportPath = path.join(output, 'report.json');
const flush = () => writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
await writeFile(path.join(output, 'head.txt'), head + '\n');
const authority = await createMain3CampusAuthority();
report.seedReceipts = authority.seedReceipts;
const watchdog = setTimeout(() => {
  report.result = 'FAIL'; report.error = 'Overall hosted acceptance deadline exceeded (720s)';
  writeFileSync(reportPath, JSON.stringify(report, null, 2)); process.exit(1);
}, 720000);

function readState() {
  const d = window.__INHAGAME_P0__, s = d.getStatus(), p = d.player.getLocalPosition();
  return { renderer: s.renderer, loading: s.loading, position: { x: p.x, y: p.y, z: p.z },
    inputEnabled: d.controller.inputEnabled, focus: s.inputFocus, online: s.online ?? d.online.status(),
    accountId: d.online.userId, main1: s.npcTest?.quest, main2: s.npcTest?.main2Quest,
    main3: s.npcTest?.main3Quest, guide: s.npcTest?.main2_guide, shop: s.shop, wallet: s.wallet,
    activeContext: d.contextActions.active ? { id: d.contextActions.active.id, label: d.contextActions.active.label,
      disabled: d.contextActions.active.disabled === true } : null };
}

function readHud() {
  const visible = element => Boolean(element && !element.hidden && element.getClientRects().length &&
    getComputedStyle(element).display !== 'none' && getComputedStyle(element).visibility !== 'hidden');
  const root = document.getElementById('quest-hud'), objective = document.getElementById('quest-hud-objective');
  return { visible: visible(root), count: document.querySelectorAll('#quest-hud').length,
    questId: root.dataset.questId, state: root.dataset.state,
    heading: document.getElementById('quest-hud-heading').textContent, objective: objective.textContent,
    legacyTourVisible: visible(document.getElementById('tour')),
    visibleLegacyQuestHuds: ['npc-quest-hud', 'main2-quest-hud'].filter(id => visible(document.getElementById(id))),
    bounds: root.getBoundingClientRect().toJSON(),
    objectiveBounds: objective.getBoundingClientRect().toJSON(), viewport: { width: innerWidth, height: innerHeight } };
}

async function checkHud(page, stage) {
  const hud = await page.evaluate(readHud);
  assert.equal(hud.count, 1, 'one shared tracked HUD'); assert.equal(hud.visible, true);
  assert.equal(hud.questId, 'quest.main.first_style'); assert.match(hud.heading, /^MAIN 03 · 내 첫 캠퍼스룩$/);
  assert.equal(hud.objective, MAIN3_QUEST_OBJECTIVES[stage]);
  assert.equal(hud.legacyTourVisible, false, 'completed Main1 must not leave a duplicate tour HUD');
  assert.deepEqual(hud.visibleLegacyQuestHuds, [], 'legacy quest HUDs must not duplicate the tracked HUD');
  assert.ok(hud.bounds.width > 0 && hud.bounds.x >= -1 && hud.bounds.right <= hud.viewport.width + 1 &&
    hud.bounds.y >= -1 && hud.bounds.bottom <= hud.viewport.height + 1, 'tracked Korean HUD fits viewport');
  assert.ok(hud.objectiveBounds.width > 0 && hud.objectiveBounds.right <= hud.bounds.right + 1,
    'objective is present within the actual HUD');
  return hud;
}

// Only player/camera setup. The live app, all update handlers, NPC logic, input owners and rendering
// continue normally. No guide/quest/controller method is replaced or called to synthesize progress.
async function placePlayer(page, target, kind) {
  return page.evaluate(async ({ target, kind }) => {
    const d = window.__INHAGAME_P0__;
    const { roadviewGroundHeight } = await import('/src/roadview-layout.js');
    if (!d.controller.inputEnabled || d.controller.mounted || d.rooms.insideRoom || d.lobbyWorld.active)
      throw Error('Fixture placement requires ordinary outdoor player input');
    const x = target.x + (kind === 'guide' ? 0.8 : 0), z = target.z;
    const y = (roadviewGroundHeight(x, z) ?? 0) + d.controller.groundY;
    d.player.setLocalPosition(x, y, z);
    d.controller.velocityY = 0; d.controller.grounded = true; d.controller.jumpQueued = false;
    d.orbit.yaw = kind === 'guide' ? 0 : Math.PI;
    d.orbit.pitch = Math.PI * 24 / 180; d.orbit.thirdPersonPitch = d.orbit.pitch;
    d.orbit.distance = 7; d.orbit.distances.walk = 7;
    return { kind, authored: target, placed: { x, y, z }, proof: 'fixture placement; not walked route' };
  }, { target, kind });
}

async function renderedPixels(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const app = window.__INHAGAME_P0__.app;
    const timer = setTimeout(() => { app.off('postrender', finish); reject(Error('Rendered frame deadline')); }, 12000);
    function finish() {
      clearTimeout(timer);
      try {
        const gl = app.graphicsDevice.gl;
        if (!gl || !(gl instanceof WebGL2RenderingContext)) throw Error('Actual WebGL2 framebuffer required');
        gl.finish();
        const width = gl.drawingBufferWidth, height = gl.drawingBufferHeight, bytes = new Uint8Array(width * height * 4);
        const previous = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, bytes); }
        finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previous); }
        const colors = new Set(); let sum = 0, square = 0;
        for (let i = 0; i < bytes.length; i += 16) {
          const l = (bytes[i] + bytes[i + 1] + bytes[i + 2]) / 3;
          sum += l; square += l * l; colors.add((bytes[i] >> 4) * 256 + (bytes[i + 1] >> 4) * 16 + (bytes[i + 2] >> 4));
        }
        const count = Math.ceil(bytes.length / 16);
        resolve({ width, height, colors: colors.size, luminanceStddev: Math.sqrt(Math.max(0, square / count - (sum / count) ** 2)),
          glError: gl.getError(), contextLost: gl.isContextLost() });
      } catch (error) { reject(error); }
    }
    app.once('postrender', finish); app.renderNextFrame = true;
  }));
}

try {
  for (const [mode, viewport] of [['desktop', { width: 1280, height: 720 }], ['mobile', { width: 390, height: 844 }]]) {
    const mobile = mode === 'mobile', accounts = MAIN3_CAMPUS_ACCOUNTS[mode];
    const entry = { mode, viewport, result: 'RUNNING', screenshots: [], placements: [], states: {},
      warnings: [], errors: [], routeErrors: [], blockedSockets: [], requests: [], staticResponses: [], rpcSnapshots: [], unavailableHttpReads: [] };
    report.cases.push(entry); await flush();
    let smoke, page, releaseVisit, heldVisit = null;
    try {
      smoke = await startSmoke({ viewport, contextOptions: { isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 } });
      // 127.0.0.2 is a secure-context loopback hostname, outside main.js's explicit local-preview
      // allowlist. ALL requests here are intercepted; bytes still come only from 127.0.0.1.
      const fixture = new URL(smoke.origin); fixture.hostname = '127.0.0.2'; const origin = fixture.origin;
      entry.documentOrigin = origin; entry.staticSourceOrigin = smoke.origin;
      await smoke.context.addInitScript(installMain3CampusIdentity,
        { accounts, shop: MAIN3_CAMPUS_SHOP, wallet: MAIN3_CAMPUS_WALLET });
      await smoke.context.routeWebSocket('**', socket => { entry.blockedSockets.push(socket.url()); socket.close(); });
      const clock = worldTimePayload(NPC_WORLD_EPOCH_MS + NPC_WORLD_PERIOD_MS + 1000);
      await smoke.context.route(`${origin}/**`, async route => {
        const request = route.request(), url = new URL(request.url());
        try {
          if (url.pathname === '/api/world-quest') {
            if (request.method() === 'GET') return route.fulfill({ status: 200, json: { enabled: true } });
            const response = await authority.request({ method: request.method(), headers: request.headers(), body: request.postData() ?? '' });
            if (response.json?.quest_id === MAIN3_QUEST_ID && JSON.parse(request.postData()).event === 'visit_student_center') {
              heldVisit = response.json;
              await new Promise(resolve => { releaseVisit = resolve; });
            }
            return route.fulfill({ status: response.status, headers: response.headers, body: response.body });
          }
          if (url.pathname === '/api/world-time') return route.fulfill({ status: 200, json: clock });
          if (url.pathname === '/api/public-supabase-config') return route.fulfill({ status: 200,
            contentType: 'text/javascript', body: '/* offline synthetic Supabase supplied before boot */' });
          if (url.pathname === '/api/world-fishing') {
            assert.equal(request.method(), 'POST');
            assert.deepEqual(JSON.parse(request.postData()), { op: 'read' }, 'Only unrelated fishing status reads are allowed');
            entry.unavailableHttpReads.push({ path: url.pathname, op: 'read', reason: 'MAIN3_OFFLINE_FIXTURE_UNAVAILABLE' });
            return route.fulfill({ status: 200, json: { error: 'MAIN3_OFFLINE_FIXTURE_UNAVAILABLE' } });
          }
          if (url.pathname.startsWith('/api/')) {
            if (request.method() === 'GET') return route.fulfill({ status: 200, json: { enabled: false } });
            assert.equal(url.pathname, '/api/hub-event', 'No unrelated API mutation is allowed');
            return route.fulfill({ status: 204 });
          }
          assert.equal(request.method(), 'GET', 'Static proxy is read-only');
          const localUrl = smoke.origin + url.pathname + url.search;
          const response = await route.fetch({ url: localUrl, maxRedirects: 0 });
          assert.ok(response.status() < 300 || response.status() >= 400, 'Static redirects cannot leave the loopback proxy');
          const bytes = await response.body();
          const verified = response.ok() ? assertMain3ServedSource(url.pathname, bytes, sourceHashes) : null;
          entry.staticResponses.push({ path: url.pathname, source: localUrl, status: response.status(),
            bytes: bytes.length, sha256: sha(bytes), trackedSource: verified?.path ?? null });
          return route.fulfill({ response, body: bytes });
        } catch (error) {
          entry.routeErrors.push({ path: url.pathname, error: String(error) });
          await route.abort('failed');
        }
      });
      page = await smoke.context.newPage(); page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(TIMEOUT_MS);
      const fatal = smoke.watch(page);
      const wait = (fn, arg = null) => Promise.race([page.waitForFunction(fn, arg, { timeout: TIMEOUT_MS }), fatal]);
      const action = locator => mobile ? locator.tap() : locator.click();
      page.on('console', message => { if (message.type() === 'warning') entry.warnings.push(message.text()); });
      page.on('pageerror', error => entry.errors.push(`pageerror: ${error.stack || error.message}`));
      page.on('request', request => {
        const url = new URL(request.url());
        entry.requests.push({ method: request.method(), url: url.origin + url.pathname });
      });
      page.on('requestfailed', request => {
        const url = new URL(request.url());
        if (url.origin !== origin) return; // Harness records/blocks off-origin requests independently.
        // Only this known 204 stub can produce Chromium's artificial ERR_ABORTED.
        if (url.pathname === '/api/hub-event' && request.failure()?.errorText === 'net::ERR_ABORTED') return;
        entry.errors.push(`requestfailed: ${url.pathname} ${request.failure()?.errorText}`);
      });
      page.on('response', response => {
        const url = new URL(response.url());
        if (url.origin === origin && response.status() >= 400) entry.errors.push(`HTTP ${response.status()}: ${url.pathname}`);
        if (url.origin !== origin && url.origin !== smoke.origin &&
          !(url.hostname === 'cdn.jsdelivr.net' && /^\/npm\/(playcanvas@|@supabase\/supabase-js@)/.test(url.pathname)))
          entry.errors.push(`Unexpected external response: ${url.origin}${url.pathname}`);
      });
      const capture = async label => {
        await page.evaluate(() => document.fonts.ready);
        const pixels = await renderedPixels(page);
        assert.ok(!pixels.contextLost && pixels.glError === 0 && pixels.colors > 15 && pixels.luminanceStddev > 4,
          `${label}: real campus framebuffer is nonblank`);
        const file = `${mode}-${label}.png`, bytes = await page.screenshot({ path: path.join(output, file), fullPage: false, animations: 'disabled' });
        entry.screenshots.push({ file, sha256: sha(bytes), bytes: bytes.length, pixels, visualReview: 'PENDING_INDEPENDENT_PIXEL_REVIEW' });
        await flush();
      };
      const ready = async stage => {
        await wait(stage => { const s = window.__INHAGAME_P0__?.getStatus();
          return s?.loading?.finished && s.npcTest?.main3Quest?.ready && s.npcTest.main3Quest.stage === stage;
        }, stage);
        const s = await page.evaluate(readState); assert.equal(s.renderer, 'WebGL2'); assert.equal(s.loading.phase, 'READY');
        return s;
      };
      const enterCampus = async () => {
        await action(page.locator('#main-gate-start'));
        await wait(() => { const d = window.__INHAGAME_P0__;
          return !d.lobbyWorld.active && !d.lobbyTransition.active && d.controller.inputEnabled &&
            document.getElementById('lobby-transition-fade').hidden;
        });
      };
      const snapshotRpc = async label => entry.rpcSnapshots.push({ label, ...await page.evaluate(() => ({
        calls: window.__MAIN3_CAMPUS_FIXTURE__.rpcCalls, forbidden: window.__MAIN3_CAMPUS_FIXTURE__.forbiddenRpcCalls,
        unavailable: window.__MAIN3_CAMPUS_FIXTURE__.unavailableRpcCalls,
        onlineErrors: window.__INHAGAME_P0__.online.errors
      })) });
      const pressContext = async id => {
        await wait(id => window.__INHAGAME_P0__.contextActions.active?.id === id &&
          !document.getElementById('context-action').hidden, id);
        if (mobile) await page.locator('#context-action').tap(); else await page.keyboard.press('f');
      };
      await page.goto(`${origin}/campus/?lobby=1`, { waitUntil: 'domcontentloaded' });
      entry.states.boot = await ready(0);
      assert.equal(entry.states.boot.main1.stage, 5); assert.equal(entry.states.boot.main2.stage, 9);
      assert.equal(entry.states.boot.main3.available, true); assert.equal(entry.states.boot.accountId, accounts[0].id);
      await enterCampus(); entry.states.hud0 = await checkHud(page, 0);
      entry.placements.push(await placePlayer(page, MAIN2_GUIDE_NPC.position, 'guide'));
      await pressContext('main2-guide-talk');
      await page.locator('#main2-guide-dialogue').waitFor({ state: 'visible' });
      entry.states.guideOpen = await page.evaluate(readState);
      assert.equal(entry.states.guideOpen.focus.owners.npcDialogue, true);
      assert.equal(entry.states.guideOpen.inputEnabled, false);
      assert.equal(await page.getByRole('button', { name: '굿즈샵 가보기', exact: true }).count(), 1);
      await capture('guide-cta-stage0');
      await page.keyboard.down('w'); await page.waitForTimeout(250); await page.keyboard.up('w');
      const locked = await page.evaluate(readState);
      assert.ok(Math.hypot(locked.position.x - entry.states.guideOpen.position.x,
        locked.position.z - entry.states.guideOpen.position.z) < 0.03, 'dialogue locks actual movement');
      await action(page.getByRole('button', { name: '굿즈샵 가보기', exact: true }));
      await ready(1);
      await action(page.locator('#main2-guide-dialogue').getByRole('button', { name: '알겠어요', exact: true }));
      await wait(() => window.__INHAGAME_P0__.controller.inputEnabled);
      entry.states.hud1 = await checkHud(page, 1); await capture('tracked-hud-stage1');

      // Negative control uses the actual menu, at the guide, not a stub button or direct panel API.
      await action(page.locator('#hud-menu-toggle')); await action(page.locator('#open-shop'));
      await wait(() => window.__INHAGAME_P0__.getStatus().shop.state === 'READY');
      assert.equal((await page.evaluate(readState)).main3.stage, 1, 'menu shop open is not a visit');
      assert.equal(await page.locator('#shop-panel .shop-offer').count(), 1);
      assert.match(await page.locator('#shop-panel').innerText(), /인덕 캠퍼스 캡/);
      await action(page.getByRole('button', { name: '상점 닫기', exact: true }));
      await wait(() => window.__INHAGAME_P0__.controller.inputEnabled);
      assert.equal(authority.calls.filter(call => call.accountId === accounts[0].id && call.questId === MAIN3_QUEST_ID &&
        call.event === 'visit_student_center').length, 0, 'no visit request from menu');

      entry.placements.push(await placePlayer(page, STUDENT_CENTER_SHOP_ENTRY, 'shop'));
      await wait(() => window.__INHAGAME_P0__.contextActions.active?.id === 'student-center-shop');
      entry.states.proximity = await page.evaluate(readState);
      assert.equal(entry.states.proximity.main3.stage, 1, 'proximity alone cannot progress');
      await capture('world-entry-stage1');
      await pressContext('student-center-shop');
      await page.locator('#shop-panel').waitFor({ state: 'visible' });
      await wait(() => window.__INHAGAME_P0__.getStatus().shop.state === 'READY');
      // Wait on local routing progress without altering the app or faking its server response.
      for (let i = 0; i < 100 && !heldVisit; i++) await new Promise(resolve => setTimeout(resolve, 20));
      assert.equal(heldVisit?.stage, 2, 'actual handler accepted the canonical visit event');
      entry.states.awaitingAuthority = await page.evaluate(readState);
      assert.equal(entry.states.awaitingAuthority.main3.stage, 1, 'no optimistic stage before HTTP readback');
      assert.equal(entry.states.awaitingAuthority.focus.owners.shop, true);
      assert.equal(entry.states.awaitingAuthority.inputEnabled, false);
      releaseVisit(); releaseVisit = null; await ready(2);
      entry.states.shopOpen = await page.evaluate(readState);
      assert.equal(entry.states.shopOpen.shop.state, 'READY'); assert.equal(entry.states.shopOpen.wallet.state, 'READY');
      assert.match(await page.locator('#shop-panel .shop-panel-wallet').innerText(), /인덕코인 180/);
      assert.equal(await page.locator('#shop-panel .shop-offer-buy:enabled').count(), 1);
      await capture('shop-stage2-no-purchase');
      await page.keyboard.press('f'); assert.equal((await page.evaluate(readState)).main3.stage, 2);
      await action(page.getByRole('button', { name: '상점 닫기', exact: true }));
      await wait(() => window.__INHAGAME_P0__.controller.inputEnabled);
      entry.states.hud2 = await checkHud(page, 2); await capture('tracked-hud-stage2');
      assert.equal((await page.evaluate(readState)).focus.owners.shop, false);
      await snapshotRpc('before-reload');

      await page.reload({ waitUntil: 'domcontentloaded' });
      entry.states.reloaded = await ready(2); await enterCampus(); await checkHud(page, 2);
      assert.equal(entry.states.reloaded.accountId, accounts[0].id);
      await page.evaluate(() => window.__MAIN3_CAMPUS_FIXTURE__.switchAccount(1));
      await wait(id => window.__INHAGAME_P0__.online.userId === id, accounts[1].id);
      entry.states.accountB = await ready(0); await checkHud(page, 0);
      assert.equal(entry.states.accountB.main3.available, true, 'new synthetic account keeps only its own prerequisite seed');
      await capture('account-b-stage0');
      await page.evaluate(() => window.__MAIN3_CAMPUS_FIXTURE__.switchAccount(0));
      await wait(id => window.__INHAGAME_P0__.online.userId === id, accounts[0].id);
      entry.states.returnedA = await ready(2); await checkHud(page, 2);
      await page.evaluate(() => window.__MAIN3_CAMPUS_FIXTURE__.switchAccount(null));
      await wait(() => window.__INHAGAME_P0__.online.identity === null && document.getElementById('quest-hud').hidden);
      entry.states.signedOut = await page.evaluate(readState);
      assert.equal(entry.states.signedOut.main3.signedIn, false); assert.equal(entry.states.signedOut.main3.ready, false);
      assert.equal((await page.evaluate(readHud)).visible, false);
      await snapshotRpc('after-account-switches');
      entry.questCalls = authority.calls.filter(call => accounts.some(account => account.id === call.accountId));
      const progressCalls = entry.questCalls.filter(call => call.questId === MAIN3_QUEST_ID && call.event !== 'status');
      assert.deepEqual(progressCalls.map(call => ({ accountId: call.accountId, event: call.event, stage: call.result.stage })), [
        { accountId: accounts[0].id, event: 'start', stage: 1 },
        { accountId: accounts[0].id, event: 'visit_student_center', stage: 2 }
      ], 'only genuine guide + canonical world-entry actions progress Main3');
      assert.ok(entry.questCalls.every(call => call.result.reward == null &&
        (call.questId !== MAIN3_QUEST_ID || call.result.stage <= 2)), 'no invented purchase/equip/reward progress');
      assert.ok(entry.rpcSnapshots.every(snapshot => snapshot.forbidden.length === 0), 'no purchase or mutation RPC request');
      for (const critical of ['campus/index.html', 'styles.css', 'src/main.js', 'npc-factory/dev-runtime.mjs',
        'npc-factory/main2-guide-runtime.mjs', 'npc-factory/main3-quest-client.mjs', 'npc-factory/main3-guide-dialogue.mjs',
        'src/quest/quest-hud.js', 'src/quest/quest-runtime.js', 'src/context-action.js',
        'src/shop/shop-world-interaction.js', 'src/shop/shop-panel.js', 'src/shop/shop-client.js', 'src/online/world-online.js'])
        assert.ok(entry.staticResponses.some(response => response.trackedSource === `apps/world/${critical}`),
          `Actual critical source was served and hash-verified: ${critical}`);
      assert.deepEqual(entry.blockedSockets, [], 'fake Supabase cannot initiate a real socket');
      assert.deepEqual(entry.routeErrors, []); assert.deepEqual(entry.errors, []); assert.deepEqual(smoke.problems, []);
      entry.browserVersion = await page.evaluate(() => navigator.userAgent);
      entry.result = 'PASS';
    } catch (error) {
      entry.result = 'FAIL'; entry.error = error.stack || String(error);
      if (page) entry.failureState = await page.evaluate(readState).catch(() => null);
      throw error;
    } finally {
      releaseVisit?.();
      entry.harnessProblems = smoke?.problems ?? [];
      await flush(); await smoke?.close();
    }
  }
  assert.equal(git(['rev-parse', 'HEAD']), head, 'HEAD remained unchanged');
  assert.equal(git(['status', '--porcelain', '--untracked-files=all', '--', ...sourcePaths]), '', 'source remained exact-head clean');
  report.result = 'PASS';
} catch (error) { report.result = 'FAIL'; report.error = error.stack || String(error); process.exitCode = 1; }
finally {
  clearTimeout(watchdog); report.finishedAt = new Date().toISOString();
  report.questCalls = authority.calls; await flush();
  console.log(JSON.stringify({ result: report.result, head, reportPath, cases: report.cases.map(c => ({ mode: c.mode, result: c.result })) }));
}
