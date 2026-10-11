import test from 'node:test';
import assert from 'node:assert/strict';
import { incomeCandidateConfig, createConfiguredIncomeCandidateHandler, createIncomeCandidateHttpHandler } from '../server/income-candidate-http.mjs';
import { createIncomeCandidateRequest } from '../src/income/income-http-client.mjs';
const env = { WORLD_INCOME_CANDIDATE_ENABLED: '1', WORLD_INCOME_CANDIDATE_SUPABASE_URL: 'http://127.0.0.1:54321',
  WORLD_INCOME_CANDIDATE_ANON_KEY: 'synthetic-anon', WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY: 'synthetic-service' };
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = 'synthetic.local.bearer.with.no.real.account';
async function call(handler, overrides = {}) {
  const req = { method: 'POST', headers: { host: 'localhost:8080', origin: 'http://localhost:8080', 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: { op: 'status', questId: 'quest.side.convenience_help' }, ...overrides };
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(text) { this.body = text; } };
  await handler(req, res); return res;
}
test('candidate guards reject Production, remote DB, missing flags/secrets without external fetch', async () => {
  assert.equal(incomeCandidateConfig(env).enabled, true);
  for (const overrides of [{ WORLD_INCOME_CANDIDATE_ENABLED: '0' }, { NODE_ENV: 'production' }, { VERCEL_ENV: 'production' },
    { WORLD_INCOME_CANDIDATE_SUPABASE_URL: 'https://example.supabase.co' }, { WORLD_INCOME_CANDIDATE_SUPABASE_URL: 'http://localhost.evil:54321' },
    { WORLD_INCOME_CANDIDATE_SUPABASE_URL: 'http://127.0.0.1:54321@evil.test' }, { WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY: '' }]) {
    const handler = createConfiguredIncomeCandidateHandler({ ...env, ...overrides }, () => assert.fail('disabled must never fetch'));
    assert.equal((await call(handler)).statusCode, 404);
  }
});
test('actual candidate auth verifier supplies actor; client identity cannot enter RPC', async () => {
  const fetches = [];
  const handler = createConfiguredIncomeCandidateHandler(env, async (url, init) => {
    fetches.push([url, init]);
    return { ok: true, status: 200, json: async () => url.endsWith('/auth/v1/user') ? { id: account, is_anonymous: false } : { enabled: false } };
  });
  const result = await call(handler);
  assert.equal(result.statusCode, 200); assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(fetches[0][0], 'http://127.0.0.1:54321/auth/v1/user');
  assert.equal(JSON.parse(fetches[1][1].body).p_user, account);
  assert.equal(fetches[1][1].redirect, 'error');
  assert.equal((await call(handler, { body: { op: 'status', userId: account } })).statusCode, 400);
  assert.equal(fetches.length, 2);
});
test('HTTP rejects missing auth/anonymous accounts and sanitizes auth outage', async () => {
  for (const [reply, expected] of [[{ id: account, is_anonymous: true }, 401], [{ id: 'fake', is_anonymous: false }, 401]]) {
    const handler = createConfiguredIncomeCandidateHandler(env, async () => ({ ok: true, json: async () => reply }));
    assert.equal((await call(handler)).statusCode, expected);
  }
  const outage = createConfiguredIncomeCandidateHandler(env, async () => { throw new Error('private credential data'); });
  assert.equal((await call(outage)).body, '{"error":"AUTH_UNAVAILABLE"}');
});
test('HTTP rejects method/origin/body size/malformed JSON before service', async () => {
  const handler = createIncomeCandidateHttpHandler({ enabled: true, service: () => assert.fail() });
  for (const [override, status] of [[{ method: 'GET' }, 405], [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ headers: { 'content-type': 'application/json', host: 'localhost:8080', origin: 'https://evil.test' } }, 403],
    [{ body: 'x'.repeat(8193) }, 413], [{ body: '{' }, 400]]) assert.equal((await call(handler, override)).statusCode, status);
});
test('browser HTTP transport is local-only, uses fresh bearer and never retries a lost response', async () => {
  assert.throws(() => createIncomeCandidateRequest({ location: { hostname: 'inhagame.test' } }), /LOCAL_ONLY/);
  let calls = 0;
  const request = createIncomeCandidateRequest({ location: { hostname: 'localhost' }, getAuthorization: async () => `Bearer ${token}`,
    fetcher: async (url, init) => { calls++; assert.equal(url, '/api/world-income-candidate'); assert.equal(init.headers.Authorization, `Bearer ${token}`); throw new Error('lost'); } });
  await assert.rejects(request({ op: 'status' }), { code: 'INCOME_UNAVAILABLE', status: 503 });
  assert.equal(calls, 1);
});
test('account epoch change while acquiring authorization prevents the old click from sending', async () => {
  let epoch = 1, resolveAuth, calls = 0;
  const request = createIncomeCandidateRequest({ location: { hostname: 'localhost' }, getAccountEpoch: () => epoch,
    getAuthorization: () => new Promise(resolve => { resolveAuth = resolve; }), fetcher: () => { calls++; assert.fail('old click must not send'); } });
  const mutation = request({ op: 'start', questId: 'quest.side.taerin_carp', requestId: account });
  epoch = 2; resolveAuth(`Bearer ${token}`);
  await assert.rejects(mutation, { code: 'AUTH_CHANGED', status: 409 }); assert.equal(calls, 0);
});
