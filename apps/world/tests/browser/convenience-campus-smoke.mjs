// Full, unchanged /campus/ -> main.js -> real GoTrue login -> actual local HTTP handler ->
// durable reducer -> disposable PostgreSQL settlement. No main/authority/Auth response mocks.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
import { INCOME_CONVENIENCE_LOCATION as shop } from '../../src/income/income-convenience-location.mjs';
import { createConvenienceCampusBrowserDatabase, assertConvenienceCampusLocalEnvironment } from '../../../../supabase/tests/support/convenience-campus-browser-db.mjs';

const env = process.env;
assertConvenienceCampusLocalEnvironment(env);
for (const name of ['WORLD_INCOME_CANDIDATE_ENABLED', 'WORLD_CONVENIENCE_AUTHORITY_CANDIDATE']) assert.equal(env[name], '1');
assert.equal(env.WORLD_INCOME_CANDIDATE_SUPABASE_URL, env.API_URL);
assert.ok(env.WORLD_INCOME_CANDIDATE_ANON_KEY === env.ANON_KEY, 'Disposable anon key config must match');
assert.ok(env.WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY === env.SERVICE_ROLE_KEY, 'Disposable server key config must match');
const root = fileURLToPath(new URL('../../../../', import.meta.url));
const output = path.resolve(env.CONVENIENCE_CAMPUS_OUTPUT || 'test-results/starter-furniture/convenience-campus');
await mkdir(output, { recursive: true });
const sha = value => createHash('sha256').update(value).digest('hex');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
if (env.CONVENIENCE_CAMPUS_HEAD_SHA) assert.equal(commit, env.CONVENIENCE_CAMPUS_HEAD_SHA, 'Exact requested head only');
const modelHash = sha(await readFile(path.join(root, 'apps/world/assets/induck-v3.glb')));
assert.equal(modelHash, '5057f3299a9d7e902b1370d203fa93e8279a2ff27a8bc2bdf68f09fe312c58f2', 'Public QA substitute only; refuse private character pixels');
const sensitive = [env.API_URL, env.DB_URL, env.ANON_KEY, env.SERVICE_ROLE_KEY];
const scrub = value => {
  let text = String(value);
  for (const secret of sensitive.filter(Boolean)) text = text.split(secret).join('[disposable-secret-redacted]');
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi, '[fixture-id]')
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token-redacted]');
};
const save = (name, value) => writeFile(path.join(output, name), `${JSON.stringify(value, (_key, v) => typeof v === 'string' ? scrub(v) : v, 2)}\n`);
async function hashes(dir) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  return (await Promise.all(entries.sort((a, b) => a.name.localeCompare(b.name)).map(async entry => {
    const file = `${dir}/${entry.name}`;
    return entry.isDirectory() ? hashes(file) : [{ path: file, sha256: sha(await readFile(path.join(root, file))) }];
  }))).flat();
}
const sources = [...await hashes('apps/world/src'), ...await hashes('apps/world/npc-factory'), ...await hashes('apps/world/server')];
for (const file of ['apps/world/campus/index.html', 'apps/world/styles.css', 'apps/world/dev-server.mjs',
  'apps/world/tests/browser/convenience-campus-smoke.mjs', 'supabase/tests/support/convenience-campus-browser-db.mjs',
  'scripts/convenience-campus-browser-local.mjs']) sources.push({ path: file, sha256: sha(await readFile(path.join(root, file))) });
await save('source-manifest.json', { commit, sourceHash: sha(JSON.stringify(sources)), publicAvatar: modelHash, files: sources });
const report = { kind: 'FULL_MAIN_DISPOSABLE_AUTH_HTTP_POSTGRES', result: 'running', commit, sourceHash: sha(JSON.stringify(sources)),
  fullMainBoot: true, realDisposableAuthentication: true, realDisposableDatabase: true,
  productionPaymentEvidence: false, viewport: { width: 1280, height: 800 },
  characterEvidence: 'Known public QA avatar substitute; no private brand imagery',
  scope: 'Unchanged campus HTML/main modules and native DOM; real SDK password login and getUser, real same-origin convenience handler, server clock/geometry/walk and SQL receipt readback',
  exclusions: ['Production/player accounts', 'Production opening/deployment', 'Private character pixels', 'Human/bot presence proof', 'Full-main mobile coverage'],
  fixturePreparation: 'Disposable candidate gates plus completed campus intro progression only. No seeded balance, position, work step, challenge answer or clock overrides.',
  steering: 'Trusted W keyboard events with camera-yaw orientation only; no controller keys, touch vector, player position or authority snapshot injection',
  screenshotPolicy: 'Semantic JSON only during active authority. One bounded public-proxy screenshot after acknowledged revocation, with the real historical receipt open.',
  evidence: [], checks: [], stages: [], http: [], pageErrors: [], unexpectedExternal: [], cleanup: 'pending' };
let smoke, page, db, latestAuthority = null, latestIncome = null, authorityFailure = null, publicPixelsAllowed = true;
const responseTasks = new Set(), requestTimes = new Map();
const stage = async name => { report.stages.push({ name, at: new Date().toISOString() }); report.stage = name; await save('progress.json', report); console.log(`CONVENIENCE_CAMPUS_STAGE: ${name}`); };
const check = text => report.checks.push(text);
const authorityPath = '/api/world-convenience-authority';
const sdkUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
const snapshot = () => page.evaluate(() => {
  const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition(), status = d.getStatus();
  return { position: { x: p.x, y: p.y, z: p.z }, frames: d.app.frame, renderer: status.renderer,
    loading: status.loading?.phase, graphics: status.graphics, onlineSignedIn: status.online?.signedIn, onlineGuest: status.online?.guest,
    accountMatches: d.online?.userId === window.INCOME_CANDIDATE_LOCAL_AUTH?.accountId,
    walker: !!d.controller.authoritativeWalk, transportLocks: [...d.controller.transportLocks], inputEnabled: d.controller.inputEnabled,
    focusClass: status.inputFocus?.focusClass, walletState: status.wallet?.state, walletLabel: document.getElementById('lobby-player-wallet')?.textContent ?? null, panelOpen: [...document.querySelectorAll('.convenience-job-panel')].some(el => !el.hidden) };
});
async function semantic(name) {
  // GPU readback can stall software-rendered Chromium longer than the real authority lease.
  // Read ordinary state only while walking/working; never create a screenshot-driven keepalive.
  const state = await snapshot(); await save(`${name}.json`, { evidence: 'semantic-only', ...state });
}
async function captureRevokedReceipt(name) {
  assert.ok(publicPixelsAllowed);
  assert.equal(latestAuthority?.active, false, 'A real acknowledged revoke is required before GPU readback');
  const before = await snapshot(); assert.equal(before.walker, false); assert.equal(before.panelOpen, true);
  assert.equal(before.graphics.tier, 'low');
  await page.waitForFunction(frame => window.__INHAGAME_P0__.app.frame > frame + 1, before.frames);
  // One attempt, one bounded deadline. Failure stays a failed pixel-evidence stage; no retries
  // or authority TTL/freshness changes hide a GPU stall. CSS scaling keeps the public HUD legible.
  const pixels = await page.screenshot({ path: path.join(output, `${name}.png`), timeout: 30000,
    fullPage: false, scale: 'css', animations: 'disabled', caret: 'hide' });
  const after = await snapshot(); assert.equal(after.walker, false); assert.equal(latestAuthority.active, false);
  const evidence = { evidence: 'actual-public-pixels-after-revoke', file: `${name}.png`, sha256: sha(pixels), before, after };
  report.evidence.push(evidence); await save(`${name}.json`, evidence);
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, message, timeout = 15000) {
  const end = Date.now() + timeout;
  while (!predicate()) {
    if (authorityFailure) throw Error(`REAL_AUTHORITY_HTTP_FAILED: ${authorityFailure}`);
    if (Date.now() > end) throw Error(message); await wait(50);
  }
}
try {
  await stage('load-existing-real-sdk');
  // Reuse the existing campus dependency, held in memory with its response version/hash recorded.
  // This supplies SDK code only; no authenticated API response is intercepted or manufactured.
  const sdkResponse = await fetch(sdkUrl, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert.equal(sdkResponse.status, 200); const sdk = Buffer.from(await sdkResponse.arrayBuffer());
  assert.ok(sdk.length > 10000); report.sdk = { existingUrl: sdkUrl, version: sdkResponse.headers.get('x-jsd-version'), sha256: sha(sdk) };
  await stage('prepare-disposable-auth-and-launch-gates');
  db = await createConvenienceCampusBrowserDatabase(); sensitive.push(db.userId, db.credentials.email, db.credentials.password);
  report.before = db.readback(); assert.equal(report.before.balance, 0); assert.equal(report.before.rewards, 0); assert.equal(report.before.settled, 0);
  smoke = await startSmoke({ viewport: report.viewport });
  // Last registered route runs first. Leave all unrelated inherited offline boundaries unchanged.
  await smoke.context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.href === sdkUrl) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: sdk });
    if (url.origin === env.API_URL) return route.continue(); // Real GoTrue/PostgREST only at verified loopback.
    if (url.origin === smoke.origin && url.pathname === authorityPath) return route.continue();
    if (url.origin === smoke.origin && url.pathname === '/api/public-supabase-config') return route.fulfill({ status: 200,
      contentType: 'text/javascript; charset=utf-8', body: `globalThis.__INHAGAME_PUBLIC_SUPABASE__=${JSON.stringify({ url: env.API_URL, publishableKey: env.ANON_KEY })};` });
    return route.fallback();
  });
  await smoke.context.routeWebSocket('**/*', websocket => {
    const url = new URL(websocket.url()), local = new URL(env.API_URL);
    if (url.protocol === 'ws:' && url.host === local.host) websocket.connectToServer();
    else { report.unexpectedExternal.push(`${url.protocol}//${url.host}${url.pathname}`); websocket.close(); }
  });
  page = await smoke.context.newPage(); page.setDefaultTimeout(15000); smoke.watch(page);
  page.on('pageerror', error => report.pageErrors.push(scrub(error.message)));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === smoke.origin && url.pathname === authorityPath) requestTimes.set(request, performance.now());
  });
  page.on('response', response => {
    const url = new URL(response.url()); if (url.origin !== smoke.origin || url.pathname !== authorityPath) return;
    const task = (async () => {
      const request = response.request(), body = request.postDataJSON(), value = await response.json();
      const record = { op: body.op, status: response.status(), latencyMs: Math.round((performance.now() - requestTimes.get(request)) * 10) / 10 };
      for (const key of ['actor', 'userId', 'accountId', 'position', 'pose', 'dt', 'now', 'timestamp']) assert.equal(key in body, false, `No client authority: ${key}`);
      if (body.op === 'move') { assert.deepEqual(Object.keys(body.command).sort(), ['moveX', 'moveZ', 'sequence']); record.command = body.command; }
      if (value.state?.position) { record.position = value.state.position; record.sequence = value.state.sequence; record.eligible = value.eligible; latestAuthority = value; }
      if (value.questId) latestIncome = value;
      if (!response.ok()) { record.error = value.error ?? 'UNKNOWN'; authorityFailure = `${body.op}:${response.status()}:${record.error}`; }
      report.http.push(record);
    })().catch(error => { authorityFailure = scrub(error.message); });
    responseTasks.add(task); task.finally(() => responseTasks.delete(task));
  });
  await stage('real-browser-password-login');
  await page.goto(`${smoke.origin}/tests/browser/income-game-entry-browser-away.html`);
  await page.addScriptTag({ url: sdkUrl });
  const login = await page.evaluate(async ({ api, anon, credentials, expected }) => {
    const client = window.supabase.createClient(api, anon);
    const result = await client.auth.signInWithPassword(credentials);
    if (result.error) throw Error('DISPOSABLE_REAL_PASSWORD_LOGIN_FAILED');
    const verified = await client.auth.getUser();
    if (verified.error) throw Error('DISPOSABLE_REAL_GET_USER_FAILED');
    return { sessionPresent: !!result.data.session, accountMatches: verified.data.user?.id === expected,
      anonymous: verified.data.user?.is_anonymous, sessionClaimPresent: !!JSON.parse(atob(result.data.session.access_token.split('.')[1].replaceAll('-', '+').replaceAll('_', '/'))).session_id };
  }, { api: env.API_URL, anon: env.ANON_KEY, credentials: db.credentials, expected: db.userId });
  assert.deepEqual(login, { sessionPresent: true, accountMatches: true, anonymous: false, sessionClaimPresent: true }); report.auth = login;
  // This is the already-supported LOCAL opt-in host; its credential supplier reads the real SDK
  // session created above. Main's online.userId equality and the server /auth/v1/user stay intact.
  await page.addInitScript(({ api, anon, expected }) => {
    globalThis.__INHAGAME_PUBLIC_SUPABASE__ = { url: api, publishableKey: anon };
    let client;
    const realClient = () => window.__INHAGAME_P0__?.online?.supabase ?? (client ??= window.supabase.createClient(api, anon));
    globalThis.INCOME_CANDIDATE_LOCAL_AUTH = {
      convenienceAuthority: true, accountId: expected,
      async getAuthorization() {
        const { data, error } = await realClient().auth.getSession();
        if (error || data.session?.user?.id !== expected || data.session.user.is_anonymous !== false) throw Error('LOCAL_QA_AUTH_MISMATCH');
        return `Bearer ${data.session.access_token}`;
      },
      subscribe(listener) {
        const { data } = realClient().auth.onAuthStateChange((_event, session) => listener(session?.user?.id ?? null));
        return () => data.subscription.unsubscribe();
      }
    };
    window.__CONVENIENCE_CAMPUS_TRUSTED__ = [];
    document.addEventListener('keydown', event => { if (event.isTrusted) window.__CONVENIENCE_CAMPUS_TRUSTED__.push({ type: 'keydown', code: event.code }); }, true);
    document.addEventListener('click', event => { if (event.isTrusted && event.target.closest?.('.convenience-authority-candidate,.convenience-job-panel')) window.__CONVENIENCE_CAMPUS_TRUSTED__.push({ type: 'click', label: event.target.textContent?.slice(0, 80) }); }, true);
  }, { api: env.API_URL, anon: env.ANON_KEY, expected: db.userId });
  await stage('boot-unchanged-full-campus-main');
  await page.goto(`${smoke.origin}/campus/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS });
  await page.waitForFunction(() => { const s = window.__INHAGAME_P0__?.getStatus?.(); return s?.renderer === 'UNAVAILABLE' || s?.loading?.finished; }, null, { timeout: TIMEOUT_MS });
  const boot = await snapshot(); assert.equal(boot.renderer, 'WebGL2'); assert.equal(boot.loading, 'READY');
  await page.waitForFunction(() => window.__INHAGAME_P0__?.online?.userId === window.INCOME_CANDIDATE_LOCAL_AUTH?.accountId, null, { timeout: 30000 });
  const authenticated = await snapshot(); assert.equal(authenticated.onlineSignedIn, true); assert.equal(authenticated.onlineGuest, false); assert.equal(authenticated.accountMatches, true);
  // Plain /campus normally enters gameplay directly. If an existing lobby route owns focus,
  // use its real entry control and normal cinematic skip; never mutate the lobby/scene state.
  if (await page.evaluate(() => window.__INHAGAME_P0__.lobbyWorld.active)) {
    await page.locator('#main-gate-start').click();
    await page.waitForFunction(() => !window.__INHAGAME_P0__.lobbyWorld.active);
  }
  if (await page.locator('#cinematic-skip').isVisible()) await page.locator('#cinematic-skip').click();
  await page.waitForFunction(() => {
    const d = window.__INHAGAME_P0__;
    return !d.lobbyWorld.active && !d.lobbyTransition.active && !d.cinematic.active && d.controller.inputEnabled;
  }, null, { timeout: 30000 });
  await stage('select-supported-low-graphics-before-authority');
  // Exercise the normal settings UI, as graphics-smoke does. This changes only supported
  // rendering quality, not simulation cadence, server freshness, geometry or authority timing.
  await page.locator('#hud-menu-toggle').click();
  await page.locator('#open-settings').click();
  await page.locator('#graphics-quality').selectOption('low');
  await page.locator('#close-settings').click();
  await page.waitForFunction(() => {
    const d = window.__INHAGAME_P0__, g = d.getStatus().graphics;
    return g.preference === 'low' && g.tier === 'low' && g.castShadows === false && g.maxPixelRatio === .8 && d.controller.inputEnabled;
  });
  const lowFrame = await page.evaluate(() => window.__INHAGAME_P0__.app.frame);
  await page.waitForFunction(frame => window.__INHAGAME_P0__.app.frame > frame + 5, lowFrame, { timeout: 30000 });
  report.boot = await snapshot(); check('Original /campus HTML and main boot READY with advancing actual renderer, normal gameplay entry and matching real permanent SDK/Auth account');
  check('Normal graphics settings UI applies supported LOW preset before authority; no simulation or server TTL modifications');
  const toolbar = page.locator('.convenience-authority-candidate'); await toolbar.waitFor({ state: 'visible' });
  const begin = toolbar.getByRole('button', { name: '검증 이동 시작 (서버 출발점으로 이동)', exact: true });
  const work = toolbar.getByRole('button', { name: '근무·영수증', exact: true });
  const cancel = toolbar.getByRole('button', { name: '검증 근무 종료', exact: true });
  const panel = page.getByRole('dialog', { name: '편의점 짧은 근무', exact: true });
  await stage('trusted-start-server-authorized-spawn');
  await begin.click(); await until(() => latestAuthority?.active === true, 'AUTHORITY_OPEN_TIMEOUT');
  assert.equal(latestAuthority.spawnId, 'BACK_GATE');
  await page.waitForFunction(() => !!window.__INHAGAME_P0__.controller.authoritativeWalk);
  await semantic('full-main-authority-start'); check('Trusted visible start control reaches real handler/Auth/Postgres and mounts real main controller at server-authorized BACK_GATE');
  await stage('trusted-keyboard-server-canonical-walk');
  const walkStart = Date.now();
  for (const target of shop.approach.slice(1)) {
    let turns = 0;
    while (Math.hypot(target.x - latestAuthority.state.position.x, target.z - latestAuthority.state.position.z) > .8) {
      assert.ok(turns++ < 12 && Date.now() - walkStart < 90000, 'Real server walk must reach canonical route without injected positions or clocks');
      const p = latestAuthority.state.position, yaw = Math.atan2(-(target.x - p.x), target.z - p.z);
      // Camera orientation only: the movement still enters through trusted W and the main frame loop.
      await page.evaluate(yaw => { window.__INHAGAME_P0__.orbit.yaw = yaw; }, yaw);
      await page.keyboard.down('w');
      try {
        const end = Date.now() + 15000;
        while (Math.hypot(target.x - latestAuthority.state.position.x, target.z - latestAuthority.state.position.z) > .8 && Date.now() < end) {
          if (authorityFailure) throw Error(`REAL_AUTHORITY_HTTP_FAILED: ${authorityFailure}`); await wait(50);
        }
      } finally { await page.keyboard.up('w'); }
      // The reducer consumes the previous direction, then installs zero. Wait for actual stopped ack.
      const stoppedAfter = latestAuthority.state.sequence;
      await until(() => latestAuthority.state.sequence > stoppedAfter && latestAuthority.state.lastCommand?.moveX === 0 && latestAuthority.state.lastCommand?.moveZ === 0, 'STOP_ACK_TIMEOUT');
    }
  }
  assert.equal(latestAuthority.eligible, true, 'Real geometry/line of sight must confirm eligibility');
  const atSite = latestAuthority.state.position;
  await page.waitForFunction(p => { const now = window.__INHAGAME_P0__.player.getLocalPosition(); return Math.hypot(now.x - p.x, now.y - p.y, now.z - p.z) < 1e-6; }, atSite);
  report.walk = { durationMs: Date.now() - walkStart, finalPosition: atSite, eligible: true, waypoints: shop.approach.length - 1 };
  await semantic('full-main-at-convenience'); check('Main trusted W input reaches shop only through canonical real-clock server movement; final actual player transform matches acknowledged state');
  await stage('trusted-work-ui-three-real-steps');
  await work.click(); await panel.waitFor({ state: 'visible' }); assert.equal((await snapshot()).inputEnabled, false);
  await panel.getByRole('button', { name: '출근하기', exact: true }).click();
  await until(() => latestIncome?.state === 'ACTIVE' && latestIncome.revision === 0, 'REAL_SHIFT_START_TIMEOUT');
  for (let revision = 0; revision < 3; revision++) {
    await until(() => latestIncome?.state === 'ACTIVE' && latestIncome.revision === revision, 'REAL_STEP_READBACK_TIMEOUT');
    // The HTTP response listener can observe the committed revision before the client's
    // follow-up status read has rendered it. Wait for that real DOM readback, not just RPC arrival.
    const expectedPrompt = latestIncome.nextChallenge.prompt;
    await page.waitForFunction(prompt => [...document.querySelectorAll('.convenience-job-panel')]
      .some(panel => !panel.hidden && panel.querySelector('h3')?.textContent === prompt), expectedPrompt);
    const prompt = await panel.locator('h3').innerText(); assert.equal(prompt, expectedPrompt); let choice;
    if (revision === 0) { const item = ['우유', '빵', '삼각김밥'].find(item => prompt.startsWith(item)); assert.ok(item); choice = `${item} 진열대`; }
    else if (revision === 1) { const match = prompt.match(/(\d+)원 상품 (\d+)개의/); assert.ok(match); choice = `${Number(match[1]) * Number(match[2])}원`; }
    else { choice = prompt.startsWith('빈 알루미늄 캔') ? '금속류' : prompt.startsWith('빈 유리병') ? '유리류' : prompt.startsWith('깨끗한 종이 상자') ? '종이류' : null; assert.ok(choice); }
    await panel.getByRole('button', { name: choice, exact: true }).click();
    if (revision === 0) await semantic('full-main-work-panel');
    // Respect the real server's availableAt. Never rewrite DB timestamps or fast-forward a clock.
    const readyAt = Date.parse(latestIncome.nextChallenge.availableAt); assert.ok(Number.isFinite(readyAt));
    await wait(Math.max(0, readyAt - Date.now() + 200));
    await panel.getByRole('button', { name: '선택한 방법으로 진행', exact: true }).click();
    await until(() => latestIncome?.revision === revision + 1, 'REAL_STEP_COMMIT_TIMEOUT');
  }
  await panel.getByRole('button', { name: '퇴근 정산 요청', exact: true }).click();
  await until(() => latestIncome?.receipt?.committed === true, 'REAL_RECEIPT_TIMEOUT');
  await page.getByText('서버 정산 확인: 30 코인. 최신 잔액은 지갑에서 확인해 주세요.', { exact: true }).waitFor();
  report.after = db.readback(); assert.equal(report.after.balance, 30); assert.equal(report.after.settled, 1); assert.equal(report.after.rewards, 1); assert.equal(report.after.linkedCredits, 1);
  await page.waitForFunction(() => window.__INHAGAME_P0__.getStatus().wallet.state === 'READY' && document.getElementById('lobby-player-wallet')?.textContent === '🪙 30');
  report.wallet = { state: 'READY', renderedLobbyLabel: '🪙 30', note: 'Actual main wallet read-model and retained lobby DOM updated after reward; lobby itself remains closed during campus gameplay' };
  await semantic('full-main-real-receipt'); check('Trusted three visible choices and settlement UI produce one PostgreSQL receipt, one SUCCESS reward and linked +30 wallet ledger credit; main wallet refresh updates actual UI read-model to 30');
  await stage('cancel-reopen-real-historical-receipt');
  const receiptId = latestIncome.receipt.settlementId;
  await panel.getByRole('button', { name: '닫기', exact: true }).click(); await cancel.click();
  await page.waitForFunction(() => !window.__INHAGAME_P0__.controller.authoritativeWalk);
  await until(() => report.http.some(record => record.op === 'revoke' && record.status === 200), 'REVOKE_ACK_TIMEOUT');
  assert.equal(db.readback().authorityActive, false);
  await work.click(); await panel.waitFor({ state: 'visible' });
  await page.getByText('서버 정산 확인: 30 코인. 최신 잔액은 지갑에서 확인해 주세요.', { exact: true }).waitFor();
  assert.equal(latestIncome.receipt.settlementId, receiptId); assert.equal((await snapshot()).walker, false);
  assert.deepEqual(db.readback(), { ...report.after, authorityActive: false });
  await stage('capture-historical-receipt-after-confirmed-revoke');
  await captureRevokedReceipt('full-main-historical-receipt');
  await panel.getByRole('button', { name: '닫기', exact: true }).click();
  assert.equal((await snapshot()).inputEnabled, true);
  check('Trusted cancel confirms durable revocation; reopening real historical receipt does not restart authority or pay twice; input ownership is restored');
  await Promise.all(responseTasks);
  report.trustedEvents = await page.evaluate(() => window.__CONVENIENCE_CAMPUS_TRUSTED__);
  assert.ok(report.trustedEvents.some(event => event.code === 'KeyW'));
  assert.equal(report.http.filter(record => record.op === 'start').length, 1);
  assert.equal(report.http.filter(record => record.op === 'step').length, 3);
  assert.equal(report.http.filter(record => record.op === 'complete').length, 1);
  assert.equal(authorityFailure, null); assert.deepEqual(report.pageErrors, []); assert.deepEqual(smoke.problems, []); assert.deepEqual(report.unexpectedExternal, []);
  report.httpSummary = Object.fromEntries([...new Set(report.http.map(r => r.op))].map(op => {
    const rows = report.http.filter(r => r.op === op), timings = rows.map(r => r.latencyMs).sort((a, b) => a - b);
    return [op, { count: rows.length, failures: rows.filter(r => r.status !== 200).length, medianMs: timings[Math.floor(timings.length / 2)], maxMs: timings.at(-1) }];
  }));
  report.result = 'pass';
} catch (error) {
  report.result = 'fail'; report.error = scrub(error.message);
  // Never start another GPU capture on failure, especially while a live authority lease may
  // still exist. A bounded ordinary read preserves useful diagnostics without altering it.
  if (page && page.url().includes('/campus/')) {
    const failureState = await Promise.race([snapshot().catch(() => null), wait(2000).then(() => null)]);
    await save('full-main-failure.json', { evidence: 'semantic-only', state: failureState });
  }
  console.error(`CONVENIENCE_CAMPUS_FAILED: ${scrub(error.message)}`); process.exitCode = 1;
} finally {
  if (page) await page.keyboard.up('w').catch(() => {});
  await smoke?.close().catch(error => { report.closeError = scrub(error.message); report.result = 'fail'; process.exitCode = 1; });
  await Promise.allSettled(responseTasks);
  if (db) {
    try { await db.close(); report.cleanup = 'Exact original candidate launch rows restored; disposable fixture ledgers left intact until unconditional workflow stack destruction'; }
    catch (error) { report.cleanup = `FAILED: ${scrub(error.message)}`; report.result = 'fail'; process.exitCode = 1; }
  } else report.cleanup = 'No disposable fixture was created';
  await save('result.json', report);
  if (report.result === 'pass') console.log('PASS: unchanged full campus main + real disposable Auth/HTTP/server walk/Postgres +30 settlement; launch gates restored, public proxy avatar only, no Production evidence');
}
