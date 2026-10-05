import test from "node:test";
import assert from "node:assert/strict";

import { buildPathRibbonGeometry, samplePathCenterline, validateSplineControls } from "../src/editor/path-spline.js";
import { createEmptyWorld, WorldDocument } from "../src/editor/world-document.js";
import { EditorState } from "../src/editor/editor-state.js";
import { EditorCommands } from "../src/editor/editor-commands.js";
import { InhaToolSession } from "../src/editor/inha-tools.js";
import { validateWorld } from "../src/editor/world-schema.js";
import { loadWorldDocument } from "../src/runtime-adapter/load-world.js";

test("spline sampling passes through controls and creates a finite upward ribbon", () => {
  const controls = [[0, 0, 0], [8, 0, 0], [8, 0, 8], [16, 0, 8]];
  const sampled = samplePathCenterline(controls, "catmull-rom");
  assert.ok(sampled.length > controls.length);
  assert.deepEqual(sampled[0], controls[0]);
  assert.deepEqual(sampled.at(-1), controls.at(-1));
  for (const control of controls) assert.ok(sampled.some(point => Math.hypot(...point.map((value, i) => value - control[i])) < 1e-8));
  assert.ok(sampled.every(point => point.every(Number.isFinite)));
  for (const width of [2, 4, 8]) {
    const mesh = buildPathRibbonGeometry(sampled, width);
    assert.equal(mesh.positions.length, sampled.length * 6);
    assert.equal(mesh.indices.length, (sampled.length - 1) * 6);
    assert.ok(mesh.normals.every((value, index) => value === (index % 3 === 1 ? 1 : 0)));
    for (let i = 0; i < mesh.indices.length; i += 3) {
      const [a, b, c] = mesh.indices.slice(i, i + 3).map(index => mesh.positions.slice(index * 3, index * 3 + 3));
      const upward = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      assert.ok(upward > 0);
    }
  }
});

test("curve mode commits one undoable world.path and keeps P0 linear paths unchanged", () => {
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.spline", name: "Spline test" }));
  const commands = new EditorCommands(world, new EditorState());
  const tool = new InhaToolSession(() => world, () => commands);
  tool.activate("path");
  tool.setOption("pathType", "road");
  tool.setOption("pathInterpolation", "catmull-rom");
  tool.setOption("widthMeters", 4);
  tool.place([10, 0, 20]);
  tool.place([16, 0, 20]);
  assert.equal(tool.valid, false);
  assert.throws(() => tool.commitPath(), /E_PATH_SPLINE_POINTS_INVALID/);
  tool.place([16, 0, 26]);
  assert.equal(tool.valid, true);
  assert.equal(world.entityCount, 0);
  const entity = tool.commitPath();
  assert.deepEqual(entity.components["world.path"], {
    pathType: "road", points: [[0, 0, 0], [6, 0, 0], [6, 0, 6]],
    widthMeters: 4, closed: false, interpolation: "catmull-rom"
  });
  assert.equal(commands.undoStack.length, 1);
  commands.undo();
  assert.equal(world.entityCount, 0);
  commands.redo();
  assert.equal(world.hasEntity(entity.id), true);
  const malformed = world.snapshot();
  malformed.entities[0].components["world.path"].points[2] = [6, 0, 0];
  assert.equal(validateWorld(malformed).errors[0].code, "E_PATH_SPLINE_POINTS_INVALID");
  assert.deepEqual(samplePathCenterline([[0, 0, 0], [1, 0, 0]], "linear"), [[0, 0, 0], [1, 0, 0]]);
  assert.throws(() => validateSplineControls([[0, 0, 0], [10, 0, 0], [0, 0, 1]]), /TURN_TOO_SHARP/);
  assert.throws(() => validateSplineControls([[0, 0, 0], [0, 3, 0], [4, 3, 0]]), /POINTS_INVALID/);
});

test("Runtime Adapter passes spline controls to the rendering context", async () => {
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.spline-runtime", name: "Spline runtime" }));
  world.addEntity({ id: "entity.path.spline", name: "Road", kind: "path", tags: ["test"], components: {
    "world.path": { pathType: "road", points: [[0, 0, 0], [5, 0, 0], [5, 0, 5]], widthMeters: 4, closed: false, interpolation: "catmull-rom" }
  } });
  const node = name => ({ name, parent: null, children: [] });
  const context = {
    loadAsset: async () => { throw new Error("unexpected asset load"); },
    createRoot: data => node(data.worldId), createEntity: data => node(data.name),
    attach(parent, child) { parent.children.push(child); child.parent = parent; },
    setLocalTransform() {}, destroyRoot() {},
    createPath(data) {
      assert.equal(data.interpolation, "catmull-rom");
      assert.equal(samplePathCenterline(data.points, data.interpolation).at(-1)[2], 5);
      return node("spline surface");
    }
  };
  const runtime = await loadWorldDocument(world.snapshot(), context);
  assert.equal(runtime.state, "ready");
  assert.equal(runtime.getEntity("entity.path.spline").runtimeObject.children[0].name, "spline surface");
  await runtime.dispose();
});
