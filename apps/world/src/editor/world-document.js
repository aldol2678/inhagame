import {
  assertValidWorld,
  DEFAULT_COORDINATE_SYSTEM,
  validateTransformInput,
  WORLD_SCHEMA_VERSION
} from "./world-schema.js";

export { DEFAULT_COORDINATE_SYSTEM, WORLD_SCHEMA_VERSION } from "./world-schema.js";

const clone = (value) => {
  if (typeof globalThis.structuredClone === "function") return globalThis.structuredClone(value);
  return JSON.parse(JSON.stringify(value));
};

function makeStableId(prefix = "entity") {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `${prefix}.${uuid}`;
  return `${prefix}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 10)}`;
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function normalizeVector(value, fallback) {
  if (!Array.isArray(value) || value.length !== fallback.length) return [...fallback];
  return fallback.map((item, index) => finiteNumber(value[index], item));
}

export function normalizeTransform(transform = {}) {
  const rotation = normalizeVector(transform.rotation, [0, 0, 0, 1]);
  const length = Math.hypot(...rotation);
  return {
    position: normalizeVector(transform.position, [0, 0, 0]),
    rotation: length > 1e-12 ? rotation.map(value => value / length) : [0, 0, 0, 1],
    scale: normalizeVector(transform.scale, [1, 1, 1])
  };
}

function assertTransformCandidate(transform) {
  if (transform === undefined) return;
  if (transform && typeof transform === "object" && !Array.isArray(transform)) {
    for (const key of Object.keys(transform)) {
      if (!["position", "rotation", "scale"].includes(key)) throw new Error(`E_TRANSFORM_FIELD_UNKNOWN:${key}`);
    }
  }
  const diagnostic = validateTransformInput(transform)[0];
  if (diagnostic) throw new Error(`${diagnostic.code}:${diagnostic.path}`);
}

function assertEntityCandidate(entity) {
  if (!entity || typeof entity !== "object" || Array.isArray(entity)) throw new Error("E_ENTITY_INVALID");
  for (const key of Object.keys(entity)) {
    if (!["id", "name", "kind", "parentId", "enabled", "transform", "tags", "components", "metadata"].includes(key)) {
      throw new Error(`E_ENTITY_FIELD_UNKNOWN:${key}`);
    }
  }
  for (const field of ["id", "name", "kind"]) {
    if (field in entity && (typeof entity[field] !== "string" || !entity[field].trim())) {
      throw new Error(`E_ENTITY_${field.toUpperCase()}_INVALID`);
    }
  }
  if ("parentId" in entity && entity.parentId !== null && (typeof entity.parentId !== "string" || !entity.parentId.trim())) {
    throw new Error("E_PARENT_ID_INVALID");
  }
  if ("enabled" in entity && typeof entity.enabled !== "boolean") throw new Error("E_ENABLED_INVALID");
  if ("tags" in entity && (!Array.isArray(entity.tags) || !entity.tags.every(tag => typeof tag === "string"))) {
    throw new Error("E_TAGS_INVALID");
  }
  for (const field of ["components", "metadata"]) {
    if (field in entity && (!entity[field] || typeof entity[field] !== "object" || Array.isArray(entity[field]))) {
      throw new Error(`E_${field.toUpperCase()}_INVALID`);
    }
  }
  assertTransformCandidate(entity.transform);
}

export function normalizeEntity(entity = {}) {
  const id = typeof entity.id === "string" && entity.id.trim()
    ? entity.id.trim()
    : makeStableId("entity");

  return {
    id,
    name: typeof entity.name === "string" && entity.name.trim() ? entity.name.trim() : id,
    kind: typeof entity.kind === "string" && entity.kind.trim() ? entity.kind.trim() : "prop",
    parentId: typeof entity.parentId === "string" && entity.parentId.trim() ? entity.parentId.trim() : null,
    enabled: entity.enabled !== false,
    transform: normalizeTransform(entity.transform),
    tags: Array.isArray(entity.tags) ? [...new Set(entity.tags.filter(tag => typeof tag === "string"))] : [],
    components: entity.components && typeof entity.components === "object" ? clone(entity.components) : {},
    metadata: entity.metadata && typeof entity.metadata === "object" ? clone(entity.metadata) : {}
  };
}

export function createEmptyWorld({
  worldId = makeStableId("world"),
  name = "Untitled World"
} = {}) {
  return {
    schemaVersion: WORLD_SCHEMA_VERSION,
    worldId,
    name,
    coordinateSystem: clone(DEFAULT_COORDINATE_SYSTEM),
    assets: [],
    entities: [],
    metadata: {}
  };
}

function normalizeWorld(candidate) {
  const source = candidate && typeof candidate === "object" ? candidate : createEmptyWorld();
  for (const key of Object.keys(source)) {
    if (!["schemaVersion", "worldId", "name", "coordinateSystem", "assets", "entities", "metadata"].includes(key)) {
      throw new Error(`E_WORLD_FIELD_UNKNOWN:${key}`);
    }
  }
  if (source.schemaVersion !== WORLD_SCHEMA_VERSION) throw new Error(`E_SCHEMA_VERSION_UNSUPPORTED:${source.schemaVersion ?? "missing"}`);
  if (typeof source.worldId !== "string" || !source.worldId.trim()) throw new Error("E_WORLD_ID_INVALID");
  if (typeof source.name !== "string" || !source.name.trim()) throw new Error("E_WORLD_NAME_INVALID");
  if (!source.coordinateSystem || source.coordinateSystem.handedness !== "right" || source.coordinateSystem.upAxis !== "Y" || source.coordinateSystem.unit !== "meter") {
    throw new Error("E_COORDINATE_SYSTEM_INVALID");
  }
  if (!Array.isArray(source.assets)) throw new Error("E_ASSETS_INVALID");
  if (!Array.isArray(source.entities)) throw new Error("E_ENTITIES_INVALID");
  if (source.metadata !== undefined && (!source.metadata || typeof source.metadata !== "object" || Array.isArray(source.metadata))) {
    throw new Error("E_METADATA_INVALID");
  }
  if (Array.isArray(source.entities)) {
    for (const entity of source.entities) assertEntityCandidate(entity);
  }
  const world = {
    schemaVersion: typeof source.schemaVersion === "string" ? source.schemaVersion : WORLD_SCHEMA_VERSION,
    worldId: typeof source.worldId === "string" && source.worldId.trim() ? source.worldId.trim() : makeStableId("world"),
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : "Untitled World",
    coordinateSystem: source.coordinateSystem && typeof source.coordinateSystem === "object"
      ? clone(source.coordinateSystem)
      : clone(DEFAULT_COORDINATE_SYSTEM),
    assets: Array.isArray(source.assets) ? clone(source.assets) : [],
    entities: Array.isArray(source.entities) ? source.entities.map(normalizeEntity) : [],
    metadata: source.metadata && typeof source.metadata === "object" ? clone(source.metadata) : {}
  };

  const ids = new Set();
  for (const entity of world.entities) {
    if (ids.has(entity.id)) throw new Error(`E_DUP_ENTITY_ID:${entity.id}`);
    ids.add(entity.id);
  }
  assertValidWorld(world);
  return world;
}

export class WorldDocument {
  constructor(candidate = createEmptyWorld()) {
    this._world = normalizeWorld(candidate);
    this._entityIndex = new Map(this._world.entities.map(entity => [entity.id, entity]));
    this._revision = 0;
    this._dirty = false;
    this._savedSnapshot = JSON.stringify(this._world);
    this._listeners = new Set();
  }

  get schemaVersion() { return this._world.schemaVersion; }
  get worldId() { return this._world.worldId; }
  get name() { return this._world.name; }
  get revision() { return this._revision; }
  get dirty() { return this._dirty; }
  get entityCount() { return this._world.entities.length; }

  snapshot() {
    return clone(this._world);
  }

  listEntities() {
    return this._world.entities.map(clone);
  }

  getEntity(id) {
    const entity = this._entityIndex.get(id);
    return entity ? clone(entity) : null;
  }

  hasEntity(id) {
    return this._entityIndex.has(id);
  }

  addAsset(candidate, { index = this._world.assets.length } = {}) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("E_ASSET_INVALID");
    if (!Number.isInteger(index) || index < 0 || index > this._world.assets.length) throw new Error("E_ASSET_INDEX_INVALID");
    const assets = [...this._world.assets];
    assets.splice(index, 0, clone(candidate));
    assertValidWorld({ ...this._world, assets });
    this._world.assets = assets;
    this._touch("asset-added", null);
    return clone(candidate);
  }

  removeAsset(id) {
    const index = this._world.assets.findIndex(asset => asset.id === id);
    if (index < 0) return false;
    const assets = this._world.assets.filter(asset => asset.id !== id);
    assertValidWorld({ ...this._world, assets });
    this._world.assets = assets;
    this._touch("asset-removed", null);
    return true;
  }

  addEntity(candidate = {}, { index = this._world.entities.length } = {}) {
    assertEntityCandidate(candidate);
    const entity = normalizeEntity(candidate);
    if (this._entityIndex.has(entity.id)) throw new Error(`E_DUP_ENTITY_ID:${entity.id}`);
    if (entity.parentId && !this._entityIndex.has(entity.parentId)) {
      throw new Error(`E_PARENT_NOT_FOUND:${entity.parentId}`);
    }
    if (!Number.isInteger(index) || index < 0 || index > this._world.entities.length) throw new Error("E_ENTITY_INDEX_INVALID");
    const entities = [...this._world.entities];
    entities.splice(index, 0, entity);
    assertValidWorld({ ...this._world, entities });
    this._world.entities = entities;
    this._entityIndex.set(entity.id, entity);
    this._touch("entity-added", entity.id);
    return clone(entity);
  }

  updateEntity(id, patch = {}) {
    const current = this._entityIndex.get(id);
    if (!current) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    assertEntityCandidate(patch);
    if (patch.id && patch.id !== id) throw new Error("E_ENTITY_ID_IMMUTABLE");

    const next = normalizeEntity({
      ...current,
      ...clone(patch),
      id,
      transform: patch.transform
        ? { ...current.transform, ...clone(patch.transform) }
        : current.transform,
      components: patch.components
        ? { ...current.components, ...clone(patch.components) }
        : current.components,
      metadata: patch.metadata
        ? { ...current.metadata, ...clone(patch.metadata) }
        : current.metadata
    });

    if (next.parentId && next.parentId !== id && !this._entityIndex.has(next.parentId)) {
      throw new Error(`E_PARENT_NOT_FOUND:${next.parentId}`);
    }
    if (next.parentId === id) throw new Error("E_PARENT_SELF_REFERENCE");

    return this.replaceEntity(id, next);
  }

  replaceEntity(id, candidate) {
    const current = this._entityIndex.get(id);
    if (!current) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    assertEntityCandidate(candidate);
    if (candidate.id !== id) throw new Error("E_ENTITY_ID_IMMUTABLE");
    const next = normalizeEntity(candidate);
    if (next.parentId && !this._entityIndex.has(next.parentId)) {
      throw new Error(`E_PARENT_NOT_FOUND:${next.parentId}`);
    }
    if (next.parentId === id) throw new Error("E_PARENT_SELF_REFERENCE");
    if (JSON.stringify(next) === JSON.stringify(current)) return clone(current);
    const index = this._world.entities.findIndex(entity => entity.id === id);
    assertValidWorld({
      ...this._world,
      entities: this._world.entities.map(entity => entity.id === id ? next : entity)
    });
    this._world.entities[index] = next;
    this._entityIndex.set(id, next);
    this._touch("entity-updated", id);
    return clone(next);
  }

  previewEntityTransform(id, transform) {
    const current = this._entityIndex.get(id);
    if (!current) throw new Error(`E_ENTITY_NOT_FOUND:${id}`);
    assertTransformCandidate(transform);
    const next = { ...current, transform: normalizeTransform(transform) };
    if (JSON.stringify(next.transform) === JSON.stringify(current.transform)) return clone(current);
    const index = this._world.entities.findIndex(entity => entity.id === id);
    this._world.entities[index] = next;
    this._entityIndex.set(id, next);
    this._touch("entity-previewed", id);
    return clone(next);
  }

  assertValid() {
    assertValidWorld(this._world);
  }

  removeEntity(id) {
    if (!this._entityIndex.has(id)) return false;
    if (this._world.entities.some(entity => entity.parentId === id)) {
      throw new Error(`E_ENTITY_HAS_CHILDREN:${id}`);
    }
    const entities = this._world.entities.filter(entity => entity.id !== id);
    assertValidWorld({ ...this._world, entities });
    this._world.entities = entities;
    this._entityIndex.delete(id);
    this._touch("entity-removed", id);
    return true;
  }

  rename(name) {
    const next = typeof name === "string" ? name.trim() : "";
    if (!next || next === this._world.name) return false;
    this._world.name = next;
    this._touch("world-renamed", null);
    return true;
  }

  markSaved() {
    this._savedSnapshot = JSON.stringify(this._world);
    this._dirty = false;
    this._emit({ type: "saved", entityId: null });
  }

  markUnsaved() {
    this._savedSnapshot = null;
    this._dirty = true;
    this._emit({ type: "unsaved", entityId: null });
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("listener must be a function");
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _touch(type, entityId) {
    this._revision += 1;
    this._dirty = JSON.stringify(this._world) !== this._savedSnapshot;
    this._emit({ type, entityId });
  }

  _emit({ type, entityId }) {
    const event = Object.freeze({
      type,
      entityId,
      revision: this._revision,
      dirty: this._dirty,
      worldId: this._world.worldId
    });
    for (const listener of this._listeners) listener(event);
  }
}
