import test from 'node:test';
import assert from 'node:assert/strict';
import { bearer, fakeSupabase, invoke, loadEdgeFunction } from './harness.mjs';

const handler = await loadEdgeFunction('world-duck-observe');
const USER = { id: '33333333-3333-4333-8333-333333333333', email: 'duck@example.test' };

function setup(user = USER) {
  const backend = fakeSupabase();
  backend.addUser('duck-token', user);
  backend.onRpc('world_inkyung_duck_observe_v1', (args, ctx) => ({
    data: {
      status: 'SUCCESS',
      duckId: args.p_duck_id,
      companion: { state: 'SIGHTED', observationCount: 1, requiredObservationCount: 3 },
      _role: ctx.role
    }
  }));
  return backend;
}

test('authenticated permanent account records observation through service role only', async () => {
  const backend = setup();
  const res = await invoke(handler, {
    headers: bearer('duck-token'),
    body: {
      duckId: 'inkyung_duck_white_01',
      userId: '99999999-9999-4999-8999-999999999999',
      resultRef: 'forged',
      idempotencyKey: 'forged'
    }
  });
  assert.equal(res.status, 200);
  assert.equal(res.json.companion.state, 'SIGHTED');

  const [call] = backend.rpcCalls('world_inkyung_duck_observe_v1');
  assert.equal(call.role, 'service_role');
  assert.equal(call.args.p_user, USER.id);
  assert.equal(call.args.p_duck_id, 'inkyung_duck_white_01');
  assert.equal(call.args.p_result_ref, `duck-observation:${USER.id}:inkyung_duck_white_01`);
  assert.equal(call.args.p_idempotency_key, `duck-observe:${USER.id}:inkyung_duck_white_01`);
});

test('invalid or mechanical duck ids never reach the database RPC', async () => {
  for (const duckId of ['inkyung_duck_mechanical_01', 'not_a_duck', '']) {
    const backend = setup();
    const res = await invoke(handler, {
      headers: bearer('duck-token'),
      body: { duckId }
    });
    assert.equal(res.status, 400);
    assert.equal(res.json.error, 'INVALID_DUCK_ID');
    assert.equal(backend.rpcCalls('world_inkyung_duck_observe_v1').length, 0);
  }
});

test('missing tokens and anonymous accounts cannot mint observations', async () => {
  let backend = setup();
  let res = await invoke(handler, { body: { duckId: 'inkyung_duck_white_01' } });
  assert.equal(res.status, 401);
  assert.equal(backend.rpcCalls('world_inkyung_duck_observe_v1').length, 0);

  backend = setup({ ...USER, is_anonymous: true });
  res = await invoke(handler, {
    headers: bearer('duck-token'),
    body: { duckId: 'inkyung_duck_white_01' }
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'PERMANENT_ACCOUNT_REQUIRED');
  assert.equal(backend.rpcCalls('world_inkyung_duck_observe_v1').length, 0);
});

test('database account and observation gates map to stable HTTP errors', async () => {
  let backend = setup();
  backend.onRpc('world_inkyung_duck_observe_v1', () => ({
    error: { code: '22023', message: 'ACCOUNT_UNAVAILABLE' }
  }));
  let res = await invoke(handler, {
    headers: bearer('duck-token'),
    body: { duckId: 'inkyung_duck_white_01' }
  });
  assert.equal(res.status, 403);
  assert.equal(res.json.error, 'ACCOUNT_UNAVAILABLE');

  backend = setup();
  backend.onRpc('world_inkyung_duck_observe_v1', () => ({
    error: { code: 'P0001', message: 'INKYUNG_DUCK_NOT_OBSERVABLE' }
  }));
  res = await invoke(handler, {
    headers: bearer('duck-token'),
    body: { duckId: 'inkyung_duck_white_01' }
  });
  assert.equal(res.status, 409);
  assert.equal(res.json.error, 'OBSERVATION_REJECTED');
});

test('CORS preflight and wrong methods are deterministic', async () => {
  setup();
  assert.equal((await invoke(handler, { method: 'OPTIONS' })).status, 200);
  assert.equal((await invoke(handler, { method: 'GET' })).status, 405);
});
