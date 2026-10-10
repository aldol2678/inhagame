// Main Gate / Dormitory 1 junction signal timing. Presentation-level only: no vehicles consume it,
// so the goal is a believable, deterministic, conflict-free cycle (not a traffic-code simulation).
//
// Groups: A = Sosung-ro through traffic (both directions), B = Main Gate approach traffic.
// Pedestrians cross Sosung-ro on the two zebra crossings and only get WALK while every vehicle
// group is red, so no phase can ever show a vehicle green together with a pedestrian walk.
//
// One shared controller owns the cycle. State is a pure function of simulation-elapsed seconds, so
// it never depends on frame rate, never uses randomness and every signal head reads the same state.

export const TRAFFIC_SIGNAL_GROUPS = Object.freeze(['A', 'B']);

const allRed = { A: 'red', B: 'red' };

export const TRAFFIC_SIGNAL_PLAN = Object.freeze({
  id: 'main_gate_sosung',
  phases: Object.freeze([
    { id: 'A_GREEN', kind: 'green', seconds: 14, vehicle: { A: 'green', B: 'red' }, pedestrian: 'stop' },
    { id: 'A_AMBER', kind: 'amber', seconds: 3, vehicle: { A: 'amber', B: 'red' }, pedestrian: 'stop' },
    { id: 'ALL_RED_TO_B', kind: 'all-red', seconds: 2, vehicle: allRed, pedestrian: 'stop' },
    { id: 'B_GREEN', kind: 'green', seconds: 8, vehicle: { A: 'red', B: 'green' }, pedestrian: 'stop' },
    { id: 'B_AMBER', kind: 'amber', seconds: 3, vehicle: { A: 'red', B: 'amber' }, pedestrian: 'stop' },
    { id: 'ALL_RED_TO_PED', kind: 'all-red', seconds: 2, vehicle: allRed, pedestrian: 'stop' },
    { id: 'PED_WALK', kind: 'pedestrian', seconds: 9, vehicle: allRed, pedestrian: 'walk' },
    // Flashing don't-walk: the stop lens blinks while pedestrians clear the crossing.
    { id: 'PED_CLEAR', kind: 'pedestrian', seconds: 4, vehicle: allRed, pedestrian: 'clear' },
    { id: 'ALL_RED_TO_A', kind: 'all-red', seconds: 2, vehicle: allRed, pedestrian: 'stop' }
  ].map(phase => Object.freeze({ ...phase, vehicle: Object.freeze({ ...phase.vehicle }) })))
});

export const TRAFFIC_SIGNAL_PED_BLINK_HZ = 2;

export function trafficSignalCycleSeconds(plan = TRAFFIC_SIGNAL_PLAN) {
  return plan.phases.reduce((sum, phase) => sum + phase.seconds, 0);
}

export function normalizeSignalElapsed(elapsed, plan = TRAFFIC_SIGNAL_PLAN) {
  const cycle = trafficSignalCycleSeconds(plan);
  if (!Number.isFinite(elapsed)) return 0;
  const wrapped = elapsed % cycle;
  return wrapped < 0 ? wrapped + cycle : wrapped;
}

export function trafficSignalStateAt(elapsed, plan = TRAFFIC_SIGNAL_PLAN) {
  const cycleSeconds = trafficSignalCycleSeconds(plan);
  const cycleElapsed = normalizeSignalElapsed(elapsed, plan);
  let start = 0;
  let phaseIndex = plan.phases.length - 1;
  for (let i = 0; i < plan.phases.length; i++) {
    if (cycleElapsed < start + plan.phases[i].seconds) {
      phaseIndex = i;
      break;
    }
    start += plan.phases[i].seconds;
  }
  const phase = plan.phases[phaseIndex];
  const phaseElapsed = Math.min(phase.seconds, Math.max(0, cycleElapsed - start));
  // Blink frame is derived from the phase clock, never from wall time, so it stays deterministic.
  const blinkOn = Math.floor(phaseElapsed * TRAFFIC_SIGNAL_PED_BLINK_HZ) % 2 === 0;
  return Object.freeze({
    planId: plan.id,
    phaseIndex,
    phaseId: phase.id,
    kind: phase.kind,
    cycleSeconds,
    cycleElapsed,
    phaseElapsed,
    phaseRemaining: phase.seconds - phaseElapsed,
    vehicle: phase.vehicle,
    pedestrian: phase.pedestrian,
    // Lens-level view for renderers: exactly one pedestrian lens is lit, except the dark half of a blink.
    pedestrianLens: Object.freeze({
      stop: phase.pedestrian === 'stop' || (phase.pedestrian === 'clear' && blinkOn),
      walk: phase.pedestrian === 'walk'
    })
  });
}

// Conflict rules the plan must satisfy in every phase; used by tests and as a runtime assert.
export function trafficSignalConflicts(state) {
  const conflicts = [];
  const live = TRAFFIC_SIGNAL_GROUPS.filter(group => state.vehicle[group] !== 'red');
  if (live.length > 1) conflicts.push(`vehicle groups ${live.join('+')} both released`);
  if (state.pedestrian === 'walk' && live.length) {
    conflicts.push(`pedestrian walk while vehicle group ${live.join('+')} is ${live.map(g => state.vehicle[g]).join('+')}`);
  }
  if (state.pedestrianLens.walk && state.pedestrianLens.stop) conflicts.push('pedestrian walk and stop lit together');
  return conflicts;
}

export function createTrafficSignalController({ plan = TRAFFIC_SIGNAL_PLAN, elapsed = 0 } = {}) {
  let time = normalizeSignalElapsed(elapsed, plan);
  return Object.freeze({
    plan,
    advance(dt) {
      if (Number.isFinite(dt) && dt > 0) time = normalizeSignalElapsed(time + dt, plan);
      return trafficSignalStateAt(time, plan);
    },
    // Absolute positioning for clock-driven callers: the cycle then follows the clock, not frame dt.
    seek(elapsedSeconds) {
      time = normalizeSignalElapsed(elapsedSeconds, plan);
      return trafficSignalStateAt(time, plan);
    },
    state: () => trafficSignalStateAt(time, plan),
    elapsed: () => time
  });
}
