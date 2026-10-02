// PR #106 × Online: the real PlayerController walks roadview stairs and terraces; the online pose
// source samples it; a second client renders it through FakeTransport + interpolation.
import test from "node:test";
import assert from "node:assert/strict";
import { AGORA, STUDENT_TERRACES, roadviewGroundHeight } from "../src/roadview-layout.js";
import { PlayerController } from "../src/player-controller.js";
import { OBSTACLES } from "../src/campus-layout.js";
import { getPlaceZoneAt } from "../src/place-zone-registry.js";
import { createPoseSource } from "../src/online/pose-source.js";
import { Anim } from "../src/network/protocol.js";
import { FakeNetworkHub, FakeScheduler } from "../src/network/fake-transport.js";
import { NetworkManager } from "../src/network/network-manager.js";

globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { getElementById() { return null; } };
const FRAME = 1000 / 60;

function actor(p) {
  let position = { ...p, y: 1.15 + roadviewGroundHeight(p.x, p.z) };
  let yaw = 0;
  const entity = {
    getLocalPosition: () => ({ ...position }),
    setLocalPosition(x, y, z) { position = { x, y, z }; },
    setLocalEulerAngles(_x, y) { yaw = y; },
    getLocalRotation: () => ({ x: 0, y: Math.sin(yaw * Math.PI / 360), z: 0, w: Math.cos(yaw * Math.PI / 360) })
  };
  const controller = new PlayerController(entity);
  return { entity, controller, poses: createPoseSource({ player: entity, controller }) };
}

function onlinePair(zone) {
  const scheduler = new FakeScheduler(1_000_000);
  const hub = new FakeNetworkHub({ scheduler, latencyMs: 60 });
  const make = (label) => {
    const net = new NetworkManager({ transport: hub.createTransport(label), clock: scheduler,
      identity: { sessionId: `sess-${label}`, userId: `user-${label}`, displayName: `Duck${label}` } });
    net.setPlaceZone(zone);
    net.start();
    return net;
  };
  return { scheduler, a: make("a"), b: make("b") };
}

// Walk the real controller toward target, streaming poses to B and sampling B's render each frame.
function walkOnline(ctx, a, target, report) {
  for (let i = 0; i < 900; i += 1) {
    const p = a.entity.getLocalPosition();
    const dx = target.x - p.x, dz = target.z - p.z, len = Math.hypot(dx, dz);
    if (len < 0.01) { a.controller.touchVector = { x: 0, y: 0 }; }
    else a.controller.touchVector = { x: dx / len, y: -dz / len };
    a.controller.update(FRAME / 1000);
    ctx.scheduler.advanceTo(ctx.scheduler.now() + FRAME);
    const { pose, jumped } = a.poses.sample(FRAME / 1000);
    report.jumps += jumped ? 1 : 0;
    if (pose.anim === Anim.AIR) report.airFrames += 1;
    assert.ok(Math.abs(pose.y - a.entity.getLocalPosition().y) < 1e-9, "pose y is the true entity y");
    ctx.a.update(pose);
    ctx.b.update(null);
    const view = ctx.b.sampleRemotes().find((r) => r.sessionId === "sess-a")?.pose;
    if (view && view.mode === "interpolate") {
      const surface = 1.15 + roadviewGroundHeight(view.x, view.z);
      report.maxFloat = Math.max(report.maxFloat, view.y - surface);
      report.maxSink = Math.max(report.maxSink, surface - view.y);
    }
    if (len < 0.01 && i > 30) return;
  }
}

test("#106 stairs: pose source reads the terrace height, never fakes a jump; remote follows the surface", () => {
  const u = (AGORA.stairStart + AGORA.stairEnd) / 2;
  const bottom = AGORA.frame.at(u, 6), top = AGORA.frame.at(u, -2);
  const zone = getPlaceZoneAt(bottom).id;
  assert.equal(zone, "AREA_AGORA_6_9", "Agora stairs resolve to the Agora place zone");
  assert.equal(getPlaceZoneAt(top).id, zone, "the terrace does not change the semantic place");
  const ctx = onlinePair(zone);
  for (let i = 0; i < 30; i += 1) { ctx.scheduler.advanceTo(ctx.scheduler.now() + FRAME); ctx.a.update(null); ctx.b.update(null); }
  const a = actor(bottom);
  const report = { jumps: 0, airFrames: 0, maxFloat: 0, maxSink: 0 };
  walkOnline(ctx, a, top, report);
  assert.ok(Math.abs(a.entity.getLocalPosition().y - 2.75) < 1e-6, "local player reached the deck");
  walkOnline(ctx, a, bottom, report);
  assert.equal(report.jumps, 0, "stairs never produce a JUMP action");
  assert.equal(report.airFrames, 0, "stairs never flip anim to air");
  // Linear interpolation between 4 Hz snapshots cuts the ramp's knees slightly; bound it.
  assert.ok(report.maxFloat < 0.25, `remote float ${report.maxFloat.toFixed(3)} m`);
  assert.ok(report.maxSink < 0.25, `remote sink ${report.maxSink.toFixed(3)} m`);
  const remote = ctx.b.remotes.get("sess-a");
  assert.ok(Math.abs(remote.latestPose.y - 1.15) < 0.01, "final remote height back on the ground");
  assert.equal(ctx.a.sent.action, 0, "no actions were sent while walking stairs");
});

test("#106 jump on a terrace is one JUMP action and lands at terrace height", () => {
  const t = STUDENT_TERRACES[0];
  const start = t.frame.at(t.frame.length / 2, t.landing + t.run + 1);
  const deck = t.frame.at(t.frame.length / 2, 0.75);
  const ctx = onlinePair(getPlaceZoneAt(start).id);
  const a = actor(start);
  const report = { jumps: 0, airFrames: 0, maxFloat: 0, maxSink: 0 };
  walkOnline(ctx, a, deck, report);
  assert.ok(Math.abs(a.entity.getLocalPosition().y - 1.75) < 1e-6);
  a.controller.jumpQueued = true;
  let jumps = 0;
  for (let i = 0; i < 90; i += 1) {
    a.controller.update(FRAME / 1000);
    ctx.scheduler.advanceTo(ctx.scheduler.now() + FRAME);
    const { pose, jumped } = a.poses.sample(FRAME / 1000);
    if (jumped) { jumps += 1; ctx.a.reportJump(); }
    ctx.a.update(pose);
    ctx.b.update(null);
  }
  assert.equal(jumps, 1);
  assert.equal(a.controller.grounded, true);
  assert.ok(Math.abs(a.entity.getLocalPosition().y - 1.75) < 1e-6, "landed on the terrace");
  assert.ok(ctx.b.remotes.get("sess-a").lastJumpAt !== null, "remote saw the jump");
  assert.ok(Math.abs(ctx.b.remotes.get("sess-a").latestPose.y - 1.75) < 0.01);
});

test("#106 colliders are static world geometry; remote players add none", () => {
  const before = OBSTACLES.length;
  assert.ok(OBSTACLES.some((o) => o.id.includes("agora") || o.id.includes("gate_booth")), "roadview colliders present");
  assert.ok(OBSTACLES.every((o) => !String(o.id).startsWith("RemotePlayer")));
  assert.ok(Object.isFrozen(OBSTACLES), "collision set cannot grow at runtime");
  assert.equal(OBSTACLES.length, before);
});
