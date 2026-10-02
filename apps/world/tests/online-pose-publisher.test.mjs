import test from "node:test";
import assert from "node:assert/strict";
import { POSE_PUBLISH_DEFAULTS, PosePublisher, yawDelta } from "../src/network/pose-publisher.js";
import { Anim } from "../src/network/protocol.js";

const at = (x = 0, { yaw = 0, anim = Anim.IDLE, y = 1.15, z = 0 } = {}) => ({ x, y, z, yaw, anim });

function sendIfDue(publisher, now, sample) {
  const reason = publisher.evaluate(now, sample);
  if (reason) publisher.markSent(now, sample);
  return reason;
}

test("thresholds are named constants matching the Notion design", () => {
  assert.deepEqual({ ...POSE_PUBLISH_DEFAULTS }, { minIntervalMs: 250, minDistanceM: 0.15, minYawDeg: 8 });
});

test("first sample is sent, identical stationary samples are suppressed forever", () => {
  const publisher = new PosePublisher();
  assert.equal(sendIfDue(publisher, 0, at()), "first");
  let sent = 0;
  for (let now = 16; now <= 60_000; now += 16) if (sendIfDue(publisher, now, at())) sent += 1;
  assert.equal(sent, 0);
});

test("movement threshold is 0.15 m and rate is capped at 4 Hz", () => {
  const publisher = new PosePublisher();
  sendIfDue(publisher, 0, at(0));
  assert.equal(publisher.evaluate(300, at(0.14)), null, "under 0.15 m stays quiet");
  assert.equal(publisher.evaluate(300, at(0.16, { anim: Anim.IDLE })), "moved");
  assert.equal(publisher.evaluate(249, at(5)), null, "rate limit beats distance");
  // Walking at 7 m/s sampled at 60 fps for 10 s.
  const walk = new PosePublisher();
  let sent = 0;
  for (let frame = 0; frame <= 600; frame += 1) {
    const now = frame * 1000 / 60;
    if (sendIfDue(walk, now, at(7 * now / 1000, { anim: Anim.WALK }))) sent += 1;
  }
  assert.ok(sent >= 30 && sent <= 41, `3–4 Hz while walking, got ${sent}/10 s`);
});

test("yaw threshold is 8° across the ±180° seam", () => {
  assert.equal(yawDelta(179, -179), 2);
  const publisher = new PosePublisher();
  sendIfDue(publisher, 0, at(0, { yaw: 176 }));
  assert.equal(publisher.evaluate(300, at(0, { yaw: -177 })), null, "7° across the seam");
  assert.equal(publisher.evaluate(300, at(0, { yaw: -175 })), "turned", "9° across the seam");
});

test("animation change sends even without movement", () => {
  const publisher = new PosePublisher();
  sendIfDue(publisher, 0, at(0, { anim: Anim.RUN }));
  assert.equal(publisher.evaluate(300, at(0, { anim: Anim.IDLE })), "anim", "the stop itself is published");
});

test("forced snapshot bypasses thresholds and rate, once", () => {
  const publisher = new PosePublisher();
  sendIfDue(publisher, 0, at());
  publisher.forceSnapshot();
  assert.equal(sendIfDue(publisher, 10, at()), "forced");
  assert.equal(publisher.evaluate(400, at()), null);
});
