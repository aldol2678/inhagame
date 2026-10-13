// JSL-A Jeongseok gate browser QA against the disposable LOCAL Supabase stack only.
// Real /campus/ + production controllers, real local Auth/PostgREST, signed-in permanent accounts.
// It opens the gate policy and pass product on the local stack and restores their prior states afterwards.
//
//   eval "$(supabase status -o env)"; export API_URL ANON_KEY DB_URL SERVICE_ROLE_KEY
//   JSL_HEAD_SHA=$(git rev-parse HEAD) WORLD_SMOKE_DISABLE_WEBGPU=1 node apps/world/tests/browser/jeongseok-gate-smoke.mjs
//
// Scope: Chromium desktop + mobile touch emulation (not physical devices). Public lobby is free;
// the public-side guide sells passes, and the inner reader re-verifies before opening real collision.
import assert from 'node:assert/strict';
import { verifyJeongseokShippedMain } from './jeongseok-synthetic-access.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { resolveWorldSmokeSource } from './harness-source.mjs';

const { API_URL, ANON_KEY, DB_URL, SERVICE_ROLE_KEY } = process.env;
const LOOPBACK = /^[a-z]+:\/\/([^@/]*@)?(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;
assert.ok(API_URL && ANON_KEY && DB_URL && SERVICE_ROLE_KEY, 'local stack env from `supabase status -o env`');
assert.match(API_URL, LOOPBACK); assert.match(DB_URL, LOOPBACK);
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (process.env.JSL_HEAD_SHA) assert.equal(head, process.env.JSL_HEAD_SHA, 'JSL_HEAD_SHA must be this exact candidate');
const output = 'test-results/jeongseok-gate'; await mkdir(output, { recursive: true });
const report = { head, status: 'RUNNING', cases: [], limits: [
  'Chromium (SwiftShader WebGL2) desktop and mobile touch emulation only; not physical Android/iOS.',
  'Local Supabase fixture only: no Production authorization, price or wallet claim.',
  'Exact shipped main selects SERVER_GRANT without constructor overrides; all local access RPCs, policy and runtime collision remain real.',
    'Inner reader and guide use GAME_ADAPTATION lobby anchors, not surveyed real-world positions.'] };
const save = () => writeFile(`${output}/report.json`, JSON.stringify(report, null, 2));

const sql = q => execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', q], { encoding: 'utf8' }).trim();
const lit = v => v == null ? 'null' : `'${String(v).replaceAll("'", "''")}'`;
const coins = id => Number(sql(`select coalesce((select balance from private.world_wallets where user_id=${lit(id)} and currency_id='currency.induck_coin'),0)`));
const debits = id => Number(sql(`select count(*) from private.world_currency_transactions where user_id=${lit(id)} and source_type='jeongseok_pass'`));
const users = [];
async function createUser(label, { email, credit = 0 } = {}) {
  const password = `Jsl-${randomUUID()}`;
  const mail = email ?? `jsl-${label}-${randomUUID().slice(0, 8)}@example.test`;
  const r = await fetch(`${API_URL}/auth/v1/admin/users`, { method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: mail, password, email_confirm: true }) });
  const user = await r.json(); assert.ok(user.id, JSON.stringify(user)); users.push(user.id);
  sql(`insert into public.profiles(user_id,nickname,is_banned) values (${lit(user.id)},${lit(`정석${label}`)},false)`);
  if (credit) sql(`set role service_role; set request.jwt.claims='{"role":"service_role"}';
    select public.world_wallet_credit_v1(${lit(user.id)},'currency.induck_coin',${credit},'REWARD','test','jsl-browser',${lit(`jsl-browser:${user.id}`)},null)`);
  const t = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, { method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: mail, password }) });
  const session = await t.json(); assert.ok(session.access_token, JSON.stringify(session));
  return { id: user.id, session };
}

// Same pinned PlayCanvas as the shared offline harness.
const pinned = await resolveWorldSmokeSource({ defaultWorldRoot: fileURLToPath(new URL('../../', import.meta.url)),
  samplerPackagePath: fileURLToPath(new URL('./package.json', import.meta.url)) });
const playCanvas = await readFile(fileURLToPath(new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url)));
const supabaseJs = await (await fetch('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js')).text();
report.supabaseJsSha256 = createHash('sha256').update(supabaseJs).digest('hex');
const port = 8700 + Math.floor(Math.random() * 200);
const server = spawn(process.execPath, ['apps/world/dev-server.mjs'], { env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'inherit'] });
await new Promise((resolve, reject) => { server.stdout.on('data', d => { if (/listening/.test(String(d))) resolve(); }); server.on('exit', reject); });
const origin = `http://127.0.0.1:${port}`;
// One browser per case, like the shared harness: SwiftShader state is not reused across cases.
const launch = () => chromium.launch({ headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  ...(process.env.WORLD_SMOKE_EXECUTABLE ? { executablePath: process.env.WORLD_SMOKE_EXECUTABLE } : {}) });

async function openWorld(entry, { viewport, mobile = false, account = null }) {
  const browser = await launch();
  const context = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1, reducedMotion: 'reduce', serviceWorkers: 'block' });
  await context.addInitScript(({ url, key, session }) => {
    Object.defineProperty(navigator, 'gpu', { value: undefined });
    globalThis.__INHAGAME_PUBLIC_SUPABASE__ = { url, publishableKey: key };
    if (session && !sessionStorage.getItem('jsl-qa-seeded')) {
      localStorage.setItem('sb-127-auth-token', JSON.stringify(session)); sessionStorage.setItem('jsl-qa-seeded', '1');
    }
  }, { url: API_URL, key: ANON_KEY, session: account?.session ?? null });
  const problems = [];
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin === origin) return url.pathname.startsWith('/api/') && url.pathname !== '/api/world-time' ? route.fulfill({ status: 204 }) : route.continue();
    if (url.origin === API_URL) return route.continue();
    if (pinned.urls.has(url.href)) return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: playCanvas });
    if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.startsWith('/npm/@supabase/supabase-js@'))
      return route.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: supabaseJs });
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage(); page.setDefaultTimeout(60000); currentPage = page;
  page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
  const [mainResponse] = await Promise.all([
    page.waitForResponse(response => response.url() === `${origin}/src/main.js`, { timeout: 60000 }),
    page.goto(`${origin}/campus/?envTime=day&envWeather=clear`, { waitUntil: 'domcontentloaded' })
  ]);
  entry.shippedMain = await verifyJeongseokShippedMain(mainResponse);
  await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus().loading?.finished, null, { timeout: 180000 });
  if (account) await page.waitForFunction(id => window.__INHAGAME_P0__.jeongseok.access.accountId === id &&
    window.__INHAGAME_P0__.jeongseok.access.state === 'READY', account.id, { timeout: 60000 });
  assert.equal(await page.evaluate(() => window.__INHAGAME_JEONGSEOK_INTERIOR__.status().policy.mode), 'SERVER_GRANT_JSL_A');
  entry.renderer = await page.evaluate(() => window.__INHAGAME_P0__.getStatus().renderer);
  let closed = false;
  const close = async () => { if (closed) return; closed = true; await context.close().catch(() => {}); await browser.close().catch(() => {}); };
  currentClose = close;
  return { context, page, problems, close };
}
const LOBBY = 'ROOM_JEONGSEOK_LOBBY';
const gateState = page => page.evaluate(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot());
const phone = page => page.evaluate(() => window.__INHAGAME_P0__.smartphone.status());
async function frames(page, count = 3) {
  const at = await page.evaluate(() => window.__INHAGAME_P0__.app.frame);
  await page.waitForFunction(({ at, count }) => window.__INHAGAME_P0__.app.frame >= at + count, { at, count }, { timeout: 60000 });
}
async function pressAction(page, mobile, id) {
  await page.waitForFunction(id => { const c = window.__INHAGAME_P0__.contextActions; return !c.suspended && c.active?.id === id; }, id);
  if (mobile) await page.locator('#context-action').tap(); else await page.keyboard.press('KeyF');
}
async function enterPublicLobby(page, mobile = false) {
  if (await page.evaluate(() => window.__INHAGAME_P0__.rooms.currentSpace === 'ROOM_JEONGSEOK_LOBBY')) return;
  await page.evaluate(async () => { const d = window.__INHAGAME_P0__;
    const { JEONGSEOK_ENTRANCE } = await import('/src/jeongseok/interior-rooms.js');
    const p = JEONGSEOK_ENTRANCE.position; d.controller.velocityY = 0; d.player.setLocalPosition(p.x, p.y ?? 2.8, p.z);
  });
  await pressAction(page, mobile, 'jeongseok-door');
  await page.waitForFunction(() => window.__INHAGAME_P0__.rooms.currentSpace === 'ROOM_JEONGSEOK_LOBBY' && !window.__INHAGAME_P0__.rooms.status().busy);
}
async function goToAnchor(page, kind, mobile = false) {
  await enterPublicLobby(page, mobile);
  await page.evaluate(() => { const d = window.__INHAGAME_P0__; if (window.__jslLog) return; window.__jslLog = [];
    d.jeongseok.gate.onChange(v => window.__jslLog.push(`gate:${v.state}`));
    d.jeongseok.access.onChange(v => window.__jslLog.push(`access:${v.reason}:${v.state}`));
    window.addEventListener('keydown', e => { if (e.code === 'KeyF') window.__jslLog.push(`keyF:${d.contextActions.active?.id}:${d.contextActions.suspended}`); }, true); });
  await page.evaluate(kind => { const d = window.__INHAGAME_P0__, g = d.jeongseok[kind === 'guide' ? 'guideLayout' : 'layout'].position;
    d.controller.velocityY = 0; d.player.setLocalPosition(g.x + (kind === 'guide' ? 0.85 : 0.39), 1.15, g.z);
    d.player.setLocalEulerAngles(0, 0, 0); d.orbit.yaw = 0;
  }, kind);
  await page.waitForFunction(id => window.__INHAGAME_P0__.contextActions.active?.id === id, `jeongseok-${kind}`, { timeout: 30000 });
}
const goToReader = (page, mobile = false) => goToAnchor(page, 'gate', mobile);
const goToGuide = (page, mobile = false) => goToAnchor(page, 'guide', mobile);
const press = (page, mobile) => pressAction(page, mobile, 'jeongseok-gate');
const pressGuide = (page, mobile) => pressAction(page, mobile, 'jeongseok-guide');
const closePhone = async page => {
  await page.evaluate(() => window.__INHAGAME_P0__.smartphone.close());
  await page.waitForFunction(() => window.__INHAGAME_P0__.smartphone.shell.state === 'CLOSED');
};
const shot = async (page, entry, name) => { await page.screenshot({ path: `${output}/${entry.name}-${name}.png` }); entry.screenshots.push(`${entry.name}-${name}.png`); };
async function layout(page) {
  return page.evaluate(() => { const root = document.querySelector('.smartphone'), frame = root.querySelector('.smartphone-frame'),
    content = root.querySelector('.smartphone-content'), r = frame.getBoundingClientRect(), hud = document.getElementById('jeongseok-gate').getBoundingClientRect();
    return { phoneInViewport: r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1,
      horizontalClip: content.scrollWidth > content.clientWidth + 2, focusInside: root.contains(document.activeElement),
      hudInViewport: hud.left >= 0 && hud.right <= innerWidth + 1, pageHorizontalScroll: document.documentElement.scrollWidth > innerWidth + 1 }; });
}
async function worldRestored(page) {
  return page.evaluate(() => { const d = window.__INHAGAME_P0__; return { phone: d.smartphone.shell.state, input: d.controller.inputEnabled,
    canWorld: (d.getStatus().inputFocus.topOwners ?? []).length === 0, inert: document.getElementById('application').inert, space: d.rooms.currentSpace }; });
}

let currentPage = null, currentClose = null;
const only = process.env.JSL_CASES ? new Set(process.env.JSL_CASES.split(',')) : null;
async function runCase(name, fn) {
  if (only && !only.has(name)) return true;
  const entry = { name, status: 'RUNNING', checks: [], screenshots: [] }; report.cases.push(entry); await save();
  try { await fn(entry); entry.status = 'PASS'; }
  catch (error) {
    entry.status = 'FAIL'; entry.error = String(error.stack ?? error);
    try { entry.diagnostic = await currentPage?.evaluate(() => { const d = window.__INHAGAME_P0__; return { gate: d.jeongseok.gate.snapshot(),
      access: { state: d.jeongseok.access.state, decision: d.jeongseok.access.snapshot?.decision }, phone: d.smartphone.status().state,
      route: d.smartphone.status().current, action: d.contextActions.active?.id ?? null, focus: d.getStatus().inputFocus.topOwners,
      activeElement: document.activeElement?.id || document.activeElement?.tagName,
      position: { ...d.player.getLocalPosition() }, frame: d.app.frame, inputEnabled: d.controller.inputEnabled,
      closedGateCollider: d.controller.space.obstacles.some(box => box.id === 'jsl_lobby_closed_gate'),
      interior: window.__INHAGAME_JEONGSEOK_INTERIOR__.status(), log: window.__jslLog }; }); } catch { /* page gone */ }
    try { await currentPage?.screenshot({ path: `${output}/${name}-failure.png` }); } catch { /* page gone */ }
  }
  await currentClose?.(); currentClose = null;
  await save();
  return entry.status === 'PASS';
}

const originalGate = sql(`select status from private.world_jeongseok_gate_policy where singleton`);
const originalProduct = JSON.parse(sql(`select json_build_object('status', status, 'price_basis', price_basis) from private.world_jeongseok_pass_catalog where pass_type='jeongseok.visitor.day'`));
sql(`update private.world_jeongseok_gate_policy set status='ACTIVE'`);
// Disposable browser QA only: enable the confirmed product locally, then restore its exact state.
sql(`update private.world_jeongseok_pass_catalog set price_basis='CONFIRMED', status='ACTIVE' where pass_type='jeongseok.visitor.day'`);
let ok = true;
try {
  const general = await createUser('A', { credit: 250 });
  const verified = await createUser('V', { email: `jsl-v-${randomUUID().slice(0, 8)}@inha.edu` });
  const poor = await createUser('P', { credit: 99 });
  const reloader = await createUser('R', { credit: 200 });

  ok &= await runCase('desktop-general-purchase', async entry => {
    const { page, problems, close } = await openWorld(entry, { viewport: { width: 1280, height: 800 }, account: general });
    await goToReader(page); await shot(page, entry, 'at-reader');
    assert.match(await page.locator('#context-action').innerText(), /학생증 태그/, 'reader action label');
    await press(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'NEEDS_PASS');
    assert.equal((await phone(page)).state, 'CLOSED', 'reader does not sell passes');
    await goToGuide(page); await pressGuide(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.smartphone.status().current?.view === 'jeongseok');
    const card = await page.locator('.smartphone-content').innerText();
    assert.match(card, /100 인덕코인/); assert.match(card, /250 인덕코인/); assert.match(card, /150 인덕코인/); assert.match(card, /양도·거래 불가/);
    const desk = await layout(page);
    assert.ok(desk.phoneInViewport && !desk.horizontalClip && desk.focusInside && desk.hudInViewport && !desk.pageHorizontalScroll, JSON.stringify(desk));
    await shot(page, entry, 'needs-pass');
    entry.checks.push('Public lobby → inner reader NEEDS_PASS → nearby guide with server price/balance/after');
    // Cancel at confirmation: no RPC, Phone returns to World.
    await page.getByRole('button', { name: '방문증 발급하기 · 100 인덕코인' }).click();
    await page.getByRole('button', { name: '구매 취소' }).click();
    await page.getByRole('button', { name: '정석 출입 취소' }).click();
    await page.waitForFunction(() => window.__INHAGAME_P0__.smartphone.shell.state === 'CLOSED');
    assert.deepEqual(await worldRestored(page), { phone: 'CLOSED', input: true, canWorld: true, inert: false, space: LOBBY });
    assert.equal(debits(general.id), 0);
    entry.checks.push('Purchase cancel + gate cancel: no debit, Phone closed, World input/focus restored');
    // Lost reply: the server commits, the browser never sees the response.
    let dropped = 0;
    await page.route(`${API_URL}/rest/v1/rpc/purchase_jeongseok_pass_v1`, async route => {
      if (dropped++ === 0) { await route.fetch(); return route.abort('connectionreset'); }
      return route.continue();
    });
    await pressGuide(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.smartphone.status().current?.view === 'jeongseok');
    await page.getByRole('button', { name: '방문증 발급하기 · 100 인덕코인' }).click();
    // Duplicate activation of the confirm button in the same tick.
    await page.getByRole('button', { name: '결제 확인 · 100 인덕코인 사용' }).evaluate(n => { n.click(); n.click(); });
    // The first request has ended (reply dropped after the server answered) and left its key unresolved.
    await page.waitForFunction(() => { const v = window.__INHAGAME_P0__.jeongseok.access.view(); return !v.purchasing && v.pendingKey; });
    await page.getByRole('button', { name: '같은 요청 다시 확인' }).waitFor();
    assert.equal(debits(general.id), 1, 'server committed exactly once although the reply was lost');
    await shot(page, entry, 'lost-reply');
    await page.getByRole('button', { name: '같은 요청 다시 확인' }).click();
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().notice === 'RECOVERED' && window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'IDLE');
    assert.equal(await page.evaluate(() => window.__INHAGAME_JEONGSEOK_INTERIOR__.status().policy.session), false, 'purchase/recovery never opens inner access');
    await closePhone(page); await goToReader(page); await press(page, false);
    await page.waitForFunction(() => ['SCANNING', 'GRANTED', 'OPENING'].includes(window.__INHAGAME_P0__.jeongseok.gate.snapshot().state));
    await shot(page, entry, 'tag');
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'READY_TO_ENTER', null, { timeout: 15000 });
    await page.waitForFunction(() => window.__INHAGAME_P0__.smartphone.shell.state === 'CLOSED');
    assert.equal((await gateState(page)).via, 'VISITOR_PASS');
    assert.equal(await page.locator('#jeongseok-gate').getAttribute('data-light'), 'green');
    await shot(page, entry, 'granted-hud');
    assert.deepEqual([debits(general.id), coins(general.id)], [1, 150], 'one debit after recovery');
    assert.equal(dropped, 2, 'recovery reused the stored key through the same RPC');
    entry.checks.push('Guide lost reply → same-key recovery without inner grant → separate reader tag → green → READY; duplicate click → one debit');
    const before = await page.evaluate(() => window.__INHAGAME_P0__.jeongseok.access.view());
    // Screenshots and SQL readback above can outlast the real 20-second READY window on SwiftShader.
    // Prove that expiry closes entry, then use real input to acquire a fresh tag; never extend the timer.
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'IDLE',
      null, { timeout: 30000 });
    assert.equal((await gateState(page)).canEnter, false, 'expired READY never remains an entry grant');
    const checksBeforeRetag = await page.evaluate(() =>
      window.__jslLog.filter(value => value === 'access:verify-entry:READY').length);
    await press(page, false);
    await page.waitForFunction(() => {
      const d = window.__INHAGAME_P0__;
      return d.jeongseok.gate.snapshot().state === 'READY_TO_ENTER' && d.smartphone.shell.state === 'CLOSED';
    }, null, { timeout: 15000 });
    const checksBeforeEntry = await page.evaluate(() =>
      window.__jslLog.filter(value => value === 'access:verify-entry:READY').length);
    assert.ok(checksBeforeEntry > checksBeforeRetag, 'retag requires a new server verification');
    // No screenshots or SQL work between fresh READY and this actual entry keypress.
    await press(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().notice === 'INNER_ACCESS_GRANTED');
    assert.ok(await page.evaluate(() =>
      window.__jslLog.filter(value => value === 'access:verify-entry:READY').length) > checksBeforeEntry,
      'entry re-verifies on the server separately from the fresh tag');
    assert.equal((await worldRestored(page)).space, LOBBY);
    await page.waitForFunction(() => !window.__INHAGAME_P0__.controller.space.obstacles.some(box => box.id === 'jsl_lobby_closed_gate'), null, { timeout: 10000 });
    assert.equal(await page.evaluate(() => window.__INHAGAME_P0__.controller.space.obstacles.some(box => box.id === 'jsl_lobby_closed_gate')), false, 'fresh inner grant removes actual collision');
    // Physics dt is capped per frame. A fixed wall-clock press does not guarantee enough
    // rendered frames on SwiftShader; hold real input until crossing, within the real grant TTL.
    await page.keyboard.down('KeyW');
    try {
      await page.waitForFunction(() => window.__INHAGAME_P0__.player.getLocalPosition().z > -3.2, null, { timeout: 10000, polling: 50 });
    } finally { await page.keyboard.up('KeyW'); }
    assert.ok(await page.evaluate(() => window.__INHAGAME_P0__.player.getLocalPosition().z > -3.2), 'native movement crosses the open inner gate');
    assert.equal(await page.evaluate(() => window.__INHAGAME_JEONGSEOK_INTERIOR__.status().policy.crossed), true);
    // Slow SQL readback must not consume the 15-second unused crossing opportunity.
    assert.deepEqual([debits(general.id), coins(general.id)], [1, 150], 'expiry, retag and entry never debit again');
    entry.checks.push('Real READY expiry closes entry; native retag and entry each re-verify, with one total debit');
    // Real B1 entry and return consume the inner stay and land safely on the public side.
    await page.evaluate(async () => { const d = window.__INHAGAME_P0__, m = await import('/src/jeongseok/lobby-layout.js');
      const p = m.JEONGSEOK_LOBBY_PORTALS[0].position; d.player.setLocalPosition(p.x, 1.15, p.z - 0.3); });
    await pressAction(page, false, 'jeongseok-portal');
    await page.waitForFunction(() => window.__INHAGAME_P0__.rooms.currentSpace === 'ROOM_JEONGSEOK_B1_READING' && !window.__INHAGAME_P0__.rooms.status().busy);
    await page.evaluate(async () => { const d = window.__INHAGAME_P0__, m = await import('/src/jeongseok/interior-rooms.js');
      const p = m.JEONGSEOK_LAYOUTS.ROOM_JEONGSEOK_B1_READING.exit.position; d.player.setLocalPosition(p.x, 1.15, p.z); });
    await pressAction(page, false, 'room-door');
    await page.waitForFunction(() => window.__INHAGAME_P0__.rooms.currentSpace === 'ROOM_JEONGSEOK_LOBBY' && !window.__INHAGAME_P0__.rooms.status().busy);
    assert.ok(await page.evaluate(() => { const d = window.__INHAGAME_P0__, p = d.player.getLocalPosition(); return Math.hypot(p.x, p.z + 5.6) < 0.2 && !window.__INHAGAME_JEONGSEOK_INTERIOR__.status().policy.session; }));
    entry.checks.push('Fresh server entry check → actual inner collider opens → native crossing → B1 → public return + session closed');
    // Student ID shows the pass and expiry, and the back stack returns to the card.
    await page.keyboard.press('KeyN'); await page.locator('.smartphone-app[data-app-id="student-id"]').click();
    await page.getByRole('button', { name: '🏛️ 정석학술정보관 출입' }).click();
    assert.match(await page.locator('.smartphone-content').innerText(), /가상 정석 방문증 보유[\s\S]*만료/);
    await shot(page, entry, 'student-id-pass');
    await page.locator('.smartphone-header button').first().click();
    assert.equal((await phone(page)).current.view, undefined);
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    assert.equal((await phone(page)).state, 'CLOSED');
    entry.checks.push('Student ID → 정석 출입 screen (pass + expiry) → Back to card → Esc to World');
    assert.equal(before.accountId, general.id);
    assert.deepEqual(problems, []);
    await close();
  });

  ok &= await runCase('desktop-reload-purchase-recovery', async entry => {
    const { page, problems, close } = await openWorld(entry, { viewport: { width: 1280, height: 800 }, account: reloader });
    await goToGuide(page); await pressGuide(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'NEEDS_PASS');
    await page.waitForFunction(() => window.__INHAGAME_P0__.smartphone.status().current?.view === 'jeongseok');
    let requests = 0;
    await page.route(`${API_URL}/rest/v1/rpc/purchase_jeongseok_pass_v1`, async route => {
      if (requests++ === 0) { await route.fetch(); return route.abort('connectionreset'); }
      return route.continue();
    });
    await page.getByRole('button', { name: '방문증 발급하기 · 100 인덕코인' }).click();
    await page.getByRole('button', { name: '결제 확인 · 100 인덕코인 사용' }).click();
    await page.getByRole('button', { name: '같은 요청 다시 확인' }).waitFor();
    assert.equal(debits(reloader.id), 1, 'server committed before the browser reload');
    const saved = await page.evaluate(id => localStorage.getItem(`inha-world:jeongseok-pass-key:${id}`), reloader.id);
    assert.ok(saved?.startsWith('jsl:'), 'the unresolved key is persisted');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.__INHAGAME_P0__?.getStatus().loading?.finished, null, { timeout: 180000 });
    await page.waitForFunction(id => window.__INHAGAME_P0__.jeongseok.access.accountId === id &&
      window.__INHAGAME_P0__.jeongseok.access.state === 'READY', reloader.id, { timeout: 60000 });
    await goToGuide(page);
    await page.keyboard.press('KeyN');
    await page.locator('.smartphone-app[data-app-id="student-id"]').click();
    await page.getByRole('button', { name: '🏛️ 정석학술정보관 출입' }).click();
    await page.getByRole('button', { name: '같은 요청 다시 확인' }).click();
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().notice === 'RECOVERED' && window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'IDLE', null, { timeout: 15000 });
    assert.deepEqual([requests, debits(reloader.id), coins(reloader.id)], [2, 1, 100], 'same-key replay after full reload never debits again');
    assert.equal(await page.evaluate(id => localStorage.getItem(`inha-world:jeongseok-pass-key:${id}`), reloader.id), null);
    entry.checks.push('Full reload restores unresolved key; Student ID recovery beside guide replays once without opening inner gate');
    assert.deepEqual(problems, []);
    await close();
  });

  ok &= await runCase('desktop-verified-free', async entry => {
    const { page, problems, close } = await openWorld(entry, { viewport: { width: 1280, height: 800 }, account: verified });
    await page.keyboard.press('KeyN'); await page.locator('.smartphone-app[data-app-id="student-id"]').click();
    await page.waitForSelector('.smartphone-student-mail[data-verified="true"]');
    await shot(page, entry, 'student-id-verified'); await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await goToReader(page); await press(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'READY_TO_ENTER', null, { timeout: 15000 });
    assert.equal((await gateState(page)).via, 'INHA_MAIL');
    assert.equal(debits(verified.id), 0);
    await page.waitForFunction(() => window.__INHAGAME_P0__.smartphone.shell.state === 'CLOSED');
    assert.deepEqual(await worldRestored(page), { phone: 'CLOSED', input: true, canWorld: true, inert: false, space: LOBBY });
    entry.checks.push('Verified mail badge shown on Student ID; free tag sequence via INHA_MAIL; no debit; Phone returns to World');
    // Verification removed on the server → next check needs a pass (state change reflected).
    sql(`update auth.users set email=${lit(`jsl-v-${randomUUID().slice(0, 8)}@example.test`)} where id=${lit(verified.id)}`);
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'IDLE', null, { timeout: 30000 });
    await press(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'NEEDS_PASS');
    entry.checks.push('Server-side verification change is reflected on the next check (NEEDS_PASS)');
    assert.deepEqual(problems, []);
    await close();
  });

  for (const [name, viewport] of [['mobile-portrait', { width: 390, height: 844 }], ['mobile-landscape', { width: 844, height: 390 }]]) {
    ok &= await runCase(`${name}-insufficient`, async entry => {
      const { page, problems, close } = await openWorld(entry, { viewport, mobile: true, account: poor });
      await goToGuide(page, true); await pressGuide(page, true);
      await page.waitForFunction(() => window.__INHAGAME_P0__.smartphone.status().current?.view === 'jeongseok');
      const text = await page.locator('.smartphone-content').innerText();
      assert.match(text, /1개 부족/);
      assert.equal(await page.getByRole('button', { name: '방문증 발급하기 · 100 인덕코인' }).isDisabled(), true);
      const bounds = await layout(page);
      assert.ok(bounds.phoneInViewport && !bounds.horizontalClip && bounds.focusInside && !bounds.pageHorizontalScroll, JSON.stringify(bounds));
      await shot(page, entry, 'insufficient');
      await page.getByRole('button', { name: '정석 출입 취소' }).tap();
      await page.waitForFunction(() => window.__INHAGAME_P0__.smartphone.shell.state === 'CLOSED');
      await page.locator('#context-action').waitFor({ state: 'visible' });
      assert.equal(debits(poor.id), 0);
      entry.checks.push('Public lobby guide touch action → server shortfall (1) → purchase disabled; Phone in viewport/no clip; cancel restores HUD');
      assert.deepEqual(problems, []);
      await close();
    });
  }

  ok &= await runCase('account-switch-isolation', async entry => {
    const { page, problems, close } = await openWorld(entry, { viewport: { width: 1280, height: 800 }, account: general });
    assert.equal((await page.evaluate(() => window.__INHAGAME_P0__.jeongseok.access.snapshot.via)), 'VISITOR_PASS');
    // Switch account in place: sign out, then sign in as the poor account.
    await page.evaluate(async session => { const c = window.__INHAGAME_P0__.online.supabase;
      await c.auth.signOut({ scope: 'local' }); await c.auth.setSession({ access_token: session.access_token, refresh_token: session.refresh_token }); }, poor.session);
    await page.waitForFunction(id => window.__INHAGAME_P0__.jeongseok.access.accountId === id && window.__INHAGAME_P0__.jeongseok.access.state === 'READY', poor.id);
    const view = await page.evaluate(() => window.__INHAGAME_P0__.jeongseok.access.view());
    assert.deepEqual([view.snapshot.decision, view.snapshot.pass, view.snapshot.offer.balance, view.lastPurchase], ['NEEDS_PASS', null, 99, null]);
    await page.keyboard.press('KeyN'); await page.locator('.smartphone-app[data-app-id="student-id"]').click();
    await page.getByRole('button', { name: '🏛️ 정석학술정보관 출입' }).click();
    assert.doesNotMatch(await page.locator('.smartphone-content').innerText(), /방문증 보유|150 인덕코인/);
    await shot(page, entry, 'switched');
    entry.checks.push('A (valid pass) → sign out → B in place: no A pass/balance/receipt in B access or Student ID');
    assert.deepEqual(problems, []);
    await close();
  });

  ok &= await runCase('guest-auth-required', async entry => {
    const { page, close } = await openWorld(entry, { viewport: { width: 1280, height: 800 } });
    await goToReader(page); await press(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'AUTH_REQUIRED');
    assert.equal((await phone(page)).state, 'CLOSED', 'no purchase UI for guests');
    assert.match(await page.locator('#jeongseok-gate').innerText(), /로비는 자유롭게 이용.*안내 NPC/);
    assert.equal(await page.locator('#jeongseok-gate').getAttribute('data-light'), 'red');
    await shot(page, entry, 'guest');
    entry.checks.push('Guest: AUTH_REQUIRED with public-guide direction, red light, no purchase UI, public lobby play continues');
    await close();
  });

  ok &= await runCase('server-closed-and-unknown', async entry => {
    const { page, problems, close } = await openWorld(entry, { viewport: { width: 1280, height: 800 }, account: poor });
    sql(`update private.world_jeongseok_gate_policy set status='COMING_SOON'`);
    await goToReader(page); await press(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'DISABLED');
    assert.match(await page.locator('#jeongseok-gate').innerText(), /준비 중/);
    sql(`update private.world_jeongseok_gate_policy set status='ACTIVE'`);
    await page.route(`${API_URL}/rest/v1/rpc/get_jeongseok_access_v1`, route => route.abort('internetdisconnected'));
    await frames(page); await press(page, false);
    await page.waitForFunction(() => window.__INHAGAME_P0__.jeongseok.gate.snapshot().state === 'UNKNOWN');
    assert.match(await page.locator('#jeongseok-gate').innerText(), /확인하지 못했어요/);
    await shot(page, entry, 'unknown');
    entry.checks.push('Server COMING_SOON → DISABLED (no CTA); network failure → UNKNOWN (not "unverified"), no entry');
    assert.deepEqual(problems, []);
    await close();
  });
} finally {
  sql(`update private.world_jeongseok_gate_policy set status=${lit(originalGate)}`);
  sql(`update private.world_jeongseok_pass_catalog set status=${lit(originalProduct.status)}, price_basis=${lit(originalProduct.price_basis)} where pass_type='jeongseok.visitor.day'`);
  if (users.length) sql(`delete from auth.users where id in (${users.map(lit).join(',')})`);
  server.kill();
  report.status = ok ? 'PASS' : 'FAIL'; await save();
}
console.log(JSON.stringify(report.cases.map(c => [c.name, c.status, c.error?.split('\n')[0]]), null, 1));
process.exit(ok ? 0 : 1);
