import test from 'node:test';
import assert from 'node:assert/strict';
import { createConvenienceAuthorityService, createConvenienceVerifier, createConvenienceRpc,
  createConfiguredConvenienceAuthorityHandler } from '../server/convenience-authority-service.mjs';
import { IncomeError } from '../server/income-service.mjs';
import { CONVENIENCE_TARGET } from '../server/presence/convenience-target.mjs';

// All authority rows, Auth replies, RPCs, and clocks below are synthetic.
// These tests establish JavaScript boundary behavior, NOT actual PostgreSQL/Auth/DB proof.
const account = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const authSession = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const connection = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const authoritySession = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const requestId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const jobSession = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const epoch = Date.UTC(2026, 0, 1), digest = 'a'.repeat(64);
const bearer = 'Bearer synthetic.local.bearer.with.no.real.account';
const principal = { accountId: account, authSessionId: authSession };
const clone = value => JSON.parse(JSON.stringify(value));
const packet = (sequence, moveX = 1, moveZ = 0) => ({ sequence, moveX, moveZ });
const scope = { connectionId: connection, authoritySessionId: authoritySession, fence: 7 };
const env = { WORLD_INCOME_CANDIDATE_ENABLED: '1', WORLD_CONVENIENCE_AUTHORITY_CANDIDATE: '1',
  WORLD_INCOME_CANDIDATE_SUPABASE_URL: 'http://127.0.0.1:54321',
  WORLD_INCOME_CANDIDATE_ANON_KEY: 'synthetic-anon', WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY: 'synthetic-service' };
const geometry = () => ({ manifest: { digest, frame: 'CAMPUS_LOCAL_XYZ' },
  valid: p => !!p && ['x', 'y', 'z'].every(k => Number.isFinite(p[k])),
  spawn: id => ({ x: id === 'BACK_GATE' ? 10 : 0, y: 1.15, z: 0 }),
  advance: (p, dx, dz) => ({ ...p, x: p.x + dx, z: p.z + dz }), lineOfSight: () => true });
const reject = (promise, code, status) => assert.rejects(promise, error => error.code === code && (status === undefined || error.status === status));
function fixture(options = {}) {
  const calls = [], verified = [];
  let nowMs = epoch, row = { sessionId: authoritySession, fence: 7, spawnId: 'MAIN_GATE', active: true,
    state: null, eligible: false, targetVersion: CONVENIENCE_TARGET.version, geometryRevision: digest, ...options.row };
  const rpc = async (name, args) => {
    calls.push({ name, args: clone(args) });
    if (options.hook) { const override = await options.hook(name, args, row); if (override !== undefined) return override; }
    if (name === 'world_convenience_income_v2') return { enabled: false, synthetic: true };
    if (args.p_op === 'COMMIT') {
      if (args.p_session !== row.sessionId || args.p_fence !== row.fence) throw new IncomeError('CONVENIENCE_SESSION_CHANGED', 409);
      if (args.p_revision !== (row.state?.revision ?? 0)) throw new IncomeError('CONVENIENCE_CAS_CONFLICT', 409);
      row = { ...row, state: clone(args.p_state), eligible: args.p_eligible };
    } else if (args.p_op === 'REVOKE') row = { ...row, active: false };
    return clone({ ...row, nowMs });
  };
  const service = createConvenienceAuthorityService({ enabled: true, geometry: options.geometry ?? geometry(), rpc,
    verifyUser: async authorization => { verified.push(authorization); return principal; }, ...options.service });
  return { calls, verified, rpc, service, get row() { return clone(row); }, set now(value) { nowMs = value; },
    open: () => service(bearer, { op: 'open', connectionId: connection }),
    move: command => service(bearer, { op: 'move', ...scope, command }) };
}
async function http(handler, overrides = {}) {
  const req = { method: 'POST', headers: { host: 'localhost:8080', origin: 'http://localhost:8080',
    'content-type': 'application/json', authorization: bearer }, body: { op: 'status', connectionId: connection }, ...overrides };
  const res = { headers: {}, setHeader(key, value) { this.headers[key] = value; }, end(value) { this.body = value; } };
  await handler(req, res); return res;
}
const jwt = claims => `Bearer ${Buffer.from('{"alg":"synthetic"}').toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.synthetic-signature`;
const claims = () => ({ sub: account, session_id: authSession, exp: Math.floor(Date.now() / 1000) + 3600 });

test('candidate is closed unless every local-only flag and secret is present; Production never fetches', async () => {
  for (const change of [{ WORLD_CONVENIENCE_AUTHORITY_CANDIDATE: '0' }, { WORLD_INCOME_CANDIDATE_ENABLED: '0' },
    { NODE_ENV: 'production' }, { VERCEL_ENV: 'production' }, { WORLD_INCOME_CANDIDATE_ANON_KEY: '' },
    { WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY: '' }, ...['https://example.supabase.co', 'http://localhost.evil:54321',
      'http://127.0.0.1:54321@evil.test', 'http://127.0.0.1:54321/path', 'http://[::1]:54321'].map(url => ({ WORLD_INCOME_CANDIDATE_SUPABASE_URL: url }))]) {
    const handler = createConfiguredConvenienceAuthorityHandler({ ...env, ...change }, () => assert.fail('closed candidate cannot fetch'));
    assert.equal((await http(handler)).statusCode, 404);
  }
});

test('direct service also fails closed by default and under either Production environment', async () => {
  const dependencies = { verifyUser: () => assert.fail('closed service cannot authenticate'), rpc: () => assert.fail('closed service cannot RPC') };
  await reject(createConvenienceAuthorityService(dependencies)(bearer, {}), 'CONVENIENCE_CLOSED', 404);
  for (const key of ['NODE_ENV', 'VERCEL_ENV']) {
    const previous = process.env[key];
    try { process.env[key] = 'production'; await reject(createConvenienceAuthorityService({ ...dependencies, enabled: true })(bearer, {}), 'CONVENIENCE_CLOSED', 404); }
    finally { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; }
  }
});

test('HTTP method, origin, media type, malformed JSON and oversized bodies fail before Auth or RPC', async () => {
  const handler = createConfiguredConvenienceAuthorityHandler(env, () => assert.fail('invalid HTTP must not fetch'));
  for (const [override, status] of [[{ method: 'GET' }, 405], [{ headers: { 'content-type': 'text/plain' } }, 415],
    [{ headers: { host: 'localhost:8080', origin: 'https://evil.test', 'content-type': 'application/json' } }, 403],
    [{ body: '{' }, 400], [{ body: 'x'.repeat(8193) }, 413]]) {
    const result = await http(handler, override); assert.equal(result.statusCode, status); assert.equal(result.headers['Cache-Control'], 'no-store');
  }
});

test('shape and injected browser authority reject without Auth or RPC', async () => {
  const h = fixture();
  const bodies = [null, [], {}, { op: 'unknown', connectionId: connection }, { op: 'open', connectionId: 'not-a-uuid' },
    Object.assign(Object.create({}), { op: 'open', connectionId: connection }),
    ...['accountId', 'userId', 'authSessionId', 'position', 'nowMs', 'elapsedMs', 'observedAt', 'spawnId', 'eligible',
      'target', 'geometryRevision', 'coin', 'reward', 'questId'].map(key => ({ op: 'open', connectionId: connection, [key]: 'forged' })),
    { op: 'open', ...scope }, { op: 'status', ...scope }];
  for (const body of bodies) await reject(h.service(bearer, body), 'CONVENIENCE_INVALID_REQUEST', 400);
  assert.equal(h.verified.length, 0); assert.equal(h.calls.length, 0);
});

test('Auth rejection, malformed principals and Auth outage never reach RPC', async () => {
  for (const result of [null, {}, { ...principal, accountId: 'fake' }, { ...principal, authSessionId: 'fake' }]) {
    const h = fixture({ service: { verifyUser: async () => result } });
    await reject(h.open(), 'CONVENIENCE_AUTH_REQUIRED', 401); assert.equal(h.calls.length, 0);
  }
  const handler = createConfiguredConvenienceAuthorityHandler(env, async () => { throw Error('secret upstream message'); });
  const result = await http(handler); assert.equal(result.statusCode, 503); assert.equal(result.body, '{"error":"CONVENIENCE_AUTH_UNAVAILABLE"}');
});

test('JWT claims are usable only after successful matching non-anonymous getUser', async () => {
  for (const [status, user] of [[401, null], [403, null], [200, { id: account, is_anonymous: true }],
    [200, { id: authSession, is_anonymous: false }], [200, { id: 'forged', is_anonymous: false }]]) {
    let called = 0; const token = jwt(claims());
    const verify = createConvenienceVerifier({ url: env.WORLD_INCOME_CANDIDATE_SUPABASE_URL, anonKey: 'synthetic-anon',
      fetcher: async (url, init) => { called++; assert.equal(url, `${env.WORLD_INCOME_CANDIDATE_SUPABASE_URL}/auth/v1/user`);
        assert.equal(init.headers.Authorization, token); assert.equal(init.redirect, 'error');
        return { ok: status === 200, status, json: async () => user }; } });
    assert.equal(await verify(token), null); assert.equal(called, 1);
  }
  const verify = createConvenienceVerifier({ url: env.WORLD_INCOME_CANDIDATE_SUPABASE_URL, anonKey: 'synthetic-anon',
    fetcher: async () => ({ ok: true, status: 200, json: async () => ({ id: account, is_anonymous: false }) }) });
  assert.deepEqual(await verify(jwt(claims())), principal);
  for (const invalid of [{ ...claims(), sub: authSession }, { ...claims(), session_id: 'forged' }, { ...claims(), exp: 0 },
    { ...claims(), exp: '9999999999' }, { ...claims(), exp: 12.5 }]) assert.equal(await verify(jwt(invalid)), null);
  assert.equal(await verify(bearer), null);
});

test('malformed bearer does not call Auth and Auth 5xx does not fall back to decoded JWT', async () => {
  const verify = createConvenienceVerifier({ fetcher: () => assert.fail('malformed bearer must not fetch') });
  for (const value of [null, '', 'Basic anything', 'Bearer short', 'bearer synthetic.long.enough.token']) assert.equal(await verify(value), null);
  const outage = createConvenienceVerifier({ url: 'http://localhost:54321', anonKey: 'synthetic',
    fetcher: async () => ({ ok: false, status: 503, json: async () => ({ id: account, is_anonymous: false }) }) });
  await assert.rejects(outage(jwt(claims())), /AUTH_UNAVAILABLE/);
});

test('configured HTTP uses the verified actor and signed session for income, never browser identity', async () => {
  const token = jwt(claims()), calls = [];
  const handler = createConfiguredConvenienceAuthorityHandler(env, async (url, init) => {
    calls.push({ url, init }); return { ok: true, status: 200,
      json: async () => url.endsWith('/auth/v1/user') ? { id: account, is_anonymous: false } : { enabled: false } };
  });
  const result = await http(handler, { headers: { host: 'localhost:8080', origin: 'http://localhost:8080',
    'content-type': 'application/json', authorization: token } });
  assert.equal(result.statusCode, 200); assert.equal(calls.length, 2);
  assert.equal(calls[1].url, `${env.WORLD_INCOME_CANDIDATE_SUPABASE_URL}/rest/v1/rpc/world_convenience_income_v2`);
  assert.deepEqual(JSON.parse(calls[1].init.body), { p_user: account, p_auth: authSession, p_connection: connection,
    p_authority_session: null, p_fence: null, p_op: 'STATUS', p_request: null, p_session: null, p_action: null, p_value: null, p_revision: null });
  assert.equal(calls[1].init.headers.Authorization, 'Bearer synthetic-service'); assert.equal(calls[1].init.redirect, 'error');
});

test('RPC permits only loopback and the two closed candidate functions', async () => {
  for (const url of ['https://example.supabase.co', 'http://localhost.evil:54321', 'http://localhost:54321/path', 'http://127.0.0.1:54321@evil.test']) {
    await reject(createConvenienceRpc({ url, serviceKey: 'synthetic', fetcher: () => assert.fail() })('world_convenience_authority_v1', {}), 'CONVENIENCE_CLOSED', 503);
  }
  await reject(createConvenienceRpc({ url: 'http://localhost:54321', serviceKey: 'synthetic', fetcher: () => assert.fail() })('arbitrary_function', {}), 'CONVENIENCE_CLOSED', 503);
  for (const failure of [async () => { throw Error('secret URL'); }, async () => ({ ok: false, json: async () => ({ message: 'secret detail' }) })]) {
    await reject(createConvenienceRpc({ url: 'http://localhost:54321', serviceKey: 'synthetic', fetcher: failure })('world_convenience_authority_v1', {}), 'CONVENIENCE_UNAVAILABLE');
  }
});

test('synthetic OPEN then READ/COMMIT derives spawn, actor, DB time, revision and fence server-side', async () => {
  const h = fixture({ row: { spawnId: 'BACK_GATE' } });
  const opened = await h.open(); assert.equal(opened.closedCandidate, true); assert.deepEqual(opened.target, CONVENIENCE_TARGET);
  assert.equal(opened.state.position.x, 10); assert.equal(opened.state.observedAt, epoch);
  assert.deepEqual(h.calls.map(c => c.args.p_op), ['OPEN', 'COMMIT']);
  assert.equal(h.calls[0].args.p_geometry, digest); assert.equal(h.calls[1].args.p_revision, 0);
  h.now = epoch + 100; await h.move(packet(1));
  h.now = epoch + 200; const moved = await h.move(packet(2, 0, 0));
  assert.ok(Math.abs(moved.state.position.x - 10.3) < 1e-9); assert.equal(moved.state.observedAt, epoch + 200);
  assert.deepEqual(h.calls.map(c => c.args.p_op), ['OPEN', 'COMMIT', 'READ', 'COMMIT', 'READ', 'COMMIT']);
  for (const { args } of h.calls) { assert.equal(args.p_user, account); assert.equal(args.p_auth, authSession); assert.equal(args.p_connection, connection); }
  const last = h.calls.at(-1).args; assert.equal(last.p_session, authoritySession); assert.equal(last.p_fence, 7);
  assert.equal(last.p_revision, 2); assert.equal(last.p_state.revision, 3); assert.equal(last.p_state.observedAt, epoch + 200);
  assert.equal(last.p_eligible, false); assert.equal(h.verified.length, 3);
});

test('lost OPEN recovers existing durable state without teleport, COMMIT or freshness change', async () => {
  const h = fixture(); await h.open(); h.now = epoch + 50; await h.move(packet(1));
  h.now = epoch + 150; await h.move(packet(2)); const before = h.row.state, count = h.calls.length;
  h.now = epoch + 100000; const recovered = await h.open();
  assert.deepEqual(recovered.state, before); assert.deepEqual(h.calls.slice(count).map(c => c.args.p_op), ['OPEN']);
});

test('exact duplicate is read-only even after a long gap; altered replay is rejected', async () => {
  const h = fixture(); await h.open(); await h.move(packet(1)); const before = h.row, count = h.calls.length;
  h.now = epoch + 100000; const duplicate = await h.move(packet(1));
  assert.deepEqual(duplicate.state, before.state); assert.deepEqual(h.calls.slice(count).map(c => c.args.p_op), ['READ']);
  await reject(h.move(packet(1, 0, 1)), 'SEQUENCE_CONFLICT', 400); assert.deepEqual(h.row, before);
});

test('pose, browser time and actor injection inside movement cannot reach COMMIT', async () => {
  const h = fixture(); await h.open(); const count = h.calls.length;
  for (const key of ['position', 'x', 'nowMs', 'elapsedMs', 'observedAt', 'userId', 'accountId', 'spawnId', 'eligible']) {
    await reject(h.move({ ...packet(1), [key]: 'forged' }), 'INPUT_SCHEMA', 400);
  }
  for (const command of [null, {}, [], packet(0), packet(2), packet(1, 1.01), packet(1, NaN)]) await assert.rejects(h.move(command));
  assert.ok(h.calls.slice(count).every(c => c.args.p_op === 'READ')); assert.equal(h.row.state.sequence, 0);
});

test('CAS and stale-computation failures surface exactly once, with no blind replay or OPEN', async () => {
  for (const code of ['CONVENIENCE_CAS_CONFLICT', 'CONVENIENCE_STALE_COMPUTATION', 'CONVENIENCE_SESSION_CHANGED']) {
    let rejectCommits = false;
    const h = fixture({ hook: async (name, args) => { if (rejectCommits && args.p_op === 'COMMIT') throw new IncomeError(code, 409); } });
    await h.open(); const before = h.row, count = h.calls.length; rejectCommits = true;
    await reject(h.move(packet(1)), code, 409);
    assert.deepEqual(h.calls.slice(count).map(c => c.args.p_op), ['READ', 'COMMIT']); assert.deepEqual(h.row, before);
  }
});

test('changed target or geometry version cannot initialize or commit', async () => {
  for (const row of [{ targetVersion: 'old-target' }, { geometryRevision: 'b'.repeat(64) }]) {
    const h = fixture({ row }); await reject(h.open(), 'CONVENIENCE_VERSION_CHANGED', 409);
    assert.deepEqual(h.calls.map(c => c.args.p_op), ['OPEN']);
  }
});

test('income operations carry exact authority scope and server-defined step action, no reward assertions', async () => {
  const h = fixture();
  await h.service(bearer, { op: 'start', ...scope, requestId });
  for (let revision = 0; revision < 3; revision++) await h.service(bearer, { op: 'step', ...scope, requestId,
    sessionId: jobSession, revision, stepId: `${jobSession}:${revision}`, choiceId: 'choice.a' });
  await h.service(bearer, { op: 'complete', ...scope, requestId, sessionId: jobSession });
  assert.deepEqual(h.calls.map(c => c.args.p_op), ['START', 'ACTION', 'ACTION', 'ACTION', 'FINISH']);
  assert.deepEqual(h.calls.slice(1, 4).map(c => c.args.p_action), ['stock', 'checkout', 'tidy']);
  for (const call of h.calls) { assert.equal(call.name, 'world_convenience_income_v2'); assert.equal(call.args.p_authority_session, authoritySession);
    assert.equal(call.args.p_fence, 7); assert.equal(call.args.p_user, account); assert.equal(call.args.p_auth, authSession); }
});

test('malformed authority scopes and steps fail without income RPC', async () => {
  const h = fixture();
  for (const change of [{ authoritySessionId: 'forged' }, { fence: 0 }, { fence: 1.5 }, { fence: Number.MAX_SAFE_INTEGER + 1 },
    { requestId: 'forged' }, { sessionId: 'forged' }, { revision: 3 }, { revision: -1 }, { stepId: 'other-step' },
    { choiceId: '../admin' }, { choiceId: '' }, { choiceId: 'x'.repeat(81) }]) {
    await reject(h.service(bearer, { op: 'step', ...scope, requestId, sessionId: jobSession,
      revision: 0, stepId: `${jobSession}:0`, choiceId: 'a', ...change }), 'CONVENIENCE_INVALID_REQUEST', 400);
  }
  assert.equal(h.calls.length, 0);
});

test('revoke is actor/session/fence scoped and its returned inactive row is not a movement commit', async () => {
  const h = fixture(); await h.open(); const count = h.calls.length;
  const result = await h.service(bearer, { op: 'revoke', ...scope }); assert.equal(result.active, false);
  assert.deepEqual(h.calls.slice(count).map(c => c.args), [{ p_user: account, p_auth: authSession, p_connection: connection,
    p_op: 'REVOKE', p_session: authoritySession, p_fence: 7 }]);
});

test('a second synthetic worker rehydrates the durable row rather than resetting movement', async () => {
  const h = fixture(); await h.open(); h.now = epoch + 50; await h.move(packet(1));
  const second = createConvenienceAuthorityService({ enabled: true, rpc: h.rpc, verifyUser: async () => principal, geometry: geometry() });
  h.now = epoch + 150; const result = await second(bearer, { op: 'move', ...scope, command: packet(2, 0, 0) });
  assert.ok(Math.abs(result.state.position.x - .3) < 1e-9); assert.equal(result.state.sequence, 2);
  assert.equal(result.state.observedAt, epoch + 150); assert.equal(h.calls.filter(c => c.args.p_op === 'OPEN').length, 1);
});

test('two synthetic workers racing the same row yield one CAS conflict without automatic replay', async () => {
  const h = fixture(); await h.open();
  const second = createConvenienceAuthorityService({ enabled: true, rpc: h.rpc, verifyUser: async () => principal, geometry: geometry() });
  const count = h.calls.length;
  const results = await Promise.allSettled([h.move(packet(1)), second(bearer, { op: 'move', ...scope, command: packet(1) })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, 'CONVENIENCE_CAS_CONFLICT');
  const calls = h.calls.slice(count); assert.equal(calls.filter(c => c.args.p_op === 'READ').length, 2);
  assert.equal(calls.filter(c => c.args.p_op === 'COMMIT').length, 2); assert.equal(calls.length, 4);
  assert.equal(h.row.state.sequence, 1); assert.equal(h.row.state.revision, 2);
});

test('optional receipt sessionId must be a UUID before any RPC',async()=>{
 const h=fixture();for(const sessionId of ['bad',{},[],17])await reject(h.service(bearer,{op:'status',connectionId:connection,sessionId}),'CONVENIENCE_INVALID_REQUEST',400);
 assert.equal(h.calls.length,0);
});
