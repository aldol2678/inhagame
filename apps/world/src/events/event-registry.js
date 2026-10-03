// INHA WORLD EventRegistry P0.
// Metadata/router only: this module does not evaluate lifecycle, mutate progress, grant rewards or access storage.

export const EVENT_ID = Object.freeze({
  BIRYONG_BR01: 'BR01',
  BACK_GATE_BG01: 'BG01',
  MCM_2026: 'event.mcm_2026',
  INKYUNG_MECHANICAL_DUCK: 'event.inkyung_mechanical_duck'
});

export const EVENT_LIFECYCLE_SOURCE = Object.freeze({
  ALWAYS: 'ALWAYS',
  OWNER_DERIVED: 'OWNER_DERIVED',
  TIME_WINDOW: 'TIME_WINDOW'
});

export const EVENT_PERSISTENCE_MODE = Object.freeze({
  SERVER_PERSISTED: 'SERVER_PERSISTED',
  DERIVED_FROM_OWNER: 'DERIVED_FROM_OWNER',
  CLIENT_PERSISTED: 'CLIENT_PERSISTED',
  SESSION_ONLY: 'SESSION_ONLY',
  PRESENTATION_ONLY: 'PRESENTATION_ONLY'
});

export const EVENT_REPEAT_POLICY = Object.freeze({
  ONCE_PER_ACCOUNT: 'ONCE_PER_ACCOUNT',
  REPEATABLE: 'REPEATABLE',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  SESSION: 'SESSION',
  NONE: 'NONE'
});

export const EVENT_PROGRESS_OWNER = Object.freeze({
  EVENT: 'EVENT',
  QUEST: 'QUEST'
});

export const EVENT_REWARD_MODE = Object.freeze({
  NONE: 'NONE',
  REWARD_CLAIM: 'REWARD_CLAIM'
});

const lifecycleSources = new Set(Object.values(EVENT_LIFECYCLE_SOURCE));
const persistenceModes = new Set(Object.values(EVENT_PERSISTENCE_MODE));
const repeatPolicies = new Set(Object.values(EVENT_REPEAT_POLICY));
const progressOwners = new Set(Object.values(EVENT_PROGRESS_OWNER));
const rewardModes = new Set(Object.values(EVENT_REWARD_MODE));
const validEventId = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{1,95}$/.test(value);

function definition(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('Event definition must be an object');
  if (!validEventId(raw.eventId)) throw new TypeError('Invalid eventId');
  if (typeof raw.title !== 'string' || !raw.title.trim()) throw new TypeError(`Invalid title for ${raw.eventId}`);
  if (!lifecycleSources.has(raw.lifecycleSource)) throw new TypeError(`Invalid lifecycleSource for ${raw.eventId}`);
  if (!persistenceModes.has(raw.persistenceMode)) throw new TypeError(`Invalid persistenceMode for ${raw.eventId}`);
  if (!repeatPolicies.has(raw.completionRepeatPolicy)) throw new TypeError(`Invalid completionRepeatPolicy for ${raw.eventId}`);
  if (!progressOwners.has(raw.progressOwner)) throw new TypeError(`Invalid progressOwner for ${raw.eventId}`);
  if (!rewardModes.has(raw.rewardMode)) throw new TypeError(`Invalid rewardMode for ${raw.eventId}`);
  if (raw.lifecycleSource === EVENT_LIFECYCLE_SOURCE.OWNER_DERIVED &&
      (typeof raw.ownerRef !== 'string' || !raw.ownerRef.trim())) {
    throw new TypeError(`OWNER_DERIVED event requires ownerRef: ${raw.eventId}`);
  }
  if (raw.persistenceMode === EVENT_PERSISTENCE_MODE.DERIVED_FROM_OWNER &&
      raw.lifecycleSource !== EVENT_LIFECYCLE_SOURCE.OWNER_DERIVED) {
    throw new TypeError(`DERIVED_FROM_OWNER requires OWNER_DERIVED lifecycle: ${raw.eventId}`);
  }
  return Object.freeze({
    eventId: raw.eventId,
    title: raw.title.trim(),
    lifecycleSource: raw.lifecycleSource,
    persistenceMode: raw.persistenceMode,
    completionRepeatPolicy: raw.completionRepeatPolicy,
    progressOwner: raw.progressOwner,
    ownerRef: raw.ownerRef ?? null,
    rewardMode: raw.rewardMode,
    interactionRepeatable: Boolean(raw.interactionRepeatable)
  });
}

export const DEFAULT_EVENT_DEFINITIONS = Object.freeze({
  [EVENT_ID.BIRYONG_BR01]: definition({
    eventId: EVENT_ID.BIRYONG_BR01,
    title: '돌아오는 목소리',
    lifecycleSource: EVENT_LIFECYCLE_SOURCE.ALWAYS,
    persistenceMode: EVENT_PERSISTENCE_MODE.SERVER_PERSISTED,
    completionRepeatPolicy: EVENT_REPEAT_POLICY.ONCE_PER_ACCOUNT,
    progressOwner: EVENT_PROGRESS_OWNER.EVENT,
    rewardMode: EVENT_REWARD_MODE.NONE,
    interactionRepeatable: true
  }),
  [EVENT_ID.BACK_GATE_BG01]: definition({
    eventId: EVENT_ID.BACK_GATE_BG01,
    title: '문밖의 거리',
    lifecycleSource: EVENT_LIFECYCLE_SOURCE.OWNER_DERIVED,
    persistenceMode: EVENT_PERSISTENCE_MODE.DERIVED_FROM_OWNER,
    completionRepeatPolicy: EVENT_REPEAT_POLICY.ONCE_PER_ACCOUNT,
    progressOwner: EVENT_PROGRESS_OWNER.QUEST,
    ownerRef: 'campus_navigation_intro_v1',
    rewardMode: EVENT_REWARD_MODE.NONE,
    interactionRepeatable: false
  }),
  [EVENT_ID.MCM_2026]: definition({
    eventId: EVENT_ID.MCM_2026,
    title: '좀비대학교 · 2026 문콘경 일일호프',
    lifecycleSource: EVENT_LIFECYCLE_SOURCE.TIME_WINDOW,
    persistenceMode: EVENT_PERSISTENCE_MODE.SERVER_PERSISTED,
    completionRepeatPolicy: EVENT_REPEAT_POLICY.ONCE_PER_ACCOUNT,
    progressOwner: EVENT_PROGRESS_OWNER.EVENT,
    rewardMode: EVENT_REWARD_MODE.REWARD_CLAIM,
    interactionRepeatable: true
  }),
  // Unlock is gated by Main 1. Progress itself is a separate client-local event,
  // not a server row and not a quest-derived lock like BG01.
  [EVENT_ID.INKYUNG_MECHANICAL_DUCK]: definition({
    eventId: EVENT_ID.INKYUNG_MECHANICAL_DUCK,
    title: '인경호의 진실',
    lifecycleSource: EVENT_LIFECYCLE_SOURCE.OWNER_DERIVED,
    persistenceMode: EVENT_PERSISTENCE_MODE.CLIENT_PERSISTED,
    completionRepeatPolicy: EVENT_REPEAT_POLICY.ONCE_PER_ACCOUNT,
    progressOwner: EVENT_PROGRESS_OWNER.EVENT,
    ownerRef: 'campus_first_walk_v1',
    rewardMode: EVENT_REWARD_MODE.NONE,
    interactionRepeatable: true
  })
});

export function createEventRegistry({ definitions = Object.values(DEFAULT_EVENT_DEFINITIONS) } = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const item = definition(raw);
    if (byId.has(item.eventId)) throw new Error(`Duplicate eventId: ${item.eventId}`);
    byId.set(item.eventId, item);
  }
  return Object.freeze({
    get: eventId => byId.get(eventId) ?? null,
    has: eventId => byId.has(eventId),
    list: () => Object.freeze([...byId.values()]),
    get size() { return byId.size; }
  });
}

export const EVENT_REGISTRY = createEventRegistry();
