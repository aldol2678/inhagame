import { advanceRoute } from './dev-navigation.mjs';

export const STUDENT_ID = 'CAMPUS_STUDENT_A001';
export const STUDENT_SCHEDULE = Object.freeze([
  Object.freeze({ need: 'CLASS', goal: 'ATTEND_CLASS', destination: 'poi.main-hall', activity: 'STUDY', duration: 12, sink: true }),
  Object.freeze({ need: 'HUNGER', goal: 'EAT', destination: 'poi.student-center', activity: 'EATING', duration: 12, sink: true }),
  Object.freeze({ need: 'REST', goal: 'REST', destination: 'seat.inkyung-tree-1-a', activity: 'RESTING', duration: 12 }),
  Object.freeze({ need: 'CLASS', goal: 'ATTEND_CLASS', destination: 'poi.main-hall', activity: 'STUDY', duration: 12, sink: true }),
  Object.freeze({ need: 'TRANSIT', goal: 'LEAVE_CAMPUS', destination: 'poi.main-gate', activity: 'EXITING', duration: 5 })
]);

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// The schedule is a demo clock; replacing the caller's tick source with World Time
// does not change the need/goal/destination/activity transitions.
export function createPurposefulStudent({ spawn, destinations, navigator, speed = 2.4,
  schedule = STUDENT_SCHEDULE, id = STUDENT_ID, repeat = false, startHidden = false,
  holdAtActivity = false } = {}) {
  if (!spawn || !navigator || !schedule.length) throw new Error('Student spawn, navigator and schedule required');
  for (const entry of schedule) {
    if (!destinations[entry.destination] || (!entry.remote && !navigator.walkable(destinations[entry.destination].position)))
      throw new Error(`Unwalkable student destination: ${entry.destination}`);
  }
  const state = {
    id, currentNeed: null, currentGoal: null, destination: null,
    phase: 'PLANNING', activity: null, scheduleIndex: 0, position: { x: spawn.x, z: spawn.z },
    heading: 0, moving: false, visible: !startHidden, paused: false, failures: 0, history: []
  };
  let route = [], phaseTime = 0, movingLimit = 0, stalledFor = 0, detour = null, remoteAt = false;
  const record = event => {
    state.history.push({ event, scheduleIndex: state.scheduleIndex,
      goal: state.currentGoal, destination: state.destination });
    if (state.history.length > 120) state.history.shift();
  };
  function recover(reason) {
    state.failures++;
    record(reason);
    // A route failure ends this demo safely at its spawn. No unbounded replanning.
    state.position = { x: spawn.x, z: spawn.z };
    state.phase = 'FAILED';
    state.activity = null;
    state.moving = false;
    remoteAt = false;
    route = [];
  }
  function plan() {
    const entry = schedule[state.scheduleIndex];
    if (!entry && repeat) state.scheduleIndex = 0;
    const current = detour ?? schedule[state.scheduleIndex];
    if (!current) { state.phase = 'DONE'; state.currentNeed = null; state.currentGoal = null;
      state.destination = null; state.activity = null; record('DONE'); return; }
    state.currentNeed = current.need;
    state.currentGoal = current.goal;
    state.destination = current.destination;
    state.activity = null;
    record('GOAL');
    const target = detour ? detour.position : destinations[current.destination].position;
    if (!detour && current.remote) {
      state.position = { ...target };
      state.visible = true;
      state.activity = current.activity;
      state.phase = 'ACTING';
      phaseTime = 0;
      remoteAt = true;
      record('REMOTE_TRANSFER_IN');
      record('ACTING');
      return;
    }
    if (!detour && remoteAt) {
      state.position = { ...target };
      state.visible = true;
      state.activity = current.activity;
      state.phase = 'ACTING';
      phaseTime = 0;
      remoteAt = false;
      record('REMOTE_TRANSFER_OUT');
      record('ACTING');
      return;
    }
    if (!state.visible && current.sink && distance(state.position, target) <= .12) {
      state.activity = current.activity;
      state.phase = 'ACTING';
      phaseTime = 0;
      record('SINK_CONTINUE');
      record('ACTING');
      return;
    }
    if (!state.visible) {
      state.visible = true;
      record('SINK_EXIT');
    }
    const planned = navigator.route(state.position, target);
    if (!planned) { recover('NO_ROUTE'); return; }
    route = planned;
    movingLimit = Math.max(20, distance(state.position, target) / speed * 2.5 + 25);
    phaseTime = 0;
    stalledFor = 0;
    state.phase = 'MOVING';
    record('MOVING');
  }
  function tick(dt) {
    if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid student tick');
    state.moving = false;
    if (state.paused) return status(false);
    if (state.phase === 'PLANNING') plan();
    if (state.phase === 'FAILED' || state.phase === 'DONE' || dt === 0) return status(false);
    phaseTime += dt;
    if (state.phase === 'MOVING') {
      const current = detour ?? schedule[state.scheduleIndex];
      const target = detour ? detour.position : destinations[state.destination].position;
      const step = advanceRoute(state.position, route, speed * dt);
      state.position = step.position;
      state.heading = step.moved ? step.heading : state.heading;
      state.moving = step.moved > 0;
      const remaining = distance(state.position, target);
      stalledFor = step.moved > .01 ? 0 : stalledFor + dt;
      if (remaining <= .12 && !route.length) {
        state.position = { ...target };
        state.moving = false;
        state.phase = 'ARRIVED';
        record('ARRIVED');
        state.activity = current.activity;
        if (current.sink) {
          state.visible = false;
          record('SINK_ENTER');
        }
        state.phase = 'ACTING';
        phaseTime = 0;
        record('ACTING');
      } else if (phaseTime > movingLimit || stalledFor > 12) recover('MOVEMENT_TIMEOUT');
    } else if (state.phase === 'ACTING' && !detour && !holdAtActivity && phaseTime >= schedule[state.scheduleIndex].duration) {
      record('ACTIVITY_COMPLETE');
      state.scheduleIndex++;
      state.phase = 'TRANSITION';
      record('TRANSITION');
      state.phase = 'PLANNING';
      plan();
    }
    return status(false);
  }
  function status(includeHistory = true) {
    return { id: state.id, currentNeed: state.currentNeed, currentGoal: state.currentGoal,
      destination: state.destination, phase: state.phase, activity: state.activity,
      scheduleIndex: state.scheduleIndex, position: { ...state.position },
      heading: state.heading, moving: state.moving, visible: state.visible, paused: state.paused,
      interrupted: Boolean(detour), failures: state.failures,
      ...(includeHistory ? { history: state.history.map(item => ({ ...item })) } : {}) };
  }
  function setScheduleIndex(index) {
    if (!Number.isInteger(index) || index < 0 || index >= schedule.length) throw new Error('Invalid schedule index');
    if (index === state.scheduleIndex && !detour) return status(false);
    detour = null;
    state.scheduleIndex = index;
    state.phase = 'PLANNING';
    state.moving = false;
    route = [];
    plan();
    return status(false);
  }
  function beginDetour({ destination, position, activity = 'WALK_TOGETHER',
    need = 'SOCIAL', goal = 'WALK_TOGETHER' } = {}) {
    if (!destination || !position || !navigator.walkable(position)) throw new Error('Invalid detour destination');
    if (remoteAt || detour || !state.visible || !['ACTING', 'MOVING'].includes(state.phase) || state.paused) return false;
    detour = { need, goal, destination, position: { ...position }, activity, sink: false };
    plan();
    if (state.phase === 'FAILED') { detour = null; return false; }
    record('INTERRUPT');
    return true;
  }
  function endDetour() {
    if (!detour) return false;
    detour = null;
    record('RESUME');
    plan();
    return state.phase !== 'FAILED';
  }
  function pause() { state.paused = true; state.moving = false; return status(false); }
  function resume() { state.paused = false; return status(false); }
  tick(0);
  return { tick, status, setScheduleIndex, beginDetour, endDetour, pause, resume };
}
