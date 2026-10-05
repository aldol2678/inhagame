// Multiplayer Equipment Projection P0: Presence `equipment` wire contract, NetworkManager republish
// rules and the remote-player model. Pure / fake-transport level (no PlayCanvas, no Supabase).
import test from "node:test";
import assert from "node:assert/strict";
import {
  EQUIPMENT_WIRE_SLOTS, EQUIPMENT_WIRE_STATUSES, PROTOCOL_VERSION, PRESENCE_FIELDS, buildPresence, equipmentKey,
  sanitizeEquipment, validatePresence
} from "../src/network/protocol.js";
import { findPrivateDataViolations } from "../src/network/privacy.js";
import { RemotePlayerManager } from "../src/network/remote-player-manager.js";
import { publicEquipmentFor, toPublicEquipmentSnapshot } from "../src/appearance/equipment-presence.js";
import { APPEARANCE_SLOTS } from "../src/collection/item-catalog.js";
import { MAIN_HALL, AGORA, createClient, createWorld, run } from "./support/online-harness.mjs";

const base = { v: 1, sessionId: "sess-a", userId: "user-a", displayName: "오리친구", placeZoneId: MAIN_HALL, joinedAt: 5 };
const CAP = Object.freeze({ itemId: "head.induck_cap", catalogStatus: "COMING_SOON" });
const PACK = Object.freeze({ itemId: "back.induck_backpack", catalogStatus: "COMING_SOON" });
const T = "2026-09-28T01:00:00+00:00";
const worn = (e) => ({ ...e, equippedAt: T });
const loadoutSnapshot = (slots) => ({ slots: Object.fromEntries(APPEARANCE_SLOTS.map((s) => [s, slots[s] ?? null])) });

// ── Protocol ─────────────────────────────────────────────────────────────────────────────────────
test("1, 12. presence without equipment is exactly the P0 shape (old presences stay valid)", () => {
  const result = validatePresence(base);
  assert.equal(result.ok, true);
  assert.deepEqual(Object.keys(result.presence), [...PRESENCE_FIELDS]);
  assert.equal(result.presence.equipment, undefined);
});

test("2-3. valid HEAD/BACK equipment round-trips as a sparse slot object", () => {
  const presence = buildPresence({ ...base, equipment: { HEAD: CAP, BACK: PACK } });
  assert.deepEqual(presence.equipment, { HEAD: CAP, BACK: PACK });
  assert.deepEqual(Object.keys(presence.equipment), ["HEAD", "BACK"], "empty slots are not sent");
  const received = validatePresence(JSON.parse(JSON.stringify(presence)));
  assert.equal(received.ok, true);
  assert.deepEqual(received.presence.equipment, { HEAD: CAP, BACK: PACK });
  assert.ok(Object.isFrozen(received.presence.equipment) && Object.isFrozen(received.presence.equipment.HEAD));
});

test("4. empty equipment sends no field at all", () => {
  for (const equipment of [{}, null, undefined, { HEAD: null }]) {
    assert.equal("equipment" in buildPresence({ ...base, equipment }), false, JSON.stringify(equipment));
  }
  assert.deepEqual(sanitizeEquipment({}), {});
});

test("5-8. unknown slots, malformed items, malformed statuses and extra keys are dropped entry by entry", () => {
  const raw = {
    HACK_SLOT: CAP, BADGE: { itemId: "badge.main_gate", catalogStatus: "ACTIVE" }, __proto__x: CAP,
    HEAD: { ...CAP, displayName: "x", rarity: "RARE", quantity: 3, extra: { deep: true } },
    BACK: { itemId: "Back.Bag", catalogStatus: "ACTIVE" },
    TOP: { itemId: "top.inha_basic", catalogStatus: "SUPER" },
    SHOES: { itemId: 42, catalogStatus: "ACTIVE" },
    FACE: "face.smile", HAIR: ["x"], BODY: { itemId: `body.${"a".repeat(60)}`, catalogStatus: "ACTIVE" },
    ACCESSORY: { itemId: "accessory.pin", catalogStatus: "UNKNOWN_ITEM" }
  };
  const result = validatePresence({ ...base, equipment: raw });
  assert.equal(result.ok, true, "a bad equipment entry never rejects the presence");
  assert.deepEqual(result.presence.equipment, { HEAD: CAP, ACCESSORY: { itemId: "accessory.pin", catalogStatus: "UNKNOWN_ITEM" } });
  for (const junk of ["x", 7, [], true]) {
    const r = validatePresence({ ...base, equipment: junk });
    assert.equal(r.ok, true);
    assert.equal(r.presence.equipment, undefined);
  }
  assert.deepEqual([...EQUIPMENT_WIRE_SLOTS], [...APPEARANCE_SLOTS], "the nine appearance slots, BADGE excluded");
  assert.deepEqual([...EQUIPMENT_WIRE_STATUSES], ["ACTIVE", "COMING_SOON", "LOCKED", "DISABLED", "HIDDEN", "UNKNOWN_ITEM"]);
});

test("8b. a payload with thousands of junk keys costs only the nine slot lookups", () => {
  const huge = {};
  for (let i = 0; i < 50_000; i += 1) huge[`K${i}`] = CAP;
  huge.HEAD = CAP;
  let reads = 0;
  const probe = new Proxy(huge, { get(target, key) { reads += 1; return target[key]; } });
  assert.deepEqual(sanitizeEquipment(probe), { HEAD: CAP });
  assert.ok(reads <= EQUIPMENT_WIRE_SLOTS.length, `${reads} property reads`);
});

test("9-10. equippedAt and modelAssetId / URLs never survive, on either side", () => {
  const sender = toPublicEquipmentSnapshot(loadoutSnapshot({ HEAD: { ...worn(CAP), modelAssetId: "equipment.head.induck_cap.v1", url: "/assets/induck-cap-v1.glb" } }));
  assert.deepEqual(sender, { HEAD: CAP });
  const received = validatePresence({ ...base, equipment: { HEAD: { ...CAP, equippedAt: T, modelAssetId: "m", url: "/x.glb" } } });
  assert.deepEqual(received.presence.equipment, { HEAD: CAP });
  const wire = JSON.stringify(buildPresence({ ...base, equipment: sender }));
  for (const banned of ["equippedAt", "modelAssetId", ".glb", "url", "quantity", "sourceType", "rarity"]) assert.ok(!wire.includes(banned), banned);
});

test("11. a guest presence never carries equipment (sender and receiver)", () => {
  assert.equal("equipment" in buildPresence({ ...base, guest: true, equipment: { HEAD: CAP } }), false);
  const received = validatePresence({ ...base, guest: true, equipment: { HEAD: CAP } });
  assert.equal(received.ok, true);
  assert.equal(received.presence.equipment, undefined);
});

test("13. new presence stays protocol v1 and old receivers' allowlist simply drops the field", () => {
  const presence = buildPresence({ ...base, equipment: { HEAD: CAP } });
  assert.equal(presence.v, PROTOCOL_VERSION);
  assert.equal(PROTOCOL_VERSION, 1);
  // An old client rebuilt presence from PRESENCE_FIELDS (+ guest) only.
  const oldReceiver = Object.fromEntries(PRESENCE_FIELDS.map((k) => [k, presence[k]]));
  assert.equal(validatePresence(oldReceiver).ok, true);
});

test("privacy: equipment presence carries no email, token, JWT or private keys", () => {
  const presence = buildPresence({ ...base, equipment: { HEAD: CAP, BACK: PACK } });
  assert.deepEqual(findPrivateDataViolations(presence), []);
});

test("sender adapter: READY snapshot of the session's account only; equipmentKey is canonical", () => {
  const snap = loadoutSnapshot({ HEAD: worn(CAP), BACK: worn(PACK) });
  assert.deepEqual(publicEquipmentFor({ state: "READY", snapshot: snap, accountId: "user-a" }, "user-a"), { HEAD: CAP, BACK: PACK });
  for (const change of [{ state: "LOADING", snapshot: null, accountId: "user-a" }, { state: "UNAVAILABLE", snapshot: null, accountId: "user-a" },
    { state: "READY", snapshot: snap, accountId: "user-b" }, { state: "SIGNED_OUT", snapshot: null, accountId: null }]) {
    assert.deepEqual(publicEquipmentFor(change, "user-a"), {}, JSON.stringify(change.state));
  }
  assert.equal(equipmentKey({ BACK: PACK, HEAD: CAP }), equipmentKey({ HEAD: CAP, BACK: PACK }));
  assert.notEqual(equipmentKey({ HEAD: CAP }), equipmentKey({ HEAD: { ...CAP, catalogStatus: "ACTIVE" } }));
});

// ── NetworkManager ───────────────────────────────────────────────────────────────────────────────
function pair({ bGuest = false } = {}) {
  const world = createWorld({ latencyMs: 20 });
  const a = createClient(world, { label: "A" });
  const b = createClient(world, { label: "B", identity: { sessionId: "sess-b", userId: "user-b", displayName: "DuckB", guest: bGuest } });
  return { world, a, b };
}
const presenceWire = (world, label) => world.hub.wire.filter((e) => e.kind === "presence" && e.from === label);
const joinA = (world, a) => { a.net.setPlaceZone(MAIN_HALL); a.net.start(); run(world, 300); };

test("14, 19. equipment set before any zone: stored, zero traffic; the first join carries it", () => {
  const { world, a } = pair();
  assert.equal(a.net.setEquipment({ HEAD: CAP }), false);
  assert.equal(world.hub.wire.length, 0, "no zone → no network traffic");
  joinA(world, a);
  const joins = presenceWire(world, "A");
  assert.equal(joins.length, 1);
  assert.deepEqual(joins[0].payload.equipment, { HEAD: CAP });
  assert.equal(a.net.sent.equipment, 0, "carried by the join, no extra republish");
});

test("15-18. after join: a change republishes once; an identical refresh never does; unequip republishes", () => {
  const { world, a } = pair();
  joinA(world, a);
  const count = () => presenceWire(world, "A").length;
  const before = count();
  assert.equal(a.net.setEquipment({ HEAD: CAP, BACK: PACK }), true);
  assert.equal(count(), before + 1);
  for (let i = 0; i < 5; i += 1) assert.equal(a.net.setEquipment({ BACK: PACK, HEAD: CAP }), false, "same snapshot, any key order");
  assert.equal(count(), before + 1, "identical snapshot → +0");
  assert.equal(a.net.setEquipment({ HEAD: { itemId: "head.inha_cap", catalogStatus: "ACTIVE" }, BACK: PACK }), true, "HEAD change");
  assert.equal(a.net.setEquipment({ BACK: PACK }), true, "HEAD unequip");
  assert.equal(count(), before + 3);
  assert.equal(a.net.sent.equipment, 3);
  const last = presenceWire(world, "A").at(-1).payload;
  assert.deepEqual(last.equipment, { BACK: PACK });
  assert.equal(last.joinedAt, presenceWire(world, "A")[0].payload.joinedAt, "republish keeps joinedAt (same session, not a re-join)");
});

test("20-21. zone change and reconnect carry the latest equipment", () => {
  const { world, a } = pair();
  joinA(world, a);
  a.net.setEquipment({ HEAD: CAP });
  a.net.setPlaceZone(AGORA);
  run(world, 300);
  assert.deepEqual(presenceWire(world, "A").filter((e) => e.placeZoneId === AGORA).at(-1).payload.equipment, { HEAD: CAP });
  a.net.setPlaceZone(null);
  run(world, 100);
  a.net.setEquipment({ HEAD: CAP, BACK: PACK });
  assert.equal(presenceWire(world, "A").filter((e) => e.placeZoneId === null).length, 0);
  a.net.setPlaceZone(MAIN_HALL);
  run(world, 300);
  assert.deepEqual(presenceWire(world, "A").at(-1).payload.equipment, { HEAD: CAP, BACK: PACK }, "next zone join gets the latest state");
  world.hub.dropClient("A");
  run(world, 300);
  world.hub.restoreClient("A");
  run(world, 4000);
  assert.equal(a.net.isOnline, true);
  assert.deepEqual(presenceWire(world, "A").at(-1).payload.equipment, { HEAD: CAP, BACK: PACK }, "reconnect rejoin carries it");
});

test("22. a guest NetworkManager never publishes equipment", () => {
  const { world, b } = pair({ bGuest: true });
  assert.equal(b.net.setEquipment({ HEAD: CAP }), false);
  b.net.setPlaceZone(MAIN_HALL);
  b.net.start();
  run(world, 300);
  assert.equal(b.net.setEquipment({ HEAD: CAP }), false);
  for (const e of presenceWire(world, "B")) assert.equal("equipment" in e.payload, false);
});

// ── Remote model ─────────────────────────────────────────────────────────────────────────────────
function manager() {
  return new RemotePlayerManager({ localSessionId: "sess-local", localUserId: "user-local" });
}

test("23-26. a new remote stores equipment, an update changes it in place, sample carries a frozen copy", () => {
  const remotes = manager();
  const events = [];
  remotes.onEvent((e) => events.push(e.type));
  remotes.upsertPresence({ ...base, equipment: { HEAD: CAP, BACK: PACK } }, 0);
  const player = remotes.get("sess-a");
  assert.deepEqual(player.equipment, { HEAD: CAP, BACK: PACK });
  remotes.upsertPresence({ ...base, equipment: { BACK: PACK } }, 10);
  assert.equal(remotes.get("sess-a"), player, "same player object: never a re-join");
  assert.deepEqual(player.equipment, { BACK: PACK });
  assert.deepEqual(events, ["playerJoined", "playerUpdated"]);
  const [sample] = remotes.sample(20);
  assert.deepEqual(sample.equipment, { BACK: PACK });
  assert.ok(Object.isFrozen(sample.equipment));
  assert.throws(() => { sample.equipment.HEAD = CAP; }, TypeError);
  remotes.upsertPresence({ ...base }, 30);
  assert.deepEqual(remotes.sample(40)[0].equipment, {}, "a presence without equipment shows none");
});

test("27. malformed equipment never removes or rejects the player", () => {
  const remotes = manager();
  remotes.upsertPresence({ ...base, equipment: { HEAD: CAP } }, 0);
  remotes.upsertPresence({ ...base, equipment: { HEAD: { itemId: "!!", catalogStatus: "?" }, HACK: 1 } }, 5);
  assert.equal(remotes.size, 1);
  assert.deepEqual(remotes.get("sess-a").equipment, {});
  assert.equal(remotes.stats.presenceInvalid, 0);
});

test("28. a superseded session's equipment does not leak into the new session", () => {
  const remotes = manager();
  const left = [];
  remotes.onEvent((e) => { if (e.type === "playerLeft") left.push([e.player.sessionId, e.reason]); });
  remotes.upsertPresence({ ...base, sessionId: "sess-old", joinedAt: 1, equipment: { HEAD: CAP, BACK: PACK } }, 0);
  remotes.upsertPresence({ ...base, sessionId: "sess-new", joinedAt: 2 }, 5);
  assert.deepEqual(left, [["sess-old", "superseded"]]);
  assert.deepEqual(remotes.get("sess-new").equipment, {});
  assert.equal(remotes.get("sess-old"), null);
});

test("guest remote: equipment dropped even if a crafted guest presence carries it", () => {
  const remotes = manager();
  remotes.upsertPresence({ ...base, guest: true, equipment: { HEAD: CAP } }, 0);
  assert.deepEqual(remotes.get("sess-a").equipment, {});
});
