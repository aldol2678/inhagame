import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const routePath = fileURLToPath(new URL('../api/public-supabase-config.js', import.meta.url));
const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const hubAccount = readFileSync(new URL('../hub-account.js', import.meta.url), 'utf8');
const campusHtml = readFileSync(new URL('../campus/index.html', import.meta.url), 'utf8');

function responseRecorder() {
  return {
    headers: {},
    statusCode: 200,
    body: '',
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = String(value); },
    status(code) { this.statusCode = code; return this; },
    send(value = '') { this.body = String(value); return this; },
    end(value = '') { this.body = String(value); return this; }
  };
}

test('hub loads production Supabase config before account bootstrap', () => {
  assert.match(indexHtml, /<script defer src="\/api\/public-supabase-config"><\/script>/);
  assert.doesNotMatch(indexHtml, /<script defer src="\/supabase-public-config\.js"><\/script>/);
});

test('campus loads shared auth config synchronously before any module executes', () => {
  const configScript = '<script src="/api/public-supabase-config"></script>';
  const configOffset = campusHtml.indexOf(configScript);
  assert.ok(configOffset >= 0, 'load the same config endpoint as the hub');
  assert.ok(configOffset < campusHtml.search(/<script\b[^>]*type="module"/),
    'module imports capture the config at evaluation time');
});

test('world module constants consume the hub config before creating member and guest clients', () => {
  const moduleUrl = new URL('../src/online/world-online.js', import.meta.url).href;
  const result = execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    const shared = { url: 'https://example-project.supabase.co', publishableKey: 'sb_publishable_example' };
    globalThis.__INHAGAME_PUBLIC_SUPABASE__ = Object.freeze(shared);
    const { startWorldOnline, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, GUEST_AUTH_STORAGE_KEY } = await import(${JSON.stringify(moduleUrl)});
    assert.equal(SUPABASE_URL, shared.url);
    assert.equal(SUPABASE_PUBLISHABLE_KEY, shared.publishableKey);
    const calls = [];
    const lib = { createClient(url, key, options) {
      calls.push({ url, key, options });
      return { auth: {
        getSession: async () => ({ data: { session: null } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
        signInAnonymously: async () => ({ data: { user: null } })
      } };
    } };
    const online = startWorldOnline({
      app: { on() {}, off() {} }, places: { onPlaceZoneChanged() { return () => {}; } },
      player: { getLocalPosition: () => ({ x: 0, y: 0, z: 0 }) }, controller: {},
      supabaseLib: lib, windowTarget: null
    });
    await online.refreshAuth();
    assert.equal(calls.length, 2);
    for (const call of calls) {
      assert.equal(call.url, shared.url);
      assert.equal(call.key, shared.publishableKey);
    }
    assert.equal(calls[0].options, undefined, 'member retains the shared default Supabase storage key');
    assert.equal(calls[1].options.auth.storageKey, GUEST_AUTH_STORAGE_KEY);
    assert.equal(calls[1].options.auth.detectSessionInUrl, false);
    online.stop();
    console.log('PASS');
  `], { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(?:SUPABASE_URL|SUPABASE_PUBLISHABLE_KEY|VITE_SUPABASE_URL|VITE_SUPABASE_PUBLISHABLE_KEY)$/.test(key))) });
  assert.match(result, /PASS/);
});

test('public config route emits only the browser-safe Supabase config from env', () => {
  const beforeUrl = process.env.SUPABASE_URL;
  const beforeKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    process.env.SUPABASE_URL = 'https://example-project.supabase.co';
    process.env.SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_example';
    delete require.cache[require.resolve(routePath)];
    const handler = require(routePath);
    const res = responseRecorder();
    handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['cache-control'], 'no-store, max-age=0');
    assert.match(res.headers['content-type'], /application\/javascript/);
    assert.match(res.body, /example-project\.supabase\.co/);
    assert.match(res.body, /sb_publishable_example/);
    assert.doesNotMatch(res.body, /service_role|sb_secret_/);
    assert.doesNotThrow(() => new Function(res.body));
  } finally {
    if (beforeUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = beforeUrl;
    if (beforeKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = beforeKey;
  }
});

test('public config route fails closed when production config is unavailable', () => {
  const beforeUrl = process.env.SUPABASE_URL;
  const beforeKey = process.env.SUPABASE_PUBLISHABLE_KEY;
  try {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_PUBLISHABLE_KEY;
    delete require.cache[require.resolve(routePath)];
    const handler = require(routePath);
    const res = responseRecorder();
    handler({ method: 'GET' }, res);
    assert.equal(res.statusCode, 503);
    assert.match(res.body, /config is unavailable/);
  } finally {
    if (beforeUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = beforeUrl;
    if (beforeKey === undefined) delete process.env.SUPABASE_PUBLISHABLE_KEY; else process.env.SUPABASE_PUBLISHABLE_KEY = beforeKey;
  }
});

test('hub auth uses same-origin redirects instead of public-export placeholders', () => {
  assert.match(hubAccount, /emailRedirectTo:\s*new URL\('\/\?panel=account', location\.origin\)\.href/);
  assert.doesNotMatch(hubAccount, /inhagame\.example/);
  assert.match(hubAccount, /if \(publicConfig\.url && publicConfig\.publishableKey\)/);
});
