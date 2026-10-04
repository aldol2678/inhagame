import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_BUILDING5_FUNCTION,
  combatAuthorityLabel,
  createBuilding5CombatAuthorityClient
} from '../src/combat/combat-authority-client.js';

function keys() {
  let n = 1;
  return () => `00000000-0000-4000-8000-${String(n++).padStart(12,'0')}`;
}

function encounter(overrides = {}) {
  return {
    encounterId: '11111111-1111-4111-8111-111111111111',
    combatId: 'combat.building5.training_drone',
    status: 'ACTIVE',
    resultRef: null,
    stateVersion: 1,
    state: {
      elapsedMs: 0,
      player: { hp: 1000, maxHp: 1000, momentum: 0, ultimateGauge: 0 },
      enemy: { hp: 4200, maxHp: 4200, breakValue: 0, breakMax: 100 },
      cooldownUntil: { basic: 0, active_1: 0, active_2: 0, active_3: 0, dodge: 0 },
      enemyAttack: { nextWindupMs: 1200, windupMs: 680 }
    },
    settlement: null,
    ...overrides
  };
}

test('authority client sends identifiers only and never client HP/damage/BREAK/result/reward assertions', async () => {
  const calls = [];
  const client = {
    functions: {
      async invoke(name, { body }) {
        calls.push({ name, body });
        if (body.op === 'start') return { data: { encounter: encounter() }, error: null };
        if (body.op === 'action') {
          return { data: { accepted: true, encounter: encounter({
            stateVersion: 2,
            state: { ...encounter().state, enemy: { ...encounter().state.enemy, hp: 4112, breakValue: 4 } }
          }) }, error: null };
        }
        return { data: { encounter: encounter() }, error: null };
      }
    }
  };
  const authority = createBuilding5CombatAuthorityClient({
    getClient: () => client,
    createKey: keys(),
    setIntervalFn: () => 1,
    clearIntervalFn: () => {}
  });

  await authority.start();
  await authority.action('basic');

  assert.equal(calls[0].name, COMBAT_BUILDING5_FUNCTION);
  assert.deepEqual(Object.keys(calls[0].body).sort(), ['clientEncounterKey','op']);
  assert.deepEqual(Object.keys(calls[1].body).sort(), ['action','actionKey','encounterId','op']);
  assert.equal(calls[1].body.action, 'basic');

  const serialized = JSON.stringify(calls);
  for (const forbidden of ['damage','breakValue','playerHp','enemyHp','resultRef','rewardId','loot','playerExp']) {
    assert.equal(serialized.includes(`"${forbidden}"`), false, `client does not submit ${forbidden}`);
  }
  assert.equal(authority.snapshot().encounter.state.enemy.hp, 4112);
});

test('an action issued before start completes is serialized behind one idempotent start', async () => {
  const calls = [];
  let releaseStart;
  const startGate = new Promise(resolve => { releaseStart = resolve; });
  const client = {
    functions: {
      async invoke(_name, { body }) {
        calls.push(body);
        if (body.op === 'start') {
          await startGate;
          return { data: { encounter: encounter() }, error: null };
        }
        return { data: { encounter: encounter({ stateVersion: 2 }) }, error: null };
      }
    }
  };
  const authority = createBuilding5CombatAuthorityClient({
    getClient: () => client,
    createKey: keys(),
    setIntervalFn: () => 1,
    clearIntervalFn: () => {}
  });

  const actionPromise = authority.action('dodge');
  await Promise.resolve();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].op, 'start');
  releaseStart();
  await actionPromise;
  assert.deepEqual(calls.map(call => call.op), ['start','action']);
  assert.equal(calls[1].action, 'dodge');
});

test('authority sync timer uses semantic SYNC actions and terminal settlement stops syncing', async () => {
  const calls = [], timers = [];
  const client = {
    functions: {
      async invoke(_name, { body }) {
        calls.push(body);
        if (body.op === 'start') return { data: { encounter: encounter() }, error: null };
        if (body.op === 'action' && body.action === 'sync') {
          return { data: { accepted: true, encounter: encounter({
            status: 'SUCCEEDED',
            resultRef: 'combat-result:11111111-1111-4111-8111-111111111111',
            settlement: {
              rewardStatus: 'SUCCESS',
              rewardId: 'reward.combat.building5_training_first_clear',
              reward: { status: 'SUCCESS' }
            }
          }) }, error: null };
        }
        return { data: { encounter: encounter() }, error: null };
      }
    }
  };
  const authority = createBuilding5CombatAuthorityClient({
    getClient: () => client,
    createKey: keys(),
    syncIntervalMs: 1000,
    setIntervalFn: fn => { timers.push(fn); return timers.length; },
    clearIntervalFn: () => {}
  });

  await authority.start();
  assert.equal(timers.length, 1);
  timers[0]();
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(calls.at(-1).action, 'sync');
  assert.equal(authority.snapshot().phase, 'SUCCEEDED');
  assert.equal(combatAuthorityLabel(authority.snapshot()), 'CLEAR · +50 EXP');
});

test('repeat clear label is explicit and cancel uses no client-authored outcome', async () => {
  const calls = [];
  const client = {
    functions: {
      async invoke(_name, { body }) {
        calls.push(body);
        if (body.op === 'start') return { data: { encounter: encounter() }, error: null };
        if (body.op === 'cancel') return { data: { encounter: encounter({ status: 'CANCELLED' }) }, error: null };
        return { data: { encounter: encounter() }, error: null };
      }
    }
  };
  const authority = createBuilding5CombatAuthorityClient({
    getClient: () => client,
    createKey: keys(),
    setIntervalFn: () => 1,
    clearIntervalFn: () => {}
  });
  await authority.start();
  await authority.cancel();
  assert.deepEqual(Object.keys(calls.at(-1)).sort(), ['actionKey','encounterId','op']);
  assert.equal(authority.snapshot().phase, 'CANCELLED');

  assert.equal(combatAuthorityLabel({
    phase: 'SUCCEEDED', pending: 0,
    settlement: { rewardStatus: 'INELIGIBLE_REPEAT' }
  }), 'CLEAR · 반복훈련');
});

test('no signed-in Supabase client keeps local training available without pretending server authority', async () => {
  const authority = createBuilding5CombatAuthorityClient({
    getClient: () => null,
    createKey: keys(),
    setIntervalFn: () => 1,
    clearIntervalFn: () => {}
  });
  const state = await authority.start();
  assert.equal(state.phase, 'LOCAL_ONLY');
  assert.equal(state.lastError, 'NO_AUTHORITY_CLIENT');
  assert.equal(combatAuthorityLabel(state), 'LOCAL');
});
