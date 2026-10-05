import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcSocialSimulation } from './npc-social-sim.mjs';
import { createNpcSocialGroupFeasibility } from './npc-social-group-feasibility.mjs';
import { createNpcNavigator } from './dev-navigation.mjs';
import { createPurposefulRoster } from './purposeful-roster.mjs';
import { mergeCampusPopulation } from './npc-campus-expansion.mjs';

const syntheticNpcs = Array.from({ length: 6 }, (_, index) => {
  const id = `TEST-NPC-${index + 1}`;
  return {
    npc_id: id,
    identity: { name: id },
    personality: {
      traits: index === 0 ? ['curious', 'cheerful'] : ['patient'],
      social_energy: index === 0 ? 1 : .72,
      talkativeness: index === 0 ? 1 : .7,
      routine_preference: .3
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
  batch_id: 'P2-B2-SYNTHETIC',
  schema_version: '0.1',
  zone: 'TEST',
  npc_count: syntheticNpcs.length,
  npcs: syntheticNpcs
};

const validationCalls = [];
const sim = createNpcSocialSimulation(synthetic, {
  seed: 'p2-b2-relationship-routing',
  naturalGroupTarget: 1,
  groupLimit: 1,
  minGroupSize: 3,
  maxGroupSize: 3,
  formationAffinity: 2,
  joinAffinity: 100,
  initialAffinityProvider: () => 5,
  relationshipPreferenceProvider: ({ npcA, npcB }) => {
    const pair = new Set([npcA.npc_id, npcB.npc_id]);
    if (pair.has('TEST-NPC-1') && pair.has('TEST-NPC-2')) return 16;
    if (pair.has('TEST-NPC-1') && pair.has('TEST-NPC-4')) return 15;
    if (pair.has('TEST-NPC-1') && pair.has('TEST-NPC-5')) return 14;
    return 0;
  },
  groupCandidateValidator: ({ memberNpcIds, primaryInterest }) => {
    validationCalls.push([...memberNpcIds]);
    if (memberNpcIds.includes('TEST-NPC-2')) return { ok: false, reason: 'NO_COMMON_ROUTE' };
    return { ok: true, meetingLocation: 'test-route', primaryInterest };
  }
});
const result = sim.run(80);
const live = result.groups.find(group => group.status !== 'DISSOLVED');
assert.ok(live, 'P2-B2 synthetic relation graph should form one route-valid group');
assert.equal(live.leaderNpcId, 'TEST-NPC-1',
  'highest-initiative NPC remains the deterministic group leader');
assert.deepEqual(live.memberNpcIds, ['TEST-NPC-1', 'TEST-NPC-4', 'TEST-NPC-5'],
  'relationship preference chooses close candidates while the route gate removes an unreachable higher preference');
assert.ok(validationCalls.some(ids => ids.includes('TEST-NPC-2')),
  'P2-B2 must actually consult the route gate before accepting relationship-ranked candidates');
const created = result.recentEvents.find(event => event.type === 'GROUP_CREATED');
assert.equal(created?.relationshipRouted, true);
assert.equal(created?.routeMeetingLocation, 'test-route');

const baseBatch = JSON.parse(readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url), 'utf8'));
const baseRoster = JSON.parse(readFileSync(new URL('./data/fixtures/public-roster.json', import.meta.url), 'utf8'));
const expansion = JSON.parse(readFileSync(new URL('./data/expansion/CAMPUS-28-P2A.json', import.meta.url), 'utf8'));
const merged = mergeCampusPopulation(baseBatch, baseRoster, expansion);
const navigator = createNpcNavigator(merged.batch);
const purposeful = createPurposefulRoster(merged.batch, navigator, { speed: 8 });
// P2-B2 deliberately waits for stable ACTING states before creating a new relationship group.
// Settle the real 48-NPC controllers instead of treating their initial commute as meetup-ready.
for (let step = 0; step < 600; step++) {
  for (const { controller } of purposeful.values()) controller.tick(.1);
  const stableCount = [...purposeful.values()].filter(({ controller }) => {
    const state = controller.status(false);
    return state.visible && state.phase === 'ACTING';
  }).length;
  if (stableCount >= 3) break;
}
const routeGate = createNpcSocialGroupFeasibility({ roster: purposeful, navigator });
const visibleIds = [...purposeful.entries()]
  .filter(([, value]) => {
    const state = value.controller.status(false);
    return state.visible && state.phase === 'ACTING';
  })
  .slice(0, 3)
  .map(([id]) => id);
assert.equal(visibleIds.length, 3, 'P2-B2 route test requires three stable visible 48-population NPCs');
const feasible = routeGate({ memberNpcIds: visibleIds, primaryInterest: 'TECH' });
assert.equal(feasible.ok, true,
  `three visible campus NPCs need at least one common regular-meeting route: ${JSON.stringify(feasible)}`);
assert.ok(feasible.maxTravelSeconds <= 90);
assert.equal(typeof feasible.meetingLocation, 'string');

const hiddenId = [...purposeful.entries()]
  .find(([, value]) => !value.controller.status(false).visible)?.[0];
assert.ok(hiddenId, '48-population fixture needs one off-zone NPC for availability rejection');
const unavailable = routeGate({
  memberNpcIds: [visibleIds[0], visibleIds[1], hiddenId],
  primaryInterest: 'TECH'
});
assert.deepEqual(unavailable, { ok: false, reason: 'MEMBER_UNAVAILABLE' },
  'route gate refuses groups containing an off-zone member instead of creating an impossible future meetup');

console.log('NPC Social P2-B2: relationship-ranked groups are physical-route gated PASS');


let cachedRouteCalls = 0;
const cacheRoster = new Map(['A', 'B', 'C'].map((id, index) => [id, {
  moveSpeed: 2,
  controller: {
    status: () => ({
      visible: true,
      interrupted: false,
      paused: false,
      phase: 'ACTING',
      position: { x: index * 2, z: 0 }
    })
  }
}]));
const cacheNavigator = {
  walkable: () => true,
  route: (_from, to) => {
    cachedRouteCalls++;
    return [{ ...to }];
  }
};
const cacheGate = createNpcSocialGroupFeasibility({
  roster: cacheRoster,
  navigator: cacheNavigator,
  positionAtFn: (_location, slot) => ({ x: 20 + slot * 2, z: 0 }),
  maxTravelSeconds: 100,
  maxSlots: 6
});
const cacheArgs = { memberNpcIds: ['A', 'B', 'C'], primaryInterest: 'TECH', tick: 10 };
assert.equal(cacheGate(cacheArgs).ok, true);
const firstRouteCalls = cachedRouteCalls;
assert.ok(firstRouteCalls > 0);
assert.equal(cacheGate(cacheArgs).ok, true);
assert.equal(cachedRouteCalls, firstRouteCalls,
  'identical stationary group feasibility reuses the complete route result');
assert.equal(cacheGate({ ...cacheArgs, memberNpcIds: ['A', 'C', 'B'] }).ok, true);
assert.equal(cachedRouteCalls, firstRouteCalls,
  'group cache canonicalizes member ordering');
assert.equal(cacheGate({ ...cacheArgs, tick: 11 }).ok, true);
assert.equal(cachedRouteCalls, firstRouteCalls,
  'social tick changes alone do not invalidate routes while physical state is unchanged');

cacheRoster.get('C').controller.status = () => ({
  visible: true,
  interrupted: false,
  paused: false,
  phase: 'ACTING',
  position: { x: 8, z: 0 }
});
assert.equal(cacheGate({ ...cacheArgs, tick: 12 }).ok, true);
assert.ok(cachedRouteCalls > firstRouteCalls,
  'moving a member changes the physical-state fingerprint and triggers fresh route validation');

cacheRoster.get('B').controller.status = () => ({
  visible: true,
  interrupted: false,
  paused: false,
  phase: 'MOVING',
  position: { x: 2, z: 0 }
});
assert.deepEqual(cacheGate({ ...cacheArgs, tick: 13 }), { ok: false, reason: 'MEMBER_UNAVAILABLE' },
  'new relationship groups wait for members to reach a stable ACTING state before route planning');
