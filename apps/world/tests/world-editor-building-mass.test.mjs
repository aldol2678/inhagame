import test from "node:test";
import assert from "node:assert/strict";

import { buildBuildingMassGeometry, createBuildingMassCandidate, triangulateFootprint } from "../src/editor/building-mass.js";
import { createMapReference } from "../src/editor/map-reference.js";
import { createEmptyWorld, WorldDocument } from "../src/editor/world-document.js";
import { EditorCommands } from "../src/editor/editor-commands.js";
import { EditorState } from "../src/editor/editor-state.js";
import { loadWorldDocument } from "../src/runtime-adapter/load-world.js";
import { validateWorld } from "../src/editor/world-schema.js";

const reference = () => createMapReference({ name: "own.png", mimeType: "image/png", width: 100, height: 100, rightsNote: "직접 제작" });
const footprint = { id: "footprint.abc", name: "Library", points: [[30, 30], [70, 30], [70, 70], [30, 70]] };

test("traced pixels become a meter-based, undoable building entity", () => {
  const candidate = createBuildingMassCandidate(reference(), footprint, 12);
  assert.equal(candidate.id, "entity.editor.mass.abc");
  assert.deepEqual(candidate.transform.position, [0, 0, 0]);
  assert.deepEqual(candidate.components["world.building"], {
    footprint: [[-8, 8], [8, 8], [8, -8], [-8, -8]], heightMeters: 12
  });
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.mass", name: "Mass test" }));
  const commands = new EditorCommands(world, new EditorState());
  commands.addEntity(candidate);
  assert.equal(world.getEntity(candidate.id).kind, "building");
  commands.undo();
  assert.equal(world.hasEntity(candidate.id), false);
  commands.redo();
  assert.deepEqual(world.getEntity(candidate.id).components["world.building"].footprint, candidate.components["world.building"].footprint);
  assert.equal(JSON.stringify(world.snapshot()).includes("own.png"), false);
});

test("concave building roofs stay within the footprint for either winding", () => {
  const points = [[0, 0], [4, 0], [4, 4], [2, 2], [0, 4]];
  for (const ring of [points, [...points].reverse()]) {
    const geometry = buildBuildingMassGeometry(ring, 6);
    assert.equal(geometry.positions.length / 3, ring.length * 6);
    assert.equal(geometry.indices.length, 6 * (ring.length - 2) + 6 * ring.length);
    const cap = triangulateFootprint(ring);
    const area = cap.reduce((sum, _, i) => {
      if (i % 3) return sum;
      const [a, b, c] = cap.slice(i, i + 3).map(index => ring[index]);
      return sum + Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2;
    }, 0);
    assert.equal(area, 12);
  }
  assert.throws(() => triangulateFootprint([[0, 0], [4, 4], [0, 4], [4, 0]]), /SELF_INTERSECTION/);
  assert.throws(() => createBuildingMassCandidate(reference(), footprint, 0), /HEIGHT_INVALID/);
  const invalid = createEmptyWorld({ worldId: "world.invalid", name: "Invalid mass" });
  const entity = new WorldDocument(createEmptyWorld({ worldId: "world.temp", name: "Temp" }))
    .addEntity(createBuildingMassCandidate(reference(), footprint, 12));
  entity.components["world.building"].footprint = [[0, 0], [4, 4], [0, 4], [4, 0]];
  invalid.entities.push(entity);
  assert.equal(validateWorld(invalid).errors[0].code, "E_BUILDING_FOOTPRINT_SELF_INTERSECTION");
});

test("Runtime Adapter attaches a procedural mass without a model asset", async () => {
  const world = createEmptyWorld({ worldId: "world.mass", name: "Mass test" });
  world.entities.push(new WorldDocument(createEmptyWorld({ worldId: "world.temp", name: "Temp" })).addEntity(createBuildingMassCandidate(reference(), footprint, 12)));
  const node = name => ({ name, children: [], parent: null });
  let disposed = false;
  const context = {
    loadAsset: async () => { throw new Error("unexpected model load"); },
    createRoot: data => node(data.worldId), createEntity: data => node(data.name),
    attach(parent, child) { parent.children.push(child); child.parent = parent; },
    setLocalTransform() {},
    createBuildingMass(data) {
      assert.equal(data.heightMeters, 12);
      return { visual: node("mass"), dispose() { disposed = true; } };
    },
    destroyRoot() {}
  };
  const runtime = await loadWorldDocument(world, context);
  const binding = runtime.getEntity("entity.editor.mass.abc");
  assert.equal(runtime.state, "ready");
  assert.equal(binding.components.get("world.building").visual.name, "mass");
  assert.equal(binding.runtimeObject.children[0].name, "mass");
  await runtime.dispose();
  assert.equal(disposed, true);
});
