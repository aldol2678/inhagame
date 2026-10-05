import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcNavigator } from './dev-navigation.mjs';
import { PULSE_PERIODS, snapshotForPeriod } from './dev-runtime-state.mjs';
import { MAIN_NPC_ID, QUEST_NPC_ID } from './npc-presence.mjs';
import { createPurposefulRoster } from './purposeful-roster.mjs';
import { PURPOSEFUL_BEHAVIOR_BY_NPC, PURPOSEFUL_BEHAVIOR_PROFILES } from './purposeful-behavior.mjs';

const batch = JSON.parse(readFileSync(new URL('./data/repaired/INKYUNG-20-A-R1.json', import.meta.url)));
const navigator = createNpcNavigator(batch);
const roster = createPurposefulRoster(batch, navigator, { duration: 1, speed: 8 });
assert.equal(roster.size, 18);
assert.equal(roster.has(MAIN_NPC_ID), false);
assert.equal(roster.has(QUEST_NPC_ID), false);
assert.equal(Object.keys(PURPOSEFUL_BEHAVIOR_BY_NPC).length, 18);
assert.equal(PURPOSEFUL_BEHAVIOR_BY_NPC[MAIN_NPC_ID], undefined);
assert.equal(PURPOSEFUL_BEHAVIOR_BY_NPC[QUEST_NPC_ID], undefined);
assert.equal(PURPOSEFUL_BEHAVIOR_BY_NPC['INKYUNG-NPC-003'], 'STANDARD_ROAMER');
assert.equal(PURPOSEFUL_BEHAVIOR_BY_NPC['INKYUNG-NPC-012'], 'AMENITY_SEEKER');
assert.ok(PURPOSEFUL_BEHAVIOR_PROFILES.LONG_STAY_SITTER.speedMultiplier <
  PURPOSEFUL_BEHAVIOR_PROFILES.STANDARD_ROAMER.speedMultiplier);
assert.ok(PURPOSEFUL_BEHAVIOR_PROFILES.ACTIVE_PROMOTER.speedMultiplier >
  PURPOSEFUL_BEHAVIOR_PROFILES.STANDARD_ROAMER.speedMultiplier);
const representedBehaviors = new Set([...roster.values()].map(({ behavior }) => behavior.id));
assert.deepEqual(representedBehaviors, new Set([
  'STANDARD_ROAMER', 'LONG_STAY_SITTER', 'AMENITY_SEEKER', 'ACTIVE_PROMOTER'
]));
for (const id of ['INKYUNG-NPC-016', 'INKYUNG-NPC-018', 'INKYUNG-NPC-020']) {
  assert.ok(roster.has(id), `${id} has no pulse controller`);
}
for (const { controller, schedule, destinations, behavior } of roster.values()) {
  assert.ok(behavior?.id);
  assert.equal(schedule.length, PULSE_PERIODS.length);
  for (const entry of schedule) {
    assert.ok(entry.need && entry.goal && entry.activity);
    assert.ok(navigator.walkable(destinations[entry.destination].position));
  }
  const initial = controller.status(false);
  assert.equal(initial.visible, !schedule[0].sink);
  assert.equal(initial.phase, schedule[0].sink ? 'ACTING' : 'MOVING');
  assert.throws(() => controller.setScheduleIndex(-1));
  assert.throws(() => controller.setScheduleIndex(schedule.length));
}

const seenHidden = new Set();
const seenReentry = new Set();
for (const [turn, period] of [...PULSE_PERIODS, 'morning'].entries()) {
  const index = turn % PULSE_PERIODS.length;
  const snapshot = snapshotForPeriod(batch, period);
  for (const [id, { controller, schedule }] of roster) {
    const before = controller.status(false);
    const after = controller.setScheduleIndex(index);
    assert.equal(after.scheduleIndex, index, `${period}/${id} did not select its band`);
    assert.equal(Boolean(schedule[index].sink), !snapshot.actors.find(actor => actor.id === id).position);
    if (!before.visible && after.visible) seenReentry.add(id);
  }
  for (let step = 0; step < 600; step++) {
    for (const [id, { controller }] of roster) {
      const before = controller.status(false);
      const after = controller.tick(.1);
      if (!after.visible) seenHidden.add(id);
      if (!before.visible && after.visible) seenReentry.add(id);
    }
  }
  const visible = [...roster.values()].filter(({ controller }) => controller.status(false).visible).length + 2;
  assert.equal(visible, snapshot.localCount, `${period} did not reach its population target`);
  const occupied = snapshot.actors.filter(actor => [MAIN_NPC_ID, QUEST_NPC_ID].includes(actor.id))
    .map(actor => ({ id: actor.id, position: actor.position }));
  for (const [id, { controller }] of roster) {
    const state = controller.status(false);
    if (state.visible) occupied.push({ id, position: state.position });
  }
  for (let a = 0; a < occupied.length; a++) for (let b = a + 1; b < occupied.length; b++) {
    const first = occupied[a], second = occupied[b];
    const separation = Math.hypot(first.position.x - second.position.x, first.position.z - second.position.z);
    assert.ok(separation >= 1.1, `${period}: ${first.id} and ${second.id} overlap (${separation.toFixed(2)})`);
  }
  for (const [id, { controller }] of roster) {
    const state = controller.status(false);
    assert.equal(state.failures, 0, `${period}/${id} route failed`);
    assert.equal(state.phase, 'ACTING', `${period}/${id} did not reach its destination`);
    assert.equal(state.scheduleIndex, index, `${period}/${id} advanced without a clock change`);
  }
}
for (const [id, { schedule }] of roster) {
  if (!schedule.some(entry => entry.sink)) continue;
  assert.ok(seenHidden.has(id), `${id} never left the outdoor scene`);
  if (schedule.some(entry => !entry.sink)) assert.ok(seenReentry.has(id), `${id} never re-entered`);
}
console.log('Purposeful roster: 18 NPCs use four behavior profiles, follow five pulse bands and sink/re-enter; quest NPCs protected: PASS');
