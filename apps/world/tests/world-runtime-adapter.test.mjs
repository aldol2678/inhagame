import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { loadWorldDocument } from "../src/runtime-adapter/load-world.js";

const fixture = () => JSON.parse(readFileSync(new URL("../src/editor/fixtures/schema-components.world.json", import.meta.url), "utf8"));

function fakeContext({ failAssets = false, missingRefs = false } = {}) {
  const loads = [];
  const disposed = [];
  const registered = { spawns: new Map(), triggers: new Map(), locations: new Map() };
  const node = name => ({ name, parent: null, children: [], enabled: true, transform: null });
  const attach = (parent, child) => { parent.children.push(child); child.parent = parent; };
  const register = map => record => {
    map.set(record.entityId, record);
    return () => { map.delete(record.entityId); disposed.push(record.entityId); };
  };
  return {
    loads, disposed, registered,
    loadAsset: async uri => { loads.push(uri); if (failAssets) throw new Error("missing model"); return { uri }; },
    createRoot: world => node(world.worldId),
    createEntity: entity => node(entity.name),
    attach,
    setLocalTransform: (object, transform) => { object.transform = structuredClone(transform); },
    createRenderable: asset => node(`model:${asset.uri}`),
    createPlaceholder: () => node("placeholder"),
    createPath: data => node(`path:${data.points.length}`),
    createStructure: data => node(`structure:${data.shape}:${data.sizeMeters.join("x")}`),
    registerSpawn: register(registered.spawns),
    registerTrigger: register(registered.triggers),
    registerLocation: register(registered.locations),
    resolveRef: missingRefs ? async () => null : undefined,
    destroyRoot: root => { root.destroyed = true; }
  };
}

test("Runtime Adapter preserves IDs, hierarchy, local transforms and component registrations", async () => {
  const world = fixture();
  world.entities[1].parentId = world.entities[0].id;
  world.entities[0].components["inha.location"] = { areaId: "AREA_FIXTURE" };
  world.entities[0].components["test.unknown"] = { preserved: true };
  const context = fakeContext();
  const runtime = await loadWorldDocument(world, context);
  assert.equal(runtime.state, "ready-with-warnings");
  assert.equal(runtime.bindings.size, 4);
  const building = runtime.getEntity("entity.fixture.building");
  const path = runtime.getEntity("entity.fixture.path");
  assert.equal(path.runtimeObject.parent, building.runtimeObject);
  assert.deepEqual(path.runtimeObject.transform, world.entities[1].transform);
  assert.equal(runtime.getEntityId(path.runtimeObject.children[0]), path.entityId);
  assert.equal(runtime.spawns.get("entity.fixture.spawn").refId, "npc.fixture");
  assert.equal(runtime.triggers.get("entity.fixture.trigger").data.shape.type, "box");
  assert.equal(runtime.locations.get("entity.fixture.building").data.areaId, "AREA_FIXTURE");
  assert.equal(context.registered.spawns.size, 1);
  assert.equal(context.registered.triggers.size, 1);
  assert.ok(runtime.diagnostics.some(item => item.code === "R_UNKNOWN_COMPONENT"));
  assert.deepEqual(world.entities[0].components["test.unknown"], { preserved: true });
  await runtime.dispose();
  await runtime.dispose();
  assert.equal(context.registered.spawns.size, 0);
  assert.equal(context.registered.triggers.size, 0);
  assert.equal(context.registered.locations.size, 0);
  assert.equal(runtime.getEntity(path.entityId), null);
  assert.equal(runtime.root, null);
});

test('world.structure is a first-class Runtime Adapter component', async () => {
  const world = fixture();
  world.entities.push({
    id: 'entity.fixture.structure', name: 'Structure', kind: 'structure', parentId: null, enabled: true,
    transform: { position: [3,0,4], rotation: [0,0,0,1], scale: [1,1,1] }, tags: ['fixture'],
    components: { 'world.structure': { shape: 'box', sizeMeters: [2,1,3], color: '#abcdef' } }, metadata: {}
  });
  const runtime = await loadWorldDocument(world, fakeContext());
  assert.equal(runtime.state, 'ready');
  const binding=runtime.getEntity('entity.fixture.structure');
  assert.equal(binding.runtimeObject.children[0].name,'structure:box:2x1x3');
  assert.deepEqual(binding.components.get('world.structure').data.sizeMeters,[2,1,3]);
  await runtime.dispose();
});

test("same model is loaded once; failed model becomes an isolated placeholder", async () => {
  const world = fixture();
  const duplicate = structuredClone(world.entities[0]);
  duplicate.id = "entity.fixture.building-b";
  duplicate.name = "Building B";
  world.entities.push(duplicate);
  const success = fakeContext();
  const ready = await loadWorldDocument(world, success);
  assert.equal(ready.state, "ready");
  assert.equal(success.loads.length, 1);
  assert.equal(ready.getEntity(duplicate.id).components.get("core.renderable").placeholder, false);
  await ready.dispose();

  const failure = fakeContext({ failAssets: true });
  const degraded = await loadWorldDocument(world, failure);
  assert.equal(degraded.state, "ready-with-warnings");
  assert.equal(degraded.getEntity(duplicate.id).status, "degraded");
  assert.equal(degraded.getEntity(duplicate.id).runtimeObject.children[0].name, "placeholder");
  assert.equal(degraded.getEntity("entity.fixture.path").status, "ready");
  assert.equal(failure.loads.length, 1);
  assert.equal(degraded.diagnostics.filter(item => item.code === "R_ASSET_LOAD_FAILED").length, 2);
  await degraded.dispose();
});

test("missing soft ref disables only that registration; invalid schema is fatal before scene creation", async () => {
  const world = fixture();
  const context = fakeContext({ missingRefs: true });
  const degraded = await loadWorldDocument(world, context);
  assert.equal(degraded.state, "ready-with-warnings");
  assert.equal(degraded.spawns.size, 0);
  assert.equal(degraded.triggers.size, 0);
  assert.equal(degraded.diagnostics.filter(item => item.code === "R_REF_NOT_FOUND").length, 2);
  await degraded.dispose();

  const strongContext = fakeContext({ missingRefs: true });
  strongContext.refPolicy = () => "strong";
  const strong = await loadWorldDocument(world, strongContext);
  assert.equal(strong.state, "fatal");
  assert.equal(strong.root, null);
  assert.equal(strongContext.registered.spawns.size, 0);

  const invalid = fixture();
  invalid.entities[0].parentId = invalid.entities[1].id;
  invalid.entities[1].parentId = invalid.entities[0].id;
  const fatal = await loadWorldDocument(invalid, fakeContext());
  assert.equal(fatal.state, "fatal");
  assert.equal(fatal.root, null);
  assert.equal(fatal.diagnostics[0].code, "E_PARENT_CYCLE");
  const future = fixture();
  future.schemaVersion = "9.0.0";
  assert.equal((await loadWorldDocument(future, fakeContext())).state, "fatal");
});
