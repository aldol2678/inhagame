import { BACK_GATE_SPAWN, MAIN_GATE_SPAWN } from "../campus-spawn.js";
import { QUEST_ID } from "../../npc-factory/quest-contract.mjs";

export const SPAWN_STATE = Object.freeze({
  AVAILABLE: "AVAILABLE",
  LOCKED_PROGRESS: "LOCKED_PROGRESS",
  LOCKED_ACCOUNT: "LOCKED_ACCOUNT",
  COMING_SOON: "COMING_SOON",
  NEW: "NEW",
  DISABLED: "DISABLED",
  UNKNOWN: "UNKNOWN",
  HIDDEN: "HIDDEN"
});

export const SPAWN_ID = Object.freeze({
  MAIN_GATE: "MAIN_GATE",
  BACK_GATE: "BACK_GATE",
  STUDENT_CENTER: "STUDENT_CENTER",
  BUILDING_5: "BUILDING_5",
  DORM: "DORM",
  CLUB_ROOM: "CLUB_ROOM",
  HOME: "HOME",
  FAVORITE: "FAVORITE",
  EVENT: "EVENT"
});

export const SPAWN_UNLOCK_TYPE = Object.freeze({
  NONE: "NONE",
  QUEST: "QUEST",
  ACCOUNT: "ACCOUNT",
  INHA_VERIFICATION: "INHA_VERIFICATION",
  CLUB: "CLUB",
  PROPERTY: "PROPERTY",
  EVENT: "EVENT",
  TIME: "TIME",
  ADMIN: "ADMIN"
});

const states = new Set(Object.values(SPAWN_STATE));
const startableStates = new Set([SPAWN_STATE.AVAILABLE, SPAWN_STATE.NEW]);
const anchorCopy = anchor => anchor ? { x: anchor.x, y: anchor.y, z: anchor.z, yaw: anchor.yaw ?? 0 } : null;
const conditionCopy = condition => condition ? { ...condition } : null;

export const DEFAULT_SPAWN_DEFINITIONS = Object.freeze({
  [SPAWN_ID.MAIN_GATE]: Object.freeze({
    spawnId: SPAWN_ID.MAIN_GATE,
    name: "정문",
    description: "인하월드의 시작점",
    worldZone: "AREA_MAIN_GATE",
    spawnAnchor: MAIN_GATE_SPAWN,
    state: SPAWN_STATE.AVAILABLE,
    unlockType: SPAWN_UNLOCK_TYPE.NONE,
    unlockCondition: null,
    previewScene: "MAIN_GATE",
    onlineCountScope: "PLACE_ZONE",
    allowResume: true,
    allowFavorite: false,
    sortPriority: 10
  }),
  [SPAWN_ID.BACK_GATE]: Object.freeze({
    spawnId: SPAWN_ID.BACK_GATE,
    name: "후문",
    description: "퀘스트 완료 후 시작 지점으로 등록",
    worldZone: "AREA_BACK_GATE",
    spawnAnchor: BACK_GATE_SPAWN,
    state: SPAWN_STATE.LOCKED_PROGRESS,
    unlockType: SPAWN_UNLOCK_TYPE.QUEST,
    unlockCondition: Object.freeze({ questId: QUEST_ID }),
    previewScene: "BACK_GATE",
    onlineCountScope: "PLACE_ZONE",
    allowResume: true,
    allowFavorite: false,
    sortPriority: 20
  })
});

function validateDefinition(definition) {
  if (!definition || typeof definition !== "object") throw new Error("Invalid spawn definition");
  if (typeof definition.spawnId !== "string" || !/^[A-Z0-9_]{2,64}$/.test(definition.spawnId))
    throw new Error("Invalid spawnId");
  if (typeof definition.name !== "string" || !definition.name.trim()) throw new Error("Invalid spawn name");
  if (!states.has(definition.state)) throw new Error("Invalid spawn state");
  const anchor = definition.spawnAnchor;
  if (anchor && ![anchor.x, anchor.y, anchor.z, anchor.yaw ?? 0].every(Number.isFinite))
    throw new Error("Invalid spawn anchor");
  if (startableStates.has(definition.state) && !anchor) throw new Error("Startable spawn requires an anchor");
  return definition;
}

export function canStartSpawn(definition) {
  return Boolean(definition && startableStates.has(definition.state) && definition.spawnAnchor);
}

export function spawnLockSummary(definition) {
  return Object.freeze({
    spawnId: definition.spawnId,
    state: definition.state,
    unlockType: definition.unlockType,
    unlockQuestId: definition.unlockCondition?.questId ?? null,
    title: definition.name
  });
}

export function markSpawnElement(element, definition) {
  if (!element || !definition) return false;
  element.dataset.spawnId = definition.spawnId;
  element.dataset.spawnState = definition.state;
  element.hidden = definition.state === SPAWN_STATE.HIDDEN;
  return true;
}

export function resolveSpawnProgressState(definition, context = null) {
  if (!definition || definition.state !== SPAWN_STATE.LOCKED_PROGRESS) return definition?.state ?? SPAWN_STATE.UNKNOWN;
  if (definition.unlockType !== SPAWN_UNLOCK_TYPE.QUEST) return definition.state;
  const questId = definition.unlockCondition?.questId;
  const completed = context?.completedQuestIds;
  const unlocked = typeof questId === "string" && (
    completed instanceof Set ? completed.has(questId) :
    Array.isArray(completed) ? completed.includes(questId) : false
  );
  return unlocked ? SPAWN_STATE.AVAILABLE : definition.state;
}

export function createSpawnRegistry({
  definitions = Object.values(DEFAULT_SPAWN_DEFINITIONS),
  stateResolver = resolveSpawnProgressState
} = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const definition = validateDefinition(raw);
    if (byId.has(definition.spawnId)) throw new Error(`Duplicate spawnId: ${definition.spawnId}`);
    byId.set(definition.spawnId, definition);
  }

  const resolve = (definition, context = null) => {
    let state = definition.state;
    if (stateResolver) {
      try {
        const candidate = stateResolver(definition, context);
        if (candidate != null) state = typeof candidate === "string" ? candidate : candidate.state;
        if (!states.has(state)) state = SPAWN_STATE.UNKNOWN;
      } catch {
        state = SPAWN_STATE.UNKNOWN;
      }
    }
    const result = {
      ...definition,
      state,
      spawnAnchor: anchorCopy(definition.spawnAnchor),
      unlockCondition: conditionCopy(definition.unlockCondition)
    };
    result.canStart = canStartSpawn(result);
    result.visible = result.state !== SPAWN_STATE.HIDDEN;
    return Object.freeze(result);
  };

  const get = (spawnId, context = null) => {
    const definition = byId.get(spawnId);
    return definition ? resolve(definition, context) : null;
  };

  const list = ({ includeHidden = false, context = null, limit = Infinity } = {}) =>
    [...byId.values()]
      .sort((a, b) => (a.sortPriority ?? 999) - (b.sortPriority ?? 999) || a.spawnId.localeCompare(b.spawnId))
      .map(definition => resolve(definition, context))
      .filter(definition => includeHidden || definition.visible)
      .slice(0, Math.max(0, Number.isFinite(limit) ? limit : Infinity));

  return {
    get,
    list,
    has: spawnId => byId.has(spawnId),
    canStart: (spawnId, context = null) => canStartSpawn(get(spawnId, context)),
    anchor: (spawnId, context = null) => {
      const definition = get(spawnId, context);
      return canStartSpawn(definition) ? anchorCopy(definition.spawnAnchor) : null;
    },
    status: (context = null) => list({ includeHidden: true, context }).map(definition => ({
      spawnId: definition.spawnId,
      state: definition.state,
      canStart: definition.canStart,
      visible: definition.visible
    }))
  };
}
