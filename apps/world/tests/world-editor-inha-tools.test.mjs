import test from "node:test";
import assert from "node:assert/strict";
import { createEmptyWorld, WorldDocument } from "../src/editor/world-document.js";
import { EditorState } from "../src/editor/editor-state.js";
import { EditorCommands } from "../src/editor/editor-commands.js";
import { InhaToolSession, groundFromViewport, projectGround } from "../src/editor/inha-tools.js";
import { serializeWorld } from "../src/editor/world-serialization.js";

function editor() {
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.inha-tools" }));
  const state = new EditorState();
  const commands = new EditorCommands(world, state);
  const session = new InhaToolSession(() => world, () => commands);
  return { world, state, commands, session };
}

test("model registration and Building placement are separate undoable commands", () => {
  const { world, commands, session } = editor();
  session.activate("building");
  assert.throws(() => session.place([1, 0, 2]), /E_BUILDING_ASSET_REQUIRED/);
  assert.equal(world.entityCount, 0);
  commands.addAsset({ id: "asset.model.a", type: "model", uri: "/assets/a.glb", metadata: { label: "A" } });
  session.setOption("assetId", "asset.model.a");
  session.setOption("areaId", "main");
  const first = session.place([1, 0, 2]);
  const second = session.place([3, 0, 4]);
  assert.equal(first.id, "entity.main.building-001");
  assert.equal(second.id, "entity.main.building-002");
  assert.deepEqual(first.components, {
    "core.renderable": { assetId: "asset.model.a", visible: true },
    "world.building": {}, "inha.location": { areaId: "main" }
  });
  commands.undo();
  assert.equal(world.hasEntity(second.id), false);
  commands.redo();
  assert.equal(world.hasEntity(second.id), true);
  assert.throws(() => world.removeAsset("asset.model.a"), /E_ASSET_REF_NOT_FOUND/);
});

test("walkway draft stays outside document and commits one local-space path", () => {
  const { world, commands, session } = editor();
  session.activate("path");
  session.place([10, 0, 20]);
  session.place([13, 0, 20]);
  session.place([13, 0, 25]);
  assert.equal(world.revision, 0);
  assert.equal(commands.undoStack.length, 0);
  assert.equal(serializeWorld(world.snapshot()).includes("world.path"), false);
  session.backspace();
  assert.equal(session.draft.points.length, 2);
  session.place([13, 0, 25]);
  const path = session.commitPath();
  assert.equal(commands.undoStack.length, 1);
  assert.deepEqual(path.transform.position, [10, 0, 20]);
  assert.deepEqual(path.components["world.path"], {
    pathType: "walkway", points: [[0, 0, 0], [3, 0, 0], [3, 0, 5]], widthMeters: 2, closed: false
  });
  commands.undo();
  assert.equal(world.entityCount, 0);
  commands.redo();
  assert.equal(world.getEntity(path.id).id, path.id);
  session.place([1, 0, 1]);
  session.cancel();
  assert.equal(session.draft.points.length, 0);
  assert.equal(world.entityCount, 1);
});

test("Spawn and Trigger create schema-valid helper entities, invalid options cannot commit", () => {
  const { world, state, session } = editor();
  session.activate("spawn");
  session.setOption("spawnType", "npc");
  session.setOption("spawnRefId", "npc.guide");
  const spawn = session.place([0, 0, 0]);
  assert.equal(state.selectedEntityId, spawn.id);
  assert.deepEqual(spawn.components["game.spawn"], { spawnType: "npc", refId: "npc.guide", radiusMeters: 1 });
  session.activate("trigger");
  session.setOption("triggerRefId", "quest.intro");
  session.setOption("triggerShape", "sphere");
  session.setOption("triggerRadius", 0);
  assert.throws(() => session.place([5, 0, 5]), /E_TRIGGER_SHAPE_INVALID/);
  assert.equal(world.entityCount, 1);
  session.setOption("triggerRadius", 3);
  const trigger = session.place([5, 0, 5]);
  assert.deepEqual(trigger.components["game.trigger"].shape, { type: "sphere", radius: 3 });
  assert.equal(world.entityCount, 2);
});

test("ground viewport projection round-trips edit coordinates", () => {
  const point = [12, 0, -8];
  const projected = projectGround(point);
  const restored = groundFromViewport(projected.left * 10, projected.top * 5, { left: 0, top: 0, width: 1000, height: 500 });
  assert.deepEqual(restored, point);
});
