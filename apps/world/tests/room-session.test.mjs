// Housing S1-D2 · Personal Room Session, friend visits, owner privacy (client side).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FakeNetworkHub, FakeScheduler } from "../src/network/fake-transport.js";
import { SupabaseRealtimeTransport } from "../src/network/supabase-realtime-transport.js";
import {
  createPersonalRoomSession, parseRoomAccess, personalRoomTopic, personalRoomZoneId, ROOM_ACCESS_CHECK_MS
} from "../src/rooms/room-session.js";
import {
  FriendRoomVisitClient, FriendRoomVisitError, FRIEND_ROOM_VISIT_TEXT, createFriendRoomVisitController, friendVisitText,
  parseFriendRoom
} from "../src/rooms/friend-room-visit.js";
import { PersonalRoomClient, PersonalRoomError } from "../src/rooms/personal-room-client.js";
import { createRoomTransition, ROOM_TRANSITION_COOLDOWN_MS } from "../src/rooms/room-transition.js";
import { DORM_1_LOBBY_FRIEND_ROOM, DORM_1_LOBBY_MY_ROOM_RETURN } from "../src/rooms/dorm1-lobby-layout.js";
import { RoomKnockClient, waitForKnockAnswer } from "../src/rooms/room-knock.js";
import { DORM_1_CAMPUS_RETURN } from "../src/dorm1-layout.js";
import { PERSONAL_ROOM_BASIC_EXIT } from "../src/rooms/personal-room-layout.js";
import { createRoomHud } from "../src/rooms/room-hud.js";
import { createPlayerCard } from "../src/social/player-card.js";
import { createFriendPanel } from "../src/social/friend-panel.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const OWNER = "a1000000-0000-4000-8000-0000000000a1";
const FRIEND = "b2000000-0000-4000-8000-0000000000b2";
const STRANGER = "c3000000-0000-4000-8000-0000000000c3";
const ROOM = "11111111-1111-4111-8111-111111111111";
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const code = (path) => readFileSync(new URL(path, import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");

// ---- fakes ----------------------------------------------------------------------------------
function fakePlayer(x = 0, z = -2) {
  const p = { x, y: 1.15, z };
  return {
    p, getLocalPosition: () => ({ ...p }), getLocalRotation: () => ({ x: 0, y: 0, z: 0, w: 1 })
  };
}
const fakeController = () => ({ grounded: true, mounted: false, moving: false, velocityY: 0 });

// The server's access decision, flippable per viewer.
function fakeRoomServer() {
  const rooms = new Map([[ROOM, { ownerUserId: OWNER, visibility: "friends" }]]);
  const friends = new Set([FRIEND]);
  const blocked = new Set();
  const state = { failing: false, calls: 0, ownerHome: false };
  // Housing H3 knocks: id → { visitor, status }. Admission = ACCEPTED / OPEN; DECLINED blocks.
  const knocks = new Map();
  let knockSeq = 0;
  const admitted = (viewer) => [...knocks.values()].some(k => k.visitor === viewer && ["ACCEPTED", "OPEN"].includes(k.status));
  const declined = (viewer) => [...knocks.values()].some(k => k.visitor === viewer && k.status === "DECLINED");
  const knockJson = (id) => ({ knockId: id, roomId: ROOM, visitorUserId: knocks.get(id).visitor, status: knocks.get(id).status,
    expiresAt: "2099-01-01T00:00:00Z", ownerPresent: state.ownerHome });
  const decide = (viewer, roomId) => {
    const room = rooms.get(roomId);
    if (!room) return { roomId, allowed: false, role: null, reason: "DENIED" };
    if (viewer === room.ownerUserId) return { roomId, allowed: true, role: "owner", reason: null, ownerUserId: room.ownerUserId, visibility: room.visibility };
    if (!friends.has(viewer) || blocked.has(viewer)) return { roomId, allowed: false, role: null, reason: "DENIED" };
    if (room.visibility !== "friends") return { roomId, allowed: false, role: null, reason: "ROOM_PRIVATE" };
    return { roomId, allowed: true, role: "visitor", reason: null, ownerUserId: room.ownerUserId, visibility: room.visibility };
  };
  const clientFor = (viewer) => ({
    rpc: async (name, args) => {
      state.calls += 1;
      if (state.failing) return { data: null, error: { message: "fetch failed" } };
      if (name === "check_world_room_access_v1") return { data: decide(viewer, args.p_room), error: null };
      if (name === "resolve_friend_personal_room_v1") {
        const [roomId, room] = [...rooms].find(([, r]) => r.ownerUserId === args.p_owner) ?? [];
        if (!friends.has(viewer) || blocked.has(viewer)) return { data: null, error: { message: "NOT_FRIENDS" } };
        if (!room) return { data: null, error: { message: "ROOM_NOT_FOUND" } };
        if (room.visibility !== "friends") return { data: null, error: { message: "ROOM_PRIVATE" } };
        if (declined(viewer)) return { data: null, error: { message: "VISIT_DECLINED" } };
        if (state.ownerHome && !admitted(viewer)) return { data: null, error: { message: "KNOCK_REQUIRED" } };
        return { data: { roomId, ownerUserId: room.ownerUserId, ownerDisplayName: "방주인", roomType: "DORM_1_BASIC", visibility: "friends", role: "visitor" }, error: null };
      }
      if (name === "knock_friend_personal_room_v1") {
        if (!friends.has(viewer)) return { data: null, error: { message: "NOT_FRIENDS" } };
        if (declined(viewer)) return { data: null, error: { message: "VISIT_DECLINED" } };
        const existing = [...knocks].find(([, k]) => k.visitor === viewer && ["PENDING", "ACCEPTED", "OPEN"].includes(k.status));
        if (existing) return { data: knockJson(existing[0]), error: null };
        const id = `00000000-0000-4000-8000-${String(++knockSeq).padStart(12, "0")}`;
        knocks.set(id, { visitor: viewer, status: state.ownerHome ? "PENDING" : "OPEN" });
        return { data: knockJson(id), error: null };
      }
      if (name === "get_my_room_knock_v1") {
        if (knocks.get(args.p_knock)?.visitor !== viewer) return { data: null, error: { message: "KNOCK_NOT_FOUND" } };
        return { data: knockJson(args.p_knock), error: null };
      }
      return { data: null, error: { message: "UNKNOWN_RPC" } };
    }
  });
  const answer = (accept) => {
    for (const k of knocks.values()) if (k.status === "PENDING") k.status = accept === "expire" ? "EXPIRED" : accept ? "ACCEPTED" : "DECLINED";
  };
  return { rooms, friends, blocked, state, knocks, answer, clientFor };
}

function sessionFixture({ server, viewer, scheduler, hub, label = viewer, displayName = "플레이어" }) {
  let identity = { userId: viewer, displayName };
  const lost = [];
  const changes = [];
  const transports = [];
  const avatars = new Map();
  const session = createPersonalRoomSession({
    player: fakePlayer(), controller: fakeController(),
    createAvatar: (sample) => { const a = { sample, destroyed: false, update() {}, destroy() { this.destroyed = true; } }; avatars.set(sample.sessionId, a); return a; },
    getClient: () => (identity ? server.clientFor(identity.userId) : null),
    getIdentity: () => identity,
    clock: scheduler,
    randomId: (() => { let n = 0; return () => `${label}-session-${++n}`; })(),
    createTransport: (_client, roomId) => { const t = hub.createTransport(`${label}:${transports.length}`); t.roomId = roomId; transports.push(t); return t; },
    onAccessLost: (event) => lost.push(event),
    onChange: (state) => changes.push(state)
  });
  const tick = (ms = 50, steps = 1) => {
    for (let i = 0; i < steps; i++) { scheduler.advance(ms); session.update(ms / 1000); }
  };
  return {
    session, lost, changes, transports, avatars, tick,
    setIdentity: (next) => { identity = next; }
  };
}

function world() {
  const scheduler = new FakeScheduler(1_000);
  const hub = new FakeNetworkHub({ scheduler, latencyMs: 20 });
  return { scheduler, hub, server: fakeRoomServer() };
}

// ---- topic / parse ----------------------------------------------------------------------------
test("room topic is a private world:room:<uuid> channel, never a campus AREA_* topic", () => {
  assert.equal(personalRoomTopic(ROOM.toUpperCase()), `world:room:${ROOM}`);
  assert.equal(personalRoomZoneId(ROOM), "ROOM_11111111111141118111111111111111");
  assert.doesNotMatch(personalRoomZoneId(ROOM), /^AREA_/);
  assert.throws(() => personalRoomTopic("ROOM_DORM1_LOBBY"), TypeError);
  assert.throws(() => personalRoomTopic(`${ROOM}:x`), TypeError);
});

test("the hardened campus transport carries a room topic only when asked (campus default unchanged)", () => {
  const opened = [];
  const client = {
    auth: { getSession: async () => ({ data: { session: null } }) },
    channel: (topic, options) => {
      opened.push({ topic, options });
      const ch = { on: () => ch, subscribe: () => ch, presenceState: () => ({}) };
      return ch;
    },
    removeChannel: () => {}
  };
  const campus = new SupabaseRealtimeTransport(client, { windowTarget: null });
  campus.joinPlaceZone("AREA_DORM_SOUTH", { sessionId: "s1" });
  const room = new SupabaseRealtimeTransport(client, { windowTarget: null, topicFor: () => personalRoomTopic(ROOM) });
  room.joinPlaceZone(personalRoomZoneId(ROOM), { sessionId: "s2" });
  assert.deepEqual(opened.map((o) => o.topic), ["world:campus:AREA_DORM_SOUTH", `world:room:${ROOM}`]);
  assert.equal(opened[1].options.config.private, true, "room channels are private (Realtime RLS decides)");
  room.destroy();
  assert.equal(room.liveChannelCount, 0);
});

test("access payload parse is narrow: anything unexpected is a denial", () => {
  assert.deepEqual(parseRoomAccess(null, ROOM), { allowed: false, reason: "DENIED" });
  assert.deepEqual(parseRoomAccess({ roomId: "other", allowed: true }, ROOM), { allowed: false, reason: "DENIED" });
  assert.deepEqual(parseRoomAccess({ roomId: ROOM, allowed: true, role: "admin", ownerUserId: OWNER }, ROOM), { allowed: false, reason: "DENIED" });
  assert.deepEqual(parseRoomAccess({ roomId: ROOM, allowed: false, reason: "ROOM_PRIVATE" }, ROOM), { allowed: false, reason: "ROOM_PRIVATE" });
  assert.equal(parseRoomAccess({ roomId: ROOM, allowed: true, role: "visitor", ownerUserId: OWNER, visibility: "friends" }, ROOM).allowed, true);
});

// ---- session lifecycle -------------------------------------------------------------------------
test("owner and friend share one room channel: presence, count, owner-present, no campus topic", async () => {
  const { scheduler, hub, server } = world();
  const owner = sessionFixture({ server, viewer: OWNER, scheduler, hub, displayName: "방주인" });
  const friend = sessionFixture({ server, viewer: FRIEND, scheduler, hub, displayName: "친구" });
  assert.equal(await owner.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "owner" }), true);
  assert.equal(await friend.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "visitor", ownerDisplayName: "방주인" }), true);
  for (let i = 0; i < 20; i++) { owner.tick(50); friend.tick(0); }
  const o = owner.session.status();
  const f = friend.session.status();
  assert.equal(o.phase, "READY");
  assert.equal(o.count, 2);
  assert.equal(f.count, 2);
  assert.equal(f.role, "visitor");
  assert.equal(f.ownerPresent, true);
  assert.deepEqual([...hub.channels.keys()], [personalRoomZoneId(ROOM)], "only the room zone exists on the hub");
  assert.ok(owner.avatars.size === 1 && friend.avatars.size === 1, "each sees one remote avatar");
  assert.deepEqual(f.participants.map((p) => p.role).sort(), ["owner", "visitor"]);
});

test("owner offline: a friend may stay; the HUD state says the owner is away", async () => {
  const { scheduler, hub, server } = world();
  const friend = sessionFixture({ server, viewer: FRIEND, scheduler, hub });
  assert.equal(await friend.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "visitor" }), true);
  friend.tick(50, 10);
  assert.equal(friend.session.status().ownerPresent, false);
  assert.equal(friend.session.status().count, 1);
});

test("a UUID alone is not access: stranger, unknown room and role spoofing are refused before any channel", async () => {
  const { scheduler, hub, server } = world();
  const stranger = sessionFixture({ server, viewer: STRANGER, scheduler, hub });
  assert.equal(await stranger.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "visitor" }), false);
  assert.equal(stranger.lost.at(-1).reason, "DENIED");
  assert.equal(stranger.transports.length, 0, "no transport is created without server access");
  const friend = sessionFixture({ server, viewer: FRIEND, scheduler, hub });
  assert.equal(await friend.session.enter({ roomId: ROOM, ownerUserId: FRIEND, role: "owner" }), false, "cannot claim to own someone else's room");
  assert.equal(await friend.session.enter({ roomId: "22222222-2222-4222-8222-222222222222", ownerUserId: OWNER, role: "visitor" }), false);
  assert.equal(friend.transports.length, 0);
  assert.equal(hub.channels.size, 0);
});

test("PRIVATE switch, unfriend and block evict the visitor at the next 15 s check; the owner stays", async () => {
  for (const change of ["private", "unfriend", "block"]) {
    const { scheduler, hub, server } = world();
    const owner = sessionFixture({ server, viewer: OWNER, scheduler, hub });
    const friend = sessionFixture({ server, viewer: FRIEND, scheduler, hub });
    await owner.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "owner" });
    await friend.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "visitor" });
    owner.tick(50, 5); friend.tick(0);
    if (change === "private") server.rooms.get(ROOM).visibility = "private";
    if (change === "unfriend") server.friends.delete(FRIEND);
    if (change === "block") server.blocked.add(FRIEND);
    friend.tick(1_000, 13);
    await flush();
    assert.equal(friend.session.active, true, `${change}: not before the check interval`);
    friend.tick(1_000, 3);
    owner.tick(0);
    await flush();
    assert.equal(friend.session.active, false, `${change}: visitor evicted`);
    assert.equal(friend.lost.at(-1).reason, change === "private" ? "ROOM_PRIVATE" : "DENIED");
    assert.equal(friend.transports[0].zones.size, 0, `${change}: visitor left the room channel`);
    owner.tick(1_000, 16); await flush();
    assert.equal(owner.session.active, true, `${change}: owner keeps the room`);
  }
});

test("revalidateNow evicts at once (relationship change) and network failure never evicts", async () => {
  const { scheduler, hub, server } = world();
  const friend = sessionFixture({ server, viewer: FRIEND, scheduler, hub });
  await friend.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "visitor" });
  friend.tick(50, 3);
  server.state.failing = true;
  friend.tick(ROOM_ACCESS_CHECK_MS, 1); await flush();
  friend.tick(ROOM_ACCESS_CHECK_MS, 1); await flush();
  assert.equal(friend.session.active, true, "check errors degrade, never evict");
  assert.ok(friend.session.stats.checkErrors >= 1);
  server.state.failing = false;
  server.friends.delete(FRIEND);
  await friend.session.revalidateNow();
  assert.equal(friend.session.active, false);
});

test("reconnect re-asks the server immediately", async () => {
  const { scheduler, hub, server } = world();
  const friend = sessionFixture({ server, viewer: FRIEND, scheduler, hub });
  await friend.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "visitor" });
  friend.tick(50, 10);
  assert.equal(friend.session.status().phase, "READY");
  const before = friend.session.stats.checks;
  hub.dropClient(friend.transports[0].label);
  friend.tick(100, 5);
  assert.equal(friend.session.status().phase, "DEGRADED");
  hub.restoreClient(friend.transports[0].label);
  server.rooms.get(ROOM).visibility = "private";
  friend.tick(500, 20);
  await flush();
  assert.ok(friend.session.stats.checks > before, "a check ran on reconnect, before the 15 s tick");
  assert.equal(friend.session.active, false, "access changed while away → evicted on reconnect");
});

test("logout / account switch ends the session and reports IDENTITY; stop releases every channel", async () => {
  const { scheduler, hub, server } = world();
  const owner = sessionFixture({ server, viewer: OWNER, scheduler, hub });
  await owner.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "owner" });
  owner.tick(50, 5);
  owner.setIdentity({ userId: FRIEND, displayName: "다른 계정" });
  owner.tick(50);
  assert.equal(owner.session.active, false);
  assert.equal(owner.lost.at(-1).reason, "IDENTITY");
  assert.equal(hub.channels.get(personalRoomZoneId(ROOM))?.size ?? 0, 0);
  owner.setIdentity(null);
  assert.equal(await owner.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "owner" }), false, "signed out: no session");
});

test("repeated enter/stop cycles leave no channel, avatar or handler behind", async () => {
  const { scheduler, hub, server } = world();
  const owner = sessionFixture({ server, viewer: OWNER, scheduler, hub });
  const friend = sessionFixture({ server, viewer: FRIEND, scheduler, hub });
  await owner.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "owner" });
  for (let i = 0; i < 12; i++) {
    assert.equal(await friend.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "visitor" }), true);
    for (let k = 0; k < 6; k++) { owner.tick(50); friend.tick(0); }
    friend.session.stop();
    for (let k = 0; k < 4; k++) owner.tick(50);
  }
  assert.equal(hub.channels.get(personalRoomZoneId(ROOM)).size, 1, "only the owner remains");
  assert.ok(friend.transports.every((t) => t.zones.size === 0 && Object.values(t.handlers).every((h) => h.size === 0)),
    "every visitor transport is unsubscribed and out of the zone");
  assert.ok([...friend.avatars.values()].every((a) => a.destroyed), "every visitor-side avatar destroyed");
  assert.equal(owner.session.status().count, 1);
  assert.equal(friend.session.stats.liveChannels, 0);
});

test("owner fail-soft: no access answer keeps the D1 local room and connects once the server answers", async () => {
  const { scheduler, hub, server } = world();
  server.state.failing = true;
  const owner = sessionFixture({ server, viewer: OWNER, scheduler, hub });
  assert.equal(await owner.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "owner" }), true);
  assert.equal(owner.session.status().phase, "LOCAL");
  assert.equal(owner.lost.length, 0, "the owner is never bounced out of their own room");
  assert.equal(owner.transports.length, 0, "no channel without a server answer");
  owner.tick(1_000, 16); await flush();
  assert.equal(owner.session.status().phase, "LOCAL", "still local while the server is unavailable");
  server.state.failing = false;
  owner.tick(1_000, 16); await flush();
  owner.tick(50, 5);
  assert.equal(owner.session.status().phase, "READY");
  assert.equal(owner.transports.length, 1);
  // A visitor gets no such grace: no positive answer, no visit.
  server.state.failing = true;
  const friend = sessionFixture({ server, viewer: FRIEND, scheduler, hub });
  assert.equal(await friend.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "visitor" }), false);
  assert.equal(friend.lost.at(-1).reason, "UNAVAILABLE");
  assert.equal(friend.transports.length, 0);
});

test("stale enter: a newer enter or stop during the access check wins", async () => {
  const { scheduler, hub, server } = world();
  const friend = sessionFixture({ server, viewer: FRIEND, scheduler, hub });
  const first = friend.session.enter({ roomId: ROOM, ownerUserId: OWNER, role: "visitor" });
  friend.session.stop();
  assert.equal(await first, false);
  assert.equal(friend.transports.length, 0);
});

// ---- owner privacy client -------------------------------------------------------------------
test("owner privacy RPC: PRIVATE / FRIENDS only, owner-bound, stale-account safe", async () => {
  const calls = [];
  let self = OWNER;
  const client = { rpc: async (name, args) => {
    calls.push([name, args]);
    return { data: { roomId: ROOM, ownerUserId: self, roomType: "DORM_1_BASIC", visibility: args.p_visibility }, error: null };
  } };
  const rooms = new PersonalRoomClient({ getClient: () => client, getSelfUserId: () => self });
  assert.equal((await rooms.setVisibility("private")).visibility, "private");
  assert.deepEqual(calls.at(-1), ["set_my_personal_room_visibility_v1", { p_visibility: "private" }]);
  await assert.rejects(rooms.setVisibility("public"), (e) => e instanceof PersonalRoomError && e.code === "INVALID_VISIBILITY");
  const pending = rooms.setVisibility("friends");
  rooms.reset();
  await assert.rejects(pending, (e) => e.code === "SIGNED_OUT");
  self = null;
  await assert.rejects(rooms.setVisibility("friends"), (e) => e.code === "SIGNED_OUT");
});

// ---- friend visit ----------------------------------------------------------------------------
test("friend resolver maps server errors and rejects mismatched payloads", async () => {
  const server = fakeRoomServer();
  const friend = new FriendRoomVisitClient({ getClient: () => server.clientFor(FRIEND), getSelfUserId: () => FRIEND });
  assert.equal((await friend.resolve(OWNER)).roomId, ROOM);
  server.rooms.get(ROOM).visibility = "private";
  await assert.rejects(friend.resolve(OWNER), (e) => e instanceof FriendRoomVisitError && e.code === "ROOM_PRIVATE");
  const stranger = new FriendRoomVisitClient({ getClient: () => server.clientFor(STRANGER), getSelfUserId: () => STRANGER });
  await assert.rejects(stranger.resolve(OWNER), (e) => e.code === "NOT_FRIENDS");
  await assert.rejects(friend.resolve(FRIEND), (e) => e.code === "TARGET_UNAVAILABLE");
  await assert.rejects(friend.resolve("not-a-uuid"), (e) => e.code === "TARGET_UNAVAILABLE");
  assert.equal(parseFriendRoom({ roomId: ROOM, ownerUserId: OWNER, roomType: "DORM_1_BASIC", visibility: "public" }), null);
  assert.equal(parseFriendRoom({ roomId: ROOM, ownerUserId: OWNER, roomType: "DORM_1_BASIC", visibility: "friends", ownerDisplayName: " " }).ownerDisplayName, "친구");
  for (const code of ["ROOM_NOT_FOUND", "ROOM_PRIVATE", "NOT_FRIENDS", "TARGET_UNAVAILABLE", "FAILED", "signed_out", "inside_room", "mounted"])
    assert.ok(FRIEND_ROOM_VISIT_TEXT[code], `copy for ${code}`);
});

function transitionFixture() {
  const clock = { t: 0, now() { return this.t; } };
  const calls = [];
  const world = {
    getPlaceZoneId: () => "AREA_DORM_SOUTH",
    leaveCampus: (room) => calls.push(["leaveCampus", room.id]),
    showRoom: (room) => calls.push(["showRoom", room.id]),
    showCampus: (room) => calls.push(["showCampus", room.id]),
    resumeCampus: () => calls.push(["resumeCampus"]),
    placePlayer: (position, yaw) => calls.push(["placePlayer", { ...position }, yaw])
  };
  const rooms = createRoomTransition({ world, clock });
  return { clock, calls, rooms, wait: () => { clock.t += ROOM_TRANSITION_COOLDOWN_MS + 1; } };
}

function visitFixture({ server, rooms, mounted = () => false, answerWith = null } = {}) {
  const statuses = [];
  const guides = [];
  const clock = { t: 0 };
  const visit = createFriendRoomVisitController({
    client: new FriendRoomVisitClient({ getClient: () => server.clientFor(FRIEND), getSelfUserId: () => FRIEND }),
    knockClient: new RoomKnockClient({ getClient: () => server.clientFor(FRIEND), getSelfUserId: () => FRIEND }),
    rooms, isMounted: mounted, onStatus: (text) => statuses.push(text),
    guideToDorm: () => { guides.push("dorm"); return true; },
    now: () => clock.t,
    // The owner answers (or not) while the visitor waits; time only moves through the fake clock.
    waitForAnswer: (options) => waitForKnockAnswer({
      ...options, now: () => clock.t,
      sleep: async (ms) => { clock.t += ms; if (answerWith !== null) server.answer(answerWith); }
    })
  });
  return { visit, statuses, guides, clock };
}
const knockAt = (visit, position = DORM_1_LOBBY_FRIEND_ROOM.position) => visit.contextAction({ position, grounded: true, mounted: false });

test("H3: a campus visit guides to 제1생활관 instead of teleporting; the corridor knock enters through the lobby", async () => {
  const server = fakeRoomServer();
  const { calls, rooms, wait } = transitionFixture();
  const { visit, statuses, guides } = visitFixture({ server, rooms });
  const result = await visit.visit(OWNER);
  assert.deepEqual(result, { ok: true, mode: "guiding" });
  assert.equal(rooms.currentSpace, "campus", "nothing moves the player into the room");
  assert.deepEqual(guides, ["dorm"]);
  assert.equal(statuses.at(-1), friendVisitText.guiding("방주인"));
  assert.equal(visit.intent.ownerDisplayName, "방주인");
  assert.equal(knockAt(visit), null, "no knock action outside the Dorm Lobby");

  assert.ok(rooms.enter("ROOM_DORM1_LOBBY"));
  wait();
  assert.equal(knockAt(visit, { x: 0, z: 0 }), null, "knock only at the corridor door");
  const action = knockAt(visit);
  assert.equal(action.label, "방주인님 방 노크");
  assert.equal(action.trigger(), true);
  await flush(8);
  assert.equal(rooms.currentSpace, "ROOM_PERSONAL_BASIC");
  assert.equal(rooms.status().parentRoomId, "ROOM_DORM1_LOBBY");
  assert.deepEqual(rooms.status().metadata, { personalRoomId: ROOM, ownerUserId: OWNER, ownerDisplayName: "방주인", visitRole: "visitor" });
  assert.equal(statuses.at(-1), friendVisitText.ownerAway("방주인"), "owner away: admitted by visibility");
  assert.equal(visit.intent, null, "entering consumes the visit");
  assert.equal(rooms.stats.directNestedEnters, 0, "the campus → room jump is gone");

  wait();
  assert.equal(rooms.contextAction({ position: PERSONAL_ROOM_BASIC_EXIT.position }).trigger(), true);
  assert.equal(rooms.currentSpace, "ROOM_DORM1_LOBBY");
  assert.deepEqual(calls.at(-1), ["placePlayer", { ...DORM_1_LOBBY_MY_ROOM_RETURN.position }, DORM_1_LOBBY_MY_ROOM_RETURN.yaw]);
  wait();
  assert.equal(rooms.exit(), true);
  assert.deepEqual(calls.at(-2), ["placePlayer", { ...DORM_1_CAMPUS_RETURN.position }, DORM_1_CAMPUS_RETURN.yaw]);
});

test("H3: owner home → the knock waits; accepted enters, declined ends the visit, silence keeps the door", async () => {
  // Accepted.
  {
    const server = fakeRoomServer();
    server.state.ownerHome = true;
    const { rooms, wait } = transitionFixture();
    assert.ok(rooms.enter("ROOM_DORM1_LOBBY")); wait();
    const { visit, statuses } = visitFixture({ server, rooms, answerWith: true });
    assert.deepEqual(await visit.visit(OWNER), { ok: true, mode: "lobby" }, "KNOCK_REQUIRED still allows walking to the door");
    assert.equal(statuses.at(-1), friendVisitText.lobby("친구"), "name falls back when the resolver withholds it");
    const entered = await visit.knock();
    assert.equal(entered.ok, true);
    assert.ok(statuses.includes(friendVisitText.waiting("친구")));
    assert.equal(rooms.currentSpace, "ROOM_PERSONAL_BASIC");
  }
  // Declined.
  {
    const server = fakeRoomServer();
    server.state.ownerHome = true;
    const { rooms, wait } = transitionFixture();
    assert.ok(rooms.enter("ROOM_DORM1_LOBBY")); wait();
    const { visit, statuses } = visitFixture({ server, rooms, answerWith: false });
    await visit.visit(OWNER, { displayName: "방주인" });
    assert.deepEqual(await visit.knock(), { ok: false, reason: "VISIT_DECLINED" });
    assert.equal(statuses.at(-1), FRIEND_ROOM_VISIT_TEXT.VISIT_DECLINED);
    assert.equal(rooms.currentSpace, "ROOM_DORM1_LOBBY");
    assert.equal(visit.intent, null);
    assert.equal(knockAt(visit), null, "a declined visit leaves no knock action");
    assert.deepEqual(await visit.visit(OWNER), { ok: false, reason: "VISIT_DECLINED" }, "the cooldown is the server's");
  }
  // No answer.
  {
    const server = fakeRoomServer();
    server.state.ownerHome = true;
    const { rooms, wait } = transitionFixture();
    assert.ok(rooms.enter("ROOM_DORM1_LOBBY")); wait();
    const { visit, statuses } = visitFixture({ server, rooms });
    await visit.visit(OWNER, { displayName: "방주인" });
    assert.deepEqual(await visit.knock(), { ok: false, reason: "KNOCK_EXPIRED" });
    assert.equal(statuses.at(-1), FRIEND_ROOM_VISIT_TEXT.KNOCK_EXPIRED);
    assert.ok(knockAt(visit), "the visitor can knock again");
  }
});

test("H3: leaving the lobby while waiting cancels quietly; intents lapse and refuse other interiors, mounts and hopping", async () => {
  const server = fakeRoomServer();
  server.state.ownerHome = true;
  const { rooms, wait } = transitionFixture();
  assert.ok(rooms.enter("ROOM_DORM1_LOBBY")); wait();
  let leaveWhileWaiting = true;
  const statuses = [];
  const visit = createFriendRoomVisitController({
    client: new FriendRoomVisitClient({ getClient: () => server.clientFor(FRIEND), getSelfUserId: () => FRIEND }),
    knockClient: new RoomKnockClient({ getClient: () => server.clientFor(FRIEND), getSelfUserId: () => FRIEND }),
    rooms, onStatus: (t) => statuses.push(t),
    waitForAnswer: (options) => waitForKnockAnswer({ ...options, sleep: async () => {
      if (leaveWhileWaiting) { leaveWhileWaiting = false; wait(); rooms.exit(); }
    } })
  });
  await visit.visit(OWNER, { displayName: "방주인" });
  assert.deepEqual(await visit.knock(), { ok: false, reason: "cancelled" });
  assert.equal(rooms.currentSpace, "campus");

  let mounted = true;
  const { visit: v2 } = visitFixture({ server, rooms, mounted: () => mounted });
  assert.deepEqual(await v2.visit(OWNER), { ok: false, reason: "mounted" });
  mounted = false;
  wait();
  assert.ok(rooms.enter("ROOM_CLUBHOUSE_01")); wait();
  assert.deepEqual(await v2.visit(OWNER), { ok: false, reason: "inside_room" });

  const clockFixture = visitFixture({ server: fakeRoomServer(), rooms: transitionFixture().rooms });
  await clockFixture.visit.visit(OWNER);
  assert.ok(clockFixture.visit.intent);
  clockFixture.clock.t += 10 * 60_000 + 1;
  assert.equal(clockFixture.visit.intent, null, "a visit intent lapses after 10 minutes");
});

test("account switch during the resolver never enters the old account's visit", async () => {
  const server = fakeRoomServer();
  const { rooms } = transitionFixture();
  let self = FRIEND;
  let release;
  const gate = new Promise((r) => { release = r; });
  const client = new FriendRoomVisitClient({
    getClient: () => ({ rpc: async (...args) => { await gate; return server.clientFor(FRIEND).rpc(...args); } }),
    getSelfUserId: () => self
  });
  const visit = createFriendRoomVisitController({ client, rooms });
  const pending = visit.visit(OWNER);
  self = STRANGER;
  release();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(rooms.currentSpace, "campus");
});

test("guests and signed-out players cannot start a visit", async () => {
  const { rooms } = transitionFixture();
  const statuses = [];
  const visit = createFriendRoomVisitController({
    client: new FriendRoomVisitClient({ getClient: () => null, getSelfUserId: () => null }), rooms,
    onStatus: (t) => statuses.push(t)
  });
  assert.deepEqual(visit.canVisit(), { ok: false, reason: "signed_out" });
  assert.equal((await visit.visit(OWNER)).reason, "signed_out");
  assert.equal(statuses.at(-1), FRIEND_ROOM_VISIT_TEXT.signed_out);
});

// ---- UI --------------------------------------------------------------------------------------
function walk(node, fn) { fn(node); node.children.forEach((c) => walk(c, fn)); }
const buttonsIn = (root) => { const out = []; walk(root, (n) => { if (n.tagName === "BUTTON") out.push(n); }); return out; };
const textIn = (root) => { const out = []; walk(root, (n) => { if (n.textContent && !n.children.length) out.push(n.textContent); }); return out.join(" | "); };

test("room HUD: owner sees count + privacy toggle + leave; visitor sees owner, read-only, owner-away", async () => {
  const doc = createFakeDocument();
  const root = doc.createElement("section");
  const requests = [];
  let left = 0;
  const hud = createRoomHud({ root, doc, onLeave: () => { left += 1; },
    onSetVisibility: async (v) => { requests.push(v); return { visibility: v }; } });
  hud.update({ active: false });
  assert.equal(root.hidden, true);
  hud.update({ active: true, phase: "READY", role: "owner", count: 2, ownerPresent: true, visibility: "friends" });
  assert.match(textIn(root), /내 방/);
  assert.match(textIn(root), /2명/);
  const [privacy, leave] = buttonsIn(root);
  assert.equal(privacy.textContent, "👥 친구 공개");
  privacy.click();
  await flush();
  assert.deepEqual(requests, ["private"]);
  leave.click();
  assert.equal(left, 1);
  hud.update({ active: true, phase: "READY", role: "visitor", ownerDisplayName: "방주인", count: 1, ownerPresent: false, visibility: "friends" });
  assert.match(textIn(root), /방주인의 방/);
  assert.match(textIn(root), /편집 불가/);
  assert.match(textIn(root), /주인 부재/);
  assert.deepEqual(buttonsIn(root).map((b) => b.textContent), ["나가기"], "visitors have no privacy control");
});

test("Player Card and Friends panel offer 🏠 방 방문 only for friends and report the server reason", async () => {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  const visits = [];
  const roomVisit = {
    canVisit: () => ({ ok: true }),
    onVisit: async (userId) => { visits.push(userId); return { ok: false, reason: "ROOM_PRIVATE" }; },
    reasonText: (r) => FRIEND_ROOM_VISIT_TEXT[r]
  };
  const social = {
    available: true, getSelfUserId: () => FRIEND,
    profile: async (userId) => ({ available: true, userId, nickname: "방주인", relationship: "friends" })
  };
  const card = createPlayerCard({ panel, social, doc, roomVisit, getSelfUserId: () => FRIEND, getRemote: () => null });
  assert.equal(await card.openUser(OWNER, "방주인"), true);
  await flush();
  const visitButton = buttonsIn(panel).find((b) => b.textContent === "🏠 방 방문");
  assert.ok(visitButton, "friend card shows the visit action");
  visitButton.click();
  await flush();
  assert.deepEqual(visits, [OWNER]);
  assert.match(textIn(panel), /비공개/);

  const strangerPanel = doc.createElement("section");
  const strangerCard = createPlayerCard({ panel: strangerPanel, doc, roomVisit, getSelfUserId: () => FRIEND, getRemote: () => null,
    social: { ...social, profile: async (userId) => ({ available: true, userId, nickname: "모르는사람", relationship: "none" }) } });
  await strangerCard.openUser(STRANGER);
  await flush();
  assert.ok(buttonsIn(strangerPanel).length > 0, "stranger card rendered");
  assert.equal(buttonsIn(strangerPanel).some((b) => b.textContent === "🏠 방 방문"), false, "no visit for non-friends");

  const friendsDoc = createFakeDocument();
  const fpanel = friendsDoc.createElement("section");
  const toggle = friendsDoc.createElement("button");
  const friends = createFriendPanel({ toggle, panel: fpanel, doc: friendsDoc, roomVisit,
    social: { mine: async () => ({ friends: [{ userId: OWNER, nickname: "방주인" }], incoming: [], outgoing: [], blocked: [] }) },
    timers: { setInterval: () => null, clearInterval: () => {} } });
  await friends.setOpen(true);
  await flush();
  const rowVisit = buttonsIn(fpanel).find((b) => b.textContent === "🏠 방 방문");
  assert.ok(rowVisit, "friends list offers the visit");
  rowVisit.click();
  await flush();
  assert.deepEqual(visits, [OWNER, OWNER]);
  assert.match(textIn(fpanel), /비공개/);
});

test("main.js wiring: room session follows room metadata, emotes route to the room, identity stops the session", () => {
  const main = code("../src/main.js");
  assert.match(main, /send: \(id\) => roomSession\?\.active \? roomSession\.reportEmote\(id\) : online\?\.reportEmote\(id\) === true/);
  assert.match(main, /roomSession\?\.update\(dt\)/);
  assert.match(main, /if \(!identity \|\| roomIdentityChanged\) roomSession\?\.stop\(\);/);
  assert.match(main, /social\.onRelationshipChange\(\(\) => \{ void roomSession\?\.revalidateNow\(\); \}\)/);
  assert.match(main, /roomVisit: roomVisitEntry/);
  assert.match(main, /parent: personalRoomScene\.root/);
  // The room session never reuses the campus online session or a campus topic.
  const session = code("../src/rooms/room-session.js");
  assert.doesNotMatch(session, /world:campus/);
  assert.doesNotMatch(session, /pauseCampus|resumeCampus/);
});

