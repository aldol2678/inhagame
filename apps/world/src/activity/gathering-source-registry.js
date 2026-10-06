// INHA WORLD Gathering P0 source Registry.
// Product-semantic source/output identity only. Player position, cooldown and settlement remain server-authoritative.

export const GATHERING_SOURCE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMING_SOON: 'COMING_SOON',
  DISABLED: 'DISABLED',
  HIDDEN: 'HIDDEN'
});

export const GATHERING_SOURCE_REF_PATTERN = /^gathering\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,4}$/;
const statuses = new Set(Object.values(GATHERING_SOURCE_STATUS));

export function createGatheringSourceDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Gathering source definition must be an object');
  }
  if (typeof raw.sourceRef !== 'string' || !GATHERING_SOURCE_REF_PATTERN.test(raw.sourceRef) || raw.sourceRef.length > 160) {
    throw new TypeError('Invalid Gathering sourceRef');
  }
  if (typeof raw.displayName !== 'string' || !raw.displayName.trim()) {
    throw new TypeError(`Invalid displayName for ${raw.sourceRef}`);
  }
  if (raw.activityId !== 'activity.gathering.campus') {
    throw new TypeError(`Invalid activityId for ${raw.sourceRef}`);
  }
  if (raw.itemId !== 'material.campus_leaf') {
    throw new TypeError(`Invalid itemId for ${raw.sourceRef}`);
  }
  if (raw.collectionEntryId !== 'collection.plant.campus_leaf') {
    throw new TypeError(`Invalid collectionEntryId for ${raw.sourceRef}`);
  }
  if (raw.skillId !== 'life.gathering') {
    throw new TypeError(`Invalid skillId for ${raw.sourceRef}`);
  }
  if (!Number.isInteger(raw.quantity) || raw.quantity < 1 || raw.quantity > 99) {
    throw new TypeError(`Invalid quantity for ${raw.sourceRef}`);
  }
  if (!statuses.has(raw.status)) throw new TypeError(`Invalid status for ${raw.sourceRef}`);
  if (!Number.isInteger(raw.definitionVersion) || raw.definitionVersion < 1) {
    throw new TypeError(`Invalid definitionVersion for ${raw.sourceRef}`);
  }
  if (!Array.isArray(raw.tags) || raw.tags.some(tag =>
    typeof tag !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(tag))) {
    throw new TypeError(`Invalid tags for ${raw.sourceRef}`);
  }

  return Object.freeze({
    sourceRef: raw.sourceRef,
    displayName: raw.displayName.trim(),
    activityId: raw.activityId,
    itemId: raw.itemId,
    collectionEntryId: raw.collectionEntryId,
    skillId: raw.skillId,
    quantity: raw.quantity,
    status: raw.status,
    definitionVersion: raw.definitionVersion,
    tags: Object.freeze([...raw.tags])
  });
}

export const DEFAULT_GATHERING_SOURCE_DEFINITIONS = Object.freeze({
  CAMPUS_LEAF_PILE_01: createGatheringSourceDefinition({
    sourceRef: 'gathering.campus.leaf_pile_01',
    displayName: '캠퍼스 낙엽 더미',
    activityId: 'activity.gathering.campus',
    itemId: 'material.campus_leaf',
    collectionEntryId: 'collection.plant.campus_leaf',
    skillId: 'life.gathering',
    quantity: 1,
    status: GATHERING_SOURCE_STATUS.COMING_SOON,
    definitionVersion: 1,
    tags: ['life', 'gathering', 'campus', 'leaf']
  })
});

export function createGatheringSourceRegistry({
  definitions = Object.values(DEFAULT_GATHERING_SOURCE_DEFINITIONS)
} = {}) {
  const byRef = new Map();
  for (const raw of definitions) {
    const source = createGatheringSourceDefinition(raw);
    if (byRef.has(source.sourceRef)) throw new Error(`Duplicate Gathering sourceRef: ${source.sourceRef}`);
    byRef.set(source.sourceRef, source);
  }
  return Object.freeze({
    get: sourceRef => byRef.get(sourceRef) ?? null,
    has: sourceRef => byRef.has(sourceRef),
    list: () => Object.freeze([...byRef.values()]),
    get size() { return byRef.size; }
  });
}

export const GATHERING_SOURCE_REGISTRY = createGatheringSourceRegistry();

export function gatheringSourceAuthorityRow(definition) {
  if (!definition) throw new TypeError('Gathering source definition is required');
  return Object.freeze({
    source_ref: definition.sourceRef,
    activity_id: definition.activityId,
    item_id: definition.itemId,
    collection_entry_id: definition.collectionEntryId,
    skill_id: definition.skillId,
    quantity: definition.quantity,
    status: definition.status,
    definition_version: definition.definitionVersion
  });
}
