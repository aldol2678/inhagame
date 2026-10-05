import test from "node:test";
import assert from "node:assert/strict";
import { createFakeDocument } from "./support/fake-dom.mjs";
import { createRoomTransition } from "../src/rooms/room-transition.js";
import { createBackGateArrivalEvent } from "../src/back-gate-arrival-event.js";

test("room transition holds external SYSTEM_LOCK across an async fade switch", () => {
  let pending = null;
  let now = 1_000;
  const lifecycle = [];
  const calls = [];
  const world = {
    getPlaceZoneId: () => "AREA_MAIN_HALL",
    leaveCampus: room => calls.push(["leaveCampus", room.id]),
    showRoom: room => calls.push(["showRoom", room.id]),
    placePlayer: (position, yaw) => calls.push(["placePlayer", position, yaw]),
    showCampus: room => calls.push(["showCampus", room.id]),
    resumeCampus: () => calls.push(["resumeCampus"])
  };
  const rooms = createRoomTransition({
    world,
    clock: { now: () => now },
    fade: run => { pending = run; },
    onBusyChange: busy => lifecycle.push(busy)
  });

  assert.equal(rooms.enter("ROOM_CLUBHOUSE_01"), true);
  assert.equal(rooms.status().busy, true);
  assert.deepEqual(lifecycle, [true]);
  assert.equal(calls.length, 0, "scene switch waits behind the fade");

  pending();
  assert.equal(rooms.status().busy, false);
  assert.equal(rooms.insideRoom, true);
  assert.deepEqual(lifecycle, [true, false]);

  now += 1_000;
  pending = null;
  assert.equal(rooms.exit(), true);
  assert.deepEqual(lifecycle, [true, false, true]);
  pending();
  assert.equal(rooms.insideRoom, false);
  assert.deepEqual(lifecycle, [true, false, true, false]);
});

test("Back Gate arrival delegates input authority without touching controller/orbit directly", () => {
  const doc = createFakeDocument();
  doc.body = doc.createElement("body");
  doc.body.appendChild = (...nodes) => doc.body.append(...nodes);
  const lifecycle = [];
  const event = createBackGateArrivalEvent({
    player: { setLocalEulerAngles() {} },
    camera: {
      camera: { fov: 62 },
      setPosition() {},
      lookAt() {}
    },
    controller: {
      keys: { clear() { throw new Error("direct keys clear"); } },
      setInputEnabled() { throw new Error("direct controller toggle"); }
    },
    orbit: {
      setInputEnabled() { throw new Error("direct orbit toggle"); }
    },
    documentLike: doc,
    onInputLockChange: locked => lifecycle.push(locked)
  });

  assert.equal(event.start(), true);
  assert.deepEqual(lifecycle, [true]);
  assert.equal(event.isActive(), true);

  for (let i = 0; i < 160 && event.isActive(); i++) event.update(0.05);
  assert.equal(event.isActive(), false);
  assert.deepEqual(lifecycle, [true, false]);
});

test("Back Gate arrival retains legacy fallback input authority for isolated callers", async () => {
  const source = await import("node:fs").then(({ readFileSync }) =>
    readFileSync(new URL("../src/back-gate-arrival-event.js", import.meta.url), "utf8"));
  assert.match(source, /typeof onInputLockChange === 'function'/);
  assert.match(source, /controller\.setInputEnabled\?\.\(!locked\)/);
  assert.match(source, /orbit\.setInputEnabled\?\.\(!locked\)/);
});
