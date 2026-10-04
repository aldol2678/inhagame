import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FISHING_ACTIVITY_ID, FISHING_SOURCES, createFishingAttempt,
  resolveFishingAttempt, expireFishingAttempt, projectFishingAttempt
} from '../src/activity/fishing-core.js';
import { ACTIVITY_REGISTRY } from '../src/activity/activity-contract.js';
import { getItemDefinition } from '../src/collection/item-catalog.js';
import { COLLECTION_ENTRY_REGISTRY } from '../src/collection/collection-discovery-contract.js';
import { LIFE_SKILL_REGISTRY } from '../src/life-skills/life-skill-registry.js';

const ACTOR = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const ID = '22222222-2222-4222-8222-222222222222';
const KEY = '33333333-3333-4333-8333-333333333333';
const NONCE = '44444444-4444-4444-8444-444444444444';
const START = 1791034200000;
// Test tuning only. No default/official Production balance is introduced.
const POLICY = {
  policyVersion: 'fishing.test.v1', minWaitMs: 1000, maxWaitMs: 3000,
  responseWindowMs: 500, attemptTtlMs: 5000, lifeXp: 2
};
const startRequest = sourceRef => ({
  activityId: FISHING_ACTIVITY_ID, sourceRef, clientAttemptKey: KEY
});
const make = (overrides = {}) => createFishingAttempt({
  request: startRequest(FISHING_SOURCES[0]), actorUserId: ACTOR,
  attemptId: ID, nonce: NONCE, startedAtMs: START, policy: POLICY, biteRoll: 0.5,
  ...overrides
});
const command = (overrides = {}) => ({
  attemptId: ID, sourceRef: FISHING_SOURCES[0], nonce: NONCE, action: 'HOOK', ...overrides
});
const resolve = (attempt, nowMs, overrides = {}) => resolveFishingAttempt({
  attempt, request: command(), actorUserId: ACTOR, nowMs, ...overrides
});
const roundtrip = value => JSON.parse(JSON.stringify(value));

test('two allowlisted sources use the existing one-carp identities without activation', () => {
  assert.deepEqual(FISHING_SOURCES, ['fishing.inkyung.north_01', 'fishing.inkyung.south_01']);
  for (const sourceRef of FISHING_SOURCES) {
    const attempt = make({ request: startRequest(sourceRef) });
    const done = resolve(attempt, attempt.biteAtMs, { request: command({ sourceRef }) });
    assert.equal(done.status, 'SUCCEEDED');
    assert.equal(done.result.catch.itemId, 'material.fish_carp');
    assert.equal(done.result.catch.collectionEntryId, 'collection.fish.carp');
    assert.equal(done.result.catch.skillId, 'life.fishing');
    assert.equal(getItemDefinition(done.result.catch.itemId).tradePolicy, 'ACCOUNT_BOUND');
  }
  assert.equal(ACTIVITY_REGISTRY.get(FISHING_ACTIVITY_ID).status, 'COMING_SOON');
  assert.equal(COLLECTION_ENTRY_REGISTRY.get('collection.fish.carp').status, 'COMING_SOON');
  assert.equal(LIFE_SKILL_REGISTRY.get('life.fishing').status, 'COMING_SOON');
});

test('server timing is sampled once at start and the policy snapshot is detached', () => {
  const policy = { ...POLICY };
  const attempt = make({ policy });
  policy.lifeXp = 999;
  assert.equal(attempt.biteAtMs, START + 2000);
  assert.equal(attempt.hookDeadlineMs, START + 2500);
  assert.equal(attempt.expiresAtMs, START + 5000);
  assert.equal(attempt.policy.lifeXp, 2);
  assert.ok(Object.isFrozen(attempt));
  assert.ok(Object.isFrozen(attempt.policy));
  assert.equal(make({ biteRoll: 0 }).biteAtMs, START + 1000);
  assert.equal(make({ biteRoll: 1 - Number.EPSILON }).biteAtMs, START + 3000);
});

test('hook accepts the exact bite boundary and rejects the exclusive deadline', () => {
  const attempt = make();
  for (const nowMs of [attempt.biteAtMs, attempt.hookDeadlineMs - 1]) {
    const done = resolve(attempt, nowMs);
    assert.equal(done.status, 'SUCCEEDED');
    assert.deepEqual(done.result.catch, {
      speciesId: 'carp', itemId: 'material.fish_carp', quantity: 1,
      collectionEntryId: 'collection.fish.carp', skillId: 'life.fishing', lifeXp: 2
    });
    assert.equal(done.result.resultRef, `fishing_result:${ID}`);
    assert.equal(done.result.actorUserId, ACTOR);
    assert.equal(done.result.conditionSnapshot.weather, 'UNKNOWN');
    assert.equal(done.result.conditionSnapshot.sourceRef, attempt.sourceRef);
    assert.ok(Object.isFrozen(done.result.catch));
    assert.equal('settled' in done.result, false);
  }
  assert.equal(resolve(attempt, attempt.biteAtMs - 1).result.reason, 'PREMATURE_HOOK');
  assert.equal(resolve(attempt, attempt.hookDeadlineMs).result.reason, 'MISSED_BITE');
});

test('premature input consumes the attempt; retry cannot turn failure into success', () => {
  const attempt = make();
  const failed = resolve(attempt, START + 1);
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.result.catch, null);
  assert.deepEqual(resolve(roundtrip(failed), attempt.biteAtMs), failed);
});

test('cancel and expiry produce no intrinsic grant intent', () => {
  const attempt = make();
  const cancelled = resolve(attempt, START, { request: command({ action: 'CANCEL' }) });
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal(cancelled.result.catch, null);
  const expired = resolve(attempt, attempt.expiresAtMs);
  assert.equal(expired.status, 'EXPIRED');
  assert.equal(expired.result.catch, null);
  assert.equal(expired.result.reason, 'ATTEMPT_EXPIRED');
  assert.equal(resolve(attempt, attempt.expiresAtMs, { request: command({ action: 'CANCEL' }) }).status, 'EXPIRED');
});

test('expiry sweep waits for TTL and preserves any terminal result', () => {
  const attempt = make();
  assert.deepEqual(expireFishingAttempt({ attempt, nowMs: attempt.expiresAtMs - 1 }), attempt);
  const expired = expireFishingAttempt({ attempt, nowMs: attempt.expiresAtMs });
  assert.equal(expired.status, 'EXPIRED');
  assert.deepEqual(resolve(roundtrip(expired), attempt.expiresAtMs + 1), expired);
  const done = resolve(attempt, attempt.biteAtMs);
  assert.deepEqual(expireFishingAttempt({ attempt: roundtrip(done), nowMs: attempt.expiresAtMs + 1 }), done);
});

test('persisted terminal result replays unchanged after timeout; conflicting commands fail', () => {
  const attempt = make();
  const done = resolve(attempt, attempt.biteAtMs);
  const restored = roundtrip(done);
  const replay = resolve(restored, attempt.expiresAtMs + 1000);
  assert.deepEqual(replay, done);
  assert.ok(Object.isFrozen(replay.result));
  assert.ok(Object.isFrozen(replay.result.conditionSnapshot));
  assert.throws(() => resolve(restored, attempt.biteAtMs, {
    request: command({ action: 'CANCEL' })
  }), /Terminal command conflict/);
});

test('actor, source, attempt and nonce are checked even on terminal replay and reads', () => {
  const attempt = make();
  const done = resolve(attempt, attempt.biteAtMs);
  for (const state of [attempt, done]) {
    assert.throws(() => resolve(state, state.biteAtMs, { actorUserId: OTHER }), /Actor mismatch/);
    for (const request of [command({ attemptId: OTHER }), command({ nonce: OTHER }),
      command({ sourceRef: FISHING_SOURCES[1] })]) {
      assert.throws(() => resolve(state, state.biteAtMs, { request }), /identity mismatch/);
    }
    assert.throws(() => projectFishingAttempt({ attempt: state, actorUserId: OTHER }), /Actor mismatch/);
  }
});

test('strict client allowlists reject authority fields, nested evidence and unknown actions', () => {
  for (const field of ['userId', 'speciesId', 'quantity', 'lifeXp', 'success', 'serverTime', 'weather', 'evidence']) {
    assert.throws(() => make({ request: { ...startRequest(FISHING_SOURCES[0]), [field]: {} } }), /Unrecognized/);
    assert.throws(() => resolve(make(), START, { request: command({ [field]: {} }) }), /Unrecognized/);
  }
  assert.throws(() => make({ request: startRequest('fishing.inkyung.unknown') }), /Unknown fishing source/);
  assert.throws(() => make({ request: { ...startRequest(FISHING_SOURCES[0]), activityId: 'activity.gathering.campus' } }), /Invalid fishing activity/);
  assert.throws(() => resolve(make(), START, { request: command({ action: 'SUCCESS' }) }), /Invalid fishing action/);
  assert.throws(() => resolve(make(), START, { request: [] }), /must be an object/);
});

test('invalid policy, randomness, UUIDs and unsafe/backwards times fail closed', () => {
  for (const [field, value] of [
    ['minWaitMs', 0], ['maxWaitMs', 999], ['responseWindowMs', 0],
    ['attemptTtlMs', 3500], ['lifeXp', -1], ['lifeXp', 1.2], ['policyVersion', '']
  ]) {
    assert.throws(() => make({ policy: { ...POLICY, [field]: value } }));
  }
  assert.throws(() => make({ policy: { ...POLICY, inventedBonus: 999 } }), /Unrecognized/);
  assert.throws(() => make({ policy: undefined }), /must be an object/);
  for (const biteRoll of [-0.1, 1, NaN, Infinity, '0.5']) assert.throws(() => make({ biteRoll }));
  for (const field of ['actorUserId', 'attemptId', 'nonce']) assert.throws(() => make({ [field]: 'bad' }));
  for (const startedAtMs of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER]) assert.throws(() => make({ startedAtMs }));
  assert.throws(() => resolve(make(), START - 1), /before attempt start/);
  assert.throws(() => expireFishingAttempt({ attempt: make(), nowMs: Infinity }));
});

test('client projection hides private policy and future catch while preserving recovery identity', () => {
  const attempt = make();
  const view = projectFishingAttempt({ attempt, actorUserId: ACTOR });
  assert.equal(view.nonce, NONCE);
  assert.equal(view.result, null);
  assert.equal('policy' in view, false);
  assert.equal('actorUserId' in view, false);
  const done = resolve(attempt, attempt.biteAtMs);
  assert.deepEqual(projectFishingAttempt({ attempt: done, actorUserId: ACTOR }).result, done.result);
});

test('inconsistent restored result, version and timing snapshots are rejected', () => {
  const attempt = make();
  const done = resolve(attempt, attempt.biteAtMs);
  const mutations = [
    state => { state.resolverVersion = 'resolver.fishing.future'; },
    state => { state.hookDeadlineMs += 1; },
    state => { state.result.actorUserId = OTHER; },
    state => { state.result.policyVersion = 'fishing.test.v2'; },
    state => { state.result.conditionSnapshot.weather = 'CLEAR'; },
    state => { state.result.catch.quantity = 2; },
    state => { state.result.catch.lifeXp = 999; },
    state => { state.result.resolvedAtMs = START; },
    state => { state.result.reason = 'PLAYER_CANCELLED'; }
  ];
  for (const mutate of mutations) {
    const restored = roundtrip(done);
    mutate(restored);
    assert.throws(() => resolve(restored, attempt.biteAtMs));
  }
  const failed = roundtrip(resolve(attempt, START));
  failed.result.catch = done.result.catch;
  assert.throws(() => resolve(failed, attempt.biteAtMs), /cannot carry a catch/);
});

test('resolution leaves the active input and restored terminal input untouched', () => {
  const attempt = roundtrip(make());
  const before = roundtrip(attempt);
  const done = resolve(attempt, attempt.biteAtMs);
  assert.deepEqual(attempt, before);
  assert.equal(Object.isFrozen(attempt), false);
  const restored = roundtrip(done);
  const replay = resolve(restored, attempt.expiresAtMs + 1);
  restored.result.catch.quantity = 99;
  assert.equal(replay.result.catch.quantity, 1);
});
