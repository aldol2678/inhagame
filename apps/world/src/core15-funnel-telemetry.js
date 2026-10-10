import { metersToWorld } from "./world-scale.js";

export const CORE15_FUNNEL_STORAGE_KEY = "inhagame-core15-funnel-v1";
export const CORE15_ENCOUNTER_RADIUS_WORLD = metersToWorld(15);

export const CORE15_EVENT = Object.freeze({
  SESSION_START: "first_session_start",
  FIRST_GOAL: "first_goal_seen",
  FIRST_MOVE: "first_move",
  FIRST_ZONE: "first_zone_arrival",
  FIRST_NPC: "first_npc_interaction",
  QUEST_START: "quest_started",
  FIRST_PLAYER: "first_player_encounter",
  ACTIVITY_START: "first_activity_start",
  ACTIVITY_COMPLETE: "first_activity_complete",
  FIRST_REWARD: "first_reward",
  REWARD_SEEN: "reward_seen",
  GROWTH_SEEN: "growth_seen",
  LOOP_COMPLETE: "core_loop_complete",
  NEXT_GOAL_SEEN: "next_goal_seen",
  CORE15_COMPLETE: "core15_complete",
  WORLD_RETURN: "world_return",
  NEXT_DISCOVERY: "next_discovery_click"
});

const TARGET = Object.freeze({
  [CORE15_EVENT.SESSION_START]: null,
  [CORE15_EVENT.FIRST_GOAL]: "first_campus",
  [CORE15_EVENT.FIRST_MOVE]: null,
  [CORE15_EVENT.FIRST_ZONE]: null,
  [CORE15_EVENT.FIRST_NPC]: null,
  [CORE15_EVENT.QUEST_START]: "first_campus",
  [CORE15_EVENT.FIRST_PLAYER]: null,
  [CORE15_EVENT.ACTIVITY_START]: "inkyung_living",
  [CORE15_EVENT.ACTIVITY_COMPLETE]: "inkyung_living",
  [CORE15_EVENT.FIRST_REWARD]: "first_campus",
  [CORE15_EVENT.REWARD_SEEN]: "first_campus",
  [CORE15_EVENT.GROWTH_SEEN]: "first_campus",
  [CORE15_EVENT.LOOP_COMPLETE]: "first_campus",
  [CORE15_EVENT.NEXT_GOAL_SEEN]: "main2_back_gate_guide",
  [CORE15_EVENT.CORE15_COMPLETE]: "first_campus",
  [CORE15_EVENT.WORLD_RETURN]: null,
  [CORE15_EVENT.NEXT_DISCOVERY]: "main2_back_gate_guide"
});

const ALLOWED = new Set(Object.values(CORE15_EVENT));
const PRODUCT_COMPLETE_REQUIRES = Object.freeze([
  CORE15_EVENT.FIRST_REWARD,
  CORE15_EVENT.REWARD_SEEN,
  CORE15_EVENT.GROWTH_SEEN,
  CORE15_EVENT.NEXT_GOAL_SEEN
]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validEventId(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function randomEventId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  return Array.from(bytes, (value, index) =>
    ([4, 6, 8, 10].includes(index) ? "-" : "") + value.toString(16).padStart(2, "0")
  ).join("");
}

function readState(storage, key) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(key) ?? "null");
    if (Array.isArray(parsed)) {
      return {
        seen: new Set(parsed.filter(value => ALLOWED.has(value))),
        pending: new Map()
      };
    }
    if (parsed && typeof parsed === "object") {
      const seen = new Set(Array.isArray(parsed.seen) ? parsed.seen.filter(value => ALLOWED.has(value)) : []);
      const pending = new Map();
      if (parsed.pending && typeof parsed.pending === "object") {
        for (const [eventType, eventId] of Object.entries(parsed.pending)) {
          if (ALLOWED.has(eventType) && !seen.has(eventType) && validEventId(eventId)) pending.set(eventType, eventId);
        }
      }
      return { seen, pending };
    }
  } catch {
    // Corrupt analytics storage is disposable.
  }
  return { seen: new Set(), pending: new Map() };
}

export function createCore15FunnelTelemetry({
  track = (eventType, surface, target, options) =>
    globalThis.window?.InhaHubTelemetry?.trackConfirmed?.(eventType, surface, target, options) ?? Promise.resolve(null),
  storage = undefined,
  storageKey = CORE15_FUNNEL_STORAGE_KEY,
  encounterRadiusWorld = CORE15_ENCOUNTER_RADIUS_WORLD,
  eventIdFactory = randomEventId,
  isCurrent = () => true
} = {}) {
  if (storage === undefined) {
    try { storage = globalThis.sessionStorage ?? null; } catch { storage = null; }
  }

  const state = readState(storage, storageKey);
  const seen = state.seen;
  const pending = state.pending;
  const inFlight = new Set();

  function persist() {
    if (!isCurrent()) return;
    try {
      storage?.setItem?.(storageKey, JSON.stringify({
        version: 2,
        seen: [...seen],
        pending: Object.fromEntries(pending)
      }));
    } catch {
      // Best effort only.
    }
  }

  function maybeComplete() {
    if (seen.has(CORE15_EVENT.CORE15_COMPLETE) || pending.has(CORE15_EVENT.CORE15_COMPLETE)) return false;
    if (!PRODUCT_COMPLETE_REQUIRES.every(type => seen.has(type))) return false;
    return mark(CORE15_EVENT.CORE15_COMPLETE);
  }

  async function dispatch(eventType, eventId) {
    if (!isCurrent() || inFlight.has(eventType) || seen.has(eventType) || !pending.has(eventType)) return false;
    inFlight.add(eventType);
    try {
      let confirmed = null;
      try {
        confirmed = await Promise.resolve(track(eventType, "campus", TARGET[eventType], { eventId }));
      } catch {
        confirmed = null;
      }
      if (!isCurrent() || confirmed !== eventId) return false;
      pending.delete(eventType);
      seen.add(eventType);
      persist();
      if (eventType !== CORE15_EVENT.CORE15_COMPLETE) maybeComplete();
      return true;
    } finally {
      inFlight.delete(eventType);
    }
  }

  function mark(eventType) {
    if (!isCurrent() || !ALLOWED.has(eventType) || seen.has(eventType)) return false;
    const existing = pending.get(eventType);
    if (existing) {
      void dispatch(eventType, existing);
      return false;
    }
    const eventId = eventIdFactory();
    if (!validEventId(eventId)) return false;
    pending.set(eventType, eventId);
    persist();
    void dispatch(eventType, eventId);
    return true;
  }

  function observePlayerEncounter(points, position) {
    if (seen.has(CORE15_EVENT.FIRST_PLAYER) || pending.has(CORE15_EVENT.FIRST_PLAYER) ||
        !position || !Number.isFinite(position.x) || !Number.isFinite(position.z))
      return false;
    const encountered = (points ?? []).some(point =>
      Number.isFinite(point?.x) && Number.isFinite(point?.z) &&
      Math.hypot(point.x - position.x, point.z - position.z) <= encounterRadiusWorld
    );
    return encountered ? mark(CORE15_EVENT.FIRST_PLAYER) : false;
  }

  // Resume the exact same event_id after reload. The server's event_id uniqueness makes a lost
  // acknowledgement safe: a retry cannot create a second row for the same pending milestone.
  for (const [eventType, eventId] of pending) void dispatch(eventType, eventId);
  maybeComplete();

  return Object.freeze({
    mark,
    startSession: () => mark(CORE15_EVENT.SESSION_START),
    firstGoalSeen: () => mark(CORE15_EVENT.FIRST_GOAL),
    firstMove: () => mark(CORE15_EVENT.FIRST_MOVE),
    firstZoneArrival: () => mark(CORE15_EVENT.FIRST_ZONE),
    firstNpcInteraction: () => mark(CORE15_EVENT.FIRST_NPC),
    questStarted: () => mark(CORE15_EVENT.QUEST_START),
    firstActivityStart: () => mark(CORE15_EVENT.ACTIVITY_START),
    firstActivityComplete: () => mark(CORE15_EVENT.ACTIVITY_COMPLETE),
    firstReward: () => mark(CORE15_EVENT.FIRST_REWARD),
    rewardSeen: () => mark(CORE15_EVENT.REWARD_SEEN),
    growthSeen: () => mark(CORE15_EVENT.GROWTH_SEEN),
    coreLoopComplete: () => mark(CORE15_EVENT.LOOP_COMPLETE),
    nextGoalSeen: () => mark(CORE15_EVENT.NEXT_GOAL_SEEN),
    worldReturn: () => mark(CORE15_EVENT.WORLD_RETURN),
    nextDiscoveryClick: () => mark(CORE15_EVENT.NEXT_DISCOVERY),
    observePlayerEncounter,
    status: () => Object.freeze({
      seen: Object.freeze([...seen]),
      pending: Object.freeze(Object.fromEntries(pending))
    })
  });
}
