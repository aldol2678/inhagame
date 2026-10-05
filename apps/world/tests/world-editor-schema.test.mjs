import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { WorldDocument } from "../src/editor/world-document.js";
import { assertValidWorld, validateWorld } from "../src/editor/world-schema.js";
import { migrateWorld, parseWorld, serializeWorld } from "../src/editor/world-serialization.js";

const fixture = name => JSON.parse(readFileSync(new URL(`../src/editor/fixtures/${name}`, import.meta.url), "utf8"));
const copy = value => structuredClone(value);
const codes = result => result.errors.map(item => item.code);

test("P0 Schema fixtures cover empty and composed worlds", () => {
  assert.equal(validateWorld(fixture("minimal.world.json")).valid, true);
  assert.equal(validateWorld(fixture("schema-components.world.json")).valid, true);
  assert.ok(codes(validateWorld(fixture("invalid/duplicate-id.world.json"))).includes("E_DUP_ENTITY_ID"));
  const schema = JSON.parse(readFileSync(new URL("../src/editor/world.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.properties.schemaVersion.const, "0.1.0");
});

test("cross-reference, parent cycle, and transform errors block the world", () => {
  const base = fixture("schema-components.world.json");
  const missingAsset = copy(base);
  missingAsset.entities[0].components["core.renderable"].assetId = "asset.missing";
  assert.ok(codes(validateWorld(missingAsset)).includes("E_ASSET_REF_NOT_FOUND"));

  const cycle = copy(base);
  cycle.entities[0].parentId = cycle.entities[1].id;
  cycle.entities[1].parentId = cycle.entities[0].id;
  assert.ok(codes(validateWorld(cycle)).includes("E_PARENT_CYCLE"));

  const invalid = copy(base);
  invalid.entities[0].transform.scale[0] = 0;
  assert.ok(codes(validateWorld(invalid)).includes("E_SCALE_INVALID"));
  invalid.entities[0].transform.scale[0] = 1;
  invalid.entities[0].transform.position[0] = Number.NaN;
  assert.ok(codes(validateWorld(invalid)).includes("E_TRANSFORM_NON_FINITE"));
});

test("known components validate shape; unknown namespaced components survive round-trip", () => {
  const world = fixture("schema-components.world.json");
  world.entities[0].components["test.unknownComponent"] = { nested: { value: 7 } };
  const result = validateWorld(world);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(item => item.code === "W_COMPONENT_UNKNOWN"));
  const text = serializeWorld(world);
  assert.deepEqual(parseWorld(text).entities.find(entity => entity.id === "entity.fixture.building").components["test.unknownComponent"], { nested: { value: 7 } });

  const invalid = copy(world);
  invalid.entities[1].components["world.path"].points = [[0, 0, 0]];
  assert.ok(codes(validateWorld(invalid)).includes("E_PATH_POINTS_INVALID"));
  invalid.entities[1].components["world.path"].points = [[0, 0, 0], [1, 0, 0]];
  invalid.entities[3].components["game.trigger"].shape.size[0] = -1;
  assert.ok(codes(validateWorld(invalid)).includes("E_TRIGGER_SHAPE_INVALID"));

  const structure = copy(world);
  structure.entities.push({
    id: "entity.fixture.structure", name: "Structure", kind: "structure", parentId: null, enabled: true,
    transform: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] }, tags: ["fixture"],
    components: { "world.structure": { shape: "box", sizeMeters: [2,1,3], color: "#abcdef" } }, metadata: {}
  });
  assert.equal(validateWorld(structure).valid, true);
  structure.entities.at(-1).components["world.structure"].sizeMeters[1] = 0;
  assert.ok(codes(validateWorld(structure)).includes("E_STRUCTURE_SIZE_INVALID"));
});

test("serialization is deterministic and does not mutate its input", () => {
  const world = fixture("schema-components.world.json");
  world.entities.reverse();
  const original = copy(world);
  const first = serializeWorld(world);
  const second = serializeWorld(parseWorld(first));
  assert.equal(first, second);
  assert.deepEqual(world, original);
  assert.deepEqual(JSON.parse(first).entities.map(entity => entity.id), [...world.entities.map(entity => entity.id)].sort());
  assert.throws(() => parseWorld("{broken"), /E_WORLD_JSON_PARSE/);
  assert.throws(() => migrateWorld({ schemaVersion: "0.0.1" }), /E_SCHEMA_VERSION_UNSUPPORTED/);
});

test("WorldDocument rejects invalid edits without changing canonical state", () => {
  const document = new WorldDocument(fixture("schema-components.world.json"));
  const before = document.snapshot();
  assert.throws(() => document.updateEntity("entity.fixture.building", { transform: { scale: [0, 1, 1] } }), /E_SCALE_INVALID/);
  assert.throws(() => document.updateEntity("entity.fixture.building", { parentId: "entity.missing" }), /E_PARENT_NOT_FOUND/);
  assert.throws(() => document.updateEntity("entity.fixture.building", { transform: { position: [Number.NaN, 0, 0] } }), /E_TRANSFORM_NON_FINITE/);
  assert.deepEqual(document.snapshot(), before);
  assert.equal(document.revision, 0);
  assert.equal(document.dirty, false);
  assertValidWorld(document.snapshot());
});

test("WorldDocument normalizes valid quaternions at mutation boundary", () => {
  const document = new WorldDocument(fixture("minimal.world.json"));
  const entity = document.addEntity({ id: "entity.rotated", transform: { rotation: [0, 0, 0, 2] } });
  assert.deepEqual(entity.transform.rotation, [0, 0, 0, 1]);
  assert.throws(() => document.updateEntity(entity.id, { transform: { rotation: [0, 0, 0, 0] } }), /E_ROTATION_INVALID/);
});

test("explicitly invalid fields are rejected instead of silently normalized", () => {
  const document = new WorldDocument(fixture("minimal.world.json"));
  assert.throws(() => document.addEntity({ id: "entity.bad", enabled: "yes" }), /E_ENABLED_INVALID/);
  assert.throws(() => document.addEntity({ id: "entity.bad", tags: ["ok", 2] }), /E_TAGS_INVALID/);
  assert.throws(() => document.addEntity({ id: "entity.bad", transientUiState: true }), /E_ENTITY_FIELD_UNKNOWN/);
  assert.equal(document.entityCount, 0);
  assert.equal(document.dirty, false);
});

test("unknown component payloads cannot silently lose non-JSON values", () => {
  const world = fixture("schema-components.world.json");
  world.entities[0].components["test.unknownComponent"] = { measurement: Number.NaN };
  assert.ok(codes(validateWorld(world)).includes("E_VALUE_NOT_JSON_SAFE"));
  assert.throws(() => serializeWorld(world), /E_VALUE_NOT_JSON_SAFE/);
  world.entities[0].components["test.unknownComponent"] = new Date("2026-09-27T00:00:00Z");
  assert.ok(codes(validateWorld(world)).includes("E_COMPONENT_INVALID"));
});
