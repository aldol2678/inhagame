import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_EVENT_DEFINITIONS, EVENT_ID, EVENT_LIFECYCLE_SOURCE, EVENT_PERSISTENCE_MODE,
  EVENT_PROGRESS_OWNER, EVENT_REGISTRY, EVENT_REPEAT_POLICY, EVENT_REWARD_MODE, createEventRegistry
} from '../src/events/event-registry.js';
import { BR01_EVENT } from '../src/biryong/biryong-state.js';
import { BACK_GATE_ARRIVAL_EVENT_ID } from '../src/back-gate-arrival-event.js';
import { MCM_2026_EVENT_ID as CLIENT_MCM_ID } from '../src/events/zombie-university-2026/event-data.js';
import { MCM_2026_EVENT_ID as SERVER_MCM_ID } from '../npc-factory/mcm-2026-event-contract.mjs';
import { INKYUNG_MECHANICAL_DUCK_EVENT_ID } from '../src/inkyung-mechanical-duck-event.js';
import { QUEST_ID } from '../npc-factory/quest-contract.mjs';

test('EventRegistry P0 contains the canonical identities exactly once', () => {
  assert.equal(EVENT_REGISTRY.size, 4);
  assert.deepEqual(new Set(EVENT_REGISTRY.list().map(event => event.eventId)),
    new Set([EVENT_ID.BIRYONG_BR01, EVENT_ID.BACK_GATE_BG01, EVENT_ID.MCM_2026, EVENT_ID.INKYUNG_MECHANICAL_DUCK]));
  assert.equal(EVENT_REGISTRY.list().filter(event => event.eventId === EVENT_ID.INKYUNG_MECHANICAL_DUCK).length, 1);
  assert.equal(BR01_EVENT.id, EVENT_ID.BIRYONG_BR01);
  assert.equal(BACK_GATE_ARRIVAL_EVENT_ID, EVENT_ID.BACK_GATE_BG01);
  assert.equal(CLIENT_MCM_ID, EVENT_ID.MCM_2026);
  assert.equal(SERVER_MCM_ID, EVENT_ID.MCM_2026);
  assert.equal(INKYUNG_MECHANICAL_DUCK_EVENT_ID, EVENT_ID.INKYUNG_MECHANICAL_DUCK);
});

test('pilot classifications preserve their existing semantic owners', () => {
  const br01 = EVENT_REGISTRY.get(EVENT_ID.BIRYONG_BR01);
  assert.equal(br01.lifecycleSource, EVENT_LIFECYCLE_SOURCE.ALWAYS);
  assert.equal(br01.persistenceMode, EVENT_PERSISTENCE_MODE.SERVER_PERSISTED);
  assert.equal(br01.completionRepeatPolicy, EVENT_REPEAT_POLICY.ONCE_PER_ACCOUNT);
  assert.equal(br01.progressOwner, EVENT_PROGRESS_OWNER.EVENT);
  assert.equal(br01.rewardMode, EVENT_REWARD_MODE.NONE);
  assert.equal(br01.interactionRepeatable, true);

  const bg01 = EVENT_REGISTRY.get(EVENT_ID.BACK_GATE_BG01);
  assert.equal(bg01.lifecycleSource, EVENT_LIFECYCLE_SOURCE.OWNER_DERIVED);
  assert.equal(bg01.persistenceMode, EVENT_PERSISTENCE_MODE.DERIVED_FROM_OWNER);
  assert.equal(bg01.progressOwner, EVENT_PROGRESS_OWNER.QUEST);
  assert.equal(bg01.ownerRef, 'campus_navigation_intro_v1');
  assert.equal(bg01.rewardMode, EVENT_REWARD_MODE.NONE);

  const mcm = EVENT_REGISTRY.get(EVENT_ID.MCM_2026);
  assert.equal(mcm.lifecycleSource, EVENT_LIFECYCLE_SOURCE.TIME_WINDOW);
  assert.equal(mcm.persistenceMode, EVENT_PERSISTENCE_MODE.SERVER_PERSISTED);
  assert.equal(mcm.rewardMode, EVENT_REWARD_MODE.REWARD_CLAIM);
  assert.equal('startsAt' in mcm, false, 'DB clock remains the MCM window authority');
  assert.equal('endsAt' in mcm, false, 'client registry does not duplicate server window dates');
});

test('Inkyung side event is registered without claiming server persistence', () => {
  const inkyung = EVENT_REGISTRY.get(EVENT_ID.INKYUNG_MECHANICAL_DUCK);
  assert.equal(inkyung.title, '인경호의 진실');
  assert.equal(inkyung.lifecycleSource, EVENT_LIFECYCLE_SOURCE.OWNER_DERIVED);
  assert.equal(inkyung.ownerRef, QUEST_ID);
  assert.equal(inkyung.persistenceMode, EVENT_PERSISTENCE_MODE.CLIENT_PERSISTED);
  assert.equal(inkyung.completionRepeatPolicy, EVENT_REPEAT_POLICY.ONCE_PER_ACCOUNT);
  assert.equal(inkyung.progressOwner, EVENT_PROGRESS_OWNER.EVENT);
  assert.equal(inkyung.rewardMode, EVENT_REWARD_MODE.NONE);
  assert.equal(inkyung.interactionRepeatable, true);
  assert.notEqual(inkyung.persistenceMode, EVENT_PERSISTENCE_MODE.SERVER_PERSISTED);
});

test('EventRegistry rejects duplicate or semantically invalid definitions', () => {
  const br01 = DEFAULT_EVENT_DEFINITIONS[EVENT_ID.BIRYONG_BR01];
  assert.throws(() => createEventRegistry({ definitions: [br01, br01] }), /Duplicate eventId/);
  assert.throws(() => createEventRegistry({ definitions: [{
    ...br01, eventId: 'X1', persistenceMode: EVENT_PERSISTENCE_MODE.DERIVED_FROM_OWNER
  }] }), /DERIVED_FROM_OWNER requires OWNER_DERIVED/);
  assert.throws(() => createEventRegistry({ definitions: [{
    ...br01, eventId: 'X2', lifecycleSource: EVENT_LIFECYCLE_SOURCE.OWNER_DERIVED, ownerRef: null
  }] }), /requires ownerRef/);
});
