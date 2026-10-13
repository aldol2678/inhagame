// AUTH-QA-P0: actual Hub/Profile Chromium with disposable loopback Supabase Auth.
// No Production URL, real user, email provider or deployed service is allowed.
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const { API_URL, ANON_KEY, SERVICE_ROLE_KEY, DB_URL, AUTH_QA_P0_HEAD } = process.env;
const loopback = value => {
  const u = new URL(value);
  assert.ok(['127.0.0.1', 'localhost'].includes(u.hostname), 'loopback-only origin required');
  return u;
};
assert.ok(API_URL && ANON_KEY && SERVICE_ROLE_KEY && DB_URL && AUTH_QA_P0_HEAD, 'local fixture and exact-head required');
assert.equal(loopback(API_URL).protocol, 'http:');
assert.ok(['postgres:', 'postgresql:'].includes(loopback(DB_URL).protocol));
const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
assert.equal(head, AUTH_QA_P0_HEAD, 'checkout does not match expected PR head');
const localAuth = new URL(API_URL).origin;
const sourceUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
const report = { head, scope: 'LOOPBACK_AUTH', cases: [], environment: { chromium: true },
  startedAt: new Date().toISOString(), status: 'RUNNING', limits: [
    'Chromium only; no real Production or physical devices',
    'Expired session metadata is not proof of JWT cryptographic expiration',
    'Revoking refresh tokens does not necessarily revoke an unexpired JWT'
  ] };
const output = 'test-results/auth-qa-p0/report.json';
const storeReport = async () => { await mkdir('test-results/auth-qa-p0', { recursive: true }); await writeFile(output, JSON.stringify(report, null, 2) + '\n'); };
const sql = value => "'" + String(value).replaceAll("'", "''") + "'";
const query = statement => execFileSync('psql', [DB_URL, '-v', 'ON_ERROR_STOP=1', '-Atqc', statement], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const localFetch = async (path, options = {}) => {
  const url = new URL(path, localAuth);
  assert.equal(url.origin, localAuth, 'request must stay on disposable local Auth');
  return fetch(url, options);
};
const freePort = () => new Promise((resolve, reject) => {
  const socket = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
    const port = socket.address().port; socket.close(() => resolve(port));
  });
});
const users = [];
async function createUser(label) {
  const email = `auth-qa-${label}-${randomUUID()}@example.test`;
  const password = `AuthQA-${randomUUID()}-9!`;
  const response = await localFetch('/auth/v1/admin/users', { method: 'POST', headers: {
    apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json'
  }, body: JSON.stringify({ email, password, email_confirm: true }) });
  assert.equal(response.status, 200, 'local test account provisioning');
  const user = await response.json();
  assert.match(user.id, /^[0-9a-f-]{36}$/i);
  users.push(user.id);
  const nickname = `QA${label}${users.length}`;
  query(`insert into public.profiles(user_id,nickname,is_banned) values (${sql(user.id)},${sql(nickname)},false)`);
  return { id: user.id, email, password, nickname };
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function scenario(id, description, fn) {
  const item = { id, description, status: 'RUNNING' }; report.cases.push(item);
  try { await fn(); item.status = 'PASS'; }
  catch (error) {
    item.status = /BFCache was not restored|JWT_UNEXPIRED|ENV_UNAVAILABLE/.test(String(error)) ? 'HOLD' : 'FAIL';
    item.error = String(error?.message || error).replace(/(Bearer|password|refresh_token|access_token)\s*[:=]?\s*[^\s,]+/gi, '$1 [REDACTED]');
  }
  await storeReport();
}
let server, browser;
let sourceBytes;
const diagnostics = [];
try {
  // One bounded CDN fetch is used only to serve a fixed SDK snapshot to localhost pages.
  const sourceResponse = await fetch(sourceUrl);
  assert.equal(sourceResponse.status, 200, 'Supabase SDK download');
  sourceBytes = await sourceResponse.text();
  assert.ok(sourceBytes.length > 50000);
  report.sdkSha256 = createHash('sha256').update(sourceBytes).digest('hex');
  const port = await freePort();
  server = spawn(process.execPath, ['apps/world/dev-server.mjs'], {
    env: { ...process.env, PORT: String(port), NPC_AI_PILOT: '0' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  const origin = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('local site did not start')), 15000);
    server.stdout.on('data', d => { if (String(d).includes('listening')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`site exited: ${code}`)); });
  });
  browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--disable-back-forward-cache'] });
  const A = await createUser('A'); const B = await createUser('B');
  async function pageCase() {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
    await context.addInitScript(() => {
      window.__authQAPageshow = [];
      addEventListener('pageshow', e => window.__authQAPageshow.push(e.persisted));
    });
    const attempted = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin) {
        if (url.pathname === '/api/public-supabase-config') return route.fulfill({ status: 200,
          contentType: 'application/javascript', body: `globalThis.__INHAGAME_PUBLIC_SUPABASE__ = Object.freeze(${JSON.stringify({ url: localAuth, publishableKey: ANON_KEY })});` });
        if (url.pathname.startsWith('/api/')) return route.fulfill({ status: 204 });
        return route.continue();
      }
      if (url.origin === localAuth) return route.continue();
      if (url.href === sourceUrl) return route.fulfill({ status: 200, contentType: 'application/javascript', body: sourceBytes });
      attempted.push(url.origin); return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    page.setDefaultTimeout(12000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message).slice(0,200)));
    const close = async () => { diagnostics.push(...attempted); await context.close(); };
    return { page, context, errors, close };
  }
  async function openLogin(page) {
    await page.goto(`${origin}/#account`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-auth-mode="login"]').waitFor({ state: 'visible' });
    await page.locator('[data-auth-mode="login"]').click();
    await page.locator('#hub-login-form').waitFor({ state: 'visible' });
  }
  async function fillLogin(page, account, password = account.password) {
    await page.locator('#hub-login-form input[name="email"]').fill(account.email);
    await page.locator('#hub-login-form input[name="password"]').fill(password);
    await page.locator('#hub-login-form button[type="submit"]').click();
  }
  async function login(page, account) {
    await openLogin(page); await fillLogin(page, account);
    await page.locator('#hub-account-actions').waitFor({ state: 'visible' });
    const found = await page.evaluate(() => window.InhaHubAccountClient.auth.getUser().then(x => x.data.user?.id));
    assert.equal(found, account.id);
  }
  async function signOutCurrentAccount(page) {
    // Hub bootstrap is asynchronous: a hidden button is not proof of sign-out.
    await page.goto(`${origin}/#account`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.InhaHubAccountClient);
    const id = await page.evaluate(() => window.InhaHubAccountClient.auth.getUser().then(x => {
      if (x.error && x.error.name !== 'AuthSessionMissingError') throw Error('Hub auth read failed');
      return x.data.user?.id || null;
    }));
    if (id) {
      await page.locator('#hub-sign-out').waitFor({ state: 'visible' });
      await page.locator('#hub-sign-out').click();
    }
    await page.locator('[data-auth-mode="login"]').waitFor({ state: 'visible' });
    const after = await page.evaluate(() => window.InhaHubAccountClient.auth.getUser().then(x => {
      if (x.error && x.error.name !== 'AuthSessionMissingError') throw Error('Hub auth read failed');
      return x.data.user?.id || null;
    }));
    assert.equal(after, null, 'account switch must complete logout before the next login');
  }
  const withPage = async action => { const c = await pageCase(); try { await action(c); } finally { await c.close(); } };

  await scenario('AUTH-01', 'wrong password and retry', () => withPage(async ({ page }) => {
    await openLogin(page); await fillLogin(page, A, 'wrong-password-9!');
    await page.getByText('로그인에 실패했습니다. 계정 정보를 확인해 주세요.').waitFor();
    assert.equal(await page.locator('#hub-login-form button[type="submit"]').isEnabled(), true);
    assert.equal(await page.locator('#hub-login-form input[name="password"]').inputValue(), '');
    assert.equal(await page.locator('#hub-account-actions').isVisible(), false);
    await fillLogin(page, A); await page.locator('#hub-account-actions').waitFor({ state: 'visible' });
  }));

  await scenario('AUTH-02', 'rejected auth promise must restore form', () => withPage(async ({ page, errors }) => {
    await openLogin(page);
    await page.evaluate(() => { window.InhaHubAccountClient.auth.signInWithPassword = async () => { throw Error('AUTH_QA_NETWORK_THROW'); }; });
    await fillLogin(page, A);
    await sleep(400);
    assert.equal(await page.locator('#hub-login-form button[type="submit"]').isEnabled(), true, 'exception must release submit button');
    assert.equal(await page.locator('#hub-account-actions').isVisible(), false);
    assert.deepEqual(errors, [], 'unhandled page error');
  }));

  await scenario('AUTH-03', 'signed-out profile back navigation and real BFCache', () => withPage(async ({ page, context }) => {
    const cdp = await context.newCDPSession(page); await cdp.send('Page.enable');
    report.bfcache = { restored: false, notRestoredReasons: [] };
    cdp.on('Page.backForwardCacheNotUsed', event => {
      report.bfcache.notRestoredReasons = (event.notRestoredExplanations || [])
        .map(({ type, reason }) => ({ type, reason }));
    });
    await login(page, A);
    await page.goto(`${origin}/profile/`);
    await page.locator('#profile-content').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#profile-nickname').textContent(), A.nickname);
    await page.goto(`${origin}/#account`);
    await page.locator('#hub-sign-out').click();
    await page.locator('#hub-login-form').waitFor({ state: 'hidden' }).catch(() => {});
    await page.getByText('회원가입하거나 기존 계정으로 로그인하세요.').waitFor();
    const history = await cdp.send('Page.getNavigationHistory');
    const entry = [...history.entries].reverse().find(e => new URL(e.url).pathname === '/profile/');
    assert.ok(entry, 'profile navigation history');
    await cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id });
    await page.waitForURL('**/profile/');
    await sleep(350);
    const restores = await page.evaluate(() => window.__authQAPageshow);
    report.bfcache.restored = restores.includes(true);
    assert.ok(restores.includes(true), 'BFCache was not restored');
    assert.equal(await page.locator('#profile-content').isVisible(), false, 'stale profile shown after logout');
    assert.equal(await page.locator('#profile-edit').isVisible(), false);
  }));

  await scenario('AUTH-04', 'reload restores account A', () => withPage(async ({ page }) => {
    await login(page, A); await page.reload();
    await page.locator('#hub-account-actions').waitFor({ state: 'visible' });
    const found = await page.evaluate(() => window.InhaHubAccountClient.auth.getUser().then(x => x.data.user?.id));
    assert.equal(found, A.id);
    await page.goto(`${origin}/profile/`);
    await page.locator('#profile-content').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#profile-nickname').textContent(), A.nickname);
  }));

  await scenario('AUTH-05', 'reload during login converges to safe state', () => withPage(async ({ page }) => {
    await openLogin(page);
    let pending; let requested;
    const arrived = new Promise(resolve => { requested = resolve; });
    await page.route('**/auth/v1/token?grant_type=password', route => { pending = route; requested(); });
    await page.locator('#hub-login-form input[name="email"]').fill(A.email);
    await page.locator('#hub-login-form input[name="password"]').fill(A.password);
    await page.locator('#hub-login-form button[type="submit"]').click();
    await Promise.race([arrived, sleep(8000).then(() => { throw Error('login request not observed'); })]);
    const reload = page.reload({ waitUntil: 'domcontentloaded' });
    await pending?.abort('failed').catch(() => {});
    await reload;
    await page.locator('#hub-account-status').waitFor();
    await page.waitForFunction(() => /로그인|회원가입|계정/.test(document.querySelector('#hub-account-status')?.textContent || ''));
    const identity = await page.evaluate(() => window.InhaHubAccountClient.auth.getUser().then(x => x.data.user?.id || null));
    assert.ok(identity === null || identity === A.id, 'unexpected identity after interrupted login');
    if (identity === null) assert.equal(await page.locator('#hub-account-actions').isVisible(), false);
  }));

  async function expireStorage(page, account) {
    return page.evaluate(id => {
      const key = Object.keys(localStorage).find(k => /^sb-.*-auth-token$/.test(k));
      assertKey(key);
      function assertKey(v) { if (!v) throw Error('member auth storage missing'); }
      const state = JSON.parse(localStorage.getItem(key));
      if (state.user?.id !== id) throw Error('unexpected stored account');
      state.expires_at = Math.floor(Date.now()/1000) - 60;
      state.expires_in = 0;
      localStorage.setItem(key, JSON.stringify(state));
      return key;
    }, account.id);
  }
  await scenario('AUTH-06', 'expired metadata + valid refresh token', () => withPage(async ({ page }) => {
    await login(page, A);
    await expireStorage(page, A);
    const refreshes = [];
    page.on('request', r => { if (r.url().startsWith(`${localAuth}/auth/v1/token`) && r.url().includes('refresh_token')) refreshes.push(1); });
    await page.reload();
    await page.locator('#hub-account-actions').waitFor({ state: 'visible' });
    const id = await page.evaluate(() => window.InhaHubAccountClient.auth.getUser().then(x => x.data.user?.id));
    assert.equal(id, A.id);
    assert.ok(refreshes.length >= 1, 'expired session was not refreshed through local Auth');
  }));

  await scenario('AUTH-07', 'revoked refresh token fails closed', () => withPage(async ({ page }) => {
    await login(page, A);
    const session = await page.evaluate(() => window.InhaHubAccountClient.auth.getSession().then(x => x.data.session));
    assert.ok(session?.access_token && session?.refresh_token);
    const revoke = await localFetch('/auth/v1/logout?scope=global', { method: 'POST', headers: { apikey: ANON_KEY, Authorization: `Bearer ${session.access_token}` } });
    assert.equal(revoke.status, 204, 'local Auth session revocation');
    const retry = await localFetch('/auth/v1/token?grant_type=refresh_token', { method: 'POST',
      headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh_token }) });
    assert.ok(retry.status >= 400, 'revoked refresh token must be rejected by local Auth');
    await expireStorage(page, A);
    await page.reload();
    await page.waitForFunction(() => !/계정 상태를 확인하는 중/.test(document.querySelector('#hub-account-status')?.textContent || ''));
    if (await page.locator('#hub-account-actions').isVisible()) throw Error('JWT_UNEXPIRED: client still holds an unexpired access JWT');
    await page.goto(`${origin}/profile/`);
    await page.waitForFunction(() => !/계정 상태를 확인하는 중/.test(document.querySelector('#profile-status')?.textContent || ''));
    assert.equal(await page.locator('#profile-content').isVisible(), false);
  }));

  await scenario('AUTH-08', 'A-B-A browser switching does not expose other profile', () => withPage(async ({ page }) => {
    for (const account of [A, B, A]) {
      await signOutCurrentAccount(page);
      await login(page, account);
      await page.goto(`${origin}/profile/`);
      await page.locator('#profile-content').waitFor({ state: 'visible' });
      assert.equal(await page.locator('#profile-nickname').textContent(), account.nickname);
    }
  }));

  if (diagnostics.length) throw Error('unexpected off-origin traffic was blocked');
} catch (error) {
  report.infrastructureError = String(error?.message || error);
} finally {
  report.endedAt = new Date().toISOString();
  report.status = report.infrastructureError || report.cases.length !== 8 ? 'HOLD'
    : report.cases.some(c => c.status === 'FAIL') ? 'FAIL'
    : report.cases.some(c => c.status === 'HOLD') ? 'HOLD' : 'PASS';
  await storeReport();
  if (users.length) try { query(`delete from auth.users where id in (${users.map(sql).join(',')})`); } catch { report.cleanup = 'FAILED'; }
  await browser?.close().catch(() => {});
  server?.kill();
  if (report.cleanup === 'FAILED') { report.status = 'HOLD'; await storeReport(); }
}
console.log(JSON.stringify({ status: report.status, head, cases: report.cases.map(({ id, status }) => ({ id, status })) }));
if (report.status !== 'PASS') process.exitCode = 1;
