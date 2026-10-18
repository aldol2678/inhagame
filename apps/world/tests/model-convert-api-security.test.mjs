import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const target = '../api/model-convert.js';
const keys = ['MODEL_CONVERT_ENABLED', 'MODEL_CONVERT_CLOUD_RUN_URL', 'MODEL_CONVERT_PROXY_SECRET',
  'MODEL_CONVERT_ALLOWED_USER_IDS', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
const original = Object.fromEntries(keys.map(key => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const allowed = '11111111-2222-4333-8444-555555555555';
const other = '99999999-2222-4333-8444-555555555555';
const token = 'Bearer ' + 'a'.repeat(40);
const fbx = Buffer.from('Kaydara FBX Binary  \0\x1a\0', 'binary');
const glb = Buffer.alloc(20);
glb.write('glTF', 0, 'ascii');
glb.writeUInt32LE(2, 4);
glb.writeUInt32LE(20, 8);

function configure(overrides = {}) {
  for (const key of keys) delete process.env[key];
  Object.assign(process.env, {
    MODEL_CONVERT_ENABLED: '1',
    MODEL_CONVERT_CLOUD_RUN_URL: 'https://example-converter.run.app',
    MODEL_CONVERT_PROXY_SECRET: 's'.repeat(32),
    MODEL_CONVERT_ALLOWED_USER_IDS: allowed,
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example'
  }, overrides);
  delete require.cache[require.resolve(target)];
  return require(target);
}
function res() {
  return {
    statusCode: null, headers: {}, body: null,
    setHeader(key, value) { this.headers[key.toLowerCase()] = value; return this; },
    status(code) { this.statusCode = code; return this; },
    end() { return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; }
  };
}
async function invoke(handler, opts = {}) {
  const response = res();
  await handler({
    method: 'POST', headers: {
      'content-type': 'application/octet-stream', 'x-model-filename': 'demo.fbx',
      authorization: token, host: 'inhagame.app'
    }, body: fbx, ...opts
  }, response);
  return response;
}
function stub({ id = allowed, authStatus = 200, glbBody = glb } = {}) {
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), init });
    if (String(url).endsWith('/auth/v1/user')) {
      return Response.json({ id, is_anonymous: false }, { status: authStatus });
    }
    return new Response(glbBody, { status: 200, headers: { 'content-type': 'model/gltf-binary' } });
  };
  return requests;
}

test('feature is fail-closed without activation, secret or operator allowlist', async () => {
  let handler = configure({ MODEL_CONVERT_ENABLED: '0' });
  assert.deepEqual((await invoke(handler, { method: 'GET' })).body, { enabled: false });
  assert.equal((await invoke(handler)).statusCode, 404);
  handler = configure({ MODEL_CONVERT_ALLOWED_USER_IDS: '' });
  assert.deepEqual((await invoke(handler, { method: 'GET' })).body, { enabled: false });
  handler = configure({ MODEL_CONVERT_PROXY_SECRET: '' });
  assert.deepEqual((await invoke(handler, { method: 'GET' })).body, { enabled: false });
});

test('missing authorization is rejected before any fetch', async () => {
  const handler = configure(); const requests = stub();
  const response = await invoke(handler, { headers: { 'content-type': 'application/octet-stream', 'x-model-filename': 'demo.fbx', host: 'inhagame.app' } });
  assert.equal(response.statusCode, 401);
  assert.equal(requests.length, 0);
});

test('only allowlisted, verified, non-anonymous Supabase users reach Cloud Run', async () => {
  const handler = configure();
  let requests = stub({ id: other });
  assert.equal((await invoke(handler)).statusCode, 403);
  assert.equal(requests.length, 1);
  requests = stub();
  const response = await invoke(handler);
  assert.equal(response.statusCode, 200);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /auth\/v1\/user$/u);
  assert.equal(requests[1].url, 'https://example-converter.run.app');
  assert.deepEqual(response.body, glb);
});

test('invalid FBX, missing MIME, declared oversize, forged Origin fail safely', async () => {
  const handler = configure();
  let requests = stub();
  assert.equal((await invoke(handler, { body: Buffer.from('not fbx') })).statusCode, 415);
  assert.equal(requests.length, 1);
  requests = stub();
  const base = { 'x-model-filename': 'demo.fbx', authorization: token, host: 'inhagame.app' };
  assert.equal((await invoke(handler, { headers: base })).statusCode, 415);
  assert.equal((await invoke(handler, { headers: { ...base, 'content-type': 'application/octet-stream', 'content-length': '30000000' } })).statusCode, 413);
  assert.equal((await invoke(handler, { headers: { ...base, 'content-type': 'application/octet-stream', origin: 'https://attacker.example' } })).statusCode, 403);
  assert.equal(requests.length, 0);
});

test('auth outage fails closed, oversized converter result fails bounded', async () => {
  const handler = configure();
  let requests = stub({ authStatus: 500 });
  assert.equal((await invoke(handler)).statusCode, 503);
  assert.equal(requests.length, 1);
  requests = stub({ glbBody: Buffer.alloc(25 * 1024 * 1024 + 1) });
  assert.equal((await invoke(handler)).statusCode, 502);
  assert.equal(requests.length, 2);
});

test.after(() => {
  for (const key of keys) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  globalThis.fetch = originalFetch;
});
