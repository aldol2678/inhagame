// INHA WORLD Creature Core P0 pure contract.
// Creature Core owns Species/Form, Ownership/Party, Observation, Memory/Growth and Evolution.
// External systems may submit only verified source-result identities; they never choose XP,
// memory tags, form changes or evolution outcomes.

export const CREATURE_DEFINITION_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMING_SOON: 'COMING_SOON',
  DISABLED: 'DISABLED',
  HIDDEN: 'HIDDEN'
});

export const CREATURE_SOURCE_DOMAIN = Object.freeze({
  ACTIVITY: 'ACTIVITY',
  COMBAT: 'COMBAT',
  EXPLORATION: 'EXPLORATION',
  SOCIAL: 'SOCIAL',
  HOUSING: 'HOUSING'
});

export const CREATURE_ACTIVITY_DECISION = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  NOOP_NO_ACTIVE: 'NOOP_NO_ACTIVE',
  NOOP_COOLDOWN: 'NOOP_COOLDOWN',
  NOOP_CAP: 'NOOP_CAP'
});

export const CREATURE_EVOLUTION_STATUS = Object.freeze({
  CANDIDATE: 'CANDIDATE',
  READY: 'READY',
  COMMITTED: 'COMMITTED',
  REJECTED: 'REJECTED'
});

export const CREATURE_SPECIES_ID_PATTERN = /^creature\.species\.[a-z][a-z0-9_]*$/;
export const CREATURE_FORM_ID_PATTERN = /^creature\.form\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const CREATURE_BRIDGE_ID_PATTERN = /^creature\.bridge\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,3}$/;
export const CREATURE_EVOLUTION_RULE_ID_PATTERN =
  /^creature\.evolution\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,3}$/;
export const CREATURE_MEMORY_TAG_PATTERN = /^memory\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){0,3}$/;
export const CREATURE_SOURCE_REF_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,6}$/;
export const CREATURE_RESULT_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
export const CREATURE_IDEMPOTENCY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

const statuses = new Set(Object.values(CREATURE_DEFINITION_STATUS));
const sourceDomains = new Set(Object.values(CREATURE_SOURCE_DOMAIN));

function frozenList(values = []) {
  return Object.freeze([...values]);
}

function assertStatus(status, label) {
  if (!statuses.has(status)) throw new TypeError(`Invalid ${label} status`);
  return status;
}

function assertStableRef(value, pattern, label, maxLength = 200) {
  if (typeof value !== 'string' || value.length > maxLength || !pattern.test(value)) {
    throw new TypeError(`Invalid ${label}`);
  }
  return value;
}

export function createCreatureSpeciesDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Creature species definition must be an object');
  }
  assertStableRef(raw.speciesId, CREATURE_SPECIES_ID_PATTERN, 'speciesId', 100);
  assertStatus(raw.status, 'species');
  if (!Number.isInteger(raw.definitionVersion) || raw.definitionVersion < 1) {
    throw new TypeError(`Invalid definitionVersion for ${raw.speciesId}`);
  }
  if (!Array.isArray(raw.tags) || raw.tags.some(tag =>
    typeof tag !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(tag))) {
    throw new TypeError(`Invalid tags for ${raw.speciesId}`);
  }
  return Object.freeze({
    speciesId: raw.speciesId,
    status: raw.status,
    tags: frozenList(raw.tags),
    definitionVersion: raw.definitionVersion
  });
}

export const DEFAULT_CREATURE_SPECIES_DEFINITIONS = Object.freeze({
  DUCK: createCreatureSpeciesDefinition({
    speciesId: 'creature.species.duck',
    status: CREATURE_DEFINITION_STATUS.ACTIVE,
    tags: ['campus', 'inkyung'],
    definitionVersion: 1
  }),
  PAGELING: createCreatureSpeciesDefinition({
    speciesId: 'creature.species.pageling',
    status: CREATURE_DEFINITION_STATUS.COMING_SOON,
    tags: ['candidate'],
    definitionVersion: 1
  }),
  VOLTI: createCreatureSpeciesDefinition({
    speciesId: 'creature.species.volti',
    status: CREATURE_DEFINITION_STATUS.COMING_SOON,
    tags: ['candidate'],
    definitionVersion: 1
  }),
  PORONG: createCreatureSpeciesDefinition({
    speciesId: 'creature.species.porong',
    status: CREATURE_DEFINITION_STATUS.COMING_SOON,
    tags: ['candidate'],
    definitionVersion: 1
  })
});

export function createCreatureSpeciesRegistry({
  definitions = Object.values(DEFAULT_CREATURE_SPECIES_DEFINITIONS)
} = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const definition = createCreatureSpeciesDefinition(raw);
    if (byId.has(definition.speciesId)) throw new Error(`Duplicate speciesId: ${definition.speciesId}`);
    byId.set(definition.speciesId, definition);
  }
  return Object.freeze({
    get: speciesId => byId.get(speciesId) ?? null,
    has: speciesId => byId.has(speciesId),
    list: () => frozenList(byId.values()),
    get size() { return byId.size; }
  });
}

export const CREATURE_SPECIES_REGISTRY = createCreatureSpeciesRegistry();

export function createCreatureFormDefinition(raw, { speciesRegistry = CREATURE_SPECIES_REGISTRY } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Creature form definition must be an object');
  }
  assertStableRef(raw.formId, CREATURE_FORM_ID_PATTERN, 'formId', 120);
  if (typeof raw.speciesId !== 'string' || !speciesRegistry.has(raw.speciesId)) {
    throw new TypeError(`Unknown speciesId for ${raw.formId}`);
  }
  const formSpeciesSlug = raw.formId.split('.')[2];
  const speciesSlug = raw.speciesId.split('.')[2];
  if (formSpeciesSlug !== speciesSlug) throw new TypeError(`Form/species mismatch for ${raw.formId}`);
  assertStatus(raw.status, 'form');
  if (!Number.isInteger(raw.definitionVersion) || raw.definitionVersion < 1) {
    throw new TypeError(`Invalid definitionVersion for ${raw.formId}`);
  }
  return Object.freeze({
    formId: raw.formId,
    speciesId: raw.speciesId,
    status: raw.status,
    definitionVersion: raw.definitionVersion
  });
}

export const DEFAULT_CREATURE_FORM_DEFINITIONS = Object.freeze([
  Object.freeze({
    formId: 'creature.form.duck.base',
    speciesId: 'creature.species.duck',
    status: CREATURE_DEFINITION_STATUS.ACTIVE,
    definitionVersion: 1
  })
]);

export function createCreatureFormRegistry({
  definitions = DEFAULT_CREATURE_FORM_DEFINITIONS,
  speciesRegistry = CREATURE_SPECIES_REGISTRY
} = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const definition = createCreatureFormDefinition(raw, { speciesRegistry });
    if (byId.has(definition.formId)) throw new Error(`Duplicate formId: ${definition.formId}`);
    byId.set(definition.formId, definition);
  }
  return Object.freeze({
    get: formId => byId.get(formId) ?? null,
    has: formId => byId.has(formId),
    list: () => frozenList(byId.values()),
    forSpecies: speciesId => frozenList([...byId.values()].filter(form => form.speciesId === speciesId)),
    get size() { return byId.size; }
  });
}

export const CREATURE_FORM_REGISTRY = createCreatureFormRegistry();

export function createCreatureActivityBridgeDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Creature activity bridge definition must be an object');
  }
  assertStableRef(raw.bridgeId, CREATURE_BRIDGE_ID_PATTERN, 'bridgeId', 120);
  if (!sourceDomains.has(raw.sourceDomain)) throw new TypeError(`Invalid sourceDomain for ${raw.bridgeId}`);
  if (typeof raw.semanticEventType !== 'string' ||
      !/^(activity|combat|exploration|social|housing)\.[a-z][a-z0-9_.]{0,95}$/.test(raw.semanticEventType)) {
    throw new TypeError(`Invalid semanticEventType for ${raw.bridgeId}`);
  }
  const expectedPrefix = raw.sourceDomain.toLowerCase() + '.';
  if (!raw.semanticEventType.startsWith(expectedPrefix)) {
    throw new TypeError(`sourceDomain/event mismatch for ${raw.bridgeId}`);
  }
  assertStableRef(raw.memoryTag, CREATURE_MEMORY_TAG_PATTERN, 'memoryTag', 120);
  assertStatus(raw.status, 'bridge');
  for (const [label, value] of Object.entries({
    xpAmount: raw.xpAmount,
    cooldownSeconds: raw.cooldownSeconds
  })) {
    if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`Invalid ${label} for ${raw.bridgeId}`);
  }
  if (raw.dailyCap !== null && (!Number.isSafeInteger(raw.dailyCap) || raw.dailyCap < 1)) {
    throw new TypeError(`Invalid dailyCap for ${raw.bridgeId}`);
  }
  if (!Number.isInteger(raw.definitionVersion) || raw.definitionVersion < 1) {
    throw new TypeError(`Invalid definitionVersion for ${raw.bridgeId}`);
  }
  return Object.freeze({
    bridgeId: raw.bridgeId,
    sourceDomain: raw.sourceDomain,
    semanticEventType: raw.semanticEventType,
    memoryTag: raw.memoryTag,
    xpAmount: raw.xpAmount,
    cooldownSeconds: raw.cooldownSeconds,
    dailyCap: raw.dailyCap,
    status: raw.status,
    definitionVersion: raw.definitionVersion
  });
}

export const DEFAULT_CREATURE_ACTIVITY_BRIDGES = Object.freeze([]);

export function createCreatureActivityBridgeRegistry({
  definitions = DEFAULT_CREATURE_ACTIVITY_BRIDGES
} = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const definition = createCreatureActivityBridgeDefinition(raw);
    if (byId.has(definition.bridgeId)) throw new Error(`Duplicate bridgeId: ${definition.bridgeId}`);
    byId.set(definition.bridgeId, definition);
  }
  return Object.freeze({
    get: bridgeId => byId.get(bridgeId) ?? null,
    list: () => frozenList(byId.values()),
    get size() { return byId.size; }
  });
}

export const CREATURE_ACTIVITY_BRIDGE_REGISTRY = createCreatureActivityBridgeRegistry();

export function createCreatureEvolutionRuleDefinition(raw, {
  formRegistry = CREATURE_FORM_REGISTRY
} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Creature evolution rule must be an object');
  }
  assertStableRef(raw.ruleId, CREATURE_EVOLUTION_RULE_ID_PATTERN, 'ruleId', 140);
  const from = formRegistry.get(raw.fromFormId);
  const to = formRegistry.get(raw.toFormId);
  if (!from || !to) throw new TypeError(`Unknown evolution form for ${raw.ruleId}`);
  if (from.speciesId !== to.speciesId) throw new TypeError(`Cross-species evolution for ${raw.ruleId}`);
  assertStableRef(raw.requiredMemoryTag, CREATURE_MEMORY_TAG_PATTERN, 'requiredMemoryTag', 120);
  if (!Number.isSafeInteger(raw.requiredMemoryCount) || raw.requiredMemoryCount < 1) {
    throw new TypeError(`Invalid requiredMemoryCount for ${raw.ruleId}`);
  }
  assertStableRef(raw.contextRef, CREATURE_SOURCE_REF_PATTERN, 'contextRef', 160);
  assertStatus(raw.status, 'evolution rule');
  if (!Number.isInteger(raw.definitionVersion) || raw.definitionVersion < 1) {
    throw new TypeError(`Invalid definitionVersion for ${raw.ruleId}`);
  }
  return Object.freeze({
    ruleId: raw.ruleId,
    speciesId: from.speciesId,
    fromFormId: raw.fromFormId,
    toFormId: raw.toFormId,
    requiredMemoryTag: raw.requiredMemoryTag,
    requiredMemoryCount: raw.requiredMemoryCount,
    contextRef: raw.contextRef,
    status: raw.status,
    definitionVersion: raw.definitionVersion
  });
}

export const DEFAULT_CREATURE_EVOLUTION_RULES = Object.freeze([]);

export function createCreatureEvolutionRuleRegistry({
  definitions = DEFAULT_CREATURE_EVOLUTION_RULES,
  formRegistry = CREATURE_FORM_REGISTRY
} = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const definition = createCreatureEvolutionRuleDefinition(raw, { formRegistry });
    if (byId.has(definition.ruleId)) throw new Error(`Duplicate evolution rule: ${definition.ruleId}`);
    byId.set(definition.ruleId, definition);
  }
  return Object.freeze({
    get: ruleId => byId.get(ruleId) ?? null,
    list: () => frozenList(byId.values()),
    get size() { return byId.size; }
  });
}

export const CREATURE_EVOLUTION_RULE_REGISTRY = createCreatureEvolutionRuleRegistry();

export function validateCreaturePartyShape({
  activeCreatureId = null,
  reserveCreatureIds = []
} = {}) {
  if (!Array.isArray(reserveCreatureIds) || reserveCreatureIds.length > 2) {
    throw new TypeError('Creature party supports at most two reserves');
  }
  const ids = [activeCreatureId, ...reserveCreatureIds].filter(value => value !== null);
  if (ids.some(value => typeof value !== 'string' || !value.trim())) {
    throw new TypeError('Invalid creature party id');
  }
  if (new Set(ids).size !== ids.length) throw new TypeError('Creature party contains duplicates');
  if (activeCreatureId === null && reserveCreatureIds.length > 0) {
    throw new TypeError('Reserve creatures require an active creature');
  }
  return Object.freeze({
    activeCreatureId,
    reserveCreatureIds: frozenList(reserveCreatureIds)
  });
}

const ACTIVITY_INGRESS_FIELDS = new Set([
  'bridgeId', 'sourceRef', 'sourceResultRef', 'sourceEventKey', 'partyRevision', 'occurredAt'
]);
const FORBIDDEN_ACTIVITY_AUTHORITY_FIELDS = new Set([
  'creatureId', 'xp', 'xpAmount', 'memoryTag', 'memoryTags', 'bond', 'bondLevel',
  'trait', 'traits', 'formId', 'nextFormId', 'evolution', 'evolutionRuleId',
  'damage', 'rewardId', 'rewardAmount', 'loot'
]);

export function validateCreatureActivityIngress(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Creature activity ingress must be an object');
  }
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_ACTIVITY_AUTHORITY_FIELDS.has(key)) {
      throw new TypeError(`External Creature authority field is forbidden: ${key}`);
    }
    if (!ACTIVITY_INGRESS_FIELDS.has(key)) throw new TypeError(`Unrecognized Creature ingress field: ${key}`);
  }
  assertStableRef(raw.bridgeId, CREATURE_BRIDGE_ID_PATTERN, 'bridgeId', 120);
  assertStableRef(raw.sourceRef, CREATURE_SOURCE_REF_PATTERN, 'sourceRef', 160);
  assertStableRef(raw.sourceResultRef, CREATURE_RESULT_REF_PATTERN, 'sourceResultRef', 200);
  assertStableRef(raw.sourceEventKey, CREATURE_IDEMPOTENCY_PATTERN, 'sourceEventKey', 200);
  if (!Number.isSafeInteger(raw.partyRevision) || raw.partyRevision < 0) {
    throw new TypeError('Invalid partyRevision');
  }
  if (typeof raw.occurredAt !== 'string' || Number.isNaN(Date.parse(raw.occurredAt))) {
    throw new TypeError('Invalid occurredAt');
  }
  return Object.freeze({
    bridgeId: raw.bridgeId,
    sourceRef: raw.sourceRef,
    sourceResultRef: raw.sourceResultRef,
    sourceEventKey: raw.sourceEventKey,
    partyRevision: raw.partyRevision,
    occurredAt: raw.occurredAt
  });
}

export function creatureSpeciesAuthorityRow(definition) {
  return Object.freeze({
    species_id: definition.speciesId,
    status: definition.status,
    definition_version: definition.definitionVersion
  });
}

export function creatureFormAuthorityRow(definition) {
  return Object.freeze({
    form_id: definition.formId,
    species_id: definition.speciesId,
    status: definition.status,
    definition_version: definition.definitionVersion
  });
}

export function creatureBridgeAuthorityRow(definition) {
  return Object.freeze({
    bridge_id: definition.bridgeId,
    source_domain: definition.sourceDomain,
    semantic_event_type: definition.semanticEventType,
    memory_tag: definition.memoryTag,
    xp_amount: definition.xpAmount,
    cooldown_seconds: definition.cooldownSeconds,
    daily_cap: definition.dailyCap,
    status: definition.status,
    definition_version: definition.definitionVersion
  });
}

export function creatureEvolutionRuleAuthorityRow(definition) {
  return Object.freeze({
    rule_id: definition.ruleId,
    species_id: definition.speciesId,
    from_form_id: definition.fromFormId,
    to_form_id: definition.toFormId,
    required_memory_tag: definition.requiredMemoryTag,
    required_memory_count: definition.requiredMemoryCount,
    context_ref: definition.contextRef,
    status: definition.status,
    definition_version: definition.definitionVersion
  });
}