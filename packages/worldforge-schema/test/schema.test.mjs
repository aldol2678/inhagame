import test from "node:test";
import assert from "node:assert/strict";
import * as z from "zod";
import {
  ChangeSetSchema,
  WorldManifestSchema,
  fromInhaWorldDocumentV010,
  validateChangeSet,
  validateWorldManifest
} from "../dist/index.js";

const minimal = () => ({
  schemaVersion: "worldforge/0.1",
  project: { id: "demo", name: "Demo", template: "campus" },
  world: { id: "demo-world", name: "Demo World", units: "meter", upAxis: "Y", handedness: "right" },
  assets: [], zones: [], places: [], paths: [], entities: [], npcs: [], quests: [], events: [], rules: []
});

test("minimal manifest parses and emits draft 2020-12 JSON Schema", () => {
  assert.equal(WorldManifestSchema.parse(minimal()).world.id, "demo-world");
  const schema = z.toJSONSchema(WorldManifestSchema, { target: "draft-2020-12" });
  assert.equal(schema.properties.schemaVersion.const, "worldforge/0.1");
  assert.equal(schema.properties.world.properties.units.const, "meter");
});

test("semantic validation catches broken references and quest edges", () => {
  const world = minimal();
  world.places.push({ id: "p1", name: "Place", type: "core.poi", zoneId: "missing", position: [0, 0, 0] });
  world.quests.push({ id: "q1", name: "Quest", type: "core.quest", nodes: [{ id: "start", type: "trigger.enter-zone" }], edges: [{ from: "start", to: "missing" }] });
  const result = validateWorldManifest(world);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(error => error.code === "E_ZONE_REF_NOT_FOUND"));
  assert.ok(result.errors.some(error => error.code === "E_QUEST_NODE_REF_NOT_FOUND"));
});

test("changesets require values for create/update and reject values for delete", () => {
  const base = { schemaVersion: "worldforge/changeset/0.1", id: "chg-1", worldId: "demo-world", baseRevision: "abc", status: "draft" };
  assert.equal(ChangeSetSchema.safeParse({ ...base, operations: [{ op: "update", collection: "paths", targetId: "p1", value: { enabled: false } }] }).success, true);
  assert.equal(validateChangeSet({ ...base, operations: [{ op: "update", collection: "paths", targetId: "p1" }] }).valid, false);
  assert.equal(validateChangeSet({ ...base, operations: [{ op: "delete", collection: "paths", targetId: "p1", value: {} }] }).valid, false);
});

test("INHA WorldDocument v0.1.0 adapter preserves entities and extracts paths", () => {
  const source = {
    schemaVersion: "0.1.0",
    worldId: "inha-world",
    name: "INHA WORLD",
    coordinateSystem: { handedness: "right", upAxis: "Y", unit: "meter" },
    assets: [{ id: "asset-a", type: "model", uri: "./a.glb", metadata: {} }],
    entities: [
      {
        id: "entity-road", name: "Road", kind: "path", parentId: null, enabled: true,
        transform: { position: [0,0,0], rotation: [0,0,0,1], scale: [1,1,1] },
        tags: ["road"],
        components: { "world.path": { pathType: "road", points: [[0,0,0],[10,0,0]], widthMeters: 4, closed: false } },
        metadata: {}
      },
      {
        id: "entity-building", name: "Building", kind: "building", parentId: null, enabled: true,
        transform: { position: [2,0,2], rotation: [0,0,0,1], scale: [1,1,1] },
        tags: ["building"],
        components: { "core.renderable": { assetId: "asset-a", visible: true } },
        metadata: {}
      }
    ],
    metadata: {}
  };
  const result = fromInhaWorldDocumentV010(source);
  assert.equal(result.entities.length, 2);
  assert.equal(result.paths.length, 1);
  assert.equal(result.paths[0].metadata.sourceEntityId, "entity-road");
  assert.equal(result.entities[1].assetId, "asset-a");
  assert.equal(validateWorldManifest(result).valid, true);
});
