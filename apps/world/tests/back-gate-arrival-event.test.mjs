import test from 'node:test';
import assert from 'node:assert/strict';
import { BACK_GATE_SPAWN } from '../src/campus-spawn.js';
import {
  BACK_GATE_ARRIVAL_DURATION, BACK_GATE_ARRIVAL_RADIUS, BACK_GATE_STREET_FOCUS, backGateArrivalBeat,
  backGateArrivalCameraPose, backGateArrivalFov, shouldStartBackGateArrival
} from '../src/back-gate-arrival-event.js';

test('BG01 starts on the first Back Gate arrival after Main 1 unlocks Main 2', () => {
  const ready = { main1Complete: true, main2Available: true, main2Stage: 0, distance: BACK_GATE_ARRIVAL_RADIUS - 0.1 };
  assert.equal(shouldStartBackGateArrival(ready), true);
  assert.equal(shouldStartBackGateArrival({ ...ready, main1Complete: false }), false);
  assert.equal(shouldStartBackGateArrival({ ...ready, main2Available: false }), false);
  assert.equal(shouldStartBackGateArrival({ ...ready, main2Stage: 1 }), false, 'started Main 2 does not replay BG01');
  assert.equal(shouldStartBackGateArrival({ ...ready, main2Stage: 9 }), false, 'completed Main 2 does not replay BG01');
  assert.equal(shouldStartBackGateArrival({ ...ready, distance: BACK_GATE_ARRIVAL_RADIUS + 0.1 }), false);
  assert.equal(shouldStartBackGateArrival({ ...ready, alreadyPlayed: true }), false);
  assert.equal(shouldStartBackGateArrival({ preview: true }), true);
});

test('BG01 cinematic stops at the guide line: arrival -> clean outlook -> guide', () => {
  assert.equal(backGateArrivalBeat(0), 'ARRIVAL');
  assert.equal(backGateArrivalBeat(1.2), 'OUTLOOK');
  assert.equal(backGateArrivalBeat(4.8), 'GUIDE');
  assert.equal(backGateArrivalBeat(BACK_GATE_ARRIVAL_DURATION), 'DONE');
});

test('BG01 camera crosses the gate, cranes out for a road/commercial wide shot, then returns to the guide', () => {
  const start = backGateArrivalCameraPose(0);
  const crossed = backGateArrivalCameraPose(1.25);
  const wide = backGateArrivalCameraPose(4.65);
  const guide = backGateArrivalCameraPose(BACK_GATE_ARRIVAL_DURATION);
  const dx = BACK_GATE_STREET_FOCUS.x - BACK_GATE_SPAWN.x;
  const dz = BACK_GATE_STREET_FOCUS.z - BACK_GATE_SPAWN.z;
  const length = Math.hypot(dx, dz);
  const ux = dx / length, uz = dz / length;
  const along = p => (p.x - BACK_GATE_SPAWN.x) * ux + (p.z - BACK_GATE_SPAWN.z) * uz;

  assert.ok(along(start.pos) < 0, 'camera starts on campus side');
  assert.ok(along(crossed.pos) > 0, 'camera physically crosses the Back Gate');
  assert.ok(wide.pos.y > crossed.pos.y + 6, 'wide shot cranes upward');
  assert.ok(Math.hypot(wide.pos.x - crossed.pos.x, wide.pos.z - crossed.pos.z) > 6, 'wide shot pulls away laterally');
  assert.ok(Math.hypot(wide.look.x - BACK_GATE_STREET_FOCUS.x, wide.look.z - BACK_GATE_STREET_FOCUS.z) < 0.01);
  assert.ok(Math.hypot(guide.look.x - BACK_GATE_SPAWN.x, guide.look.z - BACK_GATE_SPAWN.z) <
    Math.hypot(wide.look.x - BACK_GATE_SPAWN.x, wide.look.z - BACK_GATE_SPAWN.z),
    'final beat returns attention to the guide');
});

test('BG01 lens widens for the exterior establishing shot and returns to normal for dialogue', () => {
  assert.equal(backGateArrivalFov(0, 62), 62);
  assert.ok(backGateArrivalFov(4.65, 62) >= 77.9, 'outlook is visibly zoomed out');
  assert.ok(Math.abs(backGateArrivalFov(BACK_GATE_ARRIVAL_DURATION, 62) - 62) < 1e-9,
    'dialogue hand-off restores the normal lens');
});
