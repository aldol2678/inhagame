import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PERIODS, snapshotForPeriod, validateDevCandidate } from './dev-runtime-state.mjs';
import { advanceRoute, createNpcNavigator } from './dev-navigation.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const batch = validateDevCandidate(JSON.parse(readFileSync(join(root, 'data/repaired/INKYUNG-20-A-R1.json'), 'utf8')));
const navigator = createNpcNavigator(batch);
const snapshots = PERIODS.map(period => snapshotForPeriod(batch, period));
const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
let transitions = 0, roamingLegs = 0;

for (const snapshot of snapshots) {
  for (const actor of snapshot.actors) {
    if (!actor.position) continue;
    assert.equal(navigator.walkable(actor.position), true, `${snapshot.period}/${actor.id} anchor blocked`);
    if (!new Set(['walk', 'walk_to_class', 'walk_to_club', 'leave_zone', 'idle', 'wait']).has(actor.activity)) continue;
    const route = navigator.wanderRoute(actor.position, actor.position, actor.id, 0);
    assert.ok(route?.length, `${snapshot.period}/${actor.id} cannot roam`);
    let position = { ...actor.position };
    for (const waypoint of route) {
      assert.equal(navigator.segmentSafe(position, waypoint), true, `${snapshot.period}/${actor.id} roam crosses a collider`);
      position = waypoint;
    }
    assert.ok(pointDistance(actor.position, position) > 2, `${snapshot.period}/${actor.id} stayed in place`);
    position = { ...actor.position };
    const steps = [...route];
    for (let tick = 0; steps.length && tick < 300; tick++) {
      const next = advanceRoute(position, steps, .2);
      assert.ok(next.moved > 0 && next.moved <= .201);
      assert.equal(navigator.segmentSafe(position, next.position), true, `${snapshot.period}/${actor.id} movement crosses a collider`);
      position = next.position;
    }
    assert.equal(steps.length, 0, `${snapshot.period}/${actor.id} did not arrive`);
    roamingLegs++;
  }
}

for (let index = 0; index < snapshots.length; index++) {
  const current = snapshots[index], next = snapshots[(index + 1) % snapshots.length];
  for (const actor of current.actors) {
    if (!actor.position) continue;
    const destination = next.actors.find(other => other.id === actor.id)?.position;
    if (!destination) continue;
    const route = navigator.route(actor.position, destination);
    assert.ok(route?.length, `${current.period}->${next.period}/${actor.id} has no route`);
    let position = actor.position;
    for (const waypoint of route) {
      assert.equal(navigator.segmentSafe(position, waypoint), true, `${current.period}->${next.period}/${actor.id} crosses a collider`);
      position = waypoint;
    }
    assert.ok(pointDistance(position, destination) < .001);
    if (new Set(['walk', 'walk_to_class', 'walk_to_club', 'leave_zone', 'idle', 'wait']).has(actor.activity)) {
      const detour = navigator.wanderRoute(actor.position, actor.position, actor.id, 0);
      const roamingPosition = detour.at(-1);
      const reroute = navigator.route(roamingPosition, destination);
      assert.ok(reroute?.length, `${current.period}->${next.period}/${actor.id} cannot depart its roaming position`);
      let point = roamingPosition;
      for (const waypoint of reroute) {
        assert.equal(navigator.segmentSafe(point, waypoint), true, `${current.period}->${next.period}/${actor.id} roaming transition crosses a collider`);
        point = waypoint;
      }
    }
    transitions++;
  }
}

console.log(`C04 navigation: ${roamingLegs} roaming legs and ${transitions} period transitions safely traversed: PASS`);
