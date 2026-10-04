// INHA WORLD P0 Activity / Outcome pure contract.
// Metadata + validation + state semantics only. No DB writes, rewards, quest progress or gameplay resolution.

export const ACTIVITY_AUTHORITY_TIER = Object.freeze({
  LOCAL_COSMETIC: 'T0_LOCAL_COSMETIC',
  SERVER_VALIDATED: 'T1_SERVER_VALIDATED',
  AUTHORITATIVE_SESSION: 'T2_AUTHORITATIVE_SESSION'
});

export const ACTIVITY_ATTEMPT_MODE = Object.freeze({
  INSTANT: 'INSTANT',
  INTERACTIVE: 'INTERACTIVE',
  SESSION: 'SESSION'
});

export const ACTIVITY_REPEAT_POLICY = Object.freeze({
  REPEATABLE: 'REPEATABLE',
  ONCE_PER_ACCOUNT: 'ONCE_PER_ACCOUNT',
  DAILY: 'DAILY',
  WEEKLY: 'WEEKLY',
  SESSION: 'SESSION',
  NONE: 'NONE'
});

export const ACTIVITY_DEFINITION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMING_SOON: 'COMING_SOON',
  DISABLED: 'DISABLED',
  HIDDEN: 'HIDDEN'
});

export const ACTIVITY_ATTEMPT_STATE = Object.freeze({
  CREATED: 'CREATED',
  ACTIVE: 'ACTIVE',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
});

export const ACTIVITY_ID_PATTERN = /^activity\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,4}$/;
export const ACTIVITY_SOURCE_REF_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,5}$/;
export const ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const ACTIVITY_SEMANTIC_EVENT_PATTERN =
  /^activity\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){0,3}$/;

const tiers = new Set(Object.values(ACTIVITY_AUTHORITY_TIER));
const modes = new Set(Object.values(ACTIVITY_ATTEMPT_MODE));
const repeatPolicies = new Set(Object.values(ACTIVITY_REPEAT_POLICY));
const definitionStatuses = new Set(Object.values(ACTIVITY_DEFINITION_STATUS));
const states = new Set(Object.values(ACTIVITY_ATTEMPT_STATE));
const terminalStates = new Set([
  ACTIVITY_ATTEMPT_STATE.SUCCEEDED,
  ACTIVITY_ATTEMPT_STATE.FAILED,
  ACTIVITY_ATTEMPT_STATE.CANCELLED,
  ACTIVITY_ATTEMPT_STATE.EXPIRED
]);

const START_REQUEST_FIELDS = new Set(['activityId', 'sourceRef', 'clientAttemptKey', 'evidence']);
const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'rewardId', 'rewardAmount', 'amount', 'outputItem', 'outputItemId', 'outputQuantity',
  'rarity', 'lifeXp', 'lifeXP', 'collectionCompletion', 'questCompletion', 'serverTime', 'price'
]);

function stableRef(value, label) {
  if (typeof value !== 'string' || !ACTIVITY_SOURCE_REF_PATTERN.test(value) || value.length > 160) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

export function createActivityDefinition(raw) {
  if (!raw || typeof raw !== 'object') throw new TypeError('Activity definition must be an object');
  if (typeof raw.activityId !== 'string' || !ACTIVITY_ID_PATTERN.test(raw.activityId) || raw.activityId.length > 120) {
    throw new TypeError('Invalid activityId');
  }
  if (typeof raw.category !== 'string' || !/^[A-Z][A-Z0-9_]{1,31}$/.test(raw.category)) {
    throw new TypeError(`Invalid category for ${raw.activityId}`);
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) throw new TypeError(`Invalid title for ${raw.activityId}`);
  if (!tiers.has(raw.authorityTier)) throw new TypeError(`Invalid authorityTier for ${raw.activityId}`);
  if (!modes.has(raw.attemptMode)) throw new TypeError(`Invalid attemptMode for ${raw.activityId}`);
  if (!repeatPolicies.has(raw.repeatPolicy)) throw new TypeError(`Invalid repeatPolicy for ${raw.activityId}`);
  if (!definitionStatuses.has(raw.status)) throw new TypeError(`Invalid status for ${raw.activityId}`);
  if (!Number.isInteger(raw.definitionVersion) || raw.definitionVersion < 1) {
    throw new TypeError(`Invalid definitionVersion for ${raw.activityId}`);
  }
  if (!Number.isInteger(raw.outcomeSchemaVersion) || raw.outcomeSchemaVersion < 1) {
    throw new TypeError(`Invalid outcomeSchemaVersion for ${raw.activityId}`);
  }

  if (raw.attemptMode === ACTIVITY_ATTEMPT_MODE.SESSION &&
      raw.authorityTier !== ACTIVITY_AUTHORITY_TIER.AUTHORITATIVE_SESSION) {
    throw new TypeError(`SESSION requires T2 authority: ${raw.activityId}`);
  }
  if (raw.authorityTier === ACTIVITY_AUTHORITY_TIER.AUTHORITATIVE_SESSION &&
      raw.attemptMode !== ACTIVITY_ATTEMPT_MODE.SESSION) {
    throw new TypeError(`T2 authority requires SESSION mode: ${raw.activityId}`);
  }

  const needsServerRefs = raw.authorityTier !== ACTIVITY_AUTHORITY_TIER.LOCAL_COSMETIC;
  const eligibilityRef = raw.eligibilityRef == null ? null : stableRef(raw.eligibilityRef, 'eligibilityRef');
  const resolverRef = raw.resolverRef == null ? null : stableRef(raw.resolverRef, 'resolverRef');
  if (needsServerRefs && (!eligibilityRef || !resolverRef)) {
    throw new TypeError(`Server-valued activity requires eligibilityRef and resolverRef: ${raw.activityId}`);
  }

  if (!Array.isArray(raw.semanticEventTypes) || raw.semanticEventTypes.length === 0 ||
      raw.semanticEventTypes.some(type => typeof type !== 'string' || !ACTIVITY_SEMANTIC_EVENT_PATTERN.test(type))) {
    throw new TypeError(`Invalid semanticEventTypes for ${raw.activityId}`);
  }
  if (new Set(raw.semanticEventTypes).size !== raw.semanticEventTypes.length) {
    throw new TypeError(`Duplicate semanticEventTypes for ${raw.activityId}`);
  }
  if (!Array.isArray(raw.tags) || raw.tags.some(tag => typeof tag !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(tag))) {
    throw new TypeError(`Invalid tags for ${raw.activityId}`);
  }

  return Object.freeze({
    activityId: raw.activityId,
    category: raw.category,
    title: raw.title.trim(),
    authorityTier: raw.authorityTier,
    attemptMode: raw.attemptMode,
    repeatPolicy: raw.repeatPolicy,
    eligibilityRef,
    resolverRef,
    outcomeSchemaVersion: raw.outcomeSchemaVersion,
    semanticEventTypes: Object.freeze([...raw.semanticEventTypes]),
    status: raw.status,
    tags: Object.freeze([...raw.tags]),
    definitionVersion: raw.definitionVersion
  });
}

export const DEFAULT_ACTIVITY_DEFINITIONS = Object.freeze({
  FISHING_INKYUNG: createActivityDefinition({
    activityId: 'activity.fishing.inkyung',
    category: 'FISHING',
    title: '인경호 낚시',
    authorityTier: ACTIVITY_AUTHORITY_TIER.SERVER_VALIDATED,
    attemptMode: ACTIVITY_ATTEMPT_MODE.INTERACTIVE,
    repeatPolicy: ACTIVITY_REPEAT_POLICY.REPEATABLE,
    eligibilityRef: 'eligibility.fishing.inkyung_v1',
    resolverRef: 'resolver.fishing.inkyung_v1',
    outcomeSchemaVersion: 1,
    semanticEventTypes: ['activity.succeeded', 'activity.failed', 'activity.fishing.catch'],
    status: ACTIVITY_DEFINITION_STATUS.ACTIVE,
    tags: ['life', 'fishing', 'p1a'],
    definitionVersion: 1
  }),
  GATHERING_CAMPUS: createActivityDefinition({
    activityId: 'activity.gathering.campus',
    category: 'GATHERING',
    title: '캠퍼스 채집',
    authorityTier: ACTIVITY_AUTHORITY_TIER.SERVER_VALIDATED,
    attemptMode: ACTIVITY_ATTEMPT_MODE.INSTANT,
    repeatPolicy: ACTIVITY_REPEAT_POLICY.REPEATABLE,
    eligibilityRef: 'eligibility.gathering.campus_v1',
    resolverRef: 'resolver.gathering.campus_v1',
    outcomeSchemaVersion: 1,
    semanticEventTypes: ['activity.succeeded', 'activity.failed', 'activity.gathering.harvest'],
    status: ACTIVITY_DEFINITION_STATUS.COMING_SOON,
    tags: ['life', 'gathering', 'p1a'],
    definitionVersion: 1
  }),
  ARCHAEOLOGY_CAMPUS_HISTORY: createActivityDefinition({
    activityId: 'activity.archaeology.campus_history',
    category: 'ARCHAEOLOGY',
    title: '캠퍼스 역사 발굴',
    authorityTier: ACTIVITY_AUTHORITY_TIER.SERVER_VALIDATED,
    attemptMode: ACTIVITY_ATTEMPT_MODE.INTERACTIVE,
    repeatPolicy: ACTIVITY_REPEAT_POLICY.REPEATABLE,
    eligibilityRef: 'eligibility.archaeology.campus_history_v1',
    resolverRef: 'resolver.archaeology.campus_history_v1',
    outcomeSchemaVersion: 1,
    semanticEventTypes: ['activity.succeeded', 'activity.failed', 'activity.archaeology.excavate'],
    status: ACTIVITY_DEFINITION_STATUS.COMING_SOON,
    tags: ['life', 'archaeology', 'p1a'],
    definitionVersion: 1
  })
});

export function createActivityRegistry({ definitions = Object.values(DEFAULT_ACTIVITY_DEFINITIONS) } = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const item = createActivityDefinition(raw);
    if (byId.has(item.activityId)) throw new Error(`Duplicate activityId: ${item.activityId}`);
    byId.set(item.activityId, item);
  }
  return Object.freeze({
    get: activityId => byId.get(activityId) ?? null,
    has: activityId => byId.has(activityId),
    list: () => Object.freeze([...byId.values()]),
    get size() { return byId.size; }
  });
}

export const ACTIVITY_REGISTRY = createActivityRegistry();

export function validateActivityStartRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Activity start request must be an object');
  }
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(key)) throw new TypeError(`Client authority field is forbidden: ${key}`);
    if (!START_REQUEST_FIELDS.has(key)) throw new TypeError(`Unrecognized activity start field: ${key}`);
  }
  if (typeof raw.activityId !== 'string' || !ACTIVITY_ID_PATTERN.test(raw.activityId) || raw.activityId.length > 120) {
    throw new TypeError('Invalid activityId');
  }
  const sourceRef = stableRef(raw.sourceRef, 'sourceRef');
  if (typeof raw.clientAttemptKey !== 'string' || !ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN.test(raw.clientAttemptKey)) {
    throw new TypeError('Invalid clientAttemptKey');
  }
  const evidence = raw.evidence ?? null;
  if (evidence !== null) {
    if (typeof evidence !== 'object' || Array.isArray(evidence)) throw new TypeError('Evidence must be an object');
    if (JSON.stringify(evidence).length > 2048) throw new TypeError('Evidence is too large');
  }
  return Object.freeze({
    activityId: raw.activityId,
    sourceRef,
    clientAttemptKey: raw.clientAttemptKey.toLowerCase(),
    evidence: evidence === null ? null : Object.freeze({ ...evidence })
  });
}

export function isTerminalActivityState(state) {
  return terminalStates.has(state);
}

export function assertActivityStateTransition(from, to) {
  if (!states.has(from) || !states.has(to)) throw new TypeError('Unknown activity attempt state');
  const allowed =
    (from === ACTIVITY_ATTEMPT_STATE.CREATED && to === ACTIVITY_ATTEMPT_STATE.ACTIVE) ||
    (from === ACTIVITY_ATTEMPT_STATE.ACTIVE && terminalStates.has(to));
  if (!allowed) throw new Error(`Invalid activity transition: ${from} -> ${to}`);
  return true;
}

export function createActivitySemanticEvent({
  type, activityId, attemptId, sourceRef, resultRef = null, occurredAt, actorUserId
}) {
  if (typeof type !== 'string' || !ACTIVITY_SEMANTIC_EVENT_PATTERN.test(type)) throw new TypeError('Invalid semantic event type');
  if (typeof activityId !== 'string' || !ACTIVITY_ID_PATTERN.test(activityId)) throw new TypeError('Invalid activityId');
  stableRef(sourceRef, 'sourceRef');
  if (typeof attemptId !== 'string' || !ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN.test(attemptId)) throw new TypeError('Invalid attemptId');
  if (resultRef !== null && (typeof resultRef !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(resultRef))) {
    throw new TypeError('Invalid resultRef');
  }
  if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) throw new TypeError('Invalid occurredAt');
  if (typeof actorUserId !== 'string' || !ACTIVITY_CLIENT_ATTEMPT_KEY_PATTERN.test(actorUserId)) throw new TypeError('Invalid actorUserId');
  return Object.freeze({ type, activityId, attemptId, sourceRef, resultRef, occurredAt, actorUserId });
}
