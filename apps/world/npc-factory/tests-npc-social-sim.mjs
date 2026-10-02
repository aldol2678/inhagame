import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INTEREST_CLUSTER_BY_INTEREST,
  createNpcSocialSimulation,
  summarizeNpcSocialSnapshot
} from './npc-social-sim.mjs';

const batch = JSON.parse(readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url), 'utf8'));
const sourceBefore = JSON.stringify(batch);

for (const npc of batch.npcs) {
  for (const interest of npc.interests) {
    assert.ok(INTEREST_CLUSTER_BY_INTEREST[interest], `missing NG0 interest cluster for ${interest}`);
  }
}

const simA = createNpcSocialSimulation(batch, { seed: 'inkyung-ng0-regression' });
const first = simA.snapshot();
assert.equal(Object.keys(first.relations).length, 190, '20 NPCs must produce exactly 190 undirected relation edges');
assert.equal(first.groups.length, 0, 'NG0 starts without pre-authored dynamic groups');

const fastStep = createNpcSocialSimulation(batch, { seed: 'inkyung-ng0-fast-step' });
assert.equal(fastStep.step({ snapshot: false }), null,
  'internal fast-step may skip the expensive public snapshot');
assert.equal(fastStep.snapshot().tick, 1, 'fast-step still advances the exact social clock');
const fastRun = createNpcSocialSimulation(batch, { seed: 'inkyung-ng0-fast-run' });
assert.equal(fastRun.run(3, { snapshot: false }), null,
  'internal fast-run may skip the expensive relation snapshot');
assert.equal(fastRun.viewSnapshot().tick, 3, 'view snapshot preserves the social clock without relation cloning');
assert.equal('relations' in fastRun.viewSnapshot(), false,
  'view snapshot intentionally omits the full relation graph');

const resultA = simA.run(240);
const summaryA = summarizeNpcSocialSnapshot(resultA);
console.log('NPC social NG0 INKYUNG-20 summary', JSON.stringify(summaryA));

assert.equal(JSON.stringify(batch), sourceBefore, 'NG0 must never mutate the frozen Population NPC source');
assert.ok(resultA.groups.filter(group => group.status !== 'DISSOLVED').length <= 3, 'NG0 default targets at most three live groups');
assert.ok(resultA.groups.length <= 5, 'NG0 hard-caps simultaneously live groups below the product ceiling');
assert.ok(resultA.recentEvents.some(event => event.type === 'GROUP_CREATED'),
  `INKYUNG-20 should produce at least one emergent group in 240 accelerated ticks: ${JSON.stringify(summaryA)}`);
assert.ok(resultA.recentEvents.some(event => event.type === 'GROUP_MEETING_PLACE_SET'),
  'stable active groups should eventually remember a recurring meeting place');
const rememberedMeetings = Object.fromEntries(resultA.groups
  .filter(group => group.meetingPlaceRef)
  .map(group => [group.groupId, {
    meetingPlaceRef: group.meetingPlaceRef,
    meetingCadenceTicks: group.meetingCadenceTicks,
    nextMeetingTick: group.nextMeetingTick
  }]));
assert.ok(Object.keys(rememberedMeetings).length >= 1, 'at least one stable group should own a meeting place');
for (const value of Object.values(rememberedMeetings)) {
  assert.equal(value.meetingCadenceTicks, 120, 'recurring groups use the canonical 120-tick cadence');
  assert.ok(Number.isInteger(value.nextMeetingTick), 'recurring groups schedule their first meeting tick');
}
const rememberedAfter = simA.run(20);
for (const [groupId, remembered] of Object.entries(rememberedMeetings)) {
  const group = rememberedAfter.groups.find(item => item.groupId === groupId);
  assert.equal(group?.meetingPlaceRef, remembered.meetingPlaceRef,
    'recurring meeting place remains stable once chosen');
  assert.equal(group?.nextMeetingTick, remembered.nextMeetingTick,
    'scheduled meeting tick remains stable until an outcome is recorded');
}
const dueGroup = rememberedAfter.groups.find(group =>
  group.meetingPlaceRef && Number.isInteger(group.nextMeetingTick) && group.nextMeetingTick <= rememberedAfter.tick);
assert.ok(dueGroup, 'at least one recurring meeting should become due in the deterministic fixture');
const outcomeTick = rememberedAfter.tick;
const attendancePayload = {
  invitedNpcIds: [...dueGroup.memberNpcIds],
  attendedNpcIds: dueGroup.memberNpcIds.slice(0, 3),
  onTimeNpcIds: dueGroup.memberNpcIds.slice(0, 2),
  lateNpcIds: dueGroup.memberNpcIds.slice(2, 3),
  absentNpcIds: dueGroup.memberNpcIds.slice(3)
};
assert.equal(simA.recordGroupMeetingOutcome(dueGroup.groupId, 'COMPLETED', attendancePayload), true);
const afterOutcome = simA.snapshot();
const rescheduled = afterOutcome.groups.find(group => group.groupId === dueGroup.groupId);
assert.equal(rescheduled.lastMeetingTick, outcomeTick);
assert.equal(rescheduled.lastMeetingOutcome, 'COMPLETED');
assert.deepEqual(rescheduled.lastMeetingAttendance, attendancePayload,
  'recurring meeting persists on-time, late and absent attendance');
assert.equal(rescheduled.nextMeetingTick, outcomeTick + rescheduled.meetingCadenceTicks,
  'completed recurring meeting schedules the next cadence');
assert.ok(afterOutcome.recentEvents.some(event =>
  event.type === 'GROUP_REGULAR_MEETING_COMPLETED' && event.groupId === dueGroup.groupId));
assert.equal(simA.recordGroupMeetingOutcome('UNKNOWN-GROUP', 'COMPLETED'), false);
assert.throws(() => simA.recordGroupMeetingOutcome(dueGroup.groupId, 'COMPLETED', []),
  /attendance payload must be an object/);

for (const group of resultA.groups) {
  assert.ok(['FORMING', 'ACTIVE', 'DISSOLVED'].includes(group.status), `unknown group state ${group.status}`);
  assert.ok(group.memberNpcIds.length <= 6, 'MVP groups stay small');
  assert.ok(!['INKYUNG-NPC-001', 'INKYUNG-NPC-002'].includes(group.leaderNpcId),
    'quest/featured NPC 001/002 remain protected from autonomous leadership in NG0');
  for (const id of group.memberNpcIds) {
    assert.ok(batch.npcs.some(npc => npc.npc_id === id), `group contains unknown NPC ${id}`);
  }
}

const simReplay = createNpcSocialSimulation(batch, { seed: 'inkyung-ng0-regression' });
assert.deepEqual(simReplay.run(240), resultA, 'same seed + same NPC source must replay deterministically');

const simDifferent = createNpcSocialSimulation(batch, { seed: 'inkyung-ng0-alternate' });
const resultDifferent = simDifferent.run(240);
assert.notDeepEqual(resultDifferent.relations, resultA.relations, 'different seeds should be able to vary encounter history');

const syntheticNpcs = Array.from({ length: 5 }, (_, index) => {
  const id = `TEST-NPC-${index + 1}`;
  return {
    npc_id: id,
    identity: { name: id },
    personality: {
      traits: index === 0 ? ['curious', 'cheerful'] : ['patient'],
      social_energy: 0.8,
      talkativeness: 0.75,
      routine_preference: 0.35
    },
    interests: ['music'],
    relationships: [],
    schedule: Object.fromEntries(['morning', 'class_time', 'lunch', 'evening'].map(period => [period, {
      location: 'shared',
      activity: 'talk_with_friend',
      social_mode: 'high'
    }]))
  };
});

const synthetic = {
  batch_id: 'NG0-SYNTHETIC',
  schema_version: '0.1',
  zone: 'TEST',
  npc_count: syntheticNpcs.length,
  npcs: syntheticNpcs
};

const lifecycle = createNpcSocialSimulation(synthetic, {
  seed: 'ng0-lifecycle',
  formationAffinity: 2.5,
  joinAffinity: 3,
  memberLeaveParticipation: 70,
  minTenureTicks: 12,
  observationProvider: ({ npc, tick }) => tick < 30
    ? { location: 'shared', activity: 'talk_with_friend', socialMode: 'high' }
    : { location: `isolated-${npc.npc_id}`, activity: 'wait', socialMode: 'low' }
});

lifecycle.run(120);
const lifecycleSnapshot = lifecycle.snapshot();
const lifecycleTypes = new Set(lifecycleSnapshot.recentEvents.map(event => event.type));
const lifecycleSummary = summarizeNpcSocialSnapshot(lifecycleSnapshot);
console.log('NPC social NG0 lifecycle summary', JSON.stringify(lifecycleSummary));

assert.ok(lifecycleTypes.has('GROUP_CREATED'), 'synthetic lifecycle must create a group');
assert.ok(lifecycleTypes.has('GROUP_ACTIVATED'), 'synthetic lifecycle must activate a stable forming group');
assert.ok(lifecycleTypes.has('MEMBER_LEFT'), 'prolonged isolation must exercise member leave');
assert.ok(lifecycleTypes.has('GROUP_DISSOLVED'), 'membership loss must exercise group dissolution');
assert.equal(lifecycleSummary.liveGroups, 0, 'isolated synthetic group should eventually dissolve');

console.log('NPC Social NG0: deterministic population simulation and lifecycle PASS');
