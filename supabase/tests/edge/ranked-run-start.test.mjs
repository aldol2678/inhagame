// Offline contract for supabase/functions/ranked-run-start: the caller is identified only by
// the Auth token, sessions are written with the service role, and profile, ban, rate-limit
// and ruleset rules hold.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bearer, fakeSupabase, invoke, loadEdgeFunction } from './harness.mjs';

const handler = await loadEdgeFunction('ranked-run-start');
const USER = { id: '33333333-3333-4333-8333-333333333333', email: 'player@example.test' };
const OTHER = '44444444-4444-4444-8444-444444444444';

function setup({ profile = { user_id: USER.id, is_banned: false } } = {}) {
  const backend = fakeSupabase();
  backend.addUser('player-token', USER);
  if (profile) backend.rows('profiles').push(profile);
  backend.onRpc('expire_ranked_sessions_v1', () => ({ data: 0 }));
  return backend;
}
const start = (body = {}, headers = bearer('player-token')) => invoke(handler, { headers, body });

test('starts a ranked session for the token owner with the service role', async () => {
  const backend = setup();
  const res = await start({ clientVersion: 'classic-1.2.3', userId: OTHER, user_id: OTHER });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(Object.keys(res.json).sort(),
    ['expiresAt', 'nonce', 'rulesetVersion', 'runId', 'runType', 'startedAt']);
  assert.equal(res.json.runType, 'ranked');
  assert.equal(res.json.rulesetVersion, 'secret-2.1-r1');
  const [insert] = backend.writes('ranked_sessions');
  assert.equal(insert.role, 'service_role');
  assert.equal(insert.payload.user_id, USER.id, 'user id comes from the token, never the body');
  assert.equal(insert.payload.client_version, 'classic-1.2.3');
});

test('ruleset and run type accept only known values', async () => {
  setup();
  assert.equal((await start({ rulesetVersion: 'secret-2.2-r1' })).json.rulesetVersion, 'secret-2.2-r1');
  assert.equal((await start({ rulesetVersion: 'secret-9.9' })).json.rulesetVersion, 'secret-2.1-r1');
  assert.equal((await start({ runType: 'qa' })).json.runType, 'qa');
  assert.equal((await start({ runType: 'admin' })).json.runType, 'ranked');
});

test('client version is truncated to 40 characters', async () => {
  const backend = setup();
  await start({ clientVersion: 'v'.repeat(100) });
  assert.equal(backend.writes('ranked_sessions')[0].payload.client_version.length, 40);
});

test('CORS preflight and wrong methods', async () => {
  setup();
  assert.equal((await invoke(handler, { method: 'OPTIONS' })).status, 200);
  assert.equal((await invoke(handler, { method: 'GET' })).status, 405);
});

test('missing or invalid tokens are unauthenticated and write nothing', async () => {
  for (const headers of [{}, bearer('forged-token')]) {
    const backend = setup();
    const res = await start({}, headers);
    assert.equal(res.status, 401);
    assert.equal(res.json.error, 'UNAUTHENTICATED');
    assert.equal(backend.writes('ranked_sessions').length, 0);
  }
});

test('ranked runs need a profile; QA runs do not', async () => {
  let backend = setup({ profile: null });
  const ranked = await start();
  assert.equal(ranked.status, 409);
  assert.equal(ranked.json.error, 'PROFILE_REQUIRED');
  assert.equal(backend.writes('ranked_sessions').length, 0);
  backend = setup({ profile: null });
  assert.equal((await start({ runType: 'qa' })).status, 200);
});

test('banned players are blocked', async () => {
  const backend = setup({ profile: { user_id: USER.id, is_banned: true } });
  const res = await start();
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'RANKING_BLOCKED');
  assert.equal(backend.writes('ranked_sessions').length, 0);
});

test('at most 30 sessions per player in 10 minutes', async () => {
  const backend = setup();
  const now = Date.now();
  for (let i = 0; i < 30; i += 1) {
    backend.rows('ranked_sessions').push({ run_id: `r${i}`, user_id: USER.id, started_at: new Date(now - 60_000).toISOString() });
  }
  backend.rows('ranked_sessions').push({ run_id: 'old', user_id: USER.id, started_at: new Date(now - 11 * 60_000).toISOString() });
  const res = await start();
  assert.equal(res.status, 429);
  assert.equal(res.json.error, 'RATE_LIMITED');

  const other = setup();
  for (let i = 0; i < 29; i += 1) {
    other.rows('ranked_sessions').push({ run_id: `r${i}`, user_id: USER.id, started_at: new Date(now - 60_000).toISOString() });
  }
  for (let i = 0; i < 5; i += 1) {
    other.rows('ranked_sessions').push({ run_id: `o${i}`, user_id: OTHER, started_at: new Date(now - 60_000).toISOString() });
  }
  assert.equal((await start()).status, 200, "other players' sessions do not count");
});

test('lifecycle cleanup failure never blocks a start', async () => {
  const backend = setup();
  backend.onRpc('expire_ranked_sessions_v1', () => ({ error: { message: 'cleanup down' } }));
  const res = await start();
  assert.equal(res.status, 200);
  assert.equal(backend.rpcCalls('expire_ranked_sessions_v1')[0].role, 'service_role');
});

test('a malformed body starts a default ranked session', async () => {
  setup();
  const res = await invoke(handler, { headers: bearer('player-token'), body: '{oops' });
  assert.equal(res.status, 200);
  assert.equal(res.json.runType, 'ranked');
  assert.equal(res.json.rulesetVersion, 'secret-2.1-r1');
});

test('storage errors surface as START_FAILED', async () => {
  const backend = setup();
  backend.failOnce('ranked_sessions', 'insert', { message: 'insert failed' });
  const res = await start();
  assert.equal(res.status, 500);
  assert.equal(res.json.error, 'START_FAILED');
});
