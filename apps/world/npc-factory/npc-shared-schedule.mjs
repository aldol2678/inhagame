import { worldScheduleAt, NPC_WORLD_PERIOD_MS, NPC_WORLD_PERIODS } from './npc-world-time-contract.mjs';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
// Each leg is compiled once from the previous scheduled destination. Sampling has no dt,
// join time, player input, tab visibility or local pause in its state.
export function createSharedScheduleController({ id, schedule, destinations, navigator, speed, now }) {
  if (schedule.length !== NPC_WORLD_PERIODS.length || !Number.isFinite(speed) || speed <= 0)
    throw new Error('Invalid shared schedule');
  const legs = new Map();
  function legFor(index) {
    if (legs.has(index)) return legs.get(index);
    const entry = schedule[index];
    const previous = schedule[(index + schedule.length - 1) % schedule.length];
    const from = { ...destinations[previous.destination].position };
    const to = { ...destinations[entry.destination].position };
    if (entry.remote || previous.remote) {
      const leg = { from, to, remote: true, segments: [], duration: 0 };
      legs.set(index, leg);
      return leg;
    }
    // Prefer the canonical campus walk network when both endpoints are on it.
    const route = navigator.networkRoute?.(from, to) ?? navigator.route(from, to);
    if (!route) throw new Error(`Shared NPC route unavailable: ${id}/${index}`);
    let point = from, total = 0;
    const segments = [];
    for (const next of route) {
      const length = distance(point, next);
      if (length > 0) segments.push({ from: point, to: { ...next }, start: total, length });
      total += length;
      point = { ...next };
    }
    if (distance(point, to) > .01 || total / speed >= NPC_WORLD_PERIOD_MS / 1000)
      throw new Error(`Shared NPC route exceeds schedule: ${id}/${index}`);
    const leg = { from, to, segments, duration: total / speed };
    legs.set(index, leg);
    return leg;
  }
  function sample(serverNowMs = now()) {
    if (serverNowMs === null) return { id, phase: 'SYNCING', position: { x: 0, z: 0 },
      heading: 0, visible: false, moving: false, activity: null, currentGoal: null,
      currentNeed: null, destination: null, scheduleIndex: null, paused: false, interrupted: false, failures: 0 };
    const time = worldScheduleAt(serverNowMs), entry = schedule[time.index], leg = legFor(time.index);
    const moving = time.offsetSeconds < leg.duration;
    let position = { ...leg.to }, heading = 0;
    const progress = time.offsetSeconds * speed;
    for (const segment of leg.segments) {
      heading = Math.atan2(segment.to.x - segment.from.x, segment.to.z - segment.from.z) * 180 / Math.PI;
      if (progress < segment.start + segment.length) {
        const t = Math.max(0, (progress - segment.start) / segment.length);
        position = { x: segment.from.x + (segment.to.x - segment.from.x) * t,
          z: segment.from.z + (segment.to.z - segment.from.z) * t };
        break;
      }
    }
    return { id, phase: moving ? 'MOVING' : 'ACTING', position, heading, moving,
      visible: moving || !entry.sink, activity: moving ? null : entry.activity,
      currentNeed: entry.need, currentGoal: entry.goal, destination: entry.destination,
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
