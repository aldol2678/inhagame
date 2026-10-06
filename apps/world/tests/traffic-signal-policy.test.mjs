import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRAFFIC_SIGNAL_GROUPS,
  TRAFFIC_SIGNAL_PLAN,
  createTrafficSignalController,
  normalizeSignalElapsed,
  trafficSignalConflicts,
  trafficSignalCycleSeconds,
  trafficSignalStateAt
} from '../src/traffic-signal-policy.js';

const phaseStart = id => {
  let start = 0;
  for (const phase of TRAFFIC_SIGNAL_PLAN.phases) {
    if (phase.id === id) return start;
    start += phase.seconds;
  }
  throw new Error(id);
};

test('signal cycle runs green, amber, all-red, then the opposing green, deterministically', () => {
  const ids = TRAFFIC_SIGNAL_PLAN.phases.map(phase => phase.id);
  assert.deepEqual(ids.slice(0, 4), ['A_GREEN', 'A_AMBER', 'ALL_RED_TO_B', 'B_GREEN']);
  assert.deepEqual(ids.slice(4, 6), ['B_AMBER', 'ALL_RED_TO_PED']);
  assert.equal(new Set(ids).size, ids.length, 'phase ids are unique');

  const at = seconds => trafficSignalStateAt(seconds);
  assert.deepEqual({ ...at(1).vehicle }, { A: 'green', B: 'red' });
  assert.deepEqual({ ...at(phaseStart('A_AMBER') + 1).vehicle }, { A: 'amber', B: 'red' });
  assert.deepEqual({ ...at(phaseStart('ALL_RED_TO_B') + 1).vehicle }, { A: 'red', B: 'red' });
  assert.deepEqual({ ...at(phaseStart('B_GREEN') + 1).vehicle }, { A: 'red', B: 'green' });
  assert.deepEqual({ ...at(phaseStart('B_AMBER') + 1).vehicle }, { A: 'red', B: 'amber' });
  assert.deepEqual(at(12.34), at(12.34));
});

test('the cycle repeats and is a pure function of elapsed seconds', () => {
  const cycle = trafficSignalCycleSeconds();
  assert.equal(cycle, TRAFFIC_SIGNAL_PLAN.phases.reduce((sum, phase) => sum + phase.seconds, 0));
  for (const t of [0, 0.5, 13.9, 14, 17.2, 33.3, cycle - 0.01]) {
    const a = trafficSignalStateAt(t);
    const b = trafficSignalStateAt(t + cycle * 3);
    assert.equal(a.phaseId, b.phaseId, `t=${t}`);
    assert.deepEqual({ ...a.vehicle }, { ...b.vehicle });
    assert.equal(a.pedestrian, b.pedestrian);
    assert.ok(Math.abs(a.phaseElapsed - b.phaseElapsed) < 1e-9);
  }
  assert.equal(normalizeSignalElapsed(-1), cycle - 1);
  assert.equal(normalizeSignalElapsed(NaN), 0);
  assert.equal(trafficSignalStateAt(Infinity).phaseId, 'A_GREEN');
});

test('frame rate does not change the cycle: one shared controller, any dt chunking', () => {
  const target = 30.2; // mid-phase, away from every boundary
  const slow = createTrafficSignalController();
  const fast = createTrafficSignalController();
  slow.advance(target);
  for (let i = 0; i < Math.round(target * 60); i++) fast.advance(1 / 60);
  assert.equal(slow.state().phaseId, fast.state().phaseId);
  assert.ok(Math.abs(slow.elapsed() - fast.elapsed()) < 1e-6 + 0.02);
  const ragged = createTrafficSignalController();
  for (const dt of [0.016, 0.2, 0.033, 5, 0.5, -3, NaN, 24.4]) ragged.advance(dt);
  assert.ok(Number.isFinite(ragged.elapsed()));
  assert.ok(ragged.elapsed() >= 0 && ragged.elapsed() < trafficSignalCycleSeconds());
});

test('no sampled instant has conflicting vehicle greens or pedestrian walk against live traffic', () => {
  const cycle = trafficSignalCycleSeconds();
  let sawWalk = false;
  let sawClear = false;
  for (let t = 0; t < cycle * 2; t += 0.05) {
    const state = trafficSignalStateAt(t);
    assert.deepEqual(trafficSignalConflicts(state), [], `t=${t.toFixed(2)} ${state.phaseId}`);
    const live = TRAFFIC_SIGNAL_GROUPS.filter(group => state.vehicle[group] === 'green');
    assert.ok(live.length <= 1);
    if (state.pedestrian === 'walk') {
      sawWalk = true;
      assert.ok(TRAFFIC_SIGNAL_GROUPS.every(group => state.vehicle[group] === 'red'));
      assert.deepEqual({ ...state.pedestrianLens }, { stop: false, walk: true });
    }
    if (state.pedestrian === 'clear') sawClear = true;
    assert.ok(!(state.pedestrianLens.walk && state.pedestrianLens.stop));
  }
  assert.ok(sawWalk && sawClear, 'pedestrians get walk and flashing-clear phases');
});

test('every vehicle green and amber is bracketed by an all-red clearance', () => {
  const phases = TRAFFIC_SIGNAL_PLAN.phases;
  for (let i = 0; i < phases.length; i++) {
    const next = phases[(i + 1) % phases.length];
    const here = phases[i];
    const releases = group => here.vehicle[group] === 'amber' && next.vehicle[group] === 'red';
    if (TRAFFIC_SIGNAL_GROUPS.some(releases)) {
      assert.equal(next.kind, 'all-red', `${here.id} must be followed by all-red`);
    }
    // The next group is never released straight out of the previous group's amber.
    if (here.kind === 'amber') assert.ok(TRAFFIC_SIGNAL_GROUPS.every(g => next.vehicle[g] === 'red'));
  }
});

test('pedestrian stop lens blinks deterministically during the clearance phase', () => {
  const start = phaseStart('PED_CLEAR');
  const lit = [0.1, 0.6, 1.1, 1.6].map(offset => trafficSignalStateAt(start + offset).pedestrianLens.stop);
  assert.deepEqual(lit, [true, false, true, false]);
});

test('seek follows an absolute clock regardless of how often it is sampled', () => {
  const sparse = createTrafficSignalController();
  const dense = createTrafficSignalController();
  sparse.seek(40.2);
  for (let t = 0; t <= 40.2; t += 0.01) dense.seek(t);
  dense.seek(40.2);
  assert.deepEqual(sparse.state(), dense.state());
  assert.equal(sparse.seek(-5).phaseId, trafficSignalStateAt(trafficSignalCycleSeconds() - 5).phaseId);
});
