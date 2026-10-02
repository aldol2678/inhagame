import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcNavigator } from './dev-navigation.mjs';
import { createPurposefulRoster } from './purposeful-roster.mjs';
import { createNpcSocialNg15Bridge, NG15_LOCAL_MEETING_LOCATIONS, NG15_ZONE_MEETING_LOCATIONS } from './npc-social-ng15-bridge.mjs';
import { positionAt } from './dev-runtime-state.mjs';
import {
  NPC_SOCIAL_ACTION_CLASSIFIER,
  NPC_SOCIAL_ASSEMBLE_TIMEOUT_SECONDS,
  NPC_SOCIAL_REGULAR_ATTENDANCE_POLICY,
  NPC_SOCIAL_REGULAR_MEETING_POLICY,
  NPC_SOCIAL_TRAVEL_BUDGET_SECONDS,
  classifyNpcSocialTravelKind,
  npcSocialAssembleTimeoutSeconds,
  npcSocialRegularMeetingPlaceRef,
  npcSocialTravelBudgetSeconds
} from './npc-social-travel-policy.mjs';

const batch = JSON.parse(readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url), 'utf8'));
const navigator = createNpcNavigator(batch);
const roster = createPurposefulRoster(batch, navigator, { speed: 8 });
const memberNpcIds = [...roster.entries()]
  .filter(([, value]) => value.controller.status(false).visible)
  .slice(0, 3)
  .map(([id]) => id);
assert.equal(memberNpcIds.length, 3, 'NG1.5 test requires three visible purposeful NPCs');
const socialSnapshot = {
  groups: [{
    groupId: 'npc-group-ng15-test',
    status: 'ACTIVE',
    primaryInterest: 'TECH',
    leaderNpcId: memberNpcIds[0],
    memberNpcIds: [...memberNpcIds]
  }]
};
const bridge = createNpcSocialNg15Bridge({
  roster,
  navigator,
  dwellSeconds: .8,
  travelBudgetKind: 'SPONTANEOUS',
  assembleTimeoutSeconds: 20
});

function step(dt = .1, conversationId = null) {
  for (const [id, { controller }] of roster) {
    if (bridge.shouldPauseForConversation(id, conversationId)) controller.pause();
    else controller.resume();
    controller.tick(dt);
  }
  return bridge.tick(dt, socialSnapshot, { conversationId });
}

let state = null;
for (let i = 0; i < 200; i++) {
  state = step();
  if (state.phase === 'ASSEMBLING') break;
}
assert.equal(state.phase, 'ASSEMBLING', 'NG1.5 could not select a reachable active meetup');
assert.deepEqual(state.active.memberNpcIds, memberNpcIds);
assert.ok(['LOCAL', 'ZONE'].includes(state.active.meetingScope));
assert.equal(state.active.travelBudgetKind, 'SPONTANEOUS');
assert.equal(state.active.travelBudgetReason, 'OVERRIDE');
assert.equal(state.active.travelBudgetSeconds, 15);
assert.equal(state.active.assembleTimeoutSeconds, 20);
assert.ok(state.active.estimatedTravelSeconds <= state.active.travelBudgetSeconds,
  'selected meetup stays inside the route-time budget');
for (const id of memberNpcIds) {
  const npc = roster.get(id).controller.status(false);
  assert.equal(npc.interrupted, true);
  assert.equal(npc.currentNeed, 'SOCIAL');
  assert.equal(npc.currentGoal, 'GROUP_MEETUP');
}

for (let i = 0; i < 25; i++) step(.1, memberNpcIds[0]);
const paused = memberNpcIds.map(id => roster.get(id).controller.status(false));
assert.ok(paused.every(value => value.paused), 'talking to one attendee pauses the whole meetup');
assert.equal(bridge.status().phase, 'ASSEMBLING');

let sawMeeting = false;
for (let i = 0; i < 600; i++) {
  state = step();
  if (state.phase === 'MEETING') {
    sawMeeting = true;
    const meeting = memberNpcIds.map(id => roster.get(id).controller.status(false));
    assert.ok(meeting.every(value => value.interrupted && value.activity === 'SOCIAL_MEETUP'));
    const observation = bridge.observationFor(memberNpcIds[0]);
    assert.equal(observation.activity, 'talk_with_friend');
    assert.equal(observation.socialMode, 'high');
  }
  if (state.completedGroups.includes('npc-group-ng15-test')) break;
}
state = bridge.status();
assert.equal(sawMeeting, true, 'NG1.5 attendees never reached the meetup activity');
assert.ok(state.completedGroups.includes('npc-group-ng15-test'), 'NG1.5 meetup never completed');
assert.equal(state.phase, 'IDLE');
assert.equal(state.lastOutcome.outcome, 'COMPLETED');
for (const id of memberNpcIds) {
  const npc = roster.get(id).controller.status();
  assert.equal(npc.interrupted, false);
  assert.equal(npc.failures, 0);
  assert.ok(npc.history.some(item => item.event === 'INTERRUPT'));
  assert.ok(npc.history.some(item => item.event === 'RESUME'));
}

const blockedNavigator = createNpcNavigator(batch);
const blockedRoster = createPurposefulRoster(batch, blockedNavigator, { speed: 8 });
const blocked = createNpcSocialNg15Bridge({ roster: blockedRoster, navigator: blockedNavigator, dwellSeconds: .5 });
blocked.tick(.1, socialSnapshot, { blockedNpcIds: memberNpcIds });
assert.equal(blocked.status().phase, 'IDLE', 'blocked NPCs must not be stolen from another social behavior');

assert.deepEqual(NG15_ZONE_MEETING_LOCATIONS, [
  'transit_to_main_hall',
  'transit_to_student_center',
  'transit_to_building'
], 'NG1.5 expands from local Inkyung anchors to adjacent zone approaches');

const zoneNavigator = createNpcNavigator(batch);
const zoneRoster = createPurposefulRoster(batch, zoneNavigator, { speed: 8 });
const zoneOnly = createNpcSocialNg15Bridge({
  roster: zoneRoster,
  navigator: zoneNavigator,
  positionAtFn: (location, slot) =>
    NG15_LOCAL_MEETING_LOCATIONS.includes(location) ? null : positionAt(location, slot),
  travelBudgetKind: 'SPONTANEOUS',
  assembleTimeoutSeconds: 20
});
zoneOnly.tick(.1, socialSnapshot);
const zoneState = zoneOnly.status();
assert.equal(zoneState.phase, 'ASSEMBLING', 'NG1.5 can start a meetup using the expanded zone radius');
assert.equal(zoneState.active.meetingScope, 'ZONE');
assert.ok(NG15_ZONE_MEETING_LOCATIONS.includes(zoneState.active.meetingLocation));
assert.equal(zoneState.active.travelBudgetKind, 'SPONTANEOUS');
assert.equal(zoneState.active.travelBudgetReason, 'OVERRIDE');
assert.equal(zoneState.active.travelBudgetSeconds, 15);
assert.equal(zoneState.active.assembleTimeoutSeconds, 20);
assert.ok(zoneState.active.estimatedTravelSeconds <= zoneState.active.travelBudgetSeconds);

assert.deepEqual(NPC_SOCIAL_TRAVEL_BUDGET_SECONDS, {
  SPONTANEOUS: 15,
  SMALL_GROUP: 45,
  REGULAR_GROUP: 90
});
assert.equal(npcSocialTravelBudgetSeconds('SMALL_GROUP'), 45);
assert.equal(npcSocialTravelBudgetSeconds('REGULAR_GROUP'), 90);
assert.throws(() => npcSocialTravelBudgetSeconds('UNKNOWN'), /Unknown NPC social travel budget/);
assert.deepEqual(NPC_SOCIAL_ASSEMBLE_TIMEOUT_SECONDS, {
  SPONTANEOUS: 30,
  SMALL_GROUP: 60,
  REGULAR_GROUP: 120
});
assert.equal(npcSocialAssembleTimeoutSeconds('SPONTANEOUS'), 30);
assert.equal(npcSocialAssembleTimeoutSeconds('SMALL_GROUP'), 60);
assert.equal(npcSocialAssembleTimeoutSeconds('REGULAR_GROUP'), 120);
assert.throws(() => npcSocialAssembleTimeoutSeconds('UNKNOWN'), /Unknown NPC social assembly timeout/);
assert.deepEqual(NPC_SOCIAL_REGULAR_ATTENDANCE_POLICY, {
  minAttendees: 3,
  maxAttendees: 6,
  lateGraceTicks: 12
});
assert.deepEqual(NPC_SOCIAL_REGULAR_MEETING_POLICY, {
  minAgeTicks: 80,
  minCohesion: 30,
  minActivity: 80,
  cadenceTicks: 120,
  locationByCluster: {
    CREATIVE: 'inkyung_photo_point',
    TECH: 'transit_to_building',
    LEARNING: 'transit_to_main_hall',
    LIFESTYLE: 'transit_to_student_center',
    EXPLORE: 'inkyung_waterfront'
  }
});
assert.equal(npcSocialRegularMeetingPlaceRef({
  status: 'ACTIVE',
  primaryInterest: 'TECH',
  createdAtTick: 0,
  cohesion: 35,
  activity: 90,
  meetingPlaceRef: null
}, 80), 'transit_to_building');
assert.equal(npcSocialRegularMeetingPlaceRef({
  status: 'ACTIVE',
  primaryInterest: 'TECH',
  createdAtTick: 0,
  cohesion: 29,
  activity: 90,
  meetingPlaceRef: null
}, 80), null);
assert.equal(npcSocialRegularMeetingPlaceRef({
  status: 'ACTIVE',
  primaryInterest: 'TECH',
  createdAtTick: 0,
  cohesion: 35,
  activity: 90,
  meetingPlaceRef: 'inkyung_walkway'
}, 200), 'inkyung_walkway');
assert.deepEqual(NPC_SOCIAL_ACTION_CLASSIFIER, {
  spontaneousMaxCohesion: 15,
  spontaneousMaxActivity: 70
});
assert.deepEqual(classifyNpcSocialTravelKind({
  status: 'FORMING',
  cohesion: 40,
  activity: 90,
  meetingPlaceRef: null
}), { kind: 'SPONTANEOUS', reason: 'FORMING_GROUP' });
assert.deepEqual(classifyNpcSocialTravelKind({
  status: 'ACTIVE',
  cohesion: 12,
  activity: 88,
  meetingPlaceRef: null
}), { kind: 'SPONTANEOUS', reason: 'LOW_STABILITY' });
assert.deepEqual(classifyNpcSocialTravelKind({
  status: 'ACTIVE',
  cohesion: 32,
  activity: 84,
  meetingPlaceRef: null
}), { kind: 'SMALL_GROUP', reason: 'ACTIVE_GROUP' });
assert.deepEqual(classifyNpcSocialTravelKind({
  status: 'ACTIVE',
  cohesion: 32,
  activity: 84,
  meetingPlaceRef: 'club-room-regular'
}), { kind: 'REGULAR_GROUP', reason: 'RECURRING_MEETING_PLACE' });
assert.throws(() => classifyNpcSocialTravelKind({ status: 'DISSOLVED' }), /Live NPC social group required/);

const defaultPolicyNavigator = createNpcNavigator(batch);
const defaultPolicyRoster = createPurposefulRoster(batch, defaultPolicyNavigator, { speed: 8 });
const defaultPolicyBridge = createNpcSocialNg15Bridge({
  roster: defaultPolicyRoster,
  navigator: defaultPolicyNavigator,
  assembleTimeoutSeconds: 60
});
defaultPolicyBridge.tick(.1, socialSnapshot);
const defaultPolicyState = defaultPolicyBridge.status();
assert.equal(defaultPolicyState.phase, 'ASSEMBLING');
assert.equal(defaultPolicyState.active.travelBudgetKind, 'SMALL_GROUP');
assert.equal(defaultPolicyState.active.travelBudgetReason, 'ACTIVE_GROUP');
assert.equal(defaultPolicyState.active.travelBudgetSeconds, 45);
assert.equal(defaultPolicyState.active.assembleTimeoutSeconds, 60);
assert.ok(defaultPolicyState.active.estimatedTravelSeconds <= 45);
assert.throws(() => createNpcSocialNg15Bridge({
  roster: defaultPolicyRoster,
  navigator: defaultPolicyNavigator,
  travelBudgetKind: 'REGULAR_GROUP',
  assembleTimeoutSeconds: 60
}), /Invalid NG1.5 bridge configuration/,
'90-second regular-group travel requires a larger assembly timeout before activation');
const recurringPolicyNavigator = createNpcNavigator(batch);
const recurringPolicyRoster = createPurposefulRoster(batch, recurringPolicyNavigator, { speed: 8 });
const recurringSnapshot = {
  tick: 199,
  groups: [{
    ...socialSnapshot.groups[0],
    cohesion: 80,
    activity: 95,
    meetingPlaceRef: 'transit_to_building',
    meetingCadenceTicks: 120,
    lastMeetingTick: null,
    lastMeetingOutcome: null,
    nextMeetingTick: 200
  }]
};
const recurringOutcomes = [];
const recurringPolicyBridge = createNpcSocialNg15Bridge({
  roster: recurringPolicyRoster,
  navigator: recurringPolicyNavigator,
  dwellSeconds: .4,
  onRegularMeetingOutcome: ({ groupId, outcome, attendance = null }) => {
    recurringOutcomes.push({ groupId, outcome, attendance, tick: recurringSnapshot.tick });
    const group = recurringSnapshot.groups.find(item => item.groupId === groupId);
    if (!group) return;
    group.lastMeetingOutcome = outcome;
    if (outcome === 'COMPLETED') group.lastMeetingTick = recurringSnapshot.tick;
    group.nextMeetingTick = recurringSnapshot.tick + group.meetingCadenceTicks;
  }
});
recurringPolicyBridge.tick(.1, recurringSnapshot);
assert.equal(recurringPolicyBridge.status().phase, 'IDLE',
  'recurring meetup waits until nextMeetingTick');
recurringSnapshot.tick = 200;
recurringPolicyBridge.tick(.1, recurringSnapshot);
let recurringState = recurringPolicyBridge.status();
assert.equal(recurringState.phase, 'ASSEMBLING',
  'AUTO classifier activates a recurring meetup when its schedule becomes due');
assert.equal(recurringState.active.travelBudgetKind, 'REGULAR_GROUP');
assert.equal(recurringState.active.travelBudgetReason, 'RECURRING_MEETING_PLACE');
assert.equal(recurringState.active.travelBudgetSeconds, 90);
assert.equal(recurringState.active.assembleTimeoutSeconds, 120);
assert.equal(recurringState.active.scheduledMeetingTick, 200);
assert.equal(recurringState.active.meetingLocation, 'transit_to_building',
  'recurring meetup reuses the remembered meeting place instead of choosing a new venue');
assert.ok(recurringState.active.estimatedTravelSeconds <= 90);
assert.deepEqual(recurringState.active.attendance, {
  invitedNpcIds: memberNpcIds,
  attendedNpcIds: memberNpcIds,
  onTimeNpcIds: memberNpcIds,
  lateNpcIds: [],
  absentNpcIds: []
});

for (let i = 0; i < 900; i++) {
  for (const { controller } of recurringPolicyRoster.values()) controller.tick(.1);
  recurringPolicyBridge.tick(.1, recurringSnapshot);
  if (!recurringPolicyBridge.status().active &&
      recurringPolicyBridge.status().lastOutcome?.outcome === 'COMPLETED') break;
}
recurringState = recurringPolicyBridge.status();
assert.equal(recurringState.lastOutcome?.outcome, 'COMPLETED');
assert.equal(recurringOutcomes.length, 1);
assert.deepEqual(recurringOutcomes[0], {
  groupId: socialSnapshot.groups[0].groupId,
  outcome: 'COMPLETED',
  attendance: {
    invitedNpcIds: memberNpcIds,
    attendedNpcIds: memberNpcIds,
    onTimeNpcIds: memberNpcIds,
    lateNpcIds: [],
    absentNpcIds: []
  },
  tick: 200
});
assert.equal(recurringSnapshot.groups[0].lastMeetingTick, 200);
assert.equal(recurringSnapshot.groups[0].nextMeetingTick, 320,
  'completed recurring meetup schedules the next cadence');
recurringSnapshot.tick = 319;
recurringPolicyBridge.tick(.1, recurringSnapshot);
assert.equal(recurringPolicyBridge.status().phase, 'IDLE',
  'completed group remains idle before the next recurring tick');
recurringSnapshot.tick = 320;
recurringPolicyBridge.tick(.1, recurringSnapshot);
recurringState = recurringPolicyBridge.status();
assert.equal(recurringState.phase, 'ASSEMBLING',
  'the same group can meet again on the next cadence');
assert.equal(recurringState.active.scheduledMeetingTick, 320);

const lateNavigator = createNpcNavigator(batch);
const lateRoster = createPurposefulRoster(batch, lateNavigator, { speed: 8 });
const lateSnapshot = {
  tick: 500,
  groups: [{
    ...socialSnapshot.groups[0],
    cohesion: 80,
    activity: 95,
    meetingPlaceRef: 'transit_to_building',
    meetingCadenceTicks: 120,
    lastMeetingTick: null,
    lastMeetingOutcome: null,
    nextMeetingTick: 500
  }]
};
const lateBridge = createNpcSocialNg15Bridge({
  roster: lateRoster,
  navigator: lateNavigator,
  regularAttendancePolicy: { lateGraceTicks: 2 }
});
lateBridge.tick(.1, lateSnapshot, { blockedNpcIds: [memberNpcIds[2]] });
assert.equal(lateBridge.status().phase, 'IDLE');
assert.equal(lateBridge.status().pendingRegularMeetings.length, 1,
  'recurring meetup waits through the late grace window when quorum is short');
assert.deepEqual(lateBridge.status().pendingRegularMeetings[0].onTimeNpcIds, memberNpcIds.slice(0, 2));
lateSnapshot.tick = 501;
lateBridge.tick(.1, lateSnapshot);
const lateState = lateBridge.status();
assert.equal(lateState.phase, 'ASSEMBLING',
  'late attendee can satisfy quorum inside the grace window');
assert.deepEqual(lateState.active.attendance, {
  invitedNpcIds: memberNpcIds,
  attendedNpcIds: memberNpcIds,
  onTimeNpcIds: memberNpcIds.slice(0, 2),
  lateNpcIds: memberNpcIds.slice(2),
  absentNpcIds: []
});

const postponedNavigator = createNpcNavigator(batch);
const postponedRoster = createPurposefulRoster(batch, postponedNavigator, { speed: 8 });
const postponedSnapshot = {
  tick: 700,
  groups: [{
    ...socialSnapshot.groups[0],
    cohesion: 80,
    activity: 95,
    meetingPlaceRef: 'transit_to_building',
    meetingCadenceTicks: 120,
    lastMeetingTick: 500,
    lastMeetingOutcome: 'COMPLETED',
    nextMeetingTick: 700
  }]
};
const postponedOutcomes = [];
const postponedBridge = createNpcSocialNg15Bridge({
  roster: postponedRoster,
  navigator: postponedNavigator,
  regularAttendancePolicy: { lateGraceTicks: 2 },
  onRegularMeetingOutcome: ({ groupId, outcome, attendance }) => {
    postponedOutcomes.push({ groupId, outcome, attendance, tick: postponedSnapshot.tick });
    const group = postponedSnapshot.groups.find(item => item.groupId === groupId);
    group.lastMeetingOutcome = outcome;
    group.lastMeetingAttendance = attendance;
    group.nextMeetingTick = postponedSnapshot.tick + group.meetingCadenceTicks;
  }
});
postponedBridge.tick(.1, postponedSnapshot, { blockedNpcIds: [memberNpcIds[2]] });
postponedSnapshot.tick = 701;
postponedBridge.tick(.1, postponedSnapshot, { blockedNpcIds: [memberNpcIds[2]] });
postponedSnapshot.tick = 702;
postponedBridge.tick(.1, postponedSnapshot, { blockedNpcIds: [memberNpcIds[2]] });
const postponedState = postponedBridge.status();
assert.equal(postponedState.phase, 'IDLE');
assert.equal(postponedState.pendingRegularMeetings.length, 0);
assert.equal(postponedState.lastOutcome?.outcome, 'POSTPONED_QUORUM');
assert.deepEqual(postponedState.lastOutcome?.attendance, {
  invitedNpcIds: memberNpcIds,
  attendedNpcIds: memberNpcIds.slice(0, 2),
  onTimeNpcIds: memberNpcIds.slice(0, 2),
  lateNpcIds: [],
  absentNpcIds: memberNpcIds.slice(2)
});
assert.deepEqual(postponedOutcomes[0], {
  groupId: socialSnapshot.groups[0].groupId,
  outcome: 'POSTPONED_QUORUM',
  attendance: postponedState.lastOutcome.attendance,
  tick: 702
});
assert.equal(postponedSnapshot.groups[0].nextMeetingTick, 822,
  'quorum failure postpones the meeting to the next cadence instead of retrying every tick');

const quorumNavigatorBase = createNpcNavigator(batch);
const quorumRoster = createPurposefulRoster(batch, quorumNavigatorBase, { speed: 8 });
const quorumMemberIds = [...quorumRoster.entries()]
  .filter(([, value]) => value.controller.status(false).visible)
  .slice(0, 6)
  .map(([id]) => id);
assert.equal(quorumMemberIds.length, 6, 'quorum route test requires six visible NPCs');
const routeAllowedStarts = new Set(quorumMemberIds.slice(0, 3).map(id => {
  const position = quorumRoster.get(id).controller.status(false).position;
  return `${position.x.toFixed(3)}:${position.z.toFixed(3)}`;
}));
const quorumNavigator = {
  walkable: () => true,
  route: (from, to) => routeAllowedStarts.has(`${from.x.toFixed(3)}:${from.z.toFixed(3)}`) ? [{ ...to }] : null
};
const quorumSnapshot = {
  tick: 900,
  groups: [{
    groupId: 'npc-group-ng15-quorum-route',
    status: 'ACTIVE',
    primaryInterest: 'TECH',
    leaderNpcId: quorumMemberIds[0],
    memberNpcIds: quorumMemberIds,
    cohesion: 80,
    activity: 95,
    meetingPlaceRef: 'inkyung_walkway',
    meetingCadenceTicks: 120,
    lastMeetingTick: null,
    lastMeetingOutcome: null,
    nextMeetingTick: 900
  }]
};
const quorumBridge = createNpcSocialNg15Bridge({
  roster: quorumRoster,
  navigator: quorumNavigator,
  positionAtFn: (_location, slot) => ({ x: slot * 1.5, z: 0 }),
  travelBudgetKind: 'REGULAR_GROUP',
  maxTravelSeconds: 100000,
  assembleTimeoutSeconds: 100001
});
quorumBridge.tick(.1, quorumSnapshot);
const quorumState = quorumBridge.status();
assert.equal(quorumState.phase, 'ASSEMBLING',
  'regular meetup starts when the route-capable attendees satisfy quorum');
assert.deepEqual(quorumState.active.memberNpcIds, quorumMemberIds.slice(0, 3));
assert.deepEqual(quorumState.active.attendance.attendedNpcIds, quorumMemberIds.slice(0, 3));
assert.deepEqual(quorumState.active.attendance.absentNpcIds, quorumMemberIds.slice(3),
  'route-ineligible invitees are recorded absent instead of cancelling the whole meetup');

const budgetNavigator = createNpcNavigator(batch);
const budgetRoster = createPurposefulRoster(batch, budgetNavigator, { speed: 8 });
const budgetLimited = createNpcSocialNg15Bridge({
  roster: budgetRoster,
  navigator: budgetNavigator,
  maxTravelSeconds: .001,
  assembleTimeoutSeconds: 20
});
budgetLimited.tick(.1, socialSnapshot);
assert.equal(budgetLimited.status().phase, 'IDLE',
  'NG1.5 rejects reachable-looking venues that exceed the route-time travel budget');


let impossibleRouteCalls = 0;
const lowerBoundNavigator = {
  walkable: () => true,
  route: () => {
    impossibleRouteCalls++;
    return [{ x: 10000, z: 10000 }];
  }
};
const lowerBoundRoster = createPurposefulRoster(batch, createNpcNavigator(batch), { speed: 8 });
const lowerBoundBridge = createNpcSocialNg15Bridge({
  roster: lowerBoundRoster,
  navigator: lowerBoundNavigator,
  positionAtFn: (_location, slot) => ({ x: 10000 + slot, z: 10000 }),
  maxTravelSeconds: .001,
  assembleTimeoutSeconds: 20
});
lowerBoundBridge.tick(.1, socialSnapshot);
assert.equal(impossibleRouteCalls, 0,
  'NG1.5 rejects straight-line-impossible candidates before invoking route search');

console.log('NPC Social NG1.5: shared clock, route-time radius, zone meetup and resume PASS');
