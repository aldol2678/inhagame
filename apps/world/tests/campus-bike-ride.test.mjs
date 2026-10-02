import test from "node:test";
import assert from "node:assert/strict";
import { MAIN_GATE_CAMPUS_BIKE, CAMPUS_BIKE_ID } from "../src/mounts/campus-bike-world.js";

async function standAtParkedBike() {
  globalThis.window = { addEventListener() {} };
  globalThis.document = {
    body: { dataset: {} },
    getElementById: (id) => (id === "profile-panel" || id === "view-settings" ? { hidden: true } : null)
  };
  const { PlayerController } = await import("../src/player-controller.js");
  const pos = { x: MAIN_GATE_CAMPUS_BIKE.x, y: 1.15, z: MAIN_GATE_CAMPUS_BIKE.z };
  const controller = new PlayerController({
    getLocalPosition: () => ({ ...pos }),
    setLocalPosition: (x, y, z) => Object.assign(pos, { x, y, z }),
    setLocalEulerAngles() {}
  });
  return { controller, pos };
}

test("boarding the parked bike stays on the ground", async () => {
  const { controller, pos } = await standAtParkedBike();
  assert.equal(controller.boardBike(), true);
  assert.equal(controller.mounted, true);
  assert.equal(controller.mountId, CAMPUS_BIKE_ID);
  assert.equal(controller.onBike, true);
  const start = { ...pos };
  const y = pos.y;
  controller.keys.add("KeyW");
  controller.update(0.2, 0);
  assert.equal(controller.grounded, true);
  assert.ok(pos.y <= y + 0.05, "bike must not take off");
  assert.ok(Math.hypot(pos.x - start.x, pos.z - start.z) > 0.05,
    "bike must move away from its parked collider after boarding");
  const action = controller.getMountContextAction();
  assert.equal(action.icon, "🚲");
  assert.equal(controller.dismountBike(), true);
  assert.equal(controller.mounted, false);
  assert.equal(controller.mountId, null);
});

// #177: the hidden parked bike kept its collider while riding and dragged the rider off the spot.
test("riding off the parked spot is as fast as open-road cruising", async () => {
  const { controller, pos } = await standAtParkedBike();
  assert.equal(controller.boardBike(), true);
  controller.keys.add("KeyW");
  const legs = [];
  for (let leg = 0; leg < 2; leg++) {
    const from = { ...pos };
    for (let step = 0; step < 5; step++) controller.update(0.05, 0);
    legs.push(Math.hypot(pos.x - from.x, pos.z - from.z));
  }
  assert.ok(legs[1] > 1, "open-road leg must cover ground");
  assert.ok(Math.abs(legs[0] - legs[1]) < 0.01,
    `leaving the parked spot (${legs[0].toFixed(3)}) must match cruising (${legs[1].toFixed(3)})`);
  assert.equal(controller.dismountBike(), true);
});
