import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HERO_NPC_RELATIONSHIP_RULES,NPC_AFFINITY_EVENT,NPC_AFFINITY_SIGNAL,NPC_RELATIONSHIP_CLASS,
  NPC_RELATIONSHIP_DEFINITION_VERSION,NPC_RELATIONSHIP_REGISTRY,NPC_RELATIONSHIP_TIER,
  createNpcRelationshipRegistry,projectNpcRelationshipChange,relationshipTierFor,resolveNpcAffinityDelta
} from '../npc-factory/npc-player-relationship-registry.mjs';

test('HERO registry owns exactly ten stable campus ids at definition v1',()=>{
  assert.equal(NPC_RELATIONSHIP_DEFINITION_VERSION,1);
  assert.equal(NPC_RELATIONSHIP_REGISTRY.size,10);
  assert.deepEqual(NPC_RELATIONSHIP_REGISTRY.list().map(x=>x.npcId),[
    'INKYUNG-NPC-001','INKYUNG-NPC-002','INKYUNG-NPC-005','INKYUNG-NPC-008','INKYUNG-NPC-012',
    'INKYUNG-NPC-016','INKYUNG-NPC-029','INKYUNG-NPC-034','INKYUNG-NPC-042','INKYUNG-NPC-046'
  ]);
  assert.ok(HERO_NPC_RELATIONSHIP_RULES.every(x=>x.relationshipClass===NPC_RELATIONSHIP_CLASS.HERO&&x.definitionVersion===1));
});

test('tier boundaries are deterministic',()=>{
  for(const [n,t] of [[0,'STRANGER'],[9,'STRANGER'],[10,'FAMILIAR'],[24,'FAMILIAR'],[25,'FRIENDLY'],
    [44,'FRIENDLY'],[45,'FRIEND'],[69,'FRIEND'],[70,'TRUSTED'],[100,'TRUSTED']])
    assert.equal(relationshipTierFor(n),NPC_RELATIONSHIP_TIER[t]);
  assert.throws(()=>relationshipTierFor(-1),/0 to 100/);
});

test('raw repeat talk never farms and one-shot dialogue decays to zero',()=>{
  const id='INKYUNG-NPC-001';
  assert.equal(resolveNpcAffinityDelta(id,{eventType:NPC_AFFINITY_EVENT.REPEAT_DIALOGUE}),0);
  assert.equal(resolveNpcAffinityDelta(id,{eventType:NPC_AFFINITY_EVENT.FIRST_MEETING,occurrence:1}),2);
  assert.equal(resolveNpcAffinityDelta(id,{eventType:NPC_AFFINITY_EVENT.FIRST_MEETING,occurrence:2}),0);
  assert.equal(resolveNpcAffinityDelta(id,{eventType:NPC_AFFINITY_EVENT.MEANINGFUL_DIALOGUE,occurrence:2}),0);
});

test('HERO preferences differentiate shared activities',()=>{
  assert.equal(resolveNpcAffinityDelta('INKYUNG-NPC-046',{eventType:NPC_AFFINITY_EVENT.SHARED_ACTIVITY,signal:NPC_AFFINITY_SIGNAL.MOBILITY_TEST}),5);
  assert.equal(resolveNpcAffinityDelta('INKYUNG-NPC-029',{eventType:NPC_AFFINITY_EVENT.SHARED_ACTIVITY,signal:NPC_AFFINITY_SIGNAL.FISHING_SHARED}),3);
  assert.equal(resolveNpcAffinityDelta('INKYUNG-NPC-001',{eventType:NPC_AFFINITY_EVENT.SHARED_ACTIVITY,signal:NPC_AFFINITY_SIGNAL.TECHNICAL_INVESTIGATION}),2);
});

test('repeat decay makes mobility test 5 → 2 → 0',()=>{
  const f=occurrence=>resolveNpcAffinityDelta('INKYUNG-NPC-046',{
    eventType:NPC_AFFINITY_EVENT.SHARED_ACTIVITY,signal:NPC_AFFINITY_SIGNAL.MOBILITY_TEST,occurrence});
  assert.deepEqual([f(1),f(2),f(3)],[5,2,0]);
});

test('projection clamps and reports tier crossing',()=>{
  assert.deepEqual(projectNpcRelationshipChange(24,3),{
    affinityBefore:24,affinityAfter:27,tierBefore:'FAMILIAR',tierAfter:'FRIENDLY',tierChanged:true});
  assert.equal(projectNpcRelationshipChange(98,8).affinityAfter,100);
  assert.equal(projectNpcRelationshipChange(2,-5).affinityAfter,0);
});

test('non-HERO ids are inert in v0.1',()=>{
  assert.equal(resolveNpcAffinityDelta('INKYUNG-NPC-003',{
    eventType:NPC_AFFINITY_EVENT.SHARED_ACTIVITY,signal:NPC_AFFINITY_SIGNAL.CAMPUS_DISCOVERY}),null);
  assert.throws(()=>createNpcRelationshipRegistry({rules:[HERO_NPC_RELATIONSHIP_RULES[0],HERO_NPC_RELATIONSHIP_RULES[0]]}),/Duplicate/);
});
