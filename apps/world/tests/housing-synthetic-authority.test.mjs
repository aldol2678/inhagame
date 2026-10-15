import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { installSyntheticHousingAuthority, verifyHousingShippedMain } from "./browser/housing-synthetic-authority.mjs";
import { startWorldOnline } from "../src/online/world-online.js";
import { PersonalRoomClient } from "../src/rooms/personal-room-client.js";
import { createPersonalRoomInteraction } from "../src/rooms/personal-room-interaction.js";
import { createFurnitureClient } from "../src/rooms/furniture-client.js";
import { createPersonalRoomPreparation } from "../src/rooms/personal-room-preparation.js";
import { createPersonalRoomSession, parseRoomAccess } from "../src/rooms/room-session.js";

const plain = value => JSON.parse(JSON.stringify(value));
const flush = () => new Promise(resolve => setTimeout(resolve, 10));
async function fixture(hostname = "127.0.0.1", href = `http://${hostname}/campus/`) {
  let script;
  // No route/response/production-source mutation API is provided to the installer.
  await installSyntheticHousingAuthority({ addInitScript: async fn => { script = fn; } });
  const world = { location: { hostname, href }, structuredClone };
  runInNewContext(`(${script.toString()})()`, world);
  return { world, f: world.__HOUSING_SYNTHETIC__, client: world.supabase?.createClient() };
}

test("housing observes the exact shipped main and rejects changed served bytes", async () => {
  const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const evidence = await verifyHousingShippedMain({ status: () => 200, text: async () => source });
  assert.equal(evidence.mode, "SHIPPED_SYNTHETIC_HOUSING_AUTHORITY");
  assert.match(evidence.shippedMainSha256, /^[a-f0-9]{64}$/);
  assert.equal(evidence.shippedMainSha256, evidence.servedMainSha256);
  await assert.rejects(verifyHousingShippedMain({ status: () => 404, text: async () => source }), /loaded shipped main/);
  await assert.rejects(verifyHousingShippedMain({ status: () => 200, text: async () => `${source}\n` }), /exact shipped main/);
  assert.doesNotMatch(source, /housing-synthetic-authority|__HOUSING_SYNTHETIC__/);
});

test("the serialized browser dependency fixture installs only on loopback", async () => {
  const blank = await fixture("", "about:blank");
  assert.equal(blank.f, undefined); assert.equal(blank.world.supabase, undefined);
  for (const hostname of ["127.0.0.1", "localhost", "[::1]"]) assert.ok((await fixture(hostname)).f);
  for (const hostname of ["inhagame.app", "production.vercel.app", "localhost.evil", "127.0.0.2", ""]) {
    await assert.rejects(fixture(hostname), /loopback-only/);
  }
});

test("synthetic Auth has no tokens; owner RPCs reject guest, other account and wrong arguments", async () => {
  const { f, client } = await fixture();
  assert.equal((await client.auth.getSession()).data.session, null);
  assert.equal((await client.rpc("get_or_create_my_personal_room_v1", {})).error.message, "PERMANENT_ACCOUNT_REQUIRED");
  assert.equal((await client.rpc("get_world_room_furniture_v1", { p_room: f.roomId })).error.message, "LAYOUT_DENIED");
  assert.equal((await client.rpc("check_world_room_access_v1", { p_room: f.roomId })).data.allowed, false);
  f.switchAccount(f.other);
  assert.equal((await client.rpc("get_or_create_my_personal_room_v1", {})).error.message, "ACCOUNT_UNAVAILABLE");
  assert.equal((await client.rpc("get_world_room_furniture_v1", { p_room: f.roomId })).error.message, "LAYOUT_DENIED");
  assert.equal((await client.rpc("check_world_room_access_v1", { p_room: f.roomId })).data.allowed, false);
  f.switchAccount(f.owner);
  const session = (await client.auth.getSession()).data.session;
  assert.deepEqual(Object.keys(session), ["user"]);
  assert.equal(session.user.id, f.owner);
  assert.equal(session.user.is_anonymous, false);
  for (const args of [{ p_owner: f.other }, { p_user_id: f.owner }, null, []]) {
    assert.equal((await client.rpc("get_or_create_my_personal_room_v1", args)).error.message, "INVALID_ARGUMENTS");
  }
  for (const args of [{}, { p_room: f.other }, { p_room: f.roomId, p_owner: f.owner }, null]) {
    assert.equal((await client.rpc("get_world_room_furniture_v1", args)).error.message, "LAYOUT_DENIED");
    assert.equal((await client.rpc("check_world_room_access_v1", args)).data.allowed, false);
  }
  const room = (await client.rpc("get_or_create_my_personal_room_v1", {})).data;
  assert.equal(room.ownerUserId, f.owner);
  assert.equal(room.roomId, f.roomId);
  const layout = (await client.rpc("get_world_room_furniture_v1", { p_room: f.roomId })).data;
  assert.deepEqual(plain(layout), { roomId: f.roomId, role: "owner", revision: 0, objects: [] });
  const access = (await client.rpc("check_world_room_access_v1", { p_room: f.roomId })).data;
  assert.deepEqual(parseRoomAccess(access, f.roomId), { allowed: true, role: "owner", ownerUserId: f.owner, visibility: "private" });
  for (const name of ["save_my_room_furniture_v1", "set_my_personal_room_visibility_v1", "unrelated_rpc"]) {
    assert.equal((await client.rpc(name, {})).error.message, "OFFLINE_SYNTHETIC_UNSUPPORTED_RPC");
  }
  assert.equal(f.status().channelCalls, 0);
});

test("shipped online identity, native owner guard, preparation and session consume the VM fixture", async () => {
  const { world, f } = await fixture();
  const player = { getLocalPosition: () => ({ x: 0, y: 1.15, z: 0 }), getLocalRotation: () => ({ y: 0, w: 1 }) };
  const controller = { grounded: true };
  const online = startWorldOnline({
    app: { on() {}, off() {} }, places: { onPlaceZoneChanged: () => () => {}, getCurrentPlaceZone: () => null },
    player, controller, createAvatar: () => { throw Error("Offline fixture cannot create remote avatars"); },
    supabaseLib: world.supabase, windowTarget: null, randomId: () => "housing-node-session"
  });
  const client = new PersonalRoomClient({ getClient: () => online.supabase, getSelfUserId: () => online.userId });
  const furniture = createFurnitureClient({ getClient: () => online.supabase, getUserId: () => online.userId });
  let visualLoads = 0;
  const preparation = createPersonalRoomPreparation({ getFurniture: () => furniture, getUserId: () => online.userId,
    getScene: () => ({ root: { enabled: false }, ensureVisualAssets: async () => { visualLoads++; } }) });
  const entries = [], notices = [];
  const interaction = createPersonalRoomInteraction({ client, onStatus: message => notices.push(message), rooms: {
    currentSpace: "ROOM_DORM1_LOBBY", status: () => ({ busy: false }),
    enterNested: (scene, options) => { entries.push({ scene, options }); return true; }
  } });
  const session = createPersonalRoomSession({ player, controller,
    getClient: () => online.supabase, getIdentity: () => online.identity,
    createAvatar: () => { throw Error("Offline fixture cannot create remote avatars"); }, randomId: () => "housing-room-session" });
  online.onIdentity(() => { client.reset(); furniture.reset(); session.stop(); });
  try {
    await flush();
    for (let cycle = 0; cycle < 3; cycle++) {
      f.switchAccount(null); await flush();
      assert.equal(online.userId, null); assert.equal(online.identity, null);
      const before = f.status().calls.length;
      assert.equal(await interaction.open(), false);
      assert.match(notices.at(-1), /로그인/);
      assert.equal(f.status().calls.length, before, "native guest guard makes no authority call");
      await assert.rejects(preparation.prepare({ metadata: { personalRoomId: f.roomId } }), { name: "AbortError" });
      assert.equal(visualLoads, cycle, "accountless preparation never loads visuals");

      f.switchAccount(f.owner); await flush();
      assert.equal(online.userId, f.owner);
      assert.deepEqual(online.identity, { userId: f.owner, displayName: "주거합성검증" });
      f.setOwnerMismatch(true);
      assert.equal(await interaction.open(), false);
      assert.match(notices.at(-1), /개인방을 불러오지 못했어요/);
      assert.equal(entries.length, cycle, "mismatched owner never reaches a transition");
      assert.equal(f.status().calls.length, before + 1, "mismatch rejected before furniture/access requests");
      assert.equal((await online.supabase.rpc("get_world_room_furniture_v1", { p_room: f.roomId })).error.message, "LAYOUT_DENIED");
      assert.equal((await online.supabase.rpc("check_world_room_access_v1", { p_room: f.roomId })).data.allowed, false);

      f.setOwnerMismatch(false);
      assert.equal(await interaction.open(), true);
      const entry = entries.at(-1);
      assert.equal(entry.scene, "ROOM_PERSONAL_BASIC");
      assert.equal(entry.options.isValid(), true);
      assert.deepEqual(entry.options.metadata, { personalRoomId: f.roomId, ownerUserId: f.owner, visitRole: "owner", visibility: "private" });
      const lease = await preparation.prepare({ metadata: entry.options.metadata, isValid: entry.options.isValid });
      assert.equal(furniture.state().ready, true); assert.equal(furniture.state().role, "owner");
      assert.equal(furniture.state().revision, 0); lease.commit();
      assert.equal(visualLoads, cycle + 1);
      assert.equal(await session.enter({ roomId: f.roomId, ownerUserId: f.owner, role: "owner" }), true);
      await flush();
      assert.equal(session.status().phase, "DEGRADED", "valid owner access does not invent a Realtime connection");
      assert.equal(session.status().ownerUserId, f.owner);
      assert.equal(f.status().channelCalls, 0);
      f.switchAccount(null); await flush();
      assert.equal(entry.options.isValid(), false, "native entry lease is account-bound");
    }
  } finally { session.stop(); online.stop(); }
});

test("Housing smoke preserves all viewports, cycles and editor checks while using native owner entry", async () => {
  const smoke = await readFile(new URL("./browser/housing-smoke.mjs", import.meta.url), "utf8");
  assert.match(smoke, /const CYCLES = 3;/);
  assert.match(smoke, /const STEP_TIMEOUT_MS = 45_000;/);
  for (const size of ["{ width: 1280, height: 720 }", "{ width: 360, height: 740 }", "{ width: 844, height: 390 }"]) assert.ok(smoke.includes(size));
  assert.doesNotMatch(smoke, /\.rooms\.enterNested\(/);
  assert.match(smoke, /switchAccount\(null\)/);
  assert.match(smoke, /mismatched owner never enters a personal room/);
  assert.match(smoke, /useDoor\(page, fatalError, \{ id: "personal-room-door"/);
  for (const regression of ["identical snapshot retry", "reload restores saved layout", "discard restores 3D layout",
    "recall save, visitor guard, ownership and cleanup", "room HUD hidden outside rooms", "no scene entities accumulate across cycles",
    "end.roomStats.nestedEnters - baseline.roomStats.nestedEnters, CYCLES", "end.inputEnabled, true"]) assert.ok(smoke.includes(regression), regression);
});
