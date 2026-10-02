import { assertValidWorld, WORLD_SCHEMA_VERSION } from "./world-schema.js";

const clone = value => typeof globalThis.structuredClone === "function"
  ? globalThis.structuredClone(value)
  : JSON.parse(JSON.stringify(value));

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const result = {};
    for (const key of Object.keys(value).sort()) result[key] = stable(value[key]);
    return result;
  }
  if (typeof value === "number") return Object.is(value, -0) ? 0 : Number(value.toPrecision(12));
  return value;
}

export function migrateWorld(candidate) {
  if (!candidate || typeof candidate !== "object" || candidate.schemaVersion !== WORLD_SCHEMA_VERSION) {
    throw new Error(`E_SCHEMA_VERSION_UNSUPPORTED:${candidate?.schemaVersion ?? "missing"}`);
  }
  const world = clone(candidate);
  assertValidWorld(world);
  return world;
}

export function serializeWorld(candidate) {
  const world = migrateWorld(candidate);
  world.assets.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  world.entities.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  for (const entity of world.entities) {
    const rotation = entity.transform.rotation;
    const length = Math.hypot(...rotation);
    if (Math.abs(length - 1) > 1e-12) entity.transform.rotation = rotation.map(value => value / length);
    entity.tags.sort();
  }
  const ordered = {
    schemaVersion: world.schemaVersion,
    worldId: world.worldId,
    name: world.name,
    coordinateSystem: stable(world.coordinateSystem),
    assets: world.assets.map(stable),
    entities: world.entities.map(stable),
    ...(world.metadata === undefined ? {} : { metadata: stable(world.metadata) })
  };
  assertValidWorld(ordered);
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function parseWorld(json) {
  let value;
  try { value = JSON.parse(json); }
  catch (error) { throw new Error(`E_WORLD_JSON_PARSE:${error.message}`); }
  return migrateWorld(value);
}
