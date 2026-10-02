import assert from 'node:assert/strict';
import { campusStudentDestinations } from './purposeful-student-destinations.mjs';
import { createNpcNavigator } from './dev-navigation.mjs';
import { createPurposefulStudent, STUDENT_SCHEDULE } from './purposeful-student-state.mjs';

const destinations = campusStudentDestinations();
const spawn = destinations['poi.main-gate'].position;
const navigator = createNpcNavigator(null, {
  additionalAnchors: [spawn, ...Object.values(destinations).map(p => p.position)]
});
assert.equal(Object.keys(destinations).length, 4);
assert.equal(STUDENT_SCHEDULE.length, 5);
for (const entry of STUDENT_SCHEDULE) {
  assert.ok(entry.need && entry.goal && entry.activity);
  assert.ok(navigator.walkable(destinations[entry.destination].position));
}
const student = createPurposefulStudent({ spawn, destinations, navigator, speed: 12 });
assert.equal(student.status().currentGoal, 'ATTEND_CLASS');
assert.equal(student.status().destination, 'poi.main-hall');
const hiddenAt = [];
const reemergedAt = [];
let restedAtBench = false;
for (let i = 0; i < 1000 && student.status().phase !== 'DONE'; i++) {
  const before = student.status(false);
  const after = student.tick(.5);
  if (before.visible && !after.visible) hiddenAt.push({ goal: after.currentGoal, position: after.position });
  if (!before.visible && after.visible) reemergedAt.push({ goal: after.currentGoal, position: after.position });
  if (after.phase === 'ACTING' && after.activity === 'RESTING' && after.visible) restedAtBench = true;
}
const complete = student.status();
assert.equal(complete.phase, 'DONE');
assert.equal(complete.scheduleIndex, 5);
assert.equal(complete.failures, 0);
assert.deepEqual(complete.position, spawn);
assert.deepEqual(complete.history.filter(item => item.event === 'ACTING').map(item => item.goal),
  ['ATTEND_CLASS', 'EAT', 'REST', 'ATTEND_CLASS', 'LEAVE_CAMPUS']);
assert.equal(complete.history.filter(item => item.event === 'ARRIVED').length, 5);
assert.equal(complete.history.filter(item => item.event === 'ACTIVITY_COMPLETE').length, 5);
assert.ok(complete.history.every(item => item.event === 'DONE' || item.goal && item.destination));
assert.deepEqual(hiddenAt.map(item => item.goal), ['ATTEND_CLASS', 'EAT', 'ATTEND_CLASS']);
assert.deepEqual(hiddenAt[0].position, destinations['poi.main-hall'].position);
assert.deepEqual(hiddenAt[1].position, destinations['poi.student-center'].position);
assert.deepEqual(reemergedAt.map(item => item.goal), ['EAT', 'REST', 'LEAVE_CAMPUS']);
assert.deepEqual(reemergedAt[0].position, destinations['poi.main-hall'].position);
assert.ok(restedAtBench, 'outdoor rest stays visible');

const noRoute = createPurposefulStudent({ spawn, destinations,
  navigator: { walkable: () => true, route: () => null } });
assert.equal(noRoute.status().phase, 'FAILED');
assert.equal(noRoute.status().failures, 1);
assert.deepEqual(noRoute.status().position, spawn);

const stalled = createPurposefulStudent({ spawn, destinations,
  navigator: { walkable: () => true, route: () => [{ ...spawn }] } });
stalled.tick(13);
assert.equal(stalled.status().phase, 'FAILED');
assert.equal(stalled.status().history.at(-1).event, 'MOVEMENT_TIMEOUT');
console.log('Purposeful student schedule, POIs, arrival/activity/exit and recovery PASS');
