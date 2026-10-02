import { metersToWorld } from "./world-scale.js";

export const CORE15_FUNNEL_STORAGE_KEY = "inhagame-core15-funnel-v1";
export const CORE15_ENCOUNTER_RADIUS_WORLD = metersToWorld(15);

export const CORE15_EVENT = Object.freeze({
  SESSION_START: "first_session_start",
  FIRST_MOVE: "first_move",
  FIRST_ZONE: "first_zone_arrival",
  FIRST_NPC: "first_npc_interaction",
  FIRST_PLAYER: "first_player_encounter",
  ACTIVITY_START: "first_activity_start",
  ACTIVITY_COMPLETE: "first_activity_complete",
  FIRST_REWARD: "first_reward",
  LOOP_COMPLETE: "core_loop_complete",
  WORLD_RETURN: "world_return",
  NEXT_DISCOVERY: "next_discovery_click"
});

const TARGET = Object.freeze({
  [CORE15_EVENT.SESSION_START]: null,
  [CORE15_EVENT.FIRST_MOVE]: null,
  [CORE15_EVENT.FIRST_ZONE]: null,
  [CORE15_EVENT.FIRST_NPC]: null,
  [CORE15_EVENT.FIRST_PLAYER]: null,
  [CORE15_EVENT.ACTIVITY_START]: "inkyung_living",
  [CORE15_EVENT.ACTIVITY_COMPLETE]: "inkyung_living",
  [CORE15_EVENT.FIRST_REWARD]: "first_campus",
  [CORE15_EVENT.LOOP_COMPLETE]: "first_campus",
  [CORE15_EVENT.WORLD_RETURN]: null,
  [CORE15_EVENT.NEXT_DISCOVERY]: "main2_back_gate_guide"
});

const ALLOWED = new Set(Object.values(CORE15_EVENT));

function readSeen(storage, key) {
  try {
    const parsed = JSON.parse(storage?.getItem?.(key) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter(value => ALLOWED.has(value)) : []);
  } catch {
    return new Set();
  }
}

export function createCore15FunnelTelemetry({
  track = (eventType, surface, target) => globalThis.window?.InhaHubTelemetry?.track?.(eventType, surface, target) ?? null,
  storage = undefined,
  storageKey = CORE15_FUNNEL_STORAGE_KEY,
  encounterRadiusWorld = CORE15_ENCOUNTER_RADIUS_WORLD
} = {}) {
  if (storage === undefined) {
    try { storage = globalThis.sessionStorage ?? null; } catch { storage = null; }
  }

  const seen = readSeen(storage, storageKey);

  function persist() {
    try { storage?.setItem?.(storageKey, JSON.stringify([...seen])); } catch { /* Best effort only. */ }
  }

  function mark(eventType) {
    if (!ALLOWED.has(eventType) || seen.has(eventType)) return false;
    let eventId = null;
    try { eventId = track(eventType, "campus", TARGET[eventType]); } catch { eventId = null; }
    if (!eventId) return false;
    seen.add(eventType);
    persist();
    return true;
  }

  function observePlayerEncounter(points, position) {
    if (seen.has(CORE15_EVENT.FIRST_PLAYER) || !position || !Number.isFinite(position.x) || !Number.isFinite(position.z))
      return false;
    const encountered = (points ?? []).some(point =>
      Number.isFinite(point?.x) && Number.isFinite(point?.z) &&
      Math.hypot(point.x - position.x, point.z - position.z) <= encounterRadiusWorld
    );
    return encountered ? mark(CORE15_EVENT.FIRST_PLAYER) : false;
  }

  return Object.freeze({
    mark,
    startSession: () => mark(CORE15_EVENT.SESSION_START),
    firstMove: () => mark(CORE15_EVENT.FIRST_MOVE),
    firstZoneArrival: () => mark(CORE15_EVENT.FIRST_ZONE),
    firstNpcInteraction: () => mark(CORE15_EVENT.FIRST_NPC),
    firstActivityStart: () => mark(CORE15_EVENT.ACTIVITY_START),
    firstActivityComplete: () => mark(CORE15_EVENT.ACTIVITY_COMPLETE),
    firstReward: () => mark(CORE15_EVENT.FIRST_REWARD),
    coreLoopComplete: () => mark(CORE15_EVENT.LOOP_COMPLETE),
    worldReturn: () => mark(CORE15_EVENT.WORLD_RETURN),
    nextDiscoveryClick: () => mark(CORE15_EVENT.NEXT_DISCOVERY),
    observePlayerEncounter,
    status: () => Object.freeze({ seen: Object.freeze([...seen]) })
  });
}
