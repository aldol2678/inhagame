import test from "node:test";
import assert from "node:assert/strict";
import { FACILITIES } from "../src/campus-facilities.js";
import {
  DORM_1_APPROACH,
  DORM_1_CAMPUS_RETURN,
  DORM_1_ENTRANCE,
  DORM_1_FRAME
} from "../src/dorm1-layout.js";

test("first dormitory entrance is derived from the mapped reality footprint", () => {
  const dorm = FACILITIES.find(f => f.id === "bldg_dorm1");
  assert.ok(dorm);
  assert.equal(DORM_1_FRAME.buildingId, dorm.id);
  assert.equal(DORM_1_FRAME.placeZoneId, "AREA_DORM_SOUTH");
  assert.ok(DORM_1_FRAME.edgeIndex >= 0 && DORM_1_FRAME.edgeIndex < dorm.rings[0].length);
  assert.ok(DORM_1_FRAME.length >= 6);
  for (const value of [
    DORM_1_ENTRANCE.position.x, DORM_1_ENTRANCE.position.z,
    DORM_1_CAMPUS_RETURN.position.x, DORM_1_CAMPUS_RETURN.position.z,
    DORM_1_FRAME.outward.x, DORM_1_FRAME.outward.z
  ]) assert.ok(Number.isFinite(value));
});

test("return anchor is outside the entrance radius and keeps the same Place Zone contract", () => {
  const distance = Math.hypot(
    DORM_1_CAMPUS_RETURN.position.x - DORM_1_ENTRANCE.position.x,
    DORM_1_CAMPUS_RETURN.position.z - DORM_1_ENTRANCE.position.z
  );
  assert.ok(distance > DORM_1_ENTRANCE.radius);
  assert.equal(DORM_1_CAMPUS_RETURN.placeZoneId, DORM_1_ENTRANCE.placeZoneId);
  assert.equal(DORM_1_ENTRANCE.status, "ACTIVE");
});

test("approach links the shared gate frame to the housing return anchor without duplicating a room id", () => {
  assert.ok(Number.isFinite(DORM_1_APPROACH.from.x) && Number.isFinite(DORM_1_APPROACH.from.z));
  assert.deepEqual(DORM_1_APPROACH.to, {
    x: DORM_1_CAMPUS_RETURN.position.x,
    z: DORM_1_CAMPUS_RETURN.position.z
  });
  assert.equal("roomId" in DORM_1_ENTRANCE, false);
});
