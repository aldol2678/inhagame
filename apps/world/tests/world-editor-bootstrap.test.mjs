import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmptyWorld,
  DEFAULT_COORDINATE_SYSTEM,
  normalizeTransform,
  WorldDocument,
  WORLD_SCHEMA_VERSION
} from "../src/editor/world-document.js";
import { EditorState } from "../src/editor/editor-state.js";

test("WorldDocument starts from the approved P0 top-level contract", () => {
  const source = createEmptyWorld({ worldId: "world.test", name: "Test World" });
  const world = new WorldDocument(source);
  const snapshot = world.snapshot();

  assert.equal(snapshot.schemaVersion, WORLD_SCHEMA_VERSION);
  assert.equal(snapshot.worldId, "world.test");
  assert.equal(snapshot.name, "Test World");
  assert.deepEqual(snapshot.coordinateSystem, DEFAULT_COORDINATE_SYSTEM);
  assert.deepEqual(snapshot.assets, []);
  assert.deepEqual(snapshot.entities, []);
  assert.deepEqual(snapshot.metadata, {});
  assert.equal(world.entityCount, 0);
  assert.equal(world.revision, 0);
  assert.equal(world.dirty, false);
});

test("Entity mutations update revision and dirty state without changing stable IDs", () => {
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.test" }));
  const events = [];
  world.subscribe(event => events.push(event));

  const added = world.addEntity({
    id: "entity.test.001",
    name: "Test Prop",
    kind: "prop",
    transform: { position: [1, 2, 3] }
  });

  assert.equal(added.id, "entity.test.001");
  assert.deepEqual(added.transform, {
    position: [1, 2, 3],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1]
  });
  assert.equal(world.revision, 1);
  assert.equal(world.dirty, true);

  const updated = world.updateEntity("entity.test.001", {
    name: "Moved Prop",
    transform: { position: [4, 5, 6] }
  });

  assert.equal(updated.id, "entity.test.001");
  assert.equal(updated.name, "Moved Prop");
  assert.deepEqual(updated.transform.position, [4, 5, 6]);
  assert.deepEqual(updated.transform.rotation, [0, 0, 0, 1]);
  assert.deepEqual(updated.transform.scale, [1, 1, 1]);
  assert.equal(world.revision, 2);

  assert.throws(
    () => world.updateEntity("entity.test.001", { id: "entity.rewritten" }),
    /E_ENTITY_ID_IMMUTABLE/
  );

  assert.equal(world.removeEntity("entity.test.001"), true);
  assert.equal(world.entityCount, 0);
  assert.equal(world.revision, 3);
  assert.deepEqual(events.map(event => event.type), [
    "entity-added",
    "entity-updated",
    "entity-removed"
  ]);
});

test("WorldDocument rejects duplicate IDs and missing parents", () => {
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.test" }));
  world.addEntity({ id: "entity.parent" });

  assert.throws(
    () => world.addEntity({ id: "entity.parent" }),
    /E_DUP_ENTITY_ID:entity\.parent/
  );

  assert.throws(
    () => world.addEntity({ id: "entity.child", parentId: "entity.missing" }),
    /E_PARENT_NOT_FOUND:entity\.missing/
  );
});

test("Parent entities cannot be removed while children still reference them", () => {
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.test" }));
  world.addEntity({ id: "entity.parent" });
  world.addEntity({ id: "entity.child", parentId: "entity.parent" });

  assert.throws(
    () => world.removeEntity("entity.parent"),
    /E_ENTITY_HAS_CHILDREN:entity\.parent/
  );

  assert.equal(world.removeEntity("entity.child"), true);
  assert.equal(world.removeEntity("entity.parent"), true);
});

test("Snapshots and returned entities do not expose mutable canonical references", () => {
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.test" }));
  world.addEntity({
    id: "entity.test",
    transform: { position: [2, 0, -3] },
    metadata: { source: "bootstrap" }
  });

  const snapshot = world.snapshot();
  snapshot.entities[0].transform.position[0] = 999;
  snapshot.entities[0].metadata.source = "mutated";

  const entity = world.getEntity("entity.test");
  entity.transform.position[2] = 999;

  assert.deepEqual(world.getEntity("entity.test").transform.position, [2, 0, -3]);
  assert.equal(world.getEntity("entity.test").metadata.source, "bootstrap");
});

test("markSaved clears dirty without pretending to mutate world data", () => {
  const world = new WorldDocument(createEmptyWorld({ worldId: "world.test" }));
  world.addEntity({ id: "entity.test" });
  const revision = world.revision;

  world.markSaved();

  assert.equal(world.dirty, false);
  assert.equal(world.revision, revision);
});

test("normalizeTransform degrades invalid numeric input to safe defaults", () => {
  assert.deepEqual(
    normalizeTransform({
      position: [1, Number.NaN, 3],
      rotation: [0, 0, 0, Number.POSITIVE_INFINITY],
      scale: [2, 2, 2]
    }),
    {
      position: [1, 0, 3],
      rotation: [0, 0, 0, 1],
      scale: [2, 2, 2]
    }
  );
});

test("EditorState keeps selection and active tool outside WorldDocument", () => {
  const state = new EditorState();
  const events = [];
  state.subscribe(event => events.push(event.type));

  state.select("entity.test");
  state.setTool("move");
  state.clearSelection();

  assert.equal(state.selectedEntityId, null);
  assert.equal(state.activeTool, "move");
  assert.deepEqual(events, [
    "selection-changed",
    "tool-changed",
    "selection-changed"
  ]);
  assert.throws(() => state.setTool("paint"), /E_EDITOR_TOOL_UNKNOWN:paint/);
});
