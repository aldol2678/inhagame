import test from "node:test";
import assert from "node:assert/strict";
import {
  CAMPUS_BIKE_ID,
  MAIN_GATE_CAMPUS_BIKE,
  MAIN_GATE_CAMPUS_BIKE_COLLIDER,
  setCampusBikePropRoot,
  setCampusBikePropVisible
} from "../src/mounts/campus-bike-world.js";
import { OBSTACLES } from "../src/campus-layout.js";

test("main-gate campus bike is a rideable ground mount", () => {
  assert.equal(CAMPUS_BIKE_ID, "mount.campus_bike.default");
  assert.equal(MAIN_GATE_CAMPUS_BIKE.rideable, true);
  assert.equal(MAIN_GATE_CAMPUS_BIKE.mountId, CAMPUS_BIKE_ID);
  assert.ok(MAIN_GATE_CAMPUS_BIKE.interactionRadius > 0);
  assert.ok(Number.isFinite(MAIN_GATE_CAMPUS_BIKE.x));
  assert.ok(Number.isFinite(MAIN_GATE_CAMPUS_BIKE.z));
});

test("parked campus bike visibility follows boarding state", () => {
  const root = { enabled: true };
  setCampusBikePropRoot(root);
  setCampusBikePropVisible(false);
  assert.equal(root.enabled, false);
  setCampusBikePropVisible(true);
  assert.equal(root.enabled, true);
  setCampusBikePropRoot(null);
});

test("campus bike collider is registered and has no rear rack volume", () => {
  assert.equal(MAIN_GATE_CAMPUS_BIKE_COLLIDER.polygon.length, 4);
  assert.ok(MAIN_GATE_CAMPUS_BIKE_COLLIDER.maxY < 1);
  assert.ok(OBSTACLES.some((item) => item.id === "main_gate_campus_bike"));
});
