// Multiplayer Equipment Projection P0 · two-client integration over the real world-online bootstrap,
// SupabaseRealtimeTransport and NetworkManager against the fake Supabase Realtime server (Phoenix-style
// presence diffs: a re-track is join(new) then leave(old) for the same key).
import test from "node:test";
import assert from "node:assert/strict";
import { MAIN_ENTRANCE } from "../src/basic-campus.js";
import { FACILITIES } from "../src/campus-facilities.js";
import { findPrivateDataViolations } from "../src/network/privacy.js";
import { createRealtimeWorld, createWorldClient, remoteSessions, runWorld } from "./support/online-world-harness.mjs";

const HALL = { x: MAIN_ENTRANCE.x, z: MAIN_ENTRANCE.z };
const AGORA = FACILITIES.find((f) => f.id === "fac_agora_courtyard").center;
const CAP = Object.freeze({ itemId: "head.induck_cap", catalogStatus: "COMING_SOON" });
const PACK = Object.freeze({ itemId: "back.induck_backpack", catalogStatus: "COMING_SOON" });
const INHA_CAP = Object.freeze({ itemId: "head.inha_cap", catalogStatus: "ACTIVE" });
const FRESHMAN_BAG = Object.freeze({ itemId: "back.freshman_bag", catalogStatus: "ACTIVE" });

const sid = (client) => client.online.status().sessionId;
// What B's avatar for A received most recently (the sample handed to the avatar factory).
const seenBy = (viewer, subject) => viewer.avatars.live.get(sid(subject))?.last?.equipment ?? null;
const presencesFrom = (world, client) => world.server.wire.filter((w) => w.kind === "presence" && w.payload.sessionId === sid(client));
const equip = (client, equipment) => client.online.setLocalEquipment(client.lib.userId ?? `user-${client.label.toLowerCase()}`, equipment);

async function pair() {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A", at: HALL });
  const b = createWorldClient(world, { label: "B", at: HALL });
  await runWorld(world, 600);
  return { world, a, b };
}

test("two clients: equip, unequip, null-model replace and re-equip reach B without recreating A's avatar", async () => {
  const { world, a, b } = await pair();
  const aSid = sid(a);
  assert.deepEqual(seenBy(b, a), {});
  equip(a, { HEAD: CAP, BACK: PACK });
  await runWorld(world, 300);
  assert.deepEqual(seenBy(b, a), { HEAD: CAP, BACK: PACK });
  const avatar = b.avatars.live.get(aSid);
  const remote = b.online.network.remotes.get(aSid);
  const left = [];
  b.online.network.onRemoteEvent((e) => { if (e.type === "playerLeft") left.push(e.reason); });

  equip(a, { BACK: PACK }); // HEAD unequip
  await runWorld(world, 300);
  assert.deepEqual(seenBy(b, a), { BACK: PACK });
  equip(a, { BACK: FRESHMAN_BAG }); // null-model BACK
  await runWorld(world, 300);
  assert.deepEqual(seenBy(b, a), { BACK: FRESHMAN_BAG });
  equip(a, { HEAD: CAP, BACK: FRESHMAN_BAG }); // cap back
  await runWorld(world, 300);
  assert.deepEqual(seenBy(b, a), { HEAD: CAP, BACK: FRESHMAN_BAG });

  assert.equal(b.avatars.live.get(aSid), avatar, "same avatar object for every change");
  assert.equal(b.online.network.remotes.get(aSid), remote, "same remote player object");
  assert.deepEqual(b.avatars.created.filter((s) => s === aSid), [aSid], "A's avatar created exactly once");
  assert.deepEqual(b.avatars.destroyed, [], "never destroyed by an equipment change");
  assert.deepEqual(left, [], "a Presence re-track is never a leave");
  // And B's own equipment reaches A the same way.
  equip(b, { HEAD: CAP, BACK: PACK });
  await runWorld(world, 300);
  assert.deepEqual(seenBy(a, b), { HEAD: CAP, BACK: PACK });
});

test("late join: B receives A's current equipment from the initial Presence sync alone", async () => {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A", at: HALL });
  await runWorld(world, 400);
  equip(a, { HEAD: CAP, BACK: PACK });
  await runWorld(world, 300);
  const wireBefore = world.server.wire.length;
  const b = createWorldClient(world, { label: "B", at: HALL });
  await runWorld(world, 600);
  assert.deepEqual(seenBy(b, a), { HEAD: CAP, BACK: PACK });
  const fromA = world.server.wire.slice(wireBefore).filter((w) => w.kind === "presence" && w.payload.sessionId === sid(a));
  assert.deepEqual(fromA, [], "A sent nothing extra for the newcomer: no request / response round trip");
});

test("zone transition: leaving removes A (and its equipment) for B; rejoining shows the latest equipment", async () => {
  const { world, a, b } = await pair();
  equip(a, { HEAD: CAP });
  await runWorld(world, 300);
  a.local.teleportTo(AGORA);
  await runWorld(world, 1000);
  assert.deepEqual(remoteSessions(b), []);
  assert.ok(b.avatars.destroyed.includes(sid(a)));
  equip(a, { HEAD: CAP, BACK: PACK }); // changed while in another zone
  a.local.teleportTo(HALL);
  await runWorld(world, 1000);
  assert.deepEqual(seenBy(b, a), { HEAD: CAP, BACK: PACK });
});

test("room privacy: pause removes A for B, changes while inside send nothing, resume shows the latest", async () => {
  const { world, a, b } = await pair();
  equip(a, { HEAD: CAP });
  await runWorld(world, 300);
  a.online.pauseCampus({ label: "동아리방" });
  await runWorld(world, 600);
  assert.deepEqual(remoteSessions(b), []);
  const count = presencesFrom(world, a).length;
  equip(a, { HEAD: CAP, BACK: PACK });
  await runWorld(world, 600);
  assert.equal(presencesFrom(world, a).length, count, "nothing reaches the campus channel from a room");
  a.online.resumeCampus();
  await runWorld(world, 800);
  assert.deepEqual(seenBy(b, a), { HEAD: CAP, BACK: PACK });
});

test("reconnect: after a dropped socket A rejoins with its equipment", async () => {
  const { world, a, b } = await pair();
  equip(a, { HEAD: CAP, BACK: PACK });
  await runWorld(world, 300);
  const client = a.online.transport.client;
  world.server.dropClient(client);
  await runWorld(world, 300);
  assert.deepEqual(remoteSessions(b), []);
  world.server.restoreClient(client);
  await runWorld(world, 3000);
  assert.deepEqual(remoteSessions(b), [sid(a)]);
  assert.deepEqual(seenBy(b, a), { HEAD: CAP, BACK: PACK });
});

test("logout: A's member avatar and equipment leave; the guest session that replaces it wears nothing", async () => {
  const { world, a, b } = await pair();
  equip(a, { HEAD: CAP, BACK: PACK });
  await runWorld(world, 300);
  const memberSid = sid(a);
  a.online.transport.client.signOut();
  await runWorld(world, 800);
  assert.ok(!remoteSessions(b).includes(memberSid));
  assert.ok(b.avatars.destroyed.includes(memberSid));
  assert.equal(a.online.status().guest, true);
  assert.deepEqual(seenBy(b, a), {}, "guest remote: base character only");
  for (const p of presencesFrom(world, a)) assert.equal("equipment" in p.payload, false);
});

test("guest and wrong-account inputs publish nothing", async () => {
  const world = createRealtimeWorld();
  const g = createWorldClient(world, { label: "G", at: HALL, user: null });
  const b = createWorldClient(world, { label: "B", at: HALL });
  await runWorld(world, 600);
  assert.equal(g.online.setLocalEquipment("user-g", { HEAD: CAP }), false);
  assert.equal(b.online.setLocalEquipment("user-someone-else", { HEAD: CAP }), false, "only the session's own account");
  await runWorld(world, 300);
  assert.deepEqual(seenBy(b, g), {});
  for (const w of world.server.wire.filter((e) => e.kind === "presence")) assert.equal("equipment" in w.payload, false);
});

test("bandwidth: idle and movement add zero equipment traffic; one change adds exactly one presence", async () => {
  const { world, a } = await pair();
  equip(a, { HEAD: CAP, BACK: PACK });
  await runWorld(world, 300);
  const presence0 = presencesFrom(world, a).length;
  // Repeated identical loadout refreshes.
  for (let i = 0; i < 10; i += 1) equip(a, { BACK: PACK, HEAD: CAP });
  await runWorld(world, 30_000); // idle 30 s
  assert.equal(presencesFrom(world, a).length, presence0, "idle 30 s: 0 presence updates");
  const poses0 = world.server.wire.filter((w) => w.kind === "pose").length;
  a.local.input = { speed: 7, heading: 90 };
  await runWorld(world, 3000);
  a.local.input = { speed: 0, heading: 90 };
  assert.ok(world.server.wire.filter((w) => w.kind === "pose").length > poses0 + 5, "movement: pose traffic only");
  assert.equal(presencesFrom(world, a).length, presence0, "movement: 0 presence updates");
  for (const w of world.server.wire.filter((e) => e.kind === "pose")) assert.equal(JSON.stringify(w.payload).includes("equipment"), false);
  equip(a, { HEAD: INHA_CAP, BACK: PACK });
  await runWorld(world, 300);
  assert.equal(presencesFrom(world, a).length, presence0 + 1, "one change: +1");
  assert.equal(a.online.status().equipment.republished, 2);
});

test("privacy and wire shape: presence equipment is sparse { itemId, catalogStatus } only", async () => {
  const { world, a } = await pair();
  equip(a, { HEAD: { ...CAP, equippedAt: "2026-09-28T01:00:00+00:00", modelAssetId: "m" }, BACK: PACK });
  await runWorld(world, 300);
  for (const entry of world.server.wire) assert.deepEqual(findPrivateDataViolations(entry.payload), [], JSON.stringify(entry));
  const presence = presencesFrom(world, a).at(-1).payload;
  assert.deepEqual(presence.equipment, { HEAD: CAP, BACK: PACK });
  assert.deepEqual(Object.keys(presence).sort(), ["displayName", "equipment", "joinedAt", "placeZoneId", "sessionId", "userId", "v"]);
  const wire = JSON.stringify(world.server.wire);
  assert.ok(!wire.includes(a.online.transport.client.session.access_token));
  for (const banned of ["equippedAt", "modelAssetId", ".glb"]) assert.ok(!wire.includes(banned), banned);
});

test("status: equipment counters only (no entities, no raw Presence)", async () => {
  const { world, a } = await pair();
  equip(a, { HEAD: CAP });
  await runWorld(world, 300);
  assert.deepEqual(a.online.status().equipment, { localSlots: 1, remoteAvatars: 0, remoteSlots: 0, republished: 1 });
});
