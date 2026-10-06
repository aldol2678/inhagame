import test from "node:test";
import assert from "node:assert/strict";
import { MAIN_GATE_REVEAL_V01 } from "../src/cinematic/main-gate-reveal.js";
import { MAIN_GATE_SPAWN } from "../src/campus-spawn.js";
import { TOUR_STOPS } from "../src/campus-layout.js";

test("main gate reveal stays finite, bounded in duration and ends aimed at the authored main-hall stop", () => {
  assert.equal(MAIN_GATE_REVEAL_V01.id, "MAIN_GATE_REVEAL_V01");
  assert.equal(MAIN_GATE_REVEAL_V01.skippable, true);
  assert.ok(MAIN_GATE_REVEAL_V01.duration > 4 && MAIN_GATE_REVEAL_V01.duration < 10);
  assert.ok(MAIN_GATE_REVEAL_V01.streamingLeadSeconds > 0);

  for (const time of [0, 1, 2.35, 4.5, MAIN_GATE_REVEAL_V01.duration]) {
    const pose = MAIN_GATE_REVEAL_V01.poseAt(time);
    for (const point of [pose.pos, pose.look]) {
      assert.ok(Number.isFinite(point.x));
      assert.ok(Number.isFinite(point.y));
      assert.ok(Number.isFinite(point.z));
    }
    assert.ok(pose.fov >= 50 && pose.fov <= 75);
  }

  const first = MAIN_GATE_REVEAL_V01.poseAt(0);
  assert.ok(Math.hypot(first.pos.x - MAIN_GATE_SPAWN.x, first.pos.z - MAIN_GATE_SPAWN.z) < 30);

  const main = TOUR_STOPS.find(stop => stop.id === "main");
  const last = MAIN_GATE_REVEAL_V01.poseAt(MAIN_GATE_REVEAL_V01.duration);
  assert.equal(last.look.x, main.x);
  assert.equal(last.look.z, main.z);
});
