// INHA WORLD Combat Authority P0 pure contract.
// Product semantics + deterministic low-level resolution only.
// No live encounters, rewards, Player EXP, Life XP, Creature XP, loot settlement or runtime AI.

export const COMBAT_DEFINITION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMING_SOON: 'COMING_SOON',
  DISABLED: 'DISABLED',
  HIDDEN: 'HIDDEN'
});

export const COMBAT_AVAILABILITY = Object.freeze({
  SAFE: 'SAFE',
  CONDITIONAL: 'CONDITIONAL',
  ACTIVE: 'ACTIVE'
});

export const COMBAT_ENCOUNTER_STATE = Object.freeze({
  CREATED: 'CREATED',
  ACTIVE: 'ACTIVE',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED'
});

export const COMBAT_ID_PATTERN = /^combat\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,4}$/;
export const COMBAT_SOURCE_REF_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,5}$/;
export const COMBAT_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const COMBAT_EVENT_TYPE_PATTERN =
  /^combat\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){0,3}$/;

const statuses = new Set(Object.values(COMBAT_DEFINITION_STATUS));
const availabilities = new Set(Object.values(COMBAT_AVAILABILITY));
const states = new Set(Object.values(COMBAT_ENCOUNTER_STATE));
const terminalStates = new Set([
  COMBAT_ENCOUNTER_STATE.SUCCEEDED,
  COMBAT_ENCOUNTER_STATE.FAILED,
  COMBAT_ENCOUNTER_STATE.CANCELLED,
  COMBAT_ENCOUNTER_STATE.EXPIRED
]);

const START_FIELDS = new Set(['combatId', 'sourceRef', 'clientEncounterKey', 'evidence']);
const FORBIDDEN_CLIENT_AUTHORITY_FIELDS = new Set([
  'damage', 'damageAmount', 'hp', 'maxHp', 'shield', 'break', 'breakValue',
  'enemyHp', 'enemyState', 'resultRef', 'rewardId', 'rewardAmount', 'amount',
  'playerExp', 'lifeXp', 'creatureXp', 'loot', 'lootTable', 'outputItemId',
  'outputQuantity', 'rarity', 'wallet', 'inventory'
]);

function stableRef(value, label) {
  if (typeof value !== 'string' || !COMBAT_SOURCE_REF_PATTERN.test(value) || value.length > 160) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${label}`);
  return value;
}

export function createCombatDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Combat definition must be an object');
  }
  if (typeof raw.combatId !== 'string' || !COMBAT_ID_PATTERN.test(raw.combatId) || raw.combatId.length > 120) {
    throw new TypeError('Invalid combatId');
  }
  if (typeof raw.category !== 'string' || !/^[A-Z][A-Z0-9_]{1,31}$/.test(raw.category)) {
    throw new TypeError(`Invalid category for ${raw.combatId}`);
  }
  if (typeof raw.title !== 'string' || !raw.title.trim()) {
    throw new TypeError(`Invalid title for ${raw.combatId}`);
  }
  if (!statuses.has(raw.status)) throw new TypeError(`Invalid status for ${raw.combatId}`);
  if (!availabilities.has(raw.availability)) {
    throw new TypeError(`Invalid availability for ${raw.combatId}`);
  }
  const availabilityRef = stableRef(raw.availabilityRef, 'availabilityRef');
  const resolverRef = stableRef(raw.resolverRef, 'resolverRef');
  if (!Number.isInteger(raw.definitionVersion) || raw.definitionVersion < 1) {
    throw new TypeError(`Invalid definitionVersion for ${raw.combatId}`);
  }
  if (!Number.isInteger(raw.outcomeSchemaVersion) || raw.outcomeSchemaVersion < 1) {
    throw new TypeError(`Invalid outcomeSchemaVersion for ${raw.combatId}`);
  }
  if (!Array.isArray(raw.semanticEventTypes) || raw.semanticEventTypes.length === 0 ||
      raw.semanticEventTypes.some(type =>
        typeof type !== 'string' || !COMBAT_EVENT_TYPE_PATTERN.test(type))) {
    throw new TypeError(`Invalid semanticEventTypes for ${raw.combatId}`);
  }
  if (new Set(raw.semanticEventTypes).size !== raw.semanticEventTypes.length) {
    throw new TypeError(`Duplicate semanticEventTypes for ${raw.combatId}`);
  }
  if (!Array.isArray(raw.tags) || raw.tags.some(tag =>
    typeof tag !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(tag))) {
    throw new TypeError(`Invalid tags for ${raw.combatId}`);
  }

  return Object.freeze({
    combatId: raw.combatId,
    category: raw.category,
    title: raw.title.trim(),
    availability: raw.availability,
    availabilityRef,
    resolverRef,
    outcomeSchemaVersion: raw.outcomeSchemaVersion,
    semanticEventTypes: Object.freeze([...raw.semanticEventTypes]),
    status: raw.status,
    tags: Object.freeze([...raw.tags]),
    definitionVersion: raw.definitionVersion
  });
}

// P0 deliberately commits no live encounter identity.
// BREAKER v0 and Biryong encounters remain design candidates until a vertical slice is approved.
export const DEFAULT_COMBAT_DEFINITIONS = Object.freeze([]);

export function createCombatRegistry({ definitions = DEFAULT_COMBAT_DEFINITIONS } = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const definition = createCombatDefinition(raw);
    if (byId.has(definition.combatId)) throw new Error(`Duplicate combatId: ${definition.combatId}`);
    byId.set(definition.combatId, definition);
  }
  return Object.freeze({
    get: combatId => byId.get(combatId) ?? null,
    has: combatId => byId.has(combatId),
    list: () => Object.freeze([...byId.values()]),
    get size() { return byId.size; }
  });
}

export const COMBAT_REGISTRY = createCombatRegistry();

export function combatAuthorityRow(definition) {
  if (!definition) throw new TypeError('Combat definition is required');
  return Object.freeze({
    combat_id: definition.combatId,
    category: definition.category,
    availability: definition.availability,
    availability_ref: definition.availabilityRef,
    resolver_ref: definition.resolverRef,
    status: definition.status,
    definition_version: definition.definitionVersion,
    outcome_schema_version: definition.outcomeSchemaVersion
  });
}

export function validateCombatStartRequest(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Combat start request must be an object');
  }
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_CLIENT_AUTHORITY_FIELDS.has(key)) {
      throw new TypeError(`Client combat authority field is forbidden: ${key}`);
    }
    if (!START_FIELDS.has(key)) throw new TypeError(`Unrecognized combat start field: ${key}`);
  }
  if (typeof raw.combatId !== 'string' || !COMBAT_ID_PATTERN.test(raw.combatId) || raw.combatId.length > 120) {
    throw new TypeError('Invalid combatId');
  }
  const sourceRef = stableRef(raw.sourceRef, 'sourceRef');
  if (typeof raw.clientEncounterKey !== 'string' || !COMBAT_UUID_PATTERN.test(raw.clientEncounterKey)) {
    throw new TypeError('Invalid clientEncounterKey');
  }
  const evidence = raw.evidence ?? null;
  if (evidence !== null) {
    if (typeof evidence !== 'object' || Array.isArray(evidence)) throw new TypeError('Evidence must be an object');
    if (JSON.stringify(evidence).length > 2048) throw new TypeError('Evidence is too large');
  }
  return Object.freeze({
    combatId: raw.combatId,
    sourceRef,
    clientEncounterKey: raw.clientEncounterKey.toLowerCase(),
    evidence: evidence === null ? null : Object.freeze({ ...evidence })
  });
}

export function isTerminalCombatState(state) {
  return terminalStates.has(state);
}

export function assertCombatStateTransition(from, to) {
  if (!states.has(from) || !states.has(to)) throw new TypeError('Unknown combat encounter state');
  const allowed =
    (from === COMBAT_ENCOUNTER_STATE.CREATED && to === COMBAT_ENCOUNTER_STATE.ACTIVE) ||
    (from === COMBAT_ENCOUNTER_STATE.ACTIVE && terminalStates.has(to));
  if (!allowed) throw new Error(`Invalid combat transition: ${from} -> ${to}`);
  return true;
}

// Low-level deterministic damage application.
// The upstream Combat resolver owns the balance formula that produces resolvedReduction.
// This function commits only the already-resolved ordering: reduction -> shield -> HP -> death.
export function resolveCombatDamage({
  hp,
  maxHp,
  shield = 0,
  incomingDamage,
  resolvedReduction = 0
}) {
  for (const [label, value] of Object.entries({ hp, maxHp, shield, incomingDamage, resolvedReduction })) {
    nonNegativeInteger(value, label);
  }
  if (maxHp < 1 || hp > maxHp) throw new TypeError('Invalid HP bounds');

  const damageAfterReduction = Math.max(0, incomingDamage - resolvedReduction);
  const shieldAbsorbed = Math.min(shield, damageAfterReduction);
  const hpDamage = damageAfterReduction - shieldAbsorbed;
  const nextShield = shield - shieldAbsorbed;
  const nextHp = Math.max(0, hp - hpDamage);

  return Object.freeze({
    incomingDamage,
    resolvedReduction,
    damageAfterReduction,
    shieldAbsorbed,
    hpDamage,
    hpBefore: hp,
    hpAfter: nextHp,
    shieldBefore: shield,
    shieldAfter: nextShield,
    died: nextHp === 0
  });
}

export function resolveCombatBreak({
  breakValue,
  breakMax,
  incomingBreak
}) {
  for (const [label, value] of Object.entries({ breakValue, breakMax, incomingBreak })) {
    nonNegativeInteger(value, label);
  }
  if (breakMax < 1 || breakValue > breakMax) throw new TypeError('Invalid Break bounds');

  const nextBreak = Math.min(breakMax, breakValue + incomingBreak);
  return Object.freeze({
    breakBefore: breakValue,
    breakAfter: nextBreak,
    breakMax,
    incomingBreak,
    broken: nextBreak >= breakMax
  });
}

export function createCombatSemanticEvent({
  type,
  combatId,
  encounterId,
  sourceRef,
  resultRef = null,
  occurredAt,
  actorUserId
}) {
  if (typeof type !== 'string' || !COMBAT_EVENT_TYPE_PATTERN.test(type)) {
    throw new TypeError('Invalid combat event type');
  }
  if (typeof combatId !== 'string' || !COMBAT_ID_PATTERN.test(combatId)) {
    throw new TypeError('Invalid combatId');
  }
  if (typeof encounterId !== 'string' || !COMBAT_UUID_PATTERN.test(encounterId)) {
    throw new TypeError('Invalid encounterId');
  }
  stableRef(sourceRef, 'sourceRef');
  if (resultRef !== null && (typeof resultRef !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(resultRef))) {
    throw new TypeError('Invalid resultRef');
  }
  if (typeof occurredAt !== 'string' || Number.isNaN(Date.parse(occurredAt))) {
    throw new TypeError('Invalid occurredAt');
  }
  if (typeof actorUserId !== 'string' || !COMBAT_UUID_PATTERN.test(actorUserId)) {
    throw new TypeError('Invalid actorUserId');
  }

  return Object.freeze({
    type,
    combatId,
    encounterId,
    sourceRef,
    resultRef,
    occurredAt,
    actorUserId
  });
}
