import test from "node:test";
import assert from "node:assert/strict";
import { INTERPOLATION_DEFAULTS, SnapshotInterpolator, lerpYaw } from "../src/network/interpolation.js";
import { Anim } from "../src/network/protocol.js";

const snap = (x, yaw = 0, extra = {}) => ({ x, y: 1.15, z: 0, yaw, vx: 0, vz: 0, anim: Anim.WALK, ...extra });
const near = (actual, expected, eps = 1e-6) => assert.ok(Math.abs(actual - expected) < eps, `${actual} ≈ ${expected}`);

test("buffer delay is inside the 150–250 ms design window", () => {
  assert.ok(INTERPOLATION_DEFAULTS.delayMs >= 150 && INTERPOLATION_DEFAULTS.delayMs <= 250);
});

test("position interpolates between buffered snapshots at render time = now − delay", () => {
  const interp = new SnapshotInterpolator({ delayMs: 200 });
  interp.push(snap(0), 1000);
  interp.push(snap(2), 1250);
  near(interp.sample(1200).x, 0, 1e-9);
  near(interp.sample(1325).x, 1);
  assert.equal(interp.sample(1325).mode, "interpolate");
  near(interp.sample(1450).x, 2);
});

test("yaw interpolates the short way across ±180°", () => {
  near(lerpYaw(170, -170, 0.5), 180);
  near(lerpYaw(-170, 170, 0.25), -175);
  near(lerpYaw(10, 350, 0.5), 0);
  const interp = new SnapshotInterpolator({ delayMs: 0 });
  interp.push(snap(0, 170), 0);
  interp.push(snap(0.5, -170), 100);
  for (let t = 0; t <= 100; t += 10) {
    const yaw = Math.abs(interp.sample(t).yaw);
    assert.ok(yaw >= 170 - 1e-9, `never swings through 0 (t=${t}, yaw=${yaw})`);
  }
});

test("sampling is independent of frame rate", () => {
  const interp = new SnapshotInterpolator();
  interp.push(snap(0), 0);
  interp.push(snap(1.75), 250);
  interp.push(snap(3.5), 500);
  const at30 = interp.sample(200 + 1000 / 30 * 10);
  const at144 = interp.sample(200 + 1000 / 144 * 48);
  near(at30.x, at144.x, 0.02);
});

test("a large discontinuity snaps instead of sliding", () => {
  const interp = new SnapshotInterpolator({ delayMs: 200 });
  interp.push(snap(0), 0);
  assert.equal(interp.push(snap(4), 250), "buffered", "a normal 4 Hz step");
  assert.equal(interp.push(snap(60), 500), "snap");
  assert.equal(interp.snaps, 1);
  near(interp.sample(510).x, 60);
});

test("explicit teleport snaps immediately", () => {
  const interp = new SnapshotInterpolator({ delayMs: 200 });
  interp.push(snap(0), 0);
  interp.push(snap(1), 250);
  interp.teleport({ x: 5, y: 1.15, z: 5, yaw: 90 }, 300);
  const state = interp.sample(301);
  assert.deepEqual([state.x, state.z, state.yaw], [5, 5, 90]);
});

test("a long packet gap extrapolates at most maxExtrapolationMs, then holds", () => {
  const interp = new SnapshotInterpolator({ delayMs: 200, maxExtrapolationMs: 250 });
  interp.push(snap(0, 0, { vx: 4 }), 0);
  interp.push(snap(1, 0, { vx: 4 }), 250);
  const short = interp.sample(250 + 200 + 100);
  near(short.x, 1.4);
  assert.equal(short.mode, "extrapolate");
  const long = interp.sample(250 + 200 + 10_000);
  near(long.x, 2);
  assert.equal(long.mode, "hold");
  near(interp.sample(250 + 200 + 60_000).x, 2, 1e-9);
});

test("prune keeps an anchor behind the render cursor", () => {
  const interp = new SnapshotInterpolator({ delayMs: 200 });
  for (let i = 0; i < 10; i += 1) interp.push(snap(i * 0.5), i * 250);
  interp.prune(2250 + 200);
  assert.equal(interp.buffer.length, 2);
  near(interp.sample(2250 + 200).x, 4.5);
});
