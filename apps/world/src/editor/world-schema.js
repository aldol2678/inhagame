import { triangulateFootprint } from "./building-mass.js";
import { validateSplineControls } from "./path-spline.js";

export const WORLD_SCHEMA_VERSION = "0.1.0";
export const DEFAULT_COORDINATE_SYSTEM = Object.freeze({
  handedness: "right",
  upAxis: "Y",
  unit: "meter"
});

const ASSET_TYPES = new Set(["model", "texture", "audio", "other"]);
const SPAWN_TYPES = new Set(["player", "npc", "prop", "custom"]);
const PATH_TYPES = new Set(["road", "walkway", "custom"]);
const KNOWN_COMPONENTS = new Set([
  "core.renderable", "world.building", "world.path", "world.structure",
  "game.spawn", "game.trigger", "inha.location"
]);

const record = value => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};
const nonempty = value => typeof value === "string" && value.trim().length > 0;
const finite = value => typeof value === "number" && Number.isFinite(value);
const positive = value => finite(value) && value > 0;
const vector = (value, length) => Array.isArray(value) && value.length === length && value.every(finite);

export function validateTransformInput(transform, path = "transform") {
  const diagnostics = [];
  const error = (code, field) => diagnostics.push({ severity: "ERROR", code, path: `${path}.${field}` });
  if (!record(transform)) {
    error("E_TRANSFORM_INVALID", "");
    return diagnostics;
  }
  if ("position" in transform && !vector(transform.position, 3)) error("E_TRANSFORM_NON_FINITE", "position");
  if ("rotation" in transform) {
    if (!vector(transform.rotation, 4)) error("E_TRANSFORM_NON_FINITE", "rotation");
    else if (Math.hypot(...transform.rotation) < 1e-12) error("E_ROTATION_INVALID", "rotation");
  }
  if ("scale" in transform) {
    if (!vector(transform.scale, 3)) error("E_TRANSFORM_NON_FINITE", "scale");
    else if (!transform.scale.every(positive)) error("E_SCALE_INVALID", "scale");
  }
  return diagnostics;
}

export function validateWorld(world) {
  const diagnostics = [];
  const add = (severity, code, path, detail) => diagnostics.push({ severity, code, path, ...(detail ? { detail } : {}) });
  const error = (code, path, detail) => add("ERROR", code, path, detail);
  const warning = (code, path, detail) => add("WARNING", code, path, detail);

  if (!record(world)) {
    error("E_WORLD_INVALID", "$");
    return { valid: false, diagnostics, errors: diagnostics, warnings: [] };
  }
  for (const key of Object.keys(world)) {
    if (!["schemaVersion", "worldId", "name", "coordinateSystem", "assets", "entities", "metadata"].includes(key)) {
      error("E_WORLD_FIELD_UNKNOWN", key);
    }
  }
  if (world.schemaVersion !== WORLD_SCHEMA_VERSION) error("E_SCHEMA_VERSION_UNSUPPORTED", "schemaVersion");
  if (!nonempty(world.worldId)) error("E_WORLD_ID_INVALID", "worldId");
  if (!nonempty(world.name)) error("E_WORLD_NAME_INVALID", "name");
  const coordinate = world.coordinateSystem;
  if (!record(coordinate) || coordinate.handedness !== "right" || coordinate.upAxis !== "Y" || coordinate.unit !== "meter") {
    error("E_COORDINATE_SYSTEM_INVALID", "coordinateSystem");
  } else if (Object.keys(coordinate).some(key => !["handedness", "upAxis", "unit"].includes(key))) {
    error("E_COORDINATE_SYSTEM_INVALID", "coordinateSystem");
  }
  if (!Array.isArray(world.assets)) error("E_ASSETS_INVALID", "assets");
  if (!Array.isArray(world.entities)) error("E_ENTITIES_INVALID", "entities");
  if (world.metadata !== undefined && !record(world.metadata)) error("E_METADATA_INVALID", "metadata");

  const assetIds = new Set();
  const assetUses = new Set();
  if (Array.isArray(world.assets)) world.assets.forEach((asset, index) => {
    const path = `assets[${index}]`;
    if (!record(asset)) { error("E_ASSET_INVALID", path); return; }
    if (!nonempty(asset.id)) error("E_ASSET_ID_INVALID", `${path}.id`);
    else if (assetIds.has(asset.id)) error("E_DUP_ASSET_ID", `${path}.id`, asset.id);
    else assetIds.add(asset.id);
    if (!ASSET_TYPES.has(asset.type)) error("E_ASSET_TYPE_INVALID", `${path}.type`);
    if (!nonempty(asset.uri)) error("E_ASSET_URI_INVALID", `${path}.uri`);
    if (asset.metadata === undefined) warning("W_ASSET_METADATA_MISSING", `${path}.metadata`);
    else if (!record(asset.metadata)) error("E_ASSET_METADATA_INVALID", `${path}.metadata`);
  });

  const entityIds = new Set();
  const entityById = new Map();
  const names = new Set();
  if (Array.isArray(world.entities)) world.entities.forEach((entity, index) => {
    const path = `entities[${index}]`;
    if (!record(entity)) { error("E_ENTITY_INVALID", path); return; }
    for (const key of Object.keys(entity)) {
      if (!["id", "name", "kind", "parentId", "enabled", "transform", "tags", "components", "metadata"].includes(key)) {
        error("E_ENTITY_FIELD_UNKNOWN", `${path}.${key}`);
      }
    }
    if (!nonempty(entity.id)) error("E_ENTITY_ID_INVALID", `${path}.id`);
    else if (entityIds.has(entity.id)) error("E_DUP_ENTITY_ID", `${path}.id`, entity.id);
    else { entityIds.add(entity.id); entityById.set(entity.id, entity); }
    if (!nonempty(entity.name)) error("E_ENTITY_NAME_INVALID", `${path}.name`);
    else if (names.has(entity.name)) warning("W_DUP_ENTITY_NAME", `${path}.name`, entity.name);
    else names.add(entity.name);
    if (!nonempty(entity.kind)) error("E_ENTITY_KIND_INVALID", `${path}.kind`);
    if (entity.parentId !== null && !nonempty(entity.parentId)) error("E_PARENT_ID_INVALID", `${path}.parentId`);
    if (typeof entity.enabled !== "boolean") error("E_ENABLED_INVALID", `${path}.enabled`);
    if (!record(entity.transform)) error("E_TRANSFORM_INVALID", `${path}.transform`);
    else {
      for (const key of Object.keys(entity.transform)) {
        if (!["position", "rotation", "scale"].includes(key)) error("E_TRANSFORM_FIELD_UNKNOWN", `${path}.transform.${key}`);
      }
      for (const item of validateTransformInput(entity.transform, `${path}.transform`)) diagnostics.push(item);
      for (const [field, length] of [["position", 3], ["rotation", 4], ["scale", 3]]) {
        if (!(field in entity.transform)) error("E_TRANSFORM_FIELD_MISSING", `${path}.transform.${field}`);
        else if (!vector(entity.transform[field], length)) continue;
      }
      if (vector(entity.transform.rotation, 4) && Math.abs(Math.hypot(...entity.transform.rotation) - 1) > 1e-6) {
        warning("W_ROTATION_NOT_NORMALIZED", `${path}.transform.rotation`);
      }
    }
    if (!Array.isArray(entity.tags) || !entity.tags.every(tag => typeof tag === "string")) error("E_TAGS_INVALID", `${path}.tags`);
    else if (entity.tags.length === 0) warning("W_TAGS_EMPTY", `${path}.tags`);
    if (!record(entity.components)) { error("E_COMPONENTS_INVALID", `${path}.components`); return; }
    for (const [key, component] of Object.entries(entity.components)) {
      const componentPath = `${path}.components.${key}`;
      if (!/^[a-z][a-z0-9-]*\.[A-Za-z][A-Za-z0-9]*$/.test(key)) error("E_COMPONENT_KEY_INVALID", componentPath);
      if (!record(component)) { error("E_COMPONENT_INVALID", componentPath); continue; }
      if (!KNOWN_COMPONENTS.has(key)) warning("W_COMPONENT_UNKNOWN", componentPath);
      validateComponent(key, component, componentPath, error, assetIds, assetUses);
    }
    if (entity.metadata !== undefined && !record(entity.metadata)) error("E_ENTITY_METADATA_INVALID", `${path}.metadata`);
    const provenance = entity.metadata?.provenance;
    if (provenance?.estimated === true && !finite(provenance.confidence)) warning("W_CONFIDENCE_MISSING", `${path}.metadata.provenance.confidence`);
  });

  if (Array.isArray(world.entities)) world.entities.forEach((entity, index) => {
    if (!record(entity) || !nonempty(entity.id)) return;
    if (entity.parentId && !entityIds.has(entity.parentId)) error("E_PARENT_NOT_FOUND", `entities[${index}].parentId`, entity.parentId);
    if (entity.parentId === entity.id) error("E_PARENT_CYCLE", `entities[${index}].parentId`, entity.id);
  });
  const visited = new Set();
  const active = new Set();
  function visit(id) {
    if (active.has(id)) { error("E_PARENT_CYCLE", "entities", id); return; }
    if (visited.has(id)) return;
    active.add(id);
    const parentId = entityById.get(id)?.parentId;
    if (entityById.has(parentId)) visit(parentId);
    active.delete(id);
    visited.add(id);
  }
  for (const id of entityById.keys()) visit(id);
  for (const id of assetIds) if (!assetUses.has(id)) warning("W_ASSET_UNUSED", "assets", id);

  const activeValues = new WeakSet();
  function checkJsonValue(value, path) {
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number") {
      if (!Number.isFinite(value)) error("E_VALUE_NOT_JSON_SAFE", path);
      return;
    }
    if (typeof value !== "object") { error("E_VALUE_NOT_JSON_SAFE", path); return; }
    if (activeValues.has(value)) { error("E_VALUE_CYCLE", path); return; }
    activeValues.add(value);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === "symbol") { error("E_VALUE_NOT_JSON_SAFE", path); continue; }
      checkJsonValue(value[key], `${path}.${key}`);
    }
    activeValues.delete(value);
  }
  checkJsonValue(world, "$");

  const errors = diagnostics.filter(item => item.severity === "ERROR");
  return { valid: errors.length === 0, diagnostics, errors, warnings: diagnostics.filter(item => item.severity === "WARNING") };
}

function validateComponent(key, data, path, error, assetIds, assetUses) {
  if (key === "core.renderable") {
    if (!nonempty(data.assetId)) error("E_ASSET_REF_INVALID", `${path}.assetId`);
    else if (!assetIds.has(data.assetId)) error("E_ASSET_REF_NOT_FOUND", `${path}.assetId`, data.assetId);
    else assetUses.add(data.assetId);
    for (const field of ["visible", "castShadow", "receiveShadow"]) {
      if (data[field] !== undefined && typeof data[field] !== "boolean") error("E_COMPONENT_FIELD_INVALID", `${path}.${field}`);
    }
  } else if (key === "world.building") {
    if (data.floors !== undefined && (!Number.isInteger(data.floors) || data.floors <= 0)) error("E_BUILDING_FLOORS_INVALID", `${path}.floors`);
    if (data.heightMeters !== undefined && !positive(data.heightMeters)) error("E_BUILDING_HEIGHT_INVALID", `${path}.heightMeters`);
    if (data.entrances !== undefined && (!Array.isArray(data.entrances) || !data.entrances.every(item => record(item) && nonempty(item.id) && vector(item.position, 3)))) error("E_BUILDING_ENTRANCES_INVALID", `${path}.entrances`);
    if (data.footprint !== undefined) {
      try { triangulateFootprint(data.footprint); }
      catch (failure) { error(failure.message, `${path}.footprint`); }
      if (!positive(data.heightMeters)) error("E_BUILDING_HEIGHT_INVALID", `${path}.heightMeters`);
    }
  } else if (key === "world.structure") {
    if (data.shape !== "box") error("E_STRUCTURE_SHAPE_INVALID", `${path}.shape`);
    if (!vector(data.sizeMeters, 3) || !data.sizeMeters.every(positive)) error("E_STRUCTURE_SIZE_INVALID", `${path}.sizeMeters`);
    if (data.color !== undefined && (typeof data.color !== "string" || !/^#[0-9a-f]{6}$/i.test(data.color))) {
      error("E_STRUCTURE_COLOR_INVALID", `${path}.color`);
    }
  } else if (key === "world.path") {
    if (!PATH_TYPES.has(data.pathType)) error("E_PATH_TYPE_INVALID", `${path}.pathType`);
    if (!Array.isArray(data.points) || data.points.length < 2 || !data.points.every(point => vector(point, 3))) error("E_PATH_POINTS_INVALID", `${path}.points`);
    if (!positive(data.widthMeters)) error("E_PATH_WIDTH_INVALID", `${path}.widthMeters`);
    if (typeof data.closed !== "boolean") error("E_PATH_CLOSED_INVALID", `${path}.closed`);
    if (data.interpolation !== undefined && data.interpolation !== "catmull-rom") error("E_PATH_INTERPOLATION_INVALID", `${path}.interpolation`);
    if (data.interpolation === "catmull-rom") {
      try { validateSplineControls(data.points, data.closed); }
      catch (failure) { error(failure.message, `${path}.points`); }
    }
  } else if (key === "game.spawn") {
    if (!SPAWN_TYPES.has(data.spawnType)) error("E_SPAWN_TYPE_INVALID", `${path}.spawnType`);
    if (!nonempty(data.refId)) error("E_SPAWN_REF_INVALID", `${path}.refId`);
    if (!positive(data.radiusMeters)) error("E_SPAWN_RADIUS_INVALID", `${path}.radiusMeters`);
  } else if (key === "game.trigger") {
    if (!nonempty(data.triggerType)) error("E_TRIGGER_TYPE_INVALID", `${path}.triggerType`);
    if (!nonempty(data.refId)) error("E_TRIGGER_REF_INVALID", `${path}.refId`);
    if (!record(data.shape) || !["box", "sphere"].includes(data.shape.type)) error("E_TRIGGER_SHAPE_INVALID", `${path}.shape`);
    else if (data.shape.type === "box" && (!vector(data.shape.size, 3) || !data.shape.size.every(positive))) error("E_TRIGGER_SHAPE_INVALID", `${path}.shape.size`);
    else if (data.shape.type === "sphere" && !positive(data.shape.radius)) error("E_TRIGGER_SHAPE_INVALID", `${path}.shape.radius`);
  }
}

export function assertValidWorld(world) {
  const result = validateWorld(world);
  if (!result.valid) {
    const first = result.errors[0];
    throw new Error(`${first.code}:${first.detail ?? first.path}`);
  }
  return result;
}
