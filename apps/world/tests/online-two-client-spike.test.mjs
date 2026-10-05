// Online Spike 01 (Notion §12) replayed headlessly: two clients, one fake network, fake clock.
import test from "node:test";
import assert from "node:assert/strict";
import { ConnectionState } from "../src/network/connection-state.js";
import { Anim, encodePose } from "../src/network/protocol.js";
import { AGORA, MAIN_HALL, RUN_SPEED, WALK_SPEED, createClient, createWorld, remoteIds, run } from "./support/online-harness.mjs";

const { OFFLINE, ONLINE, RECONNECTING } = ConnectionState;

function spike() {
  const world = createWorld({ latencyMs: 40 });
  const a = createClient(world, { label: "A", position: { x: 55, z: -10 } });
  const b = createClient(world, { label: "B", position: { x: 50, z: -12 } });
  const bEvents = [];
  b.net.onRemoteEvent((event) => bEvents.push(`${event.type}:${event.player.sessionId}${event.reason ? `:${event.reason}` : ""}`));
  return { world, a, b, bEvents };
}

const count = (client, sessionId) => client.net.remotes.list().filter((p) => p.sessionId === sessionId).length;

test("two-client spike: join, see, move, run, jump, stale, disconnect, reconnect, zone change", () => {
  const { world, a, b, bEvents } = spike();

  // 1–3. A joins, B joins, both observe each other.
  a.net.setPlaceZone(MAIN_HALL);
  a.net.start();
  run(world, 300);
  assert.equal(a.net.state, ONLINE);
  b.net.setPlaceZone(MAIN_HALL);
  b.net.start();
  run(world, 300);
  assert.deepEqual(remoteIds(a), ["sess-b"]);
  assert.deepEqual(remoteIds(b), ["sess-a"]);
  assert.equal(a.net.onlineCount, 2);
  assert.equal(b.net.onlineCount, 2);
  assert.equal(b.net.remotes.get("sess-a").displayName, "DuckA");
  // Each side received the other's position without anyone moving (forced snapshot on join).
  assert.deepEqual([b.net.remotes.get("sess-a").latestPose.x, b.net.remotes.get("sess-a").latestPose.z], [55, -10]);
  assert.deepEqual([a.net.remotes.get("sess-b").latestPose.x, a.net.remotes.get("sess-b").latestPose.z], [50, -12]);

  // 4–5. A walks north; B's remote state follows.
  a.sim.input = { speed: WALK_SPEED, heading: 0, turnRate: 0 };
  run(world, 1000);
  const remoteA = b.net.remotes.get("sess-a");
  assert.equal(remoteA.anim, Anim.WALK);
  assert.ok(Math.abs(remoteA.latestPose.z - a.sim.z) < WALK_SPEED * 0.35, "within one send interval + latency");
  const rendered = b.net.sampleRemotes()[0].pose;
  assert.ok(rendered.z > -10 && rendered.z < a.sim.z, "interpolated view trails the live position");

  // 6. RUN propagates.
  a.sim.input.speed = RUN_SPEED;
  run(world, 400);
  assert.equal(b.net.remotes.get("sess-a").anim, Anim.RUN);
  assert.ok(Math.abs(b.net.remotes.get("sess-a").latestPose.vz - RUN_SPEED) < 0.01);

  // 7. JUMP arrives as an action, ahead of the next pose snapshot.
  // Pretend a pose just left, so the next one cannot go for 250 ms; let in-flight poses land first.
  a.net.publisher.markSent(world.scheduler.now(), a.sim.sample());
  run(world, 50);
  const posesBefore = b.net.remotes.stats.poseAccepted;
  const sentAt = world.scheduler.now();
  assert.ok(a.sim.jump());
  assert.ok(a.net.reportJump());
  run(world, 60);
  assert.ok(b.net.remotes.get("sess-a").lastJumpAt >= sentAt + 40, "jump delivered after one latency");
  assert.equal(b.net.remotes.stats.poseAccepted, posesBefore, "no pose was needed");
  assert.equal(b.net.sampleRemotes()[0].anim, Anim.AIR);

  // 8. A stale (reordered) pose is ignored.
  const beforeStale = { ...b.net.remotes.get("sess-a").latestPose };
  world.hub.inject("pose", "B", { placeZoneId: MAIN_HALL, sessionId: "sess-a", packet: encodePose(0, { x: 0, y: 1.15, z: 0, yaw: 0, anim: Anim.IDLE }) });
  run(world, 20);
  assert.deepEqual(b.net.remotes.get("sess-a").latestPose, beforeStale);
  assert.equal(b.net.remotes.stats.poseStale, 1);

  // 9–10. A's connection drops; B removes A; A keeps playing locally.
  a.sim.input.speed = WALK_SPEED;
  world.hub.dropClient("A");
  const zBeforeOutage = a.sim.z;
  run(world, 300);
  assert.equal(a.net.state, RECONNECTING);
  assert.equal(count(b, "sess-a"), 0);
  assert.ok(bEvents.includes("playerLeft:sess-a:left"));
  assert.ok(a.sim.z > zBeforeOutage + 1.5, "local movement continued while reconnecting");
  assert.equal(b.net.onlineCount, 1);

  // 11–12. A's network recovers; the retry reconnects and A appears exactly once on both sides.
  world.hub.restoreClient("A");
  run(world, 2000);
  assert.equal(a.net.state, ONLINE);
  assert.equal(count(b, "sess-a"), 1);
  assert.equal(count(a, "sess-b"), 1);
  assert.equal(b.net.remotes.size, 1);
  assert.equal(a.net.remotes.size, 1);
  assert.equal(a.net.remotes.get("sess-b").presence, "present");
  assert.equal(bEvents.filter((e) => e === "playerJoined:sess-a").length, 2, "joined, left, joined — never twice at once");

  // 13–15. A moves to the Agora; B drops A from the Main Hall; no duplicates remain.
  a.net.handlePlaceZoneChanged(MAIN_HALL, AGORA);
  assert.equal(a.net.remotes.size, 0, "A stops showing Main Hall players immediately");
  run(world, 300);
  assert.equal(count(b, "sess-a"), 0);
  assert.equal(a.net.remotes.size, 0, "nobody else in the Agora");
  assert.equal(a.net.onlineCount, 1);
  b.net.setPlaceZone(AGORA);
  run(world, 300);
  assert.deepEqual(remoteIds(a), ["sess-b"]);
  assert.deepEqual(remoteIds(b), ["sess-a"]);
  assert.equal(b.net.remotes.get("sess-a").placeZoneId, AGORA);
});

test("network failure: RECONNECTING while local play continues, recovery reconciles without duplicates", () => {
  const { world, a, b } = spike();
  for (const client of [a, b]) { client.net.setPlaceZone(MAIN_HALL); client.net.start(); }
  run(world, 500);
  a.sim.input = { speed: WALK_SPEED, heading: 90, turnRate: 0 };
  b.sim.input = { speed: RUN_SPEED, heading: 0, turnRate: 30 };

  world.hub.setReachable(false);
  const localBefore = [a.sim.x, b.sim.z];
  run(world, 1500);
  assert.deepEqual([a.net.state, b.net.state], [RECONNECTING, RECONNECTING]);
  // Remote state is frozen, not deleted, while we are the ones in doubt.
  assert.equal(a.net.remotes.get("sess-b").presence, "suspect");
  assert.ok(a.sim.x > localBefore[0] + 9 && b.sim.z > localBefore[1] + 5, "both players kept moving");
  assert.equal(a.sim.frames, b.sim.frames);
  assert.ok(!("controller" in a.net) && !("player" in a.net), "network holds no reference to the local player");

  world.hub.setReachable(true);
  run(world, 3000);
  assert.deepEqual([a.net.state, b.net.state], [ONLINE, ONLINE]);
  assert.deepEqual(remoteIds(a), ["sess-b"]);
  assert.deepEqual(remoteIds(b), ["sess-a"]);
  assert.equal(a.net.remotes.get("sess-b").presence, "present");
  run(world, 500);
  assert.ok(Math.abs(a.net.remotes.get("sess-b").latestPose.z - b.sim.z) < 4, "poses flow again after recovery");
});

test("long outage: retries exhausted → OFFLINE, world keeps running, manual restart recovers", () => {
  const { world, a, b } = spike();
  for (const client of [a, b]) { client.net.setPlaceZone(MAIN_HALL); client.net.start(); }
  run(world, 500);
  a.sim.input = { speed: WALK_SPEED, heading: 0, turnRate: 0 };
  world.hub.setReachable(false);
  run(world, 40_000);
  assert.equal(a.net.state, OFFLINE);
  assert.equal(a.net.remotes.size, 0, "offline mode shows no remote players");
  assert.equal(a.net.onlineCount, 0);
  assert.ok(a.sim.z > -10 + WALK_SPEED * 39, "40 s of uninterrupted local play");
  assert.equal(a.net.connection.history.at(-1), OFFLINE);

  world.hub.setReachable(true);
  a.net.start();
  b.net.start();
  run(world, 500);
  assert.deepEqual(remoteIds(a), ["sess-b"]);
  assert.deepEqual(remoteIds(b), ["sess-a"]);
});
