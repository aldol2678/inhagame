// INHA WORLD P0 Collection Discovery pure contract.
// Code Registry is product-semantic canon. The DB mirror holds only the write-authority subset.

export const COLLECTION_PERSISTENCE_MODE = Object.freeze({
  SERVER_PERSISTED: 'SERVER_PERSISTED',
  DERIVED_FROM_OWNER: 'DERIVED_FROM_OWNER',
  SESSION_ONLY: 'SESSION_ONLY',
  PRESENTATION_ONLY: 'PRESENTATION_ONLY'
});

export const COLLECTION_VISIBILITY_POLICY = Object.freeze({
  PUBLIC: 'PUBLIC',
  SILHOUETTE: 'SILHOUETTE',
  SECRET: 'SECRET',
  HIDDEN: 'HIDDEN'
});

export const COLLECTION_ENTRY_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMING_SOON: 'COMING_SOON',
  DISABLED: 'DISABLED',
  HIDDEN: 'HIDDEN'
});

export const COLLECTION_RARITY = Object.freeze({
  COMMON: 'COMMON',
  UNCOMMON: 'UNCOMMON',
  RARE: 'RARE',
  SPECIAL: 'SPECIAL'
});

export const COLLECTION_CATEGORIES = Object.freeze([
  'FISH', 'PLANT', 'BIOLOGY', 'ARTIFACT', 'PLACE', 'PHOTO', 'BOSS',
  'FOOD', 'CRAFT', 'ITEM', 'MOUNT', 'LORE', 'NPC_EVENT', 'EVENT_RECORD'
]);

export const COLLECTION_ENTRY_ID_PATTERN =
  /^collection\.[a-z][a-z0-9_]*(?:\.[a-z0-9_]+){1,4}$/;

const persistenceModes = new Set(Object.values(COLLECTION_PERSISTENCE_MODE));
const visibilityPolicies = new Set(Object.values(COLLECTION_VISIBILITY_POLICY));
const statuses = new Set(Object.values(COLLECTION_ENTRY_STATUS));
const rarities = new Set(Object.values(COLLECTION_RARITY));
const categories = new Set(COLLECTION_CATEGORIES);
const STABLE_REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function optionalStableRef(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string' || !STABLE_REF_PATTERN.test(value)) throw new TypeError(`Invalid ${label}`);
  return value;
}

export function createCollectionEntryDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Collection entry definition must be an object');
  }
  if (typeof raw.entryId !== 'string' || !COLLECTION_ENTRY_ID_PATTERN.test(raw.entryId) || raw.entryId.length > 120) {
    throw new TypeError('Invalid entryId');
  }
  if (!categories.has(raw.category)) throw new TypeError(`Invalid category for ${raw.entryId}`);
  if (typeof raw.title !== 'string' || !raw.title.trim()) throw new TypeError(`Invalid title for ${raw.entryId}`);
  if (typeof raw.description !== 'string' || !raw.description.trim()) {
    throw new TypeError(`Invalid description for ${raw.entryId}`);
  }
  if (!rarities.has(raw.rarity)) throw new TypeError(`Invalid rarity for ${raw.entryId}`);
  if (!persistenceModes.has(raw.persistenceMode)) throw new TypeError(`Invalid persistenceMode for ${raw.entryId}`);
  if (!visibilityPolicies.has(raw.visibilityPolicy)) throw new TypeError(`Invalid visibilityPolicy for ${raw.entryId}`);
  if (!statuses.has(raw.status)) throw new TypeError(`Invalid status for ${raw.entryId}`);
  if (!Number.isInteger(raw.definitionVersion) || raw.definitionVersion < 1) {
    throw new TypeError(`Invalid definitionVersion for ${raw.entryId}`);
  }

  const ownerDomain = optionalStableRef(raw.ownerDomain, 'ownerDomain');
  const ownerRef = optionalStableRef(raw.ownerRef, 'ownerRef');
  const discoveryRuleRef = optionalStableRef(raw.discoveryRuleRef, 'discoveryRuleRef');
  const recordProjectionRef = optionalStableRef(raw.recordProjectionRef, 'recordProjectionRef');
  const presentationRef = optionalStableRef(raw.presentationRef, 'presentationRef');

  if (raw.persistenceMode === COLLECTION_PERSISTENCE_MODE.SERVER_PERSISTED) {
    if (!discoveryRuleRef) throw new TypeError(`SERVER_PERSISTED requires discoveryRuleRef: ${raw.entryId}`);
    if (ownerDomain || ownerRef) throw new TypeError(`SERVER_PERSISTED cannot declare ownerDomain/ownerRef: ${raw.entryId}`);
  }
  if (raw.persistenceMode === COLLECTION_PERSISTENCE_MODE.DERIVED_FROM_OWNER) {
    if (!ownerDomain || !ownerRef) throw new TypeError(`DERIVED_FROM_OWNER requires ownerDomain/ownerRef: ${raw.entryId}`);
    if (discoveryRuleRef) throw new TypeError(`DERIVED_FROM_OWNER cannot declare discoveryRuleRef: ${raw.entryId}`);
  }
  if ((raw.persistenceMode === COLLECTION_PERSISTENCE_MODE.SESSION_ONLY ||
       raw.persistenceMode === COLLECTION_PERSISTENCE_MODE.PRESENTATION_ONLY) &&
      (ownerDomain || ownerRef || discoveryRuleRef)) {
    throw new TypeError(`${raw.persistenceMode} cannot declare persistent owner/write refs: ${raw.entryId}`);
  }

  if (!Array.isArray(raw.tags) || raw.tags.some(tag =>
    typeof tag !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(tag))) {
    throw new TypeError(`Invalid tags for ${raw.entryId}`);
  }

  return Object.freeze({
    entryId: raw.entryId,
    category: raw.category,
    title: raw.title.trim(),
    description: raw.description.trim(),
    rarity: raw.rarity,
    persistenceMode: raw.persistenceMode,
    ownerDomain,
    ownerRef,
    visibilityPolicy: raw.visibilityPolicy,
    discoveryRuleRef,
    recordProjectionRef,
    presentationRef,
    status: raw.status,
    tags: Object.freeze([...raw.tags]),
    definitionVersion: raw.definitionVersion
  });
}

export const DEFAULT_COLLECTION_ENTRY_DEFINITIONS = Object.freeze({
  FISH_CARP: createCollectionEntryDefinition({
    entryId: 'collection.fish.carp',
    category: 'FISH',
    title: '붕어',
    description: '인경호 낚시에서 처음 검증할 기본 어종 도감 항목.',
    rarity: 'COMMON',
    persistenceMode: 'SERVER_PERSISTED',
    visibilityPolicy: 'SILHOUETTE',
    discoveryRuleRef: 'discovery.fishing.carp_v1',
    presentationRef: 'presentation.collection.fish_carp',
    status: 'ACTIVE',
    tags: ['life', 'fishing', 'p1a'],
    definitionVersion: 1
  }),
  PLANT_CAMPUS_LEAF: createCollectionEntryDefinition({
    entryId: 'collection.plant.campus_leaf',
    category: 'PLANT',
    title: '캠퍼스 낙엽',
    description: '캠퍼스 비파괴 채집의 첫 자연 소재 도감 항목.',
    rarity: 'COMMON',
    persistenceMode: 'SERVER_PERSISTED',
    visibilityPolicy: 'SILHOUETTE',
    discoveryRuleRef: 'discovery.gathering.campus_leaf_v1',
    presentationRef: 'presentation.collection.campus_leaf',
    status: 'COMING_SOON',
    tags: ['life', 'gathering', 'p1a'],
    definitionVersion: 1
  }),
  ARTIFACT_CAMPUS_FRAGMENT_01: createCollectionEntryDefinition({
    entryId: 'collection.artifact.campus_fragment_01',
    category: 'ARTIFACT',
    title: '캠퍼스 유물 조각 I',
    description: '캠퍼스 역사 조사와 발굴의 첫 유물 도감 항목.',
    rarity: 'UNCOMMON',
    persistenceMode: 'SERVER_PERSISTED',
    visibilityPolicy: 'SECRET',
    discoveryRuleRef: 'discovery.archaeology.campus_fragment_01_v1',
    presentationRef: 'presentation.collection.campus_fragment_01',
    status: 'COMING_SOON',
    tags: ['life', 'archaeology', 'p1a'],
    definitionVersion: 1
  }),
  PLACE_BIRYONG_TOWER: createCollectionEntryDefinition({
    entryId: 'collection.place.biryong_tower',
    category: 'PLACE',
    title: '비룡탑',
    description: '기존 BR01 비룡탑 발견 상태를 별도 복제하지 않고 투영하는 장소 항목.',
    rarity: 'SPECIAL',
    persistenceMode: 'DERIVED_FROM_OWNER',
    ownerDomain: 'BIRYONG',
    ownerRef: 'BR01',
    visibilityPolicy: 'PUBLIC',
    recordProjectionRef: 'projection.biryong.progress_v1',
    presentationRef: 'presentation.collection.biryong_tower',
    status: 'ACTIVE',
    tags: ['place', 'biryong', 'derived'],
    definitionVersion: 1
  })
});

export function createCollectionEntryRegistry({ definitions = Object.values(DEFAULT_COLLECTION_ENTRY_DEFINITIONS) } = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const entry = createCollectionEntryDefinition(raw);
    if (byId.has(entry.entryId)) throw new Error(`Duplicate entryId: ${entry.entryId}`);
    byId.set(entry.entryId, entry);
  }
  return Object.freeze({
    get: entryId => byId.get(entryId) ?? null,
    has: entryId => byId.has(entryId),
    list: () => Object.freeze([...byId.values()]),
    get size() { return byId.size; }
  });
}

export const COLLECTION_ENTRY_REGISTRY = createCollectionEntryRegistry();

export function collectionEntryAuthorityRow(definition) {
  if (!definition) throw new TypeError('Collection entry definition is required');
  return Object.freeze({
    entry_id: definition.entryId,
    category: definition.category,
    persistence_mode: definition.persistenceMode,
    owner_domain: definition.ownerDomain,
    owner_ref: definition.ownerRef,
    status: definition.status,
    definition_version: definition.definitionVersion
  });
}

export function collectionDiscoveryPresentationState(definition, discovery = null) {
  if (!definition) throw new TypeError('Collection entry definition is required');

  if (definition.persistenceMode === COLLECTION_PERSISTENCE_MODE.DERIVED_FROM_OWNER) {
    return Object.freeze({
      entryId: definition.entryId,
      persistenceMode: definition.persistenceMode,
      discoveryState: 'OWNER_DERIVED',
      discovered: null,
      firstDiscoveredAt: null,
      discoveryCount: null
    });
  }

  if (definition.persistenceMode !== COLLECTION_PERSISTENCE_MODE.SERVER_PERSISTED) {
    return Object.freeze({
      entryId: definition.entryId,
      persistenceMode: definition.persistenceMode,
      discoveryState: 'NOT_PERSISTED',
      discovered: null,
      firstDiscoveredAt: null,
      discoveryCount: null
    });
  }

  const discovered = Boolean(discovery);
  return Object.freeze({
    entryId: definition.entryId,
    persistenceMode: definition.persistenceMode,
    discoveryState: discovered ? 'DISCOVERED' : 'UNKNOWN',
    discovered,
    firstDiscoveredAt: discovery?.firstDiscoveredAt ?? null,
    discoveryCount: discovery?.discoveryCount ?? 0
  });
}
