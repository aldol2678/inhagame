import { worldScheduleAt, NPC_WORLD_PERIOD_MS, NPC_WORLD_PERIODS } from './npc-world-time-contract.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Each leg is compiled once from the previous scheduled destination. Sampling has no dt,
// join time, player input, tab visibility or local pause in its state.
export function createSharedScheduleController({ id, schedule, destinations, navigator, speed, now }) {
  if (schedule.length !== NPC_WORLD_PERIODS.length || !Number.isFinite(speed) || speed <= 0)
    throw new Error('Invalid shared schedule');
  const legs = new Map();
  function compileRoute(from, to) {
    const route = navigator.networkRoute?.(from, to) ?? navigator.route(from, to);
    if (!route) throw new Error(`Shared NPC route unavailable: ${id}`);
    let point = from, total = 0;
    const segments = [];
    for (const next of route) {
      const length = distance(point, next);
      if (length > 0) segments.push({ from: point, to: { ...next }, start: total, length });
      total += length;
      point = { ...next };
    }
    if (distance(point, to) > .01) throw new Error(`Shared NPC route unavailable: ${id}`);
    return { from, to, segments, duration: total / speed };
  }
  function along(route, seconds) {
    const progress = Math.max(0, seconds) * speed;
    let position = { ...route.to }, heading = 0;
    for (const segment of route.segments) {
      heading = Math.atan2(segment.to.x - segment.from.x, segment.to.z - segment.from.z) * 180 / Math.PI;
      if (progress < segment.start + segment.length) {
        const t = Math.max(0, (progress - segment.start) / segment.length);
        position = { x: segment.from.x + (segment.to.x - segment.from.x) * t,
          z: segment.from.z + (segment.to.z - segment.from.z) * t };
        break;
      }
    }
    return { position, heading };
  }
  function legFor(index) {
    if (legs.has(index)) return legs.get(index);
    const entry = schedule[index];
    const previous = schedule[(index + schedule.length - 1) % schedule.length];
    const from = { ...destinations[previous.destination].position };
    const to = { ...destinations[entry.destination].position };
    const remote = entry.remote || previous.remote;
    const departure = remote ? 0 : entry.departureSeconds ?? 0;
    if (!Number.isFinite(departure) || departure < 0)
      throw new Error(`Invalid shared NPC departure: ${id}/${index}`);
    const leg = remote ? { from, to, remote: true, segments: [], duration: 0, departure } :
      { ...compileRoute(from, to), departure };
    if (leg.duration + departure >= NPC_WORLD_PERIOD_MS / 1000)
      throw new Error(`Shared NPC route exceeds schedule: ${id}/${index}`);
    // A walk break is a bounded out-and-back excursion, ending at the next leg's
    // canonical origin. Clients independently sample it without accumulating dt.
    if (entry.walkDestination && !entry.sink) {
      const turn = destinations[entry.walkDestination]?.position;
      if (!turn) throw new Error(`Invalid shared NPC walk destination: ${id}/${index}`);
      const outward = compileRoute(to, turn), home = compileRoute(turn, to);
      const cycle = outward.duration + home.duration + 40;
      const rounds = Math.floor((NPC_WORLD_PERIOD_MS / 1000 - departure - leg.duration) / cycle);
      if (rounds > 0) leg.walk = { outward, home, cycle, rounds };
    }
    legs.set(index, leg);
    return leg;
  }
  function sample(serverNowMs = now()) {
    if (serverNowMs === null) return { id, phase: 'SYNCING', position: { x: 0, z: 0 },
      heading: 0, visible: false, moving: false, activity: null, currentGoal: null,
      currentNeed: null, destination: null, scheduleIndex: null, paused: false, interrupted: false, failures: 0 };
    const time = worldScheduleAt(serverNowMs), entry = schedule[time.index], leg = legFor(time.index);
    const previous = schedule[(time.index + schedule.length - 1) % schedule.length];
    const waiting = time.offsetSeconds < (leg.departure ?? 0);
    if (waiting) return { id, phase: 'WAITING', position: { ...leg.from }, heading: 0,
      moving: false, visible: !previous.sink, activity: previous.activity,
      currentNeed: previous.need, currentGoal: previous.goal, destination: previous.destination,
      scheduleIndex: time.index, slot: time.slot, paused: false, interrupted: false, failures: 0 };
    const elapsed = time.offsetSeconds - (leg.departure ?? 0);
    let moving = elapsed < leg.duration, pose = along(leg, elapsed), destination = entry.destination;
    const walkTime = elapsed - leg.duration;
    if (leg.walk && walkTime >= 0 && walkTime < leg.walk.cycle * leg.walk.rounds) {
      const at = walkTime % leg.walk.cycle;
      const returning = at >= leg.walk.outward.duration + 20;
      const route = returning ? leg.walk.home : leg.walk.outward;
      const seconds = returning ? at - leg.walk.outward.duration - 20 : at;
      pose = along(route, seconds);
      moving = seconds < route.duration;
      destination = returning ? entry.destination : entry.walkDestination;
    }
    return { id, phase: moving ? 'MOVING' : 'ACTING', ...pose, moving,
      visible: moving || !entry.sink, activity: moving ? null : entry.activity,
      currentNeed: entry.need, currentGoal: entry.goal, destination,
      scheduleIndex: time.index, slot: time.slot, paused: false, interrupted: false, failures: 0,
      transfer: leg.remote === true };
  }
  // Existing readers keep their status contract. No caller can privately mutate shared motion.
  return { sample, status: () => sample(), tick: () => sample(),
    setScheduleIndex: () => sample(), pause: () => sample(), resume: () => sample(),
    beginDetour: () => false, endDetour: () => false };
}
export function bindSharedSchedule(roster, navigator, now) {
  for (const [id, member] of roster) member.controller = createSharedScheduleController({
    id, schedule: member.schedule, destinations: member.destinations,
    navigator, speed: member.moveSpeed, now
  });
  return roster;
}
