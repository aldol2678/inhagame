import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseWorld, serializeWorld } from "../src/editor/world-serialization.js";
import { validateWorld } from "../src/editor/world-schema.js";
import { loadWorldDocument } from "../src/runtime-adapter/load-world.js";

const fixtureText = readFileSync(new URL("../src/editor/fixtures/p0-block-01.world.json", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const fixture = () => parseWorld(fixtureText);
// A core.autocrlf checkout turns every LF of the committed fixture into CRLF; expect exactly that, nothing looser.
const asCheckedOut = text => (fixtureText.includes("\r") ? text.replaceAll("\n", "\r\n") : text);

function context({ failAsset = false } = {}) {
  const registrations = { spawns: new Map(), triggers: new Map(), locations: new Map() };
  const roots = [];
  const loads = [];
  const node = name => ({ name, children: [], parent: null, transform: null });
  const register = map => record => {
    map.set(record.entityId, record);
    return () => map.delete(record.entityId);
  };
  return {
    registrations, roots, loads,
    loadAsset: async uri => {
      loads.push(uri);
      if (failAsset) throw new Error("QA model unavailable");
      return { uri };
    },
    createRoot: world => {
      const root = node(world.worldId);
      roots.push(root);
      return root;
    },
    createEntity: entity => node(entity.name),
    attach: (parent, child) => { parent.children.push(child); child.parent = parent; },
    setLocalTransform: (object, transform) => { object.transform = structuredClone(transform); },
    createRenderable: asset => node(`model:${asset.uri}`),
    createPlaceholder: () => node("missing-model"),
    createPath: data => node(`path:${data.points.length}`),
    registerSpawn: register(registrations.spawns),
    registerTrigger: register(registrations.triggers),
    registerLocation: register(registrations.locations),
    destroyRoot: root => { root.destroyed = true; }
  };
}

test("UI-exported P0_BLOCK_01 is canonical, complete, and stable after parse/serialize", () => {
  const world = fixture();
  assert.equal(world.schemaVersion, "0.1.0");
  assert.equal(validateWorld(world).errors.length, 0);
  assert.equal(validateWorld(world).warnings.length, 0);
  assert.equal(world.entities.length, 6);
  assert.equal(new Set(world.entities.map(entity => entity.id)).size, 6);
  assert.equal(new Set(world.assets.map(asset => asset.id)).size, 1);
  assert.deepEqual(world.entities.map(entity => entity.kind), ["building", "building", "path", "spawn", "spawn", "trigger"]);
  assert.equal(world.entities[2].components["world.path"].points.length, 3);
  assert.deepEqual(world.entities.filter(entity => entity.kind === "spawn").map(entity => entity.components["game.spawn"].spawnType), ["player", "npc"]);
  assert.equal(world.entities[5].components["game.trigger"].shape.type, "box");
  assert.equal(asCheckedOut(serializeWorld(world)), fixtureText);
  assert.equal(asCheckedOut(serializeWorld(parseWorld(serializeWorld(world)))), fixtureText);
  assert.ok(!fixtureText.includes('"selectedEntityId"'));
  assert.ok(!fixtureText.includes('"camera"'));
  assert.ok(!fixtureText.includes('"draft"'));
});

test("P0 fixture retains editor meaning in Runtime Adapter and deduplicates model loading", async () => {
  const world = fixture();
  const runtimeContext = context();
  const runtime = await loadWorldDocument(world, runtimeContext);
  assert.equal(runtime.state, "ready");
  assert.equal(runtime.diagnostics.length, 0);
  assert.equal(runtime.bindings.size, 6);
  assert.equal(runtimeContext.loads.length, 1);
  for (const entity of world.entities) {
    const binding = runtime.getEntity(entity.id);
    assert.equal(runtime.getEntityId(binding.runtimeObject), entity.id);
    assert.deepEqual(binding.runtimeObject.transform, entity.transform);
    if (entity.kind === "building") {
      assert.equal(binding.components.get("core.renderable").assetId, entity.components["core.renderable"].assetId);
      assert.equal(binding.components.get("core.renderable").placeholder, false);
    }
    if (entity.kind === "path") assert.deepEqual(binding.components.get("world.path").data, entity.components["world.path"]);
    if (entity.kind === "spawn") assert.deepEqual(runtime.spawns.get(entity.id).data, entity.components["game.spawn"]);
    if (entity.kind === "trigger") assert.deepEqual(runtime.triggers.get(entity.id).data, entity.components["game.trigger"]);
  }
  assert.equal(runtimeContext.registrations.spawns.size, 2);
  assert.equal(runtimeContext.registrations.triggers.size, 1);
  await runtime.dispose();
  assert.equal(runtimeContext.registrations.spawns.size, 0);
  assert.equal(runtimeContext.registrations.triggers.size, 0);
  assert.equal(runtimeContext.registrations.locations.size, 0);
});

test("failure fixtures distinguish asset, unknown component, transform, cycle, and JSON errors", async () => {
  const missing = fixture();
  missing.assets[0].uri = "/assets/does-not-exist.glb";
  const degraded = await loadWorldDocument(missing, context({ failAsset: true }));
  assert.equal(degraded.state, "ready-with-warnings");
  assert.equal(degraded.bindings.size, 6);
  assert.equal(degraded.diagnostics.filter(item => item.code === "R_ASSET_LOAD_FAILED").length, 2);
  await degraded.dispose();

  const unknown = fixture();
  unknown.entities[0].components["test.unknownComponent"] = { preserved: ["qa", 1] };
  const roundTrip = parseWorld(serializeWorld(unknown));
  assert.deepEqual(roundTrip.entities[0].components["test.unknownComponent"], { preserved: ["qa", 1] });
  const ignored = await loadWorldDocument(roundTrip, context());
  assert.ok(ignored.diagnostics.some(item => item.code === "R_UNKNOWN_COMPONENT"));
  await ignored.dispose();

  const invalid = fixture();
  invalid.entities[0].transform.scale[0] = 0;
  assert.throws(() => serializeWorld(invalid), /E_SCALE_INVALID/);
  const cyclic = fixture();
  cyclic.entities[0].parentId = cyclic.entities[1].id;
  cyclic.entities[1].parentId = cyclic.entities[0].id;
  assert.throws(() => serializeWorld(cyclic), /E_PARENT_CYCLE/);
  assert.throws(() => parseWorld("{broken"), /E_WORLD_JSON_PARSE/);
});

test("ten Runtime Adapter load/dispose cycles leave no registrations or roots active", async () => {
  const runtimeContext = context();
  for (let iteration = 0; iteration < 10; iteration += 1) {
    const runtime = await loadWorldDocument(fixture(), runtimeContext);
    assert.equal(runtime.state, "ready");
    assert.equal(runtimeContext.registrations.spawns.size, 2);
    assert.equal(runtimeContext.registrations.triggers.size, 1);
    await runtime.dispose();
    assert.equal(runtimeContext.registrations.spawns.size, 0);
    assert.equal(runtimeContext.registrations.triggers.size, 0);
    assert.equal(runtimeContext.registrations.locations.size, 0);
    assert.equal(runtimeContext.roots.at(-1).destroyed, true);
  }
  assert.equal(runtimeContext.roots.length, 10);
});
