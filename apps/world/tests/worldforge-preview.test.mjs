import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { validateWorld } from "../src/editor/world-schema.js";
import { loadWorldDocument } from "../src/runtime-adapter/load-world.js";

const api = await import("../src/runtime-adapter/worldforge-preview.mjs").catch(error => {
  if (error?.code === "ERR_MODULE_NOT_FOUND") return {};
  throw error;
});
const project = api.projectInhagameWorldForgePreview;

const fixture = JSON.parse(readFileSync(
  new URL("./fixtures/worldforge-sync-preview-candidate.json", import.meta.url),
  "utf8"
));

const opValue = operation => operation.op === "update" ? operation.changes : operation.object;
const buildingSource = id => fixture.operations.find(operation =>
  operation.collection === "entities" &&
  (operation.object?.id === id || operation.target === id)
);
const pathSource = fixture.operations.find(operation => operation.collection === "paths");

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, zi] = polygon[i], [xj, zj] = polygon[j];
    const hit = (zi > point[1]) !== (zj > point[1]) &&
      point[0] < (xj - xi) * (point[1] - zi) / (zj - zi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

function fakeContext() {
  const created = { buildings: 0, paths: 0 };
  const node = name => ({ name, parent: null, children: [], enabled: true, transform: null });
  return {
    created,
    createRoot: world => node(world.worldId),
    createEntity: entity => node(entity.name),
    attach(parent, child) { parent.children.push(child); child.parent = parent; },
    setLocalTransform(object, transform) { object.transform = structuredClone(transform); },
    createBuildingMass(data) {
      created.buildings += 1;
      return { visual: node(`building:${data.footprint.length}`) };
    },
    createPath(data) {
      created.paths += 1;
      return node(`path:${data.points.length}`);
    },
    destroyRoot(root) { root.destroyed = true; }
  };
}

test("WorldForge preview projection is implemented", () => {
  assert.equal(typeof project, "function", "preview projection implementation must exist");
});

test("the live spatial candidate projects into a valid WorldDocument without executing external rules", { skip: typeof project !== "function" }, () => {
  const preview = project(fixture, { worldId: "worldforge.sync.preview", name: "WorldForge Sync Preview" });
  const validation = validateWorld(preview);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));

  assert.equal(preview.metadata.worldforgePreview.sourceOperationCount, fixture.operations.length);
  assert.equal(preview.metadata.worldforgePreview.projectedPathCount, fixture.expected.paths);
  assert.equal(preview.metadata.worldforgePreview.projectedBuildingSourceCount, fixture.expected.buildingMasses);
  assert.equal(preview.metadata.worldforgePreview.externalAuthorityRuleCount, fixture.expected.externalRules);
  assert.equal(preview.entities.filter(entity => entity.kind === "path").length, fixture.expected.paths);
  assert.equal(preview.entities.some(entity => entity.id.startsWith("rule.")), false, "rules are never Runtime entities");

  const source = opValue(pathSource);
  const projectedPath = preview.entities.find(entity => entity.id === source.id);
  assert.ok(projectedPath);
  assert.deepEqual(projectedPath.components["world.path"].points,
    source.points.map(point => [point.x, point.y, point.z]),
    "WorldForge meter coordinates are preserved exactly; PlayCanvas context owns meters-per-unit scaling");
  assert.equal(projectedPath.components["world.path"].widthMeters, source.width);
});

test("simple buildings preserve the source entity id; courtyard buildings keep a hole-safe deterministic part group", { skip: typeof project !== "function" }, () => {
  const preview = project(fixture);

  const hall = preview.entities.find(entity => entity.id === "entity-bldg_01");
  assert.equal(hall.kind, "building");
  assert.equal(hall.components["world.building"].heightMeters, 21);

  const five = preview.entities.find(entity => entity.id === "entity-bldg_05");
  assert.equal(five.kind, "group");
  assert.deepEqual(five.components, {});
  const parts = preview.entities.filter(entity => entity.parentId === five.id);
  assert.ok(parts.length > 1, "5호관 courtyard geometry is partitioned into simple preview masses");
  assert.ok(parts.every((entity, index) =>
    entity.id === `entity-bldg_05.wf-part-${String(index + 1).padStart(2, "0")}` &&
    entity.metadata.worldforge.sourceEntityId === five.id
  ));

  const sourceGeometry = opValue(buildingSource("entity-bldg_05")).extensions["inhagame.geometry"];
  const hole = sourceGeometry.footprints[0].rings[1];
  const holeCenter = [
    hole.reduce((sum, item) => sum + item.x, 0) / hole.length,
    hole.reduce((sum, item) => sum + item.z, 0) / hole.length
  ];
  for (const entity of parts) {
    const [tx,,tz] = entity.transform.position;
    const worldPolygon = entity.components["world.building"].footprint.map(([x,z]) => [x + tx, z + tz]);
    assert.equal(pointInPolygon(holeCenter, worldPolygon), false, `${entity.id} must not cap the courtyard`);
  }
});

test("projected candidate replays through the actual Runtime Adapter with zero diagnostics", { skip: typeof project !== "function" }, async () => {
  const preview = project(fixture);
  const context = fakeContext();
  const runtime = await loadWorldDocument(preview, context);
  assert.equal(runtime.state, "ready", JSON.stringify(runtime.diagnostics));
  assert.deepEqual(runtime.diagnostics, []);
  assert.equal(runtime.bindings.size, preview.entities.length);
  assert.equal(context.created.paths, fixture.expected.paths);
  assert.ok(context.created.buildings >= fixture.expected.buildingMasses);
  await runtime.dispose();
  assert.equal(runtime.root, null);
});

test("preview refuses a candidate that failed INHAGAME capability validation", { skip: typeof project !== "function" }, () => {
  assert.throws(() => project({
    operations: [{
      op: "create", collection: "places",
      object: { id: "bad", type: "core.poi", extensions: { "inhagame.future-hook": { execute: true } } }
    }]
  }), /WF_CAPABILITY_INVALID/);
});
