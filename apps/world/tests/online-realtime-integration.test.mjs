// Online P0 integration: world-online bootstrap + SupabaseRealtimeTransport + NetworkManager +
// real PlaceZoneRegistry, against a fake Supabase Realtime that enforces the RLS rule.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAIN_ENTRANCE } from "../src/basic-campus.js";
import { FACILITIES } from "../src/campus-facilities.js";
import { ConnectionState } from "../src/network/connection-state.js";
import { SupabaseRealtimeTransport } from "../src/network/supabase-realtime-transport.js";
import { TRANSPORT_METHODS, assertNetworkTransport } from "../src/network/transport.js";
import { Anim, encodePose } from "../src/network/protocol.js";
import { findPrivateDataViolations } from "../src/network/privacy.js";
import { PlaceZoneNetworkBridge } from "../src/online/place-zone-bridge.js";
import { RemotePlayerView } from "../src/online/remote-player-view.js";
import { onlineHudText } from "../src/online/online-hud.js";
import { yawFromQuaternion } from "../src/online/pose-source.js";
import { FakeRealtimeServer, createFakeSupabaseLib } from "./support/fake-supabase.mjs";
import { FakeScheduler } from "../src/network/fake-transport.js";
import { createRealtimeWorld, createWorldClient, remoteSessions, runWorld } from "./support/online-world-harness.mjs";

const HALL = { x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z };
// Source without comments, so prose about what a module avoids does not count as using it.
const code = (url) => readFileSync(url, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const AGORA = FACILITIES.find((f) => f.id === "fac_agora_courtyard").center;
const HALL_EDGE = { x: 38.5, z: -23.5 };
const LAWN_EDGE = { x: 35.4, z: -28.9 };
const { ONLINE, RECONNECTING, OFFLINE } = ConnectionState;

async function twoInHall() {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A", at: HALL });
  const b = createWorldClient(world, { label: "B", at: HALL });
  await runWorld(world, 600);
  return { world, a, b };
}

test("1. SupabaseRealtimeTransport satisfies the NetworkTransport contract", () => {
  const scheduler = new FakeScheduler();
  const client = createFakeSupabaseLib(new FakeRealtimeServer({ scheduler }), { user: { id: "u1" } }).createClient();
  const transport = new SupabaseRealtimeTransport(client, { windowTarget: null });
  assert.doesNotThrow(() => assertNetworkTransport(transport));
  assert.equal(TRANSPORT_METHODS.length, 11);
  assert.throws(() => new SupabaseRealtimeTransport({}), /supabase-js client/);
});

test("2. auth lifecycle: members and guests share the Place Zone channel; sign-out falls back to guest", async () => {
  const world = createRealtimeWorld();
  const member = createWorldClient(world, { label: "M", at: HALL });
  const guest = createWorldClient(world, { label: "G", at: HALL, user: null });
  const anonymous = createWorldClient(world, { label: "N", at: HALL, user: { id: "anon-1", is_anonymous: true } });
  await runWorld(world, 600);
  assert.equal(member.online.status().state, ONLINE);
  assert.equal(member.online.status().guest, false);
  for (const client of [guest, anonymous]) {
    const status = client.online.status();
    assert.equal(status.state, ONLINE, `${client.label} joins as a guest`);
    assert.equal(status.guest, true);
    assert.equal(client.online.userId, null, "guests expose no social identity");
    assert.equal(client.online.supabase, null);
    assert.equal(client.online.identity, null);
    assert.equal(client.hud.textContent, "● GUEST · 3명");
    assert.equal(client.hud.dataset.guest, "true");
    // The guest session lives in its own auth store: the shared member store is untouched.
    assert.equal(client.online.transport.client.storageKey, "inhagame-world-guest-auth-v1");
  }
  assert.equal(anonymous.lib.clients.find((c) => c.storageKey === "default").session.user.id, "anon-1",
    "the shared (hub) session is never replaced by the World guest session");
  assert.equal(member.online.status().count, 3, "members see guests in the same Place Zone");
  assert.equal(member.hud.textContent, "● ONLINE · 3명");
  const guestNames = member.online.status().remotes.map((r) => r.displayName).sort();
  assert.ok(guestNames.every((name) => /^게스트 [A-Z0-9]{1,4}$/.test(name)), guestNames.join());
  // Sign-out tears the member session down and reconnects the same tab as a guest.
  member.online.transport.client.signOut();
  await runWorld(world, 600);
  assert.equal(member.online.status().guest, true);
  assert.equal(member.online.status().state, ONLINE);
  assert.equal(member.online.userId, null);
  assert.equal(member.hud.textContent, "● GUEST · 3명");
  assert.ok(member.local.frames > 40);
});

test("2b. guests only move and jump: no chat, no emote, not inspectable, not in Nearby", async () => {
  const world = createRealtimeWorld();
  const member = createWorldClient(world, { label: "M", at: HALL });
  const guest = createWorldClient(world, { label: "G", at: HALL, user: null });
  await runWorld(world, 600);
  const guestSid = guest.online.status().sessionId;
  const memberSid = member.online.status().sessionId;

  // Guest moves and jumps: the member sees both.
  guest.local.input = { speed: 3, heading: 90 };
  await runWorld(world, 600);
  guest.local.input = { speed: 0, heading: 90 };
  guest.local.jump();
  await runWorld(world, 100);
  const seen = member.online.network.sampleRemotes().find((s) => s.sessionId === guestSid);
  assert.equal(seen.guest, true);
  assert.equal(seen.anim, Anim.AIR, "the guest jump reaches members");
  assert.ok(seen.pose.x > HALL.x + 1, "the guest movement reaches members");

  // Guest cannot chat or emote; nothing chat/emote-shaped goes on the wire.
  const wireBefore = world.server.wire.length;
  assert.equal(guest.online.chat.canChat, false);
  assert.equal(guest.online.chat.signedIn, false);
  assert.equal(guest.online.chat.submit("안녕").result === "sent", false);
  assert.equal(guest.online.reportEmote("wave"), false);
  assert.equal(guest.online.network.reportEmote("wave"), false, "the network layer refuses too");
  assert.equal(guest.online.network.reportChat("안녕", { x: 0, y: 0, z: 0 }), false);
  const actions = world.server.wire.slice(wireBefore).filter((w) => w.kind === "action").map((w) => w.payload.p.type);
  assert.deepEqual(actions.filter((t) => t === "chat" || t === "emote"), []);

  // Members still see the guest but cannot inspect, follow or list them socially.
  assert.equal(member.online.remotePlayer(guestSid), null);
  assert.equal(member.online.remoteByUser(seen.userId), null);
  assert.deepEqual(member.online.nearbyRemotes().map((r) => r.sessionId), []);
  assert.equal(member.online.miniMapRemotes().some((r) => r.sessionId === guestSid), true, "still on the mini-map");

  // Guests still see members (and their chat bubbles) on the shared channel.
  assert.deepEqual(remoteSessions(guest), [memberSid]);
  assert.equal(member.online.chat.submit("반가워요").result, "sent");
  await runWorld(world, 100);
  assert.ok(guest.online.chat.feed.bubbleFor(memberSid), "guest receives member chat");
});

test("2c. a hand-crafted chat/emote from a guest presence is dropped by receivers", async () => {
  const world = createRealtimeWorld();
  const member = createWorldClient(world, { label: "M", at: HALL });
  const guest = createWorldClient(world, { label: "G", at: HALL, user: null });
  await runWorld(world, 600);
  const guestSid = guest.online.status().sessionId;
  // Bypass the client guard, like a modified client would.
  const net = guest.online.network;
  for (const [type, payload] of [["chat", { text: "스팸", x: HALL.x, y: 1, z: HALL.z }], ["emote", { emote: "wave" }]]) {
    guest.online.transport.publishAction(net.placeZoneId, { v: 1, id: net.actionId++, type, payload });
  }
  await runWorld(world, 100);
  assert.equal(member.online.chat.feed.bubbleFor(guestSid), null);
  assert.equal(member.online.network.sampleRemotes().find((s) => s.sessionId === guestSid).emote, null);
  assert.equal(member.online.network.remotes.stats.actionGuestBlocked, 2);
});

test("2d. guest fallbacks: anonymous sign-ins disabled or allowGuests false keep the old OFFLINE", async () => {
  const world = createRealtimeWorld();
  const member = createWorldClient(world, { label: "M", at: HALL });
  const disabled = createWorldClient(world, { label: "D", at: HALL, user: null, anonymousSignIns: false });
  const optedOut = createWorldClient(world, { label: "O", at: HALL, user: null, allowGuests: false });
  await runWorld(world, 600);
  for (const client of [disabled, optedOut]) {
    assert.equal(client.online.network, null, `${client.label} never builds a network session`);
    assert.equal(client.hud.textContent, "OFFLINE");
    assert.equal(client.hud.dataset.state, "GUEST");
  }
  assert.equal(disabled.online.errors.some((e) => e.where === "guest"), true);
  assert.equal(optedOut.lib.anonymousSignInCalls, 0);
  assert.equal(member.online.status().count, 1);
  assert.ok(disabled.local.frames > 30, "local play keeps running");
});

test("2e. signing in on another tab upgrades a guest to a member session", async () => {
  const world = createRealtimeWorld();
  const member = createWorldClient(world, { label: "M", at: HALL });
  const guest = createWorldClient(world, { label: "G", at: HALL, user: null });
  await runWorld(world, 600);
  const guestSid = guest.online.status().sessionId;
  guest.lib.clients.find((c) => c.storageKey === "default").signIn({ id: "user-g", is_anonymous: false });
  await runWorld(world, 600);
  const status = guest.online.status();
  assert.equal(status.guest, false);
  assert.equal(guest.online.userId, "user-g");
  assert.notEqual(status.sessionId, guestSid);
  assert.equal(status.liveChannels, 1, "the guest channel was left");
  assert.deepEqual(remoteSessions(member), [status.sessionId], "no guest ghost remains");
  assert.equal(member.online.status().remotes[0].displayName, "DuckG");
});

test("3–4. join and leave a semantic Place Zone channel (private, AREA topic, presence key = session)", async () => {
  const { world, a } = await twoInHall();
  const joined = [...a.online.transport.channels.values()].map((e) => ({ topic: e.channel.topic, config: e.channel.opts.config }));
  assert.deepEqual(joined.map((j) => j.topic), ["world:campus:AREA_MAIN_HALL"]);
  assert.equal(joined[0].config.private, true);
  assert.equal(joined[0].config.presence.key, a.online.status().sessionId);
  assert.equal(joined[0].config.broadcast.self, false);
  a.online.stop();
  await runWorld(world, 200);
  assert.equal(world.server.liveSubscriptions(a.online.transport?.client ?? {}), 0);
});

test("5–6. PlaceZoneChanged moves the channel; topics never use RC_* render chunk IDs", async () => {
  const { world, a, b } = await twoInHall();
  a.local.teleportTo(AGORA);
  await runWorld(world, 1000);
  assert.equal(a.online.status().placeZone, "AREA_AGORA_6_9");
  assert.equal(a.online.status().liveChannels, 1, "old channel left, one live subscription");
  assert.deepEqual(remoteSessions(b), [], "B no longer sees A in the Main Hall");
  assert.deepEqual(remoteSessions(a), [], "A sees nobody in the Agora");
  assert.ok(world.server.joins.every((t) => /^world:campus:AREA_[A-Z0-9_]+$/.test(t)), world.server.joins.join());
  assert.ok(!world.server.joins.some((t) => t.includes("RC_")));
  b.local.teleportTo(AGORA);
  await runWorld(world, 1000);
  assert.deepEqual(remoteSessions(a), [b.online.status().sessionId]);
  assert.deepEqual(remoteSessions(b), [a.online.status().sessionId]);
});

test("7–9, 16–17. presence, pose, RUN, JUMP, HUD population and avatar spawn over the Realtime adapter", async () => {
  const { world, a, b } = await twoInHall();
  const aSid = a.online.status().sessionId;
  assert.deepEqual(remoteSessions(b), [aSid]);
  assert.equal(b.online.status().remotes[0].displayName, "DuckA", "public nickname from profiles");
  assert.equal(a.hud.textContent, "● ONLINE · 2명", "N includes the local player");
  assert.deepEqual(b.avatars.created, [aSid]);

  a.local.input = { speed: 7, heading: 90 };
  await runWorld(world, 1000);
  const remote = b.online.network.remotes.get(aSid);
  assert.equal(remote.anim, Anim.WALK);
  assert.ok(Math.abs(remote.latestPose.x - a.local.pos.x) < 3, "pose follows");
  assert.ok(Math.abs(Math.abs(remote.latestPose.yaw) - 90) < 1, "yaw follows");
  const avatarPose = b.avatars.live.get(aSid).last.pose;
  assert.ok(avatarPose.x > HALL.x && avatarPose.x < a.local.pos.x, "avatar renders the interpolated position");

  a.local.input.speed = 12;
  await runWorld(world, 600);
  assert.equal(b.online.network.remotes.get(aSid).anim, Anim.RUN);

  a.local.input.speed = 0;
  await runWorld(world, 600);
  const posesBefore = b.online.network.remotes.stats.poseAccepted;
  a.local.jump();
  await runWorld(world, 60);
  assert.ok(b.online.network.remotes.get(aSid).lastJumpAt !== null, "jump action arrived");
  assert.equal(b.avatars.live.get(aSid).last.anim, Anim.AIR);
  assert.ok(b.online.network.remotes.stats.poseAccepted - posesBefore <= 1);
});

test("8. stale and foreign packets are rejected at the adapter boundary", async () => {
  const { world, a, b } = await twoInHall();
  const aSid = a.online.status().sessionId;
  a.local.input = { speed: 7, heading: 0 };
  await runWorld(world, 800);
  const before = { ...b.online.network.remotes.get(aSid).latestPose };
  const channel = [...b.online.transport.channels.values()][0].channel;
  channel.fire("broadcast", "pose", { payload: { sid: aSid, p: encodePose(0, { x: 0, y: 0, z: 0, yaw: 0, anim: "idle" }) } });
  channel.fire("broadcast", "pose", { payload: { sid: aSid, p: { v: 1, seq: 999, x: NaN } } });
  assert.deepEqual(b.online.network.remotes.get(aSid).latestPose, before);
  assert.ok(b.online.network.remotes.stats.poseStale >= 1);
  assert.ok(b.online.network.remotes.stats.poseInvalid >= 1);
});

test("10–12. reconnect restores exactly one remote; the local user is never a remote", async () => {
  const { world, a, b } = await twoInHall();
  const aSid = a.online.status().sessionId;
  const aClient = a.online.transport.client;
  world.server.dropClient(aClient);
  a.local.input = { speed: 7, heading: 0 };
  const z0 = a.local.pos.z;
  await runWorld(world, 300);
  assert.equal(a.online.status().state, RECONNECTING);
  assert.deepEqual(remoteSessions(b), []);
  assert.ok(b.avatars.destroyed.includes(aSid), "avatar removed on disconnect");
  world.server.restoreClient(aClient);
  await runWorld(world, 2500);
  assert.equal(a.online.status().state, ONLINE);
  assert.deepEqual(remoteSessions(b), [aSid], "exactly one A");
  assert.deepEqual(remoteSessions(a), [b.online.status().sessionId], "exactly one B");
  assert.equal(b.avatars.live.size, 1);
  assert.ok(a.local.pos.z > z0 + 15, "local play never paused");
  for (const client of [a, b]) {
    assert.ok(!remoteSessions(client).includes(client.online.status().sessionId), `${client.label} not its own remote`);
    assert.ok(!client.avatars.created.includes(client.online.status().sessionId));
  }
});

test("11. a reload (new session, same user) replaces the ghost instead of duplicating", async () => {
  const { world, a, b } = await twoInHall();
  const oldSid = a.online.status().sessionId;
  a.online.stop();
  a.active = false;
  const a2 = createWorldClient(world, { label: "A2", user: { id: "user-a", is_anonymous: false }, at: HALL });
  await runWorld(world, 800);
  const now = remoteSessions(b);
  assert.equal(now.length, 1);
  assert.notEqual(now[0], oldSid);
  assert.equal(now[0], a2.online.status().sessionId);
});

test("13. privacy: only the allowlisted public contract reaches Realtime", async () => {
  const { world, a } = await twoInHall();
  a.local.input = { speed: 12, heading: 45 };
  await runWorld(world, 500);
  a.local.jump();
  await runWorld(world, 500);
  const client = a.online.transport.client;
  assert.ok(world.server.wire.length > 5);
  for (const entry of world.server.wire) assert.deepEqual(findPrivateDataViolations(entry.payload), [], JSON.stringify(entry));
  const wire = JSON.stringify(world.server.wire);
  assert.ok(!wire.includes(client.session.access_token), "access token never on the wire");
  assert.ok(!wire.includes("refresh-secret"));
  const presence = world.server.wire.find((w) => w.kind === "presence").payload;
  assert.deepEqual(Object.keys(presence).sort(), ["displayName", "joinedAt", "placeZoneId", "sessionId", "userId", "v"]);
});

test("14. offline fallback: Realtime outage never freezes local play; recovery or OFFLINE", async () => {
  const { world, a, b } = await twoInHall();
  a.local.input = { speed: 7, heading: 0 };
  world.server.setOnline(false);
  const z0 = a.local.pos.z;
  await runWorld(world, 400);
  assert.equal(a.online.status().state, RECONNECTING);
  assert.equal(a.hud.textContent, "◌ RECONNECTING");
  assert.ok(a.local.pos.z > z0 + 2);
  world.server.setOnline(true);
  await runWorld(world, 3000);
  assert.equal(a.online.status().state, ONLINE);
  assert.deepEqual(remoteSessions(a), [b.online.status().sessionId]);

  world.server.setOnline(false);
  await runWorld(world, 40_000);
  assert.equal(a.online.status().state, OFFLINE);
  assert.equal(a.avatars.live.size, 0, "remotes disappear cleanly");
  assert.equal(a.hud.textContent, "OFFLINE");
  assert.ok(a.local.pos.z > z0 + 7 * 40, "40 s of local play while offline");
  assert.equal(a.places.getCurrentPlaceZone() !== undefined, true, "Place Zones keep resolving");
});

test("15. a missing supabase library leaves the World offline without errors", async () => {
  const world = createRealtimeWorld();
  const { startWorldOnline } = await import("../src/online/world-online.js");
  const hud = { textContent: "", dataset: {} };
  let handlers = 0;
  const handle = startWorldOnline({
    app: { on: () => { handlers += 1; } }, places: { onPlaceZoneChanged: () => () => {}, getCurrentPlaceZone: () => null },
    player: {}, controller: {}, createAvatar: () => ({}), hudElement: hud, supabaseLib: undefined, clock: world.scheduler, windowTarget: null
  });
  assert.equal(handle.network, null);
  assert.equal(hud.textContent, "OFFLINE");
  assert.equal(handlers, 1);
});

test("rapid border crossing is debounced: no duplicate subscriptions or remotes", async () => {
  const { world, a, b } = await twoInHall();
  a.local.teleportTo(HALL_EDGE);
  await runWorld(world, 600);
  const joinsBefore = world.server.joins.length;
  let flip = false;
  await runWorld(world, 3000, { onFrame: (client) => {
    if (client !== a) return;
    flip = !flip;
    a.local.teleportTo(flip ? LAWN_EDGE : HALL_EDGE);
  } });
  a.local.teleportTo(HALL_EDGE);
  await runWorld(world, 600);
  assert.equal(world.server.joins.length, joinsBefore, "jitter across the border caused no re-join");
  assert.equal(a.online.status().liveChannels, 1);
  assert.deepEqual(remoteSessions(b), [a.online.status().sessionId]);
  // A real move still commits after the debounce.
  a.local.teleportTo(LAWN_EDGE);
  await runWorld(world, 800);
  assert.equal(a.online.status().placeZone, "AREA_CENTRAL_LAWN");
  assert.equal(a.online.status().liveChannels, 1);
});

test("repeated PlaceZoneChanged for the same zone is idempotent", async () => {
  const { world, a } = await twoInHall();
  const joins = world.server.joins.length;
  for (let i = 0; i < 5; i += 1) a.online.bridge.observe("AREA_MAIN_HALL", world.scheduler.now());
  a.online.network.handlePlaceZoneChanged("AREA_MAIN_HALL", "AREA_MAIN_HALL");
  await runWorld(world, 600);
  assert.equal(world.server.joins.length, joins);
  assert.equal(world.server.liveSubscriptions(a.online.transport.client), 1);
});

test("18. remote avatars are visual only: no collision code path and no controller writes", () => {
  const sources = ["remote-avatar.js", "remote-player-view.js", "world-online.js", "pose-source.js", "place-zone-bridge.js"]
    .map((f) => [f, code(new URL(`../src/online/${f}`, import.meta.url))]);
  for (const [file, src] of sources) {
    assert.doesNotMatch(src, /world-collision|OBSTACLES|moveAroundObstacles|resolveHeight/, `${file} touches collision`);
    assert.doesNotMatch(src, /controller\.[a-zA-Z]+\s*=[^=]|setLocalPosition\([^)]*\)\s*;?\s*\/\/\s*local/, `${file} writes the controller`);
  }
  const controllerSrc = code(new URL("../src/player-controller.js", import.meta.url));
  assert.doesNotMatch(controllerSrc, /network|remote|supabase/i, "PlayerController knows nothing about online");
});

test("19–20. view distance and render chunks never reach network membership", () => {
  const online = ["world-online.js", "place-zone-bridge.js", "pose-source.js", "remote-player-view.js", "remote-avatar.js"]
    .map((f) => code(new URL(`../src/online/${f}`, import.meta.url))).join("\n")
    + code(new URL("../src/network/supabase-realtime-transport.js", import.meta.url));
  assert.doesNotMatch(online, /render-chunk|view-distance|RenderChunk|viewDistance|streaming/);
  const main = code(new URL("../src/main.js", import.meta.url));
  const wiring = main.slice(main.indexOf("startWorldOnline({"), main.indexOf("});", main.indexOf("startWorldOnline({")));
  assert.doesNotMatch(wiring, /streaming|registry|viewSettings|chunkRenderer/, "online receives places, never chunks or view settings");
});

test("19. view-distance style churn with a fixed Place Zone does not touch the channel", async () => {
  const { world, a } = await twoInHall();
  const joins = world.server.joins.length;
  const sid = a.online.status().sessionId;
  // Anything the renderer does is invisible here; only Place Zone events drive the bridge.
  for (let i = 0; i < 4; i += 1) { a.places.update(a.local.pos); await runWorld(world, 200); }
  assert.equal(world.server.joins.length, joins);
  assert.equal(a.online.status().sessionId, sid, "no network state recreated");
});

test("unit: bridge debounce, HUD text, avatar view dedupe, yaw from quaternion", () => {
  const calls = [];
  const net = { placeZoneId: null, handlePlaceZoneChanged(prev, next) { calls.push([prev, next]); this.placeZoneId = next; } };
  const bridge = new PlaceZoneNetworkBridge(net, { debounceMs: 400 });
  bridge.observe("AREA_MAIN_HALL", 0);
  bridge.observe("AREA_CENTRAL_LAWN", 100);
  bridge.tick(300);
  bridge.observe("AREA_MAIN_HALL", 350);
  bridge.tick(1000);
  bridge.observe("AREA_AGORA_6_9", 1000);
  bridge.tick(1399);
  bridge.tick(1400);
  assert.deepEqual(calls, [[null, "AREA_MAIN_HALL"], ["AREA_MAIN_HALL", "AREA_AGORA_6_9"]]);

  assert.equal(onlineHudText({ state: "ONLINE", count: 3 }), "● ONLINE · 3명");
  assert.equal(onlineHudText({ state: "RECONNECTING" }), "◌ RECONNECTING");
  assert.equal(onlineHudText({ state: "OFFLINE" }), "OFFLINE");
  assert.equal(onlineHudText({ state: "ONLINE", count: 2, signedIn: false }), "OFFLINE");

  const made = [];
  const view = new RemotePlayerView({ localSessionId: "me", createAvatar: (s) => { made.push(s.sessionId); return { update() {}, destroy() { made.push(`-${s.sessionId}`); } }; } });
  const s = (sessionId) => ({ sessionId, pose: { x: 0, y: 0, z: 0, yaw: 0 }, anim: "idle" });
  view.sync([s("a"), s("a"), s("me"), s("b")], 0.016);
  view.sync([s("b")], 0.016);
  assert.deepEqual(made, ["a", "b", "-a"]);

  for (const yaw of [0, 45, 179, -179, -90]) {
    const q = { y: Math.sin(yaw * Math.PI / 360), w: Math.cos(yaw * Math.PI / 360) };
    assert.ok(Math.abs(yawFromQuaternion(q) - yaw) < 1e-9, `${yaw}`);
  }
});
