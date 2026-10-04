import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIVITY_ATTEMPT_MODE, ACTIVITY_ATTEMPT_STATE, ACTIVITY_AUTHORITY_TIER,
  ACTIVITY_DEFINITION_STATUS, ACTIVITY_REGISTRY, ACTIVITY_REPEAT_POLICY,
  DEFAULT_ACTIVITY_DEFINITIONS, assertActivityStateTransition, createActivityDefinition,
  createActivityRegistry, createActivitySemanticEvent, isTerminalActivityState,
  validateActivityStartRequest
} from '../src/activity/activity-contract.js';

const KEY = '11111111-1111-4111-8111-111111111111';
const ATTEMPT = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

test('P0 Activity registry contains the three P1-A identities; only Fishing is live', () => {
  assert.equal(ACTIVITY_REGISTRY.size, 3);
  assert.deepEqual(ACTIVITY_REGISTRY.list().map(x => x.activityId), [
    'activity.fishing.inkyung',
    'activity.gathering.campus',
    'activity.archaeology.campus_history'
  ]);
  for (const definition of ACTIVITY_REGISTRY.list()) {
    assert.equal(definition.authorityTier, ACTIVITY_AUTHORITY_TIER.SERVER_VALIDATED);
    assert.equal(definition.repeatPolicy, ACTIVITY_REPEAT_POLICY.REPEATABLE);
    assert.equal(definition.status, definition.activityId === 'activity.fishing.inkyung'
      ? ACTIVITY_DEFINITION_STATUS.ACTIVE : ACTIVITY_DEFINITION_STATUS.COMING_SOON);
    assert.equal(definition.definitionVersion, 1);
    assert.equal(definition.outcomeSchemaVersion, 1);
    assert.ok(Object.isFrozen(definition));
  }
  assert.equal(ACTIVITY_REGISTRY.get('activity.gathering.campus').attemptMode, ACTIVITY_ATTEMPT_MODE.INSTANT);
  assert.equal(ACTIVITY_REGISTRY.get('activity.fishing.inkyung').attemptMode, ACTIVITY_ATTEMPT_MODE.INTERACTIVE);
});

test('registry rejects duplicate, malformed and tier/mode-invalid definitions', () => {
  const fishing = DEFAULT_ACTIVITY_DEFINITIONS.FISHING_INKYUNG;
  assert.throws(() => createActivityRegistry({ definitions: [fishing, fishing] }), /Duplicate activityId/);
  assert.throws(() => createActivityDefinition({ ...fishing, activityId: 'fishing.inkyung' }), /Invalid activityId/);
  assert.throws(() => createActivityDefinition({
    ...fishing, activityId: 'activity.bad.session', attemptMode: ACTIVITY_ATTEMPT_MODE.SESSION
  }), /SESSION requires T2/);
  assert.throws(() => createActivityDefinition({
    ...fishing, activityId: 'activity.bad.t2',
    authorityTier: ACTIVITY_AUTHORITY_TIER.AUTHORITATIVE_SESSION
  }), /T2 authority requires SESSION/);
  assert.throws(() => createActivityDefinition({
    ...fishing, activityId: 'activity.bad.refs', eligibilityRef: null
  }), /requires eligibilityRef and resolverRef/);
  assert.throws(() => createActivityDefinition({
    ...fishing, activityId: 'activity.bad.events', semanticEventTypes: ['activity.succeeded', 'activity.succeeded']
  }), /Duplicate semanticEventTypes/);
});

test('start request accepts only semantic identity + UUID key + bounded evidence', () => {
  const valid = validateActivityStartRequest({
    activityId: 'activity.fishing.inkyung',
    sourceRef: 'fishing.inkyung.north_01',
    clientAttemptKey: KEY,
    evidence: { timingBucket: 'GOOD' }
  });
  assert.deepEqual(valid, {
    activityId: 'activity.fishing.inkyung',
    sourceRef: 'fishing.inkyung.north_01',
    clientAttemptKey: KEY,
    evidence: { timingBucket: 'GOOD' }
  });
  assert.ok(Object.isFrozen(valid));

  for (const field of ['rewardId', 'rewardAmount', 'outputItemId', 'outputQuantity', 'rarity', 'lifeXp',
    'collectionCompletion', 'questCompletion', 'serverTime', 'price']) {
    assert.throws(() => validateActivityStartRequest({
      activityId: 'activity.fishing.inkyung',
      sourceRef: 'fishing.inkyung.north_01',
      clientAttemptKey: KEY,
      [field]: field === 'price' ? 100 : true
    }), /authority field is forbidden/);
  }
  assert.throws(() => validateActivityStartRequest({
    activityId: 'activity.fishing.inkyung',
    sourceRef: '37.451,126.654',
    clientAttemptKey: KEY
  }), /Invalid sourceRef/);
  assert.throws(() => validateActivityStartRequest({
    activityId: 'activity.fishing.inkyung',
    sourceRef: 'fishing.inkyung.north_01',
    clientAttemptKey: 'random-client-key'
  }), /Invalid clientAttemptKey/);
  assert.throws(() => validateActivityStartRequest({
    activityId: 'activity.fishing.inkyung',
    sourceRef: 'fishing.inkyung.north_01',
    clientAttemptKey: KEY,
    output: 'forged'
  }), /Unrecognized activity start field/);
});

test('attempt state machine allows CREATED -> ACTIVE -> exactly one terminal transition', () => {
  assert.equal(assertActivityStateTransition(ACTIVITY_ATTEMPT_STATE.CREATED, ACTIVITY_ATTEMPT_STATE.ACTIVE), true);
  for (const terminal of [
    ACTIVITY_ATTEMPT_STATE.SUCCEEDED,
    ACTIVITY_ATTEMPT_STATE.FAILED,
    ACTIVITY_ATTEMPT_STATE.CANCELLED,
    ACTIVITY_ATTEMPT_STATE.EXPIRED
  ]) {
    assert.equal(assertActivityStateTransition(ACTIVITY_ATTEMPT_STATE.ACTIVE, terminal), true);
    assert.equal(isTerminalActivityState(terminal), true);
    assert.throws(() => assertActivityStateTransition(terminal, ACTIVITY_ATTEMPT_STATE.ACTIVE), /Invalid activity transition/);
  }
  assert.throws(() => assertActivityStateTransition(ACTIVITY_ATTEMPT_STATE.CREATED, ACTIVITY_ATTEMPT_STATE.SUCCEEDED),
    /Invalid activity transition/);
  assert.throws(() => assertActivityStateTransition(ACTIVITY_ATTEMPT_STATE.ACTIVE, ACTIVITY_ATTEMPT_STATE.ACTIVE),
    /Invalid activity transition/);
});

test('semantic event envelope carries verified identity only, not settlement state', () => {
  const event = createActivitySemanticEvent({
    type: 'activity.fishing.catch',
    activityId: 'activity.fishing.inkyung',
    attemptId: ATTEMPT,
    sourceRef: 'fishing.inkyung.north_01',
    resultRef: 'fishing_result:abc123',
    occurredAt: '2026-09-30T13:30:00.000Z',
    actorUserId: USER
  });
  assert.deepEqual(event, {
    type: 'activity.fishing.catch',
    activityId: 'activity.fishing.inkyung',
    attemptId: ATTEMPT,
    sourceRef: 'fishing.inkyung.north_01',
    resultRef: 'fishing_result:abc123',
    occurredAt: '2026-09-30T13:30:00.000Z',
    actorUserId: USER
  });
  assert.equal('rewardId' in event, false);
  assert.equal('questCompletion' in event, false);
  assert.equal('inventory' in event, false);
});
