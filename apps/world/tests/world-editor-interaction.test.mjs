import test from "node:test";
import assert from "node:assert/strict";

import { createEmptyWorld, WorldDocument } from "../src/editor/world-document.js";
import { EditorState } from "../src/editor/editor-state.js";
import { EditorCommands } from "../src/editor/editor-commands.js";
import {
  eulerFromQuaternion,
  quaternionFromEuler,
  transformedForDrag,
  worldTransform
} from "../src/editor/editor-transform.js";

function editor() {
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.interaction" }));
  const state = new EditorState();
  return { world, state, commands: new EditorCommands(world, state) };
}

function close(actual, expected, tolerance = 1e-8) {
  assert.ok(Math.abs(actual - expected) < tolerance, actual + " is not close to " + expected);
}

test("selection and tool preferences stay outside WorldDocument", () => {
  const { world, state } = editor();
  state.select("entity.one");
  state.setTool("rotate");
  state.setTransformSpace("local");
  state.setSnap("move", 0.5);
  state.setSnap("rotate", 15);
  assert.equal(world.revision, 0);
  assert.equal(world.dirty, false);
  assert.equal(state.selectedEntityId, "entity.one");
  assert.equal(state.transformSpace, "local");
  assert.equal(state.translateSnap, 0.5);
  assert.equal(state.rotateSnap, 15);
  assert.throws(() => state.setSnap("scale", 2), /E_SNAP_INVALID/);
});

test("add, duplicate, delete, undo and redo keep stable IDs and entity order", () => {
  const { world, state, commands } = editor();
  commands.addEntity({ id: "entity.a", name: "A" });
  commands.addEntity({ id: "entity.b", name: "B" });
  world.markSaved();
  const duplicate = commands.duplicateEntity("entity.a");
  assert.equal(duplicate.id, "entity.a.copy");
  assert.equal(state.selectedEntityId, duplicate.id);
  assert.equal(commands.undoStack.length, 3);
  commands.undo();
  assert.equal(world.hasEntity(duplicate.id), false);
  assert.equal(world.dirty, false);
  commands.redo();
  assert.equal(world.hasEntity(duplicate.id), true);
  assert.equal(world.getEntity(duplicate.id).name, "A Copy");

  commands.removeEntity("entity.a");
  assert.equal(state.selectedEntityId, duplicate.id);
  commands.undo();
  assert.deepEqual(world.listEntities().map(entity => entity.id), ["entity.a", "entity.b", duplicate.id]);
  commands.redo();
  assert.equal(world.hasEntity("entity.a"), false);
});

test("deletion with children is rejected without changing history or document", () => {
  const { world, commands } = editor();
  commands.addEntity({ id: "entity.parent" });
  commands.addEntity({ id: "entity.child", parentId: "entity.parent" });
  const before = commands.undoStack.length;
  assert.throws(() => commands.removeEntity("entity.parent"), /E_ENTITY_HAS_CHILDREN/);
  assert.equal(commands.undoStack.length, before);
  assert.equal(world.entityCount, 2);
});

test("one drag creates one history entry; undo returns to saved state", () => {
  const { world, commands } = editor();
  commands.addEntity({ id: "entity.drag" });
  world.markSaved();
  const beforeCount = commands.undoStack.length;
  const before = commands.beginTransform("entity.drag", "move");
  for (const x of [1, 2, 3, 4]) {
    commands.previewTransform({ ...before, position: [x, 0, 0] });
  }
  assert.equal(commands.undoStack.length, beforeCount);
  assert.equal(commands.commitTransform(), true);
  assert.equal(commands.undoStack.length, beforeCount + 1);
  assert.equal(world.getEntity("entity.drag").transform.position[0], 4);
  commands.undo();
  assert.equal(world.getEntity("entity.drag").transform.position[0], 0);
  assert.equal(world.dirty, false);
  commands.redo();
  assert.equal(world.getEntity("entity.drag").transform.position[0], 4);
  assert.equal(world.dirty, true);
});

test("cancel restores the draft, creates no history, and preserves redo", () => {
  const { world, commands } = editor();
  commands.addEntity({ id: "entity.drag" });
  commands.setTransform("entity.drag", { position: [1, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
  commands.undo();
  const historySize = commands.undoStack.length;
  const before = commands.beginTransform("entity.drag", "move");
  commands.previewTransform({ ...before, position: [8, 0, 0] });
  assert.equal(commands.cancelTransform(), true);
  assert.equal(world.getEntity("entity.drag").transform.position[0], 0);
  assert.equal(commands.undoStack.length, historySize);
  assert.equal(commands.canRedo, true);
  commands.redo();
  assert.equal(world.getEntity("entity.drag").transform.position[0], 1);
});

test("invalid transform never enters canonical state or history", () => {
  const { world, commands } = editor();
  commands.addEntity({ id: "entity.invalid" });
  const size = commands.undoStack.length;
  const before = world.getEntity("entity.invalid").transform;
  assert.throws(() => commands.setTransform("entity.invalid", { ...before, scale: [0, 1, 1] }), /E_/);
  assert.throws(() => commands.setTransform("entity.invalid", { ...before, position: [NaN, 0, 0] }), /E_/);
  assert.deepEqual(world.getEntity("entity.invalid").transform, before);
  assert.equal(commands.undoStack.length, size);
  commands.beginTransform("entity.invalid", "scale");
  assert.throws(() => commands.previewTransform({ ...before, scale: [-1, 1, 1] }), /E_/);
  commands.cancelTransform();
  assert.equal(commands.undoStack.length, size);
});

test("new edit after undo clears redo; field mutations are undoable", () => {
  const { world, commands } = editor();
  commands.addEntity({ id: "entity.fields" });
  commands.renameEntity("entity.fields", "Renamed");
  commands.undo();
  assert.equal(commands.canRedo, true);
  commands.setEnabled("entity.fields", false);
  assert.equal(commands.canRedo, false);
  commands.setTags("entity.fields", ["one", "two"]);
  commands.setComponentField("entity.fields", "custom.note", "text", "hello");
  commands.undo();
  assert.deepEqual(world.getEntity("entity.fields").components, {});
  commands.undo();
  assert.deepEqual(world.getEntity("entity.fields").tags, []);
  commands.undo();
  assert.equal(world.getEntity("entity.fields").enabled, true);
});

test("world and local gizmo movement respect parent rotation", () => {
  const { world, commands } = editor();
  commands.addEntity({
    id: "entity.parent",
    transform: { rotation: quaternionFromEuler([0, 90, 0]) }
  });
  commands.addEntity({
    id: "entity.child",
    parentId: "entity.parent",
    transform: { position: [1, 0, 0] }
  });
  const before = world.getEntity("entity.child").transform;
  const worldMoved = transformedForDrag(world, "entity.child", before, "move", "x", "world", 2);
  commands.setTransform("entity.child", worldMoved);
  const worldPosition = worldTransform(world, "entity.child").position;
  close(worldPosition[0], 2);
  close(worldPosition[2], -1);
  commands.undo();
  const localMoved = transformedForDrag(world, "entity.child", before, "move", "x", "local", 2);
  commands.setTransform("entity.child", localMoved);
  const localPosition = worldTransform(world, "entity.child").position;
  close(localPosition[0], 0);
  close(localPosition[2], -3);
});

test("rotation uses normalized quaternion, Euler fields round-trip, scale clamps positive", () => {
  const { world, commands } = editor();
  commands.addEntity({ id: "entity.transform" });
  const before = world.getEntity("entity.transform").transform;
  const rotated = transformedForDrag(world, "entity.transform", before, "rotate", "y", "world", 90);
  commands.setTransform("entity.transform", rotated);
  close(Math.hypot(...world.getEntity("entity.transform").transform.rotation), 1);
  close(eulerFromQuaternion(rotated.rotation)[1], 90, 1e-6);
  const roundTrip = quaternionFromEuler([20, 30, 40]);
  const angles = eulerFromQuaternion(roundTrip);
  angles.forEach((value, index) => close(value, [20, 30, 40][index], 1e-6));
  const scale = transformedForDrag(world, "entity.transform", before, "scale", "all", "local", -10);
  assert.deepEqual(scale.scale, [0.001, 0.001, 0.001]);
});

test("compound command is one undoable action and rolls back a failed part", () => {
  const { world, commands } = editor();
  const first = { redo: () => world.addEntity({ id: "entity.one" }), undo: () => world.removeEntity("entity.one") };
  const second = { redo: () => world.addEntity({ id: "entity.two" }), undo: () => world.removeEntity("entity.two") };
  commands.executeCompound("Pair", [first, second]);
  assert.equal(commands.undoStack.length, 1);
  commands.undo();
  assert.equal(world.entityCount, 0);
  commands.redo();
  assert.equal(world.entityCount, 2);
  const historySize = commands.undoStack.length;
  assert.throws(() => commands.executeCompound("Fail", [
    { redo: () => world.addEntity({ id: "entity.temp" }), undo: () => world.removeEntity("entity.temp") },
    { redo: () => { throw new Error("boom"); }, undo: () => {} }
  ]), /boom/);
  assert.equal(world.hasEntity("entity.temp"), false);
  assert.equal(commands.undoStack.length, historySize);
});
