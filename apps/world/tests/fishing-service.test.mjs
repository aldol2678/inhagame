import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createFishingService, createFishingRpc, createFishingApiHandler, FishingError } from '../server/fishing-service.mjs';

const actor = randomUUID(), attemptId = randomUUID(), nonce = randomUUID(), key = randomUUID();
const sourceRef = 'fishing.inkyung.north_01';
const requests = [
  [{ op: 'start', activityId: 'activity.fishing.inkyung', sourceRef, clientAttemptKey: key },
    'world_fishing_start_v1', { p_source_ref: sourceRef, p_client_attempt_key: key }],
  [{ op: 'input', attemptId, nonce, sourceRef, action: 'HOOK' }, 'world_fishing_input_v1',
    { p_attempt_id: attemptId, p_source_ref: sourceRef, p_nonce: nonce, p_action: 'HOOK' }],
  [{ op: 'settle', attemptId }, 'world_fishing_settle_v1', { p_attempt_id: attemptId }],
  [{ op: 'read', attemptId }, 'world_fishing_read_v1', { p_attempt_id: attemptId }],
  [{ op: 'read' }, 'world_fishing_read_v1', { p_attempt_id: null }]
];
for (const [body, name, args] of requests) {
  test(`${body.op}: verified actor and exact RPC arguments`, async () => {
    const service = createFishingService({
      verifyUser: async authorization => { assert.equal(authorization, 'Bearer verified'); return actor; },
      rpc: async (rpcName, rpcArgs) => {
        assert.equal(rpcName, name); assert.deepEqual(rpcArgs, { p_user: actor, ...args }); return { ok: true };
      }
    });
    assert.deepEqual(await service('Bearer verified', body), { ok: true });
  });
}
test('every operation rejects client authority and unknown fields before RPC', async () => {
  const service = createFishingService({ verifyUser: () => actor, rpc: () => assert.fail('RPC must not run') });
  for (const [body] of requests) for (const field of [
    'userId', 'p_user', 'actorUserId', 'success', 'speciesId', 'quantity', 'lifeXp', 'weather', 'serverTime', 'policy', 'opExtra'
  ]) await assert.rejects(service('Bearer verified', { ...body, [field]: actor }),
    error => error.status === 400 && error.message === 'INVALID_REQUEST');
  for (const body of [null, [], {}, { op: 'settle' }, { op: 'read', attemptId: null },
    { ...requests[0][0], sourceRef: 'remote' }, { ...requests[1][0], action: 'SUCCEEDED' }]) {
    await assert.rejects(service('', body), error => error.status === 400);
  }
});
test('invalid token, anonymous or missing verified actor never calls RPC', async () => {
  for (const result of [null, undefined, 'forged', {}]) {
    const service = createFishingService({ verifyUser: () => result, rpc: () => assert.fail('RPC must not run') });
    await assert.rejects(service('Bearer forged', { op: 'read' }), error => error.status === 401);
  }
  const service = createFishingService({ verifyUser: () => { throw Error('sensitive upstream'); }, rpc: () => assert.fail() });
  await assert.rejects(service('', { op: 'read' }), error => error.status === 503 && error.message === 'AUTH_UNAVAILABLE');
});
test('RPC uses configured server key and never retries ambiguous mutations', async () => {
  let calls = 0;
  const rpc = createFishingRpc({ url: 'https://configured.example/', serviceKey: 'server-secret', fetcher: async (url, options) => {
    calls++; assert.equal(url, 'https://configured.example/rest/v1/rpc/world_fishing_settle_v1');
    assert.equal(options.headers.Authorization, 'Bearer server-secret');
    assert.equal(options.headers.apikey, 'server-secret');
    assert.deepEqual(JSON.parse(options.body), { p_user: actor, p_attempt_id: attemptId });
    throw Error('server-secret upstream URL');
  } });
  await assert.rejects(rpc('world_fishing_settle_v1', { p_user: actor, p_attempt_id: attemptId }),
    error => error.status === 503 && error.message === 'FISHING_UNAVAILABLE');
  assert.equal(calls, 1);
});
test('RPC exposes only allowlisted SQL errors', async () => {
  for (const [message, expected, status] of [
    ['IDEMPOTENCY_CONFLICT', 'IDEMPOTENCY_CONFLICT', 409],
    ['ATTEMPT_NOT_FOUND', 'ATTEMPT_NOT_FOUND', 404],
    ['FISHING_RATE_LIMITED', 'FISHING_RATE_LIMITED', 429],
    ['private row and server-secret', 'FISHING_UNAVAILABLE', 503]
  ]) {
    const rpc = createFishingRpc({ url: 'https://configured.example', serviceKey: 'server-secret',
      fetcher: async () => ({ ok: false, json: async () => ({ message }) }) });
    await assert.rejects(rpc('world_fishing_read_v1', {}), e => e.status === status && e.message === expected);
  }
});

function response() {
  return { headers: {}, statusCode: 0, payload: null, setHeader(k, v) { this.headers[k] = v; },
    status(code) { this.statusCode = code; return this; }, end() { return this; }, json(value) { this.payload = value; return this; } };
}
const request = body => ({ method: 'POST', headers: { host: 'world.test', 'content-type': 'application/json', authorization: 'Bearer verified' }, body });
test('HTTP rejects disabled, method, media, origin, oversized and invalid JSON requests', async () => {
  const service = () => assert.fail('service must not run');
  const cases = [
    [false, request({ op: 'read' }), 404],
    [true, { ...request({}), method: 'GET' }, 405],
    [true, { ...request({}), headers: { 'content-type': 'text/plain' } }, 415],
    [true, { ...request({}), headers: { ...request({}).headers, origin: 'https://other.test' } }, 403],
    [true, request('x'.repeat(8193)), 413], [true, request('{broken'), 400]
  ];
  for (const [enabled, req, status] of cases) {
    const res = response(); await createFishingApiHandler({ enabled, service })(req, res);
    assert.equal(res.statusCode, status); assert.equal(res.headers['Cache-Control'], 'no-store');
  }
});
test('HTTP accepts same origin, propagates safe errors and hides unclassified errors', async () => {
  for (const [error, status, message] of [
    [new FishingError('ACCOUNT_UNAVAILABLE', 403), 403, 'ACCOUNT_UNAVAILABLE'],
    [Error('server-secret'), 503, 'FISHING_UNAVAILABLE']
  ]) {
    const req = request({ op: 'read' }); req.headers.origin = 'https://world.test';
    const res = response(); await createFishingApiHandler({ enabled: true, service: () => { throw error; } })(req, res);
    assert.equal(res.statusCode, status); assert.deepEqual(res.payload, { error: message });
  }
  const res = response(); await createFishingApiHandler({ enabled: true, service: async () => ({ inventory: 1 }) })(request(Buffer.from('{"op":"read"}')), res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.payload, { inventory: 1 });
});
test('actual deployment entry point is disabled without opt-in', async () => {
  const previous = process.env.WORLD_FISHING_API_ENABLED;
  try {
    delete process.env.WORLD_FISHING_API_ENABLED;
    const handler = createRequire(import.meta.url)('../api/world-fishing.js');
    const res = response(); await handler(request({ op: 'read' }), res);
    assert.equal(res.statusCode, 404); assert.equal(res.headers['Cache-Control'], 'no-store');
  } finally {
    if (previous === undefined) delete process.env.WORLD_FISHING_API_ENABLED;
    else process.env.WORLD_FISHING_API_ENABLED = previous;
  }
});
test('enabled deployment entry point verifies the auth server before its service RPC', async () => {
  const originalFetch = globalThis.fetch;
  const keys = ['WORLD_FISHING_API_ENABLED', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let authCalls = 0, rpcCalls = 0, permanent = false;
  try {
    process.env.WORLD_FISHING_API_ENABLED = '1'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-fixture';
    process.env.SUPABASE_URL = 'http://127.0.0.1:54321'; process.env.SUPABASE_PUBLISHABLE_KEY = 'public-fixture';
    globalThis.fetch = async (url, options) => {
      assert.ok(url.startsWith('http://127.0.0.1:54321/'));
      if (url.endsWith('/auth/v1/user')) {
        authCalls++; assert.equal(options.headers.apikey, 'public-fixture');
        assert.equal(options.headers.Authorization, 'Bearer ' + 'v'.repeat(30));
        return { ok: true, json: async () => ({ id: actor, is_anonymous: !permanent }) };
      }
      rpcCalls++; assert.ok(url.endsWith('/rest/v1/rpc/world_fishing_read_v1'));
      assert.equal(options.headers.Authorization, 'Bearer server-fixture');
      assert.deepEqual(JSON.parse(options.body), { p_user: actor, p_attempt_id: null });
      return { ok: true, json: async () => ({ attempt: null, inventory: { quantity: 0 } }) };
    };
    const handler = createRequire(import.meta.url)('../api/world-fishing.js');
    const req = request({ op: 'read' }); req.headers.authorization = 'Bearer ' + 'v'.repeat(30);
    const denied = response(); await handler(req, denied);
    assert.equal(denied.statusCode, 401); assert.equal(rpcCalls, 0);
    permanent = true;
    const allowed = response(); await handler(req, allowed);
    assert.equal(allowed.statusCode, 200); assert.equal(authCalls, 2); assert.equal(rpcCalls, 1);
    assert.deepEqual(allowed.payload, { attempt: null, inventory: { quantity: 0 } });
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
  }
});
