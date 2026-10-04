import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DUCK_OBSERVATION_FUNCTION,
  createDuckObservationClient
} from '../src/creature/duck-observation-client.js';

function fakeClient() {
  const calls = [];
  let companion = { state: 'UNSEEN', observationCount: 0, requiredObservationCount: 3 };
  return {
    calls,
    setCompanion(next) { companion = next; },
    rpc: async (name) => {
      calls.push({ kind: 'rpc', name });
      return { data: companion, error: null };
    },
    functions: {
      invoke: async (name, options) => {
        calls.push({ kind: 'function', name, options });
        return {
          data: {
            status: 'SUCCESS',
            duckId: options.body.duckId,
            companion
          },
          error: null
        };
      }
    }
  };
}

test('Duck observation client invokes only the named Edge Function with duckId', async () => {
  const client = fakeClient();
  client.setCompanion({ state: 'SIGHTED', observationCount: 1, requiredObservationCount: 3 });
  const adapter = createDuckObservationClient({ getClient: () => client });
  const result = await adapter.observe('inkyung_duck_white_01');

  assert.equal(result.companion.state, 'SIGHTED');
  assert.deepEqual(client.calls[0], {
    kind: 'function',
    name: DUCK_OBSERVATION_FUNCTION,
    options: { body: { duckId: 'inkyung_duck_white_01' } }
  });
});

test('refresh uses self-scoped Duck Companion RPC and caches state', async () => {
  const client = fakeClient();
  client.setCompanion({ state: 'OBSERVED', observationCount: 2, requiredObservationCount: 3 });
  const adapter = createDuckObservationClient({ getClient: () => client });
  const snapshot = await adapter.refresh();
  assert.equal(snapshot.state, 'OBSERVED');
  assert.equal(adapter.status().snapshot.observationCount, 2);
});

test('BOND_ELIGIBLE and OWNED snapshots stop ordinary companion observation prompts', async () => {
  const client = fakeClient();
  const adapter = createDuckObservationClient({ getClient: () => client });
  assert.equal(adapter.canObserve(), true);

  client.setCompanion({ state: 'BOND_ELIGIBLE', observationCount: 3, requiredObservationCount: 3 });
  await adapter.refresh();
  assert.equal(adapter.canObserve(), false);

  adapter.reset();
  client.setCompanion({ state: 'OWNED', observationCount: 3, requiredObservationCount: 3 });
  await adapter.refresh();
  assert.equal(adapter.canObserve(), false);
});

test('duplicate in-flight duck observation is suppressed', async () => {
  let resolveInvoke;
  const client = {
    rpc: async () => ({ data: null, error: null }),
    functions: {
      invoke: () => new Promise(resolve => { resolveInvoke = resolve; })
    }
  };
  const adapter = createDuckObservationClient({ getClient: () => client });
  const first = adapter.observe('inkyung_duck_white_01');
  const second = await adapter.observe('inkyung_duck_white_01');
  assert.equal(second.status, 'PENDING');
  resolveInvoke({ data: { companion: { state: 'SIGHTED', observationCount: 1 } }, error: null });
  await first;
});


test('BOND_ELIGIBLE may bond once through the self-scoped RPC and caches OWNED', async () => {
  const client = fakeClient();
  client.setCompanion({ state: 'BOND_ELIGIBLE', observationCount: 3, requiredObservationCount: 3 });
  const originalRpc = client.rpc;
  client.rpc = async (name, args) => {
    if (name === 'bond_my_duck_companion_v1') {
      client.calls.push({ kind: 'rpc', name, args });
      return {
        data: {
          status: 'SUCCESS',
          autoActivated: true,
          companion: { state: 'OWNED', observationCount: 3, requiredObservationCount: 3 }
        },
        error: null
      };
    }
    return originalRpc(name, args);
  };

  const adapter = createDuckObservationClient({
    getClient: () => client,
    claimKeyFactory: () => 'test-claim-001'
  });
  await adapter.refresh();
  assert.equal(adapter.canBond(), true);

  const result = await adapter.bond();
  assert.equal(result.status, 'SUCCESS');
  assert.equal(result.autoActivated, true);
  assert.equal(adapter.status().snapshot.state, 'OWNED');
  assert.equal(adapter.canBond(), false);

  const call = client.calls.find(entry => entry.name === 'bond_my_duck_companion_v1');
  assert.deepEqual(call.args, { p_claim_key: 'duck-bond:test-claim-001' });
});

test('bond is rejected locally unless BOND_ELIGIBLE and duplicate in-flight bond is suppressed', async () => {
  let resolveBond;
  const client = fakeClient();
  client.setCompanion({ state: 'OBSERVED', observationCount: 2, requiredObservationCount: 3 });
  const adapter = createDuckObservationClient({
    getClient: () => client,
    claimKeyFactory: () => 'claim-002'
  });
  await adapter.refresh();
  assert.equal((await adapter.bond()).status, 'NOT_ELIGIBLE');

  client.setCompanion({ state: 'BOND_ELIGIBLE', observationCount: 3, requiredObservationCount: 3 });
  await adapter.refresh();
  client.rpc = (name, args) => {
    client.calls.push({ kind: 'rpc', name, args });
    if (name !== 'bond_my_duck_companion_v1') return Promise.resolve({ data: null, error: null });
    return new Promise(resolve => { resolveBond = resolve; });
  };

  const first = adapter.bond();
  const second = await adapter.bond();
  assert.equal(second.status, 'PENDING');
  resolveBond({
    data: { status: 'SUCCESS', companion: { state: 'OWNED', observationCount: 3 } },
    error: null
  });
  await first;
});
