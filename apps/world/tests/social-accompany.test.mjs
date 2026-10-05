import test from "node:test";
import assert from "node:assert/strict";
import { selectNearbyPlayers } from "../src/social/nearby-players.js";
import { parseAccompanySession } from "../src/social/accompany-client.js";
import { AccompanyController } from "../src/social/accompany-controller.js";
import { Relationship } from "../src/social/social-client.js";
import { FollowController, ACCOMPANY_ZONE_GRACE_MS } from "../src/social/follow-controller.js";

const A = "a0000000-0000-4000-8000-0000000000a1";
const B = "b0000000-0000-4000-8000-0000000000b2";
const C = "c0000000-0000-4000-8000-0000000000c3";
const ID = "d0000000-0000-4000-8000-0000000000d4";
const ZONE = "AREA_MAIN_HALL";
const remote = (userId, x, extra = {}) => ({ userId, sessionId: `${userId}-session`, displayName: userId,
  placeZoneId: ZONE, presence: "present", pose: { x, y: 0, z: 0 }, ...extra });

test("Nearby includes only present, unblocked people in 15m; 17m exit hysteresis and duplicate sessions", () => {
  const remotes = [remote(A, 1), remote(B, 7.4), remote(B, 8), remote(C, 2),
    remote("outside", 1, { placeZoneId: "AREA_OTHER" }), remote("suspect", 1, { presence: "suspect" })];
  const args = { remotes, position: { x: 0, z: 0 }, selfUserId: A, zoneId: ZONE,
    blocked: id => id === C };
  assert.deepEqual(selectNearbyPlayers(args).map(row => row.userId), [B]);
  remotes[1].pose.x = 8.2; remotes[2].pose.x = 8.3;
  assert.equal(selectNearbyPlayers(args).length, 0, "new player beyond 15m stays hidden");
  assert.equal(selectNearbyPlayers({ ...args, previouslyVisible: new Set([B]) }).length, 1,
    "already visible player remains until 17m");
  remotes[1].pose.x = 8.6; remotes[2].pose.x = 8.7;
  assert.equal(selectNearbyPlayers({ ...args, previouslyVisible: new Set([B]) }).length, 0);
});

test("accompany session parser rejects unrelated, unsupported and malformed server data", () => {
  const raw = { id: ID, inviterId: A, inviteeId: B, peer: { userId: A, nickname: "앨리스" },
    placeZoneId: ZONE, poiId: "poi.main-hall", state: "offered", expiresAt: new Date(Date.now() + 60_000).toISOString() };
  assert.equal(parseAccompanySession(raw, B).peerId, A);
  assert.equal(parseAccompanySession(raw, C), null);
  assert.equal(parseAccompanySession({ ...raw, poiId: "point:1,2" }, B), null);
  assert.equal(parseAccompanySession({ ...raw, peer: { userId: C } }, B), null);
});

function rig() {
  const clock = { t: 0, now() { return this.t; } };
  const session = { id: ID, inviterId: A, inviteeId: B, peerId: A, peerName: "앨리스",
    placeZoneId: ZONE, poiId: "poi.main-hall", state: "offered", expiresAt: 600_000 };
  const db = { current: [session], calls: [], failEnd: false };
  const client = {
    async mine() { return db.current.map(s => ({ ...s })); },
    async respond(id, accept) { db.calls.push(["respond", id, accept]); session.state = accept ? "active" : "declined";
      db.current = accept ? [session] : []; return { state: session.state }; },
    async end(id) { db.calls.push(["end", id]);
      if (db.failEnd) { db.failEnd = false; throw new Error("offline"); }
      db.current = []; return { state: "ended" }; },
    async propose() { db.calls.push(["propose"]); }
  };
  const local = { x: 0, z: 0 }, leader = remote(A, 1);
  const world = { zone: ZONE, mounted: false, remote: leader, destination: null, previous: null };
  const follow = { target: null, starts: 0, isFollowing(id) { return this.target === id; },
    start(id, options) { this.target = id; this.starts++; this.formation = options.formation; return { ok: true }; },
    stop() { this.target = null; } };
  const controller = new AccompanyController({ client, clock, getSelfUserId: () => B,
    getZoneId: () => world.zone, getRemote: () => world.remote, getPosition: () => local,
    getMounted: () => world.mounted, relationshipOf: () => Relationship.FRIENDS,
    verifyFriend: async () => true, follow,
    resolveTarget: () => ({ id: "poi:poi.main-hall", approach: { x: 10, z: 0 }, arrivalRadius: 2 }),
    navigation: { snapshot: () => ({ destination: world.destination }),
      set: target => { world.destination = target; }, clear: () => { world.destination = null; } }
  });
  return { clock, session, db, world, local, leader, follow, controller };
}

test("offer is visible but never moves the invitee; acceptance starts one formation follow", async () => {
  const r = rig();
  await r.controller.refresh();
  assert.equal(r.controller.offered, true);
  assert.equal(r.follow.starts, 0);
  assert.equal(r.world.destination, null);
  await r.controller.respond(true);
  assert.equal(r.controller.active, true);
  assert.equal(r.follow.target, A);
  assert.equal(r.follow.formation, true);
  assert.equal(r.world.destination.id, "poi:poi.main-hall");
  assert.deepEqual(r.db.calls[0], ["respond", ID, true]);
});

test("manual interruption and leaving the campus immediately stop movement and end the session", async () => {
  const r = rig();
  await r.controller.refresh(); await r.controller.respond(true);
  r.follow.stop();
  r.controller.update();
  assert.equal(r.controller.session, null);
  assert.equal(r.world.destination, null);
  assert.ok(r.db.calls.some(call => call[0] === "end"));

  const z = rig(); await z.controller.refresh(); await z.controller.respond(true);
  z.world.zone = null;
  z.controller.update();
  assert.equal(z.follow.target, null);
  assert.equal(z.controller.session, null);
});

test("both players at the destination for two seconds end the journey", async () => {
  const r = rig(); await r.controller.refresh(); await r.controller.respond(true);
  r.local.x = 5; r.leader.pose.x = 5; r.controller.update();
  r.local.x = 10; r.leader.pose.x = 10;
  r.controller.update();
  r.clock.t = 1999; r.controller.update();
  assert.equal(r.controller.active, true);
  r.clock.t = 2001; r.controller.update();
  assert.equal(r.controller.session, null);
});

test("failed end request retries without resuming assisted movement", async () => {
  const r = rig(); await r.controller.refresh(); await r.controller.respond(true);
  r.db.failEnd = true;
  await r.controller.end();
  assert.equal(r.follow.target, null);
  assert.equal(r.controller.session, null);
  assert.equal(r.db.current.length, 1, "server has not yet acknowledged end");
  r.clock.t = 5000; r.controller.update();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(r.db.current.length, 0, "server end is retried");
  assert.equal(r.follow.target, null);
});

test("accepted journey survives a short Place Zone handoff and ends if the leader does not reappear", async () => {
  const r = rig(); await r.controller.refresh(); await r.controller.respond(true);
  r.world.zone = "AREA_NEXT";
  r.clock.t = 1000; r.controller.update();
  assert.equal(r.controller.active, true, "brief channel handoff does not end consent");
  r.world.remote.placeZoneId = "AREA_NEXT";
  r.clock.t = 1500; r.controller.update();
  assert.equal(r.controller.active, true, "both participants rejoin the new zone");
  r.world.remote = null;
  r.clock.t = 2000; r.controller.update();
  r.clock.t = 2000 + ACCOMPANY_ZONE_GRACE_MS; r.controller.update();
  assert.equal(r.controller.active, false, "lost leader eventually ends the journey");
});

test("formation follow crosses the same boundary using the last visible point", () => {
  const clock = { t: 0, now() { return this.t; } };
  const world = { zone: ZONE, remote: remote(A, 3) };
  let assist = null;
  const follow = new FollowController({ clock,
    getTarget: () => world.remote, getLocalPosition: () => ({ x: 0, z: 0 }),
    getLocalPlaceZoneId: () => world.zone, isNetworkOnline: () => true,
    canFollow: () => ({ ok: true }), manualIntent: () => ({}),
    assist: { set: intent => { assist = intent; }, clear: () => { assist = null; } }
  });
  follow.start(A, { formation: true }); follow.update();
  assert.equal(follow.active, true);
  world.zone = "AREA_NEXT"; world.remote = null; clock.t = 1000; follow.update();
  assert.equal(follow.active, true);
  assert.ok(assist?.x > 0, "continue toward last visible location");
  world.remote = remote(A, 3.2, { placeZoneId: "AREA_NEXT" }); clock.t = 1500; follow.update();
  assert.equal(follow.active, true, "reacquired friend in new zone");
  world.remote = null; clock.t = 2000; follow.update();
  clock.t = 2000 + ACCOMPANY_ZONE_GRACE_MS; follow.update();
  assert.equal(follow.active, false);
});
