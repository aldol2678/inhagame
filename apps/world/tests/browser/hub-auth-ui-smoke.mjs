// Browser verification of the real hub login/signup DOM and UI controllers.
// Uses synthetic Supabase responses only. Does not contact an auth provider.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = fileURLToPath(new URL('../../', import.meta.url));
const output = resolve(process.env.EVIDENCE_DIR || 'test-results/portal-layout', 'auth');
await mkdir(output, { recursive: true });
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!path.startsWith(root)) throw Error('invalid path');
    const types = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript', '.mjs':'text/javascript', '.svg':'image/svg+xml' };
    res.setHeader('Content-Type', types[extname(path)] || 'application/octet-stream');
    res.end(await readFile(path));
  } catch {
    res.writeHead(404);
    res.end();
  }
});

let browser;
const result = [];
try {
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || chromium.executablePath(),
    headless: true,
    args: ['--no-sandbox']
  });
  for (const width of [320, 390, 768, 1440]) {
    const page = await browser.newPage({ viewport:{ width, height:844 }, deviceScaleFactor:1 });
    const exceptions = [];
    page.on('pageerror', e => exceptions.push(e.message));
    await page.addInitScript(() => {
      window.__INHAGAME_PUBLIC_SUPABASE__ = {url:'https://supabase-fixture.invalid',publishableKey:'public-fixture-only'};
      const calls = [];
      window.__authFixture = {calls};
      const client = {
        auth: {
          onAuthStateChange: () => ({ data:{ subscription:{ unsubscribe(){} } } }),
          getUser: async () => ({ data:{user:null}, error:null }),
          signInWithPassword: async args => {
            calls.push({type:'login',email:args.email,passwordSupplied:Boolean(args.password)});
            return {error:{message:'Invalid login credentials'}};
          },
          signUp: async args => {
            calls.push({type:'signup',email:args.email,nickname:args.options?.data?.nickname,passwordSupplied:Boolean(args.password)});
            return {data:{session:null},error:null};
          },
          signInWithOAuth: async args => {
            calls.push({type:'google',provider:args.provider,redirect:args.options?.redirectTo});
            return {error:{message:'Synthetic OAuth failure'}};
          }
        }
      };
      window.supabase = {createClient: () => client};
    });
    await page.route('**/*', route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      if (request.resourceType() === 'script' &&
          !['/hub-account.js','/hub-auth-ux.js'].includes(url.pathname)) {
        return route.fulfill({contentType:'text/javascript',body:''});
      }
      return route.continue();
    });
    await page.goto(origin + '/?panel=account', {waitUntil:'networkidle'});
    await page.evaluate(() => {
      for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== 'account';
    });
    await page.waitForFunction(() => !document.querySelector('#hub-login-form').hidden &&
      document.querySelector('[data-auth-mode="login"]').getAttribute('aria-pressed') === 'true');
    assert.deepEqual(exceptions, [], 'No uncaught browser errors');
    assert.equal(await page.locator('#hub-signup-form').isVisible(), false);
    assert.equal(await page.locator('#hub-google-auth').isVisible(), true);
    assert.equal(await page.locator('#hub-login-form input[name="email"]').getAttribute('autocomplete'), 'username');

    const sizes = await page.evaluate(() => {
      const rect = sel => {const b=document.querySelector(sel).getBoundingClientRect();return {width:b.width,height:b.height,left:b.left,right:b.right};};
      return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth,
        account:rect('.hub-auth-card'),login:rect('#hub-login-form button[type="submit"]'),
        google:rect('#hub-google-auth'),toggle:rect('#hub-login-form .hub-auth-reveal') };
    });
    assert.ok(sizes.scrollWidth <= sizes.viewport, 'Account must have no horizontal overflow at '+width);
    assert.ok(sizes.login.height >= 44 && sizes.google.height >= 44, 'Primary actions have touch-friendly sizes');
    assert.ok(sizes.account.left >= -1 && sizes.account.right <= width+1, 'Auth card stays in viewport');
    assert.ok(sizes.toggle.width >= 44, 'Password reveal target is at least 44px wide');

    await page.screenshot({path:resolve(output,'login-'+width+'.png'),fullPage:true});
    const loginPass=page.locator('#hub-login-form input[name="password"]');
    await page.locator('#hub-login-form input[name="email"]').fill('member@example.test');
    await loginPass.fill('fixture-password-123');
    await page.locator('#hub-login-form .hub-auth-reveal').click();
    assert.equal(await loginPass.getAttribute('type'), 'text', 'Password becomes visible');
    await page.locator('[data-auth-mode="signup"]').click();
    assert.equal(await loginPass.getAttribute('type'), 'password', 'Mode switch conceals previously revealed password');
    assert.equal(await page.locator('#hub-signup-form').isVisible(),true);
    assert.equal(await page.locator('#hub-login-form').isVisible(),false);
    assert.equal(await page.locator('#hub-signup-form input[name="nickname"]').getAttribute('maxlength'),'12');
    await page.screenshot({path:resolve(output,'signup-'+width+'.png'),fullPage:true});
    assert.deepEqual(exceptions, [], 'No uncaught exceptions during mode switch');

    if (width === 390) {
      const signup=page.locator('#hub-signup-form');
      await signup.locator('input[name="nickname"]').fill('테스트오리');
      await signup.locator('input[name="email"]').fill('sample@example.test');
      await signup.locator('input[name="password"]').fill('correct-horse-111');
      await signup.locator('input[name="passwordConfirm"]').fill('wrong-horse-222');
      await signup.locator('#hub-signup-age-confirm').check();
      await signup.locator('button[type="submit"]').click();
      assert.ok((await page.locator('#hub-account-status').innerText()).includes('일치하지'), 'Mismatch is explained');
      assert.equal(await page.evaluate(() => window.__authFixture.calls.length), 0, 'Mismatch must not reach Auth');

      await signup.locator('input[name="passwordConfirm"]').fill('correct-horse-111');
      await signup.locator('button[type="submit"]').click();
      await page.waitForFunction(() => window.__authFixture.calls.some(c => c.type==='signup'));
      assert.ok((await page.locator('#hub-account-status').innerText()).includes('인증 메일'), 'Registration asks for email verification');

      await page.locator('[data-auth-mode="login"]').click();
      await page.locator('#hub-login-form input[name="email"]').fill('member@example.test');
      await page.locator('#hub-login-form input[name="password"]').fill('fixture-password-123');
      await page.locator('#hub-login-form button[type="submit"]').click();
      await page.waitForFunction(() => window.__authFixture.calls.some(c => c.type==='login'));
      assert.ok((await page.locator('#hub-account-status').innerText()).includes('실패'), 'Login error is visible');
      assert.equal(await page.locator('#hub-login-form input[name="password"]').inputValue(), '', 'Password cleared on failure');

      const googleCount=await page.evaluate(() => window.__authFixture.calls.filter(c => c.type==='google').length);
      await page.locator('#hub-google-auth').click();
      assert.equal(await page.evaluate(() => window.__authFixture.calls.filter(c => c.type==='google').length), googleCount, 'Google blocked without age self-confirmation');
      await page.locator('#hub-google-age-confirm').check();
      await page.locator('#hub-google-auth').click();
      await page.waitForFunction(() => window.__authFixture.calls.some(c => c.type==='google'));
      assert.ok((await page.locator('#hub-account-status').innerText()).includes('Google 로그인을 시작하지'), 'OAuth error handled without navigation');
      assert.equal(await page.locator('#hub-google-age-confirm').isChecked(), false, 'OAuth age checkbox reset after request');
      assert.equal(await page.locator('#hub-google-auth').isDisabled(), false, 'Failed OAuth can be retried');
      assert.deepEqual(exceptions, [], 'No uncaught errors across mock auth actions');
      const calls=await page.evaluate(() => window.__authFixture.calls);
      assert.deepEqual(calls.map(c=>c.type), ['signup','login','google'], 'Only intended mock auth calls occur');
    }

    result.push(sizes);
    await page.close();
  }
  await writeFile(resolve(output,'auth-metrics.json'),JSON.stringify(result,null,2));
  console.log(JSON.stringify({result:'PASS',cases:['login default','toggle password','mode switch','signup mismatch','mock signup','mock login failure','Google age guard','mock OAuth failure','responsive layout'],viewports:result.map(x=>x.viewport),output}));
} finally {
  try { await browser?.close(); }
  finally { if (server.listening) await new Promise(ok => server.close(ok)); }
}