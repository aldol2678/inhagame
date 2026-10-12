// Production client/session/transport against an injected deterministic server double.
// These are NOT live Supabase RLS or simultaneous PostgreSQL transaction results.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClubRoomSession, parseClubSnapshot } from "../src/rooms/club-room-session.js";
import { clubRoomTopic } from "../src/rooms/club-room-transport.js";
import { CLUB_ROOM_ID, CLUB_ROOM_SEATS, clubRoomSeatAnchors } from "../src/rooms/club-room-seats.js";
import { CLUB_ROOM_OBSTACLES, CLUB_ROOM_BOUNDS, CLUB_ROOM_FURNITURE } from "../src/rooms/club-room-layout.js";
import { roomSeatPointIsClear } from "../src/rooms/personal-room-seats.js";
import { createClubRoomSeatActions } from "../src/rooms/club-room-seat-actions.js";
import { createSeatInteraction } from "../src/seat-interaction.js";
import { createRoomHud } from "../src/rooms/room-hud.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

import { serverFixture } from "./support/club-server-fixture.mjs";

const id = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const flush = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r)); };


function member(server, n) {
  let identity = { userId: id(n), displayName: "인덕이" };
  const p = { x: 0, y: 1.15, z: -1.8 }, avatars = new Map(), lost = [], seatLost = [];
  const controller = { grounded: true, mounted: false, moving: false, keys: new Set() };
  const client = server.client(id(n));
  const player = { getLocalPosition: () => ({ ...p }), getLocalRotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    setLocalPosition: (x, y, z) => Object.assign(p, { x, y, z }), setLocalEulerAngles() {} };
  let nextSession = 1000 + n * 10;
  const session = createClubRoomSession({ player, controller, clock: server.clock,
    getClient: () => client, getIdentity: () => identity,
    randomId: () => id(nextSession++), onAccessLost: e => lost.push(e), onSeatLost: e => seatLost.push(e),
    createAvatar: sample => { const avatar = { sample, update(next) { this.sample = next; }, destroy() { avatars.delete(sample.sessionId); } };
      avatars.set(sample.sessionId, avatar); return avatar; }
  });
  return { session, player, controller, client, avatars, lost, seatLost, setIdentity(next) { identity = next; } };
}
async function frames(server, members, count = 20) {
  for (let i = 0; i < count; i++) { server.advance(50); members.forEach(m => m.session.update(.05)); await flush(); }
}

test("club IDs, recipient inbox and six collision-safe authored chairs are independent of personal UUIDs", () => {
  assert.equal(clubRoomTopic(CLUB_ROOM_ID, id(1)), `world:club:${CLUB_ROOM_ID}:${id(1)}`);
  assert.throws(() => clubRoomTopic(id(2), id(1)));
  assert.throws(() => clubRoomTopic(CLUB_ROOM_ID, "fake"));
  assert.equal(CLUB_ROOM_SEATS.length, 6);
  for (const seat of CLUB_ROOM_SEATS) {
    const chair = CLUB_ROOM_FURNITURE.find(f => f.id === seat.seatId);
    assert.equal(chair.kind, "chair"); assert.equal(seat.position.x, chair.at[0]); assert.equal(seat.position.z, chair.at[2]);
    assert.ok(Math.abs(seat.position.y - 1.3) < 1e-9); assert.equal(seat.yaw, chair.yaw);
    assert.equal(roomSeatPointIsClear(seat.standPoint, CLUB_ROOM_OBSTACLES, CLUB_ROOM_BOUNDS), true);
    assert.ok(clubRoomSeatAnchors({ position: seat.standPoint }).includes(seat));
  }
  assert.equal(clubRoomSeatAnchors({ position: { x: 0, z: .4 } }).length, 0, "cannot reach through table");
});

test("two club members see each other's real session avatars and emotes through server-only inbox transport", async () => {
  const server = serverFixture(), a = member(server, 1), b = member(server, 2);
  a.session.setChatBubbles((_sessionId, userId) => userId === id(2) ? "동아리방에서 만나!" : null);
  assert.equal(await a.session.enter(), true); await flush();
  assert.equal(await b.session.enter(), true); await flush();
  await a.session.revalidateNow(); await frames(server, [a, b]);
  assert.equal(a.session.status().phase, "READY"); assert.equal(b.session.status().phase, "READY");
  assert.equal(a.session.status().count, 2); assert.equal(b.session.status().count, 2);
  assert.equal(a.avatars.size, 1); assert.equal(b.avatars.size, 1);
  assert.equal([...a.avatars.values()][0].sample.bubble, "동아리방에서 만나!", "a getter installed before enter reaches the remote avatar");
  a.session.setChatBubbles(() => null); await frames(server, [a, b], 1);
  assert.equal([...a.avatars.values()][0].sample.bubble, null, "chat expiry/reset removes the bubble");
  assert.equal(a.session.reportEmote("wave"), true); await frames(server, [a, b], 2);
  assert.equal([...b.avatars.values()][0].sample.emote?.id, "wave");
  assert.ok([...server.channels].every(c => c.options.config.private === true && c.topic.startsWith("world:club:")));
  assert.equal(server.calls.some(c => c.name === "check_world_room_access_v1"), false);
  a.session.stop(); b.session.stop(); await flush();
  assert.equal(server.channels.size, 0); assert.equal(a.avatars.size, 0); assert.equal(b.avatars.size, 0);
});

test("an older heartbeat arriving after a seat claim cannot restore obsolete seat state", async () => {
  const server = serverFixture(), a = member(server, 1); await a.session.enter(); await flush();
  await frames(server, [a], 2);
  const original = a.client.rpc; let release, captured;
  a.client.rpc = async (name, args) => {
    const response = await original(name, args);
    if (name === "heartbeat_world_club_room_v1") {
      captured = response; return new Promise(resolve => { release = () => resolve(captured); });
    }
    return response;
  };
  const heartbeat = a.session.revalidateNow(); await flush();
  assert.equal(await a.session.claimSeat("chair_s0"), true);
  release(); await heartbeat;
  assert.equal(a.session.status().seatId, "chair_s0");
  assert.equal(a.seatLost.length, 0);
});

test("unavailable or denied server admission never masquerades as a local shared room", async () => {
  const server = serverFixture(), a = member(server, 1);
  server.state.failing = true;
  assert.equal(await a.session.enter(), false); assert.equal(a.lost.at(-1).reason, "UNAVAILABLE");
  assert.equal(a.session.active, false); assert.equal(server.channels.size, 0);
  server.state.failing = false; server.restricted.add(id(1));
  assert.equal(await a.session.enter(), false); assert.equal(server.channels.size, 0);
});

test("capacity is server-decided and only one contender owns a chair (deterministic server double)", async () => {
  const server = serverFixture(), members = Array.from({ length: 7 }, (_, i) => member(server, i + 1));
  for (const m of members.slice(0, 6)) { assert.equal(await m.session.enter(), true); await flush(); }
  assert.equal(await members[6].session.enter(), false); assert.equal(members[6].lost.at(-1).reason, "ROOM_FULL");
  await frames(server, members.slice(0, 6), 2);
  const claims = await Promise.all(members.slice(0, 2).map(m => m.session.claimSeat("chair_s0")));
  assert.deepEqual(claims, [true, false]);
  assert.equal(server.sessions.size, 6);
  await members[1].session.revalidateNow();
  assert.deepEqual(members[1].session.remoteSeatedPositions().map(s => s.sessionId), [members[0].session.status().sessionId]);
  assert.equal(await members[0].session.releaseSeat("chair_n0"), true);
  assert.equal(members[0].session.status().seatId, "chair_s0", "stale wrong-seat release cannot release current chair");
  assert.equal(await members[0].session.releaseSeat("chair_s0"), true);
  assert.equal(await members[1].session.claimSeat("chair_s0"), true);
});

test("access loss, identity change, lease expiry and same-account replacement tear down channels", async () => {
  for (const cause of ["restriction", "identity", "expiry", "replacement"]) {
    const server = serverFixture(), a = member(server, 1);
    await a.session.enter(); await flush(); await frames(server, [a], 2);
    if (cause === "restriction") { server.restricted.add(id(1)); await a.session.revalidateNow(); }
    if (cause === "identity") { a.setIdentity({ userId: id(99) }); a.session.update(.05); }
    if (cause === "expiry") { server.state.failing = true; server.advance(20_001); a.session.update(.05); }
    if (cause === "replacement") {
      await server.client(id(1)).rpc("join_world_club_room_v1", { p_room: CLUB_ROOM_ID, p_session: id(9999) });
      await a.session.revalidateNow();
    }
    assert.equal(a.session.active, false, cause); assert.equal(server.channels.size, 0, cause);
    assert.equal(a.lost.length, 1, cause);
  }
});

test("snapshot parser refuses mismatched identity, duplicate participants, capacity and seat spoofing", async () => {
  const server = serverFixture(), a = member(server, 1); await a.session.enter(); await flush();
  const ctx = { roomId: CLUB_ROOM_ID, sessionId: a.session.status().sessionId, userId: id(1) };
  const good = server.snapshot(ctx.userId, ctx.sessionId);
  assert.equal(parseClubSnapshot(good, ctx).allowed, true);
  for (const bad of [null, { ...good, userId: id(2) }, { ...good, capacity: 99 },
    { ...good, participants: [...good.participants, ...good.participants] },
    { ...good, seats: [{ seatId: "sofa", sessionId: ctx.sessionId, userId: ctx.userId }] },
    { ...good, seats: [{ seatId: "chair_s0", sessionId: id(3), userId: id(3) }] }]) {
    assert.equal(parseClubSnapshot(bad, ctx).allowed, false);
  }
});

test("a transient channel disconnect rechecks the same live lease before reopening one inbox", async () => {
  const server = serverFixture(), a = member(server, 1);
  await a.session.enter(); await flush(); await frames(server, [a], 2);
  const sessionId = a.session.status().sessionId;
  const old = [...server.channels][0], checks = server.calls.filter(c => c.name === "heartbeat_world_club_room_v1").length;
  old.status("CHANNEL_ERROR"); await frames(server, [a], 60);
  assert.equal(a.session.status().phase, "READY"); assert.equal(a.session.status().sessionId, sessionId);
  assert.equal(server.channels.size, 1); assert.equal(server.channels.has(old), false);
  assert.ok(server.calls.filter(c => c.name === "heartbeat_world_club_room_v1").length > checks);
  assert.equal(a.lost.length, 0);
});

test("all six server-approved chairs seat through the existing controller and release on movement", async () => {
  const server = serverFixture(), a = member(server, 1);
  await a.session.enter(); await flush(); await frames(server, [a], 2);
  const seating = createSeatInteraction({ player: a.player, controller: a.controller,
    getOnline: () => a.session, getSpaceId: () => CLUB_ROOM_ID, getPlaceZoneId: () => CLUB_ROOM_ID,
    getAnchors: () => clubRoomSeatAnchors({ position: a.player.getLocalPosition() }) });
  const actions = createClubRoomSeatActions({ session: a.session, seating, player: a.player, controller: a.controller,
    getRoomId: () => CLUB_ROOM_ID });
  for (const anchor of CLUB_ROOM_SEATS) {
    a.controller.keys.clear(); a.player.setLocalPosition(anchor.standPoint.x, anchor.standPoint.y, anchor.standPoint.z);
    assert.equal(await actions.toggle(), true, anchor.seatId);
    assert.equal(seating.seats.seated.seatId, anchor.seatId); assert.deepEqual(a.player.getLocalPosition(), anchor.position);
    assert.equal(seating.beforeController(), true, "still seated with current room-local anchors");
    a.controller.keys.add("KeyW"); assert.equal(seating.beforeController(), false); await flush();
    assert.equal(a.session.status().seatId, null);
    assert.deepEqual(a.player.getLocalPosition(), anchor.standPoint);
  }
  actions.destroy(); a.session.stop();
});

test("late club seat approval cannot move the player after exit, movement, overlay or emote", async () => {
  for (const cause of ["exit", "move", "overlay", "emote"]) {
    const anchor = CLUB_ROOM_SEATS[0]; let roomId = CLUB_ROOM_ID, available = true, resolve;
    const p = { ...anchor.standPoint }, releases = [];
    const controller = { grounded: true, mounted: false, keys: new Set() };
    const player = { getLocalPosition: () => ({ ...p }), setLocalPosition: (x, y, z) => Object.assign(p, { x, y, z }), setLocalEulerAngles() {} };
    const session = { status: () => ({ sessionId: id(10), online: true }), claimSeat: () => new Promise(r => { resolve = r; }),
      releaseSeat: async (...args) => { releases.push(args); } };
    const seating = createSeatInteraction({ player, controller, getAnchors: () => CLUB_ROOM_SEATS,
      getSpaceId: () => roomId, getPlaceZoneId: () => roomId });
    const actions = createClubRoomSeatActions({ session, seating, player, controller, getRoomId: () => roomId, canInteract: () => available });
    const result = actions.toggle();
    assert.equal(actions.pending, true); assert.equal(await actions.toggle(), false, "double tap ignored");
    if (cause === "exit") roomId = "campus";
    if (cause === "move") p.x += .5;
    if (cause === "overlay") available = false;
    if (cause === "emote") actions.cancel();
    const before = { ...p }; resolve(true);
    assert.equal(await result, false); assert.deepEqual(p, before); assert.equal(seating.seats.isSeated, false);
    assert.equal(releases.length, 1); assert.deepEqual(releases[0], [anchor.seatId, id(10)]);
    actions.destroy();
  }
});

test("club HUD shows shared occupancy without private-room ownership actions", () => {
  const doc = createFakeDocument(), root = doc.createElement("div");
  const hud = createRoomHud({ root, doc, onEdit() {}, onStory() {} });
  hud.update({ active: true, kind: "club", role: "member", phase: "READY", count: 2, capacity: 6 });
  const content = node => `${node.textContent ?? ""} ${(node.children ?? []).map(content).join(" ")}`;
  assert.match(content(root), /공용 동아리방/); assert.match(content(root), /2\/6명/);
  assert.doesNotMatch(content(root), /주인 부재|방문 중|꾸미기|친구 공개|방의 한 장면/);
});

test("main wires club session, identity cleanup, seat claims and emotes separately from personal room", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(main, /clubRoomSession = createClubRoomSession/);
  assert.match(main, /parent: clubRoom.root/);
  assert.match(main, /clubRoomSeatActions\?\.toggle\(\)/);
  assert.match(main, /clubRoomSession\?\.update\(dt\)/);
  assert.match(main, /clubRoomSession\.reportEmote\(id\)/);
  assert.match(main, /identity\?\.userId !== clubRoomSession\.status\(\)\.userId/);
  assert.match(main, /\(!identity \|\| clubIdentityChanged\) && rooms\?\.currentSpace === CLUB_ROOM_ID/);
});
