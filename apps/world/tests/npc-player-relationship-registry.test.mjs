import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO_NPC_RELATIONSHIP_RULES,
  NPC_AFFINITY_EVENT,
  NPC_AFFINITY_SIGNAL,
  NPC_RELATIONSHIP_CLASS,
  NPC_RELATIONSHIP_REGISTRY,
  NPC_RELATIONSHIP_TIER,
  createNpcRelationshipRegistry,
  projectNpcRelationshipChange,
  relationshipTierFor,
  resolveNpcAffinityDelta
} from '../npc-factory/npc-player-relationship-registry.mjs';

test('HERO registry owns exactly the ten stable campus NPC ids', () => {
  assert.equal(NPC_RELATIONSHIP_REGISTRY.size, 10);
  assert.deepEqual(NPC_RELATIONSHIP_REGISTRY.list().map(rule => rule.npcId), [
    'INKYUNG-NPC-001','INKYUNG-NPC-002','INKYUNG-NPC-005','INKYUNG-NPC-008','INKYUNG-NPC-012',
    'INKYUNG-NPC-016','INKYUNG-NPC-029','INKYUNG-NPC-034','INKYUNG-NPC-042','INKYUNG-NPC-046'
  ]);
  assert.ok(HERO_NPC_RELATIONSHIP_RULES.every(rule => rule.relationshipClass === NPC_RELATIONSHIP_CLASS.HERO));
  assert.ok(HERO_NPC_RELATIONSHIP_RULES.every(rule => Object.isFrozen(rule) && Object.isFrozen(rule.signalWeights)));
});

test('relationship tiers are deterministic at every boundary', () => {
  assert.equal(relationshipTierFor(0), NPC_RELATIONSHIP_TIER.STRANGER);
  assert.equal(relationshipTierFor(9), NPC_RELATIONSHIP_TIER.STRANGER);
  assert.equal(relationshipTierFor(10), NPC_RELATIONSHIP_TIER.FAMILIAR);
  assert.equal(relationshipTierFor(24), NPC_RELATIONSHIP_TIER.FAMILIAR);
  assert.equal(relationshipTierFor(25), NPC_RELATIONSHIP_TIER.FRIENDLY);
  assert.equal(relationshipTierFor(44), NPC_RELATIONSHIP_TIER.FRIENDLY);
  assert.equal(relationshipTierFor(45), NPC_RELATIONSHIP_TIER.FRIEND);
  assert.equal(relationshipTierFor(69), NPC_RELATIONSHIP_TIER.FRIEND);
  assert.equal(relationshipTierFor(70), NPC_RELATIONSHIP_TIER.TRUSTED);
  assert.equal(relationshipTierFor(100), NPC_RELATIONSHIP_TIER.TRUSTED);
  assert.throws(() => relationshipTierFor(-1), /0 to 100/);
  assert.throws(() => relationshipTierFor(101), /0 to 100/);
});

test('raw repeat talk never farms affinity and one-shot events stop after their first occurrence', () => {
  const npcId = 'INKYUNG-NPC-001';
  assert.equal(resolveNpcAffinityDelta(npcId, { eventType: NPC_AFFINITY_EVENT.REPEAT_DIALOGUE }), 0);
  assert.equal(resolveNpcAffinityDelta(npcId, { eventType: NPC_AFFINITY_EVENT.FIRST_MEETING, occurrence: 1 }), 2);
  assert.equal(resolveNpcAffinityDelta(npcId, { eventType: NPC_AFFINITY_EVENT.FIRST_MEETING, occurrence: 2 }), 0);
  assert.equal(resolveNpcAffinityDelta(npcId, { eventType: NPC_AFFINITY_EVENT.MEANINGFUL_DIALOGUE, occurrence: 1 }), 1);
  assert.equal(resolveNpcAffinityDelta(npcId, { eventType: NPC_AFFINITY_EVENT.MEANINGFUL_DIALOGUE, occurrence: 2 }), 0);
});

test('HERO preferences differentiate otherwise identical shared activities', () => {
  assert.equal(resolveNpcAffinityDelta('INKYUNG-NPC-046', {
    eventType: NPC_AFFINITY_EVENT.SHARED_ACTIVITY,
    signal: NPC_AFFINITY_SIGNAL.MOBILITY_TEST
  }), 5, 'mobility test is the mobility HERO\'s strongest shared activity');
  assert.equal(resolveNpcAffinityDelta('INKYUNG-NPC-029', {
    eventType: NPC_AFFINITY_EVENT.SHARED_ACTIVITY,
    signal: NPC_AFFINITY_SIGNAL.FISHING_SHARED
  }), 3, 'shared fishing matters more to the ecology HERO');
  assert.equal(resolveNpcAffinityDelta('INKYUNG-NPC-001', {
    eventType: NPC_AFFINITY_EVENT.SHARED_ACTIVITY,
    signal: NPC_AFFINITY_SIGNAL.TECHNICAL_INVESTIGATION
  }), 2, 'unrelated signals keep only the generic shared-activity value');
});

test('repeat decay makes a repeated mobility test 5 → 2 → 0 within one authoritative cadence', () => {
  const spec = occurrence => resolveNpcAffinityDelta('INKYUNG-NPC-046', {
    eventType: NPC_AFFINITY_EVENT.SHARED_ACTIVITY,
    signal: NPC_AFFINITY_SIGNAL.MOBILITY_TEST,
    occurrence
  });
  assert.deepEqual([spec(1), spec(2), spec(3)], [5,2,0]);
});

test('projection clamps affinity and reports tier crossings without owning persistence', () => {
  assert.deepEqual(projectNpcRelationshipChange(24, 3), {
    affinityBefore: 24,
    affinityAfter: 27,
    tierBefore: NPC_RELATIONSHIP_TIER.FAMILIAR,
    tierAfter: NPC_RELATIONSHIP_TIER.FRIENDLY,
    tierChanged: true
  });
  assert.equal(projectNpcRelationshipChange(98, 8).affinityAfter, 100);
  assert.equal(projectNpcRelationshipChange(2, -5).affinityAfter, 0);
});

test('registry rejects duplicate identity and non-HERO mutation rules; non-HERO lookup is inert', () => {
  const hero = HERO_NPC_RELATIONSHIP_RULES[0];
  assert.throws(() => createNpcRelationshipRegistry({ rules: [hero, hero] }), /Duplicate relationship npcId/);
  assert.equal(resolveNpcAffinityDelta('INKYUNG-NPC-003', {
    eventType: NPC_AFFINITY_EVENT.SHARED_ACTIVITY,
    signal: NPC_AFFINITY_SIGNAL.CAMPUS_DISCOVERY
  }), null);
  assert.throws(() => resolveNpcAffinityDelta('INKYUNG-NPC-001', { eventType: 'CHAT_SPAM' }), /Unknown affinity event/);
});
