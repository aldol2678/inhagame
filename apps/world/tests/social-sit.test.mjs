// Social S1-B · Sit / bench (tree-seat) interaction.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  GROUND_ORIGIN_Y, SEAT_ANCHORS, SEAT_INTERACT_RANGE, SEAT_OCCUPIED_RADIUS, SEAT_TOP_Y, SIT_OFFSETS,
  SeatController, findSeat, isSeatOccupied, locomotionIntent
} from "../src/seat-anchors.js";
import { createSeatInteraction } from "../src/seat-interaction.js";
import { POND_TREE_SEATING, pondSeatTrees } from "../src/roadview-layout.js";
import { getPlaceZoneAt } from "../src/place-zone-registry.js";
import { Anim, classifyAnim } from "../src/network/protocol.js";
import { createPoseSource } from "../src/online/pose-source.js";
import { REST_OFFSETS, composeEmotePose, EmoteController } from "../src/online/emotes.js";
import { FACILITIES } from "../src/campus-facilities.js";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";
import { FakeElement } from "./support/fake-dom.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const HUB = "AREA_INKYUNG_STUDENT_CENTER";
const [A0, A1] = SEAT_ANCHORS;

test("1, 27. seat anchors: stable IDs on the rendered tree seats, all in the Inkyung Place Zone", () => {
  // #141 appended back-gate bench seats; the pond tree seats stay the first 32 anchors.
  const treeSeats = SEAT_ANCHORS.filter((a) => a.id.startsWith("SEAT_INKYUNG_TREE_"));
  assert.equal(treeSeats.length, 32, "4 trees × 8 slabs");
  assert.deepEqual(SEAT_ANCHORS.slice(0, 32), treeSeats);
  assert.equal(A0.id, "SEAT_INKYUNG_TREE_1_A");
  assert.equal(new Set(SEAT_ANCHORS.map((a) => a.id)).size, SEAT_ANCHORS.length);
  for (const anchor of SEAT_ANCHORS) assert.equal(getPlaceZoneAt(anchor.position)?.id, anchor.placeZoneId, `${anchor.id} in its Place Zone`);
  const trees = pondSeatTrees();
  for (const anchor of treeSeats) {
    assert.equal(anchor.type, "seat");
    assert.equal(anchor.placeZoneId, HUB);
    assert.equal(getPlaceZoneAt(anchor.position)?.id, HUB, "sitting keeps the semantic Place Zone");
    assert.equal(getPlaceZoneAt(anchor.standPoint)?.id, HUB, "standing up keeps it too");
    const tree = trees[Number(anchor.id.split("_")[3]) - 1];
    const r = Math.hypot(anchor.position.x - tree.center.x, anchor.position.z - tree.center.z);
    assert.ok(Math.abs(r - POND_TREE_SEATING.ringRadius) < 0.1, `${anchor.id} on the rendered slab ring (${r.toFixed(2)})`);
    assert.ok(Math.abs(anchor.position.y - (GROUND_ORIGIN_Y + SEAT_TOP_Y - 0.1)) < 1e-9, "hips on the seat top");
    // Facing out from the trunk.
    const out = { x: anchor.position.x - tree.center.x, z: anchor.position.z - tree.center.z };
    const yaw = Math.atan2(out.x, out.z) * 180 / Math.PI;
    assert.ok(Math.abs(((anchor.yaw - yaw + 540) % 360) - 180) < 1e-6, `${anchor.id} faces outward`);
  }
});

test("2–4, 19–20. availability: in reach, out of reach, occupied, alternate free seat", () => {
  const near = { x: A0.standPoint.x, z: A0.standPoint.z };
  assert.equal(findSeat(near).id, A0.id, "nearest free seat offered");
  const far = { x: A0.position.x + SEAT_INTERACT_RANGE + 5, z: A0.position.z };
  assert.equal(findSeat(far), null, "nothing out of range");
  assert.equal(isSeatOccupied(A0, [{ ...A0.position }]), true);
  const alt = findSeat(near, { occupants: [{ ...A0.position }] });
  assert.ok(alt && alt.id !== A0.id, "another free seat instead of the occupied one");
  const everyone = SEAT_ANCHORS.map((a) => ({ ...a.position }));
  assert.equal(findSeat(near, { occupants: everyone }), null, "no seat when all nearby are taken");
  const nudge = { x: A0.position.x + SEAT_OCCUPIED_RADIUS + 0.05, z: A0.position.z };
  assert.equal(isSeatOccupied(A0, [nudge]), false, "someone standing next to a seat does not occupy it");
});

function localRig({ online = null } = {}) {
  let pos = { x: A0.standPoint.x, y: A0.standPoint.y, z: A0.standPoint.z };
  let yaw = 0;
  const player = {
    getLocalPosition: () => ({ ...pos }),
    setLocalPosition: (x, y, z) => { pos = { x, y, z }; },
    setLocalEulerAngles: (_x, y) => { yaw = y; },
    getLocalRotation: () => ({ x: 0, y: Math.sin(yaw * Math.PI / 360), z: 0, w: Math.cos(yaw * Math.PI / 360) })
  };
  const controller = { keys: new Set(), touchVector: { x: 0, y: 0 }, jumpQueued: false, mounted: false, grounded: true, velocityY: 0, moving: false, walkSpeed: 7 };
  const clock = { t: 0, now() { return this.t; } };
  const emotes = new EmoteController({ clock });
  let zone = HUB;
  const seating = createSeatInteraction({ player, controller, emotes, places: { getCurrentPlaceZone: () => ({ id: zone }) }, getOnline: () => online });
  return { player, controller, emotes, seating, clock, pos: () => pos, yaw: () => yaw, setZone: (z) => { zone = z; } };
}

test("5–10. sit aligns position and yaw; move, jump, mount, zone change and explicit stand all stand up", () => {
  for (const [label, act] of [
    ["move", (r) => r.controller.keys.add("KeyW")],
    ["touch", (r) => { r.controller.touchVector = { x: 0.5, y: 0 }; }],
    ["jump", (r) => { r.controller.jumpQueued = true; }],
    ["mount", (r) => { r.controller.mounted = true; }],
    ["zone", (r) => r.setZone("AREA_MAIN_HALL")],
    ["explicit", (r) => r.seating.toggle()]
  ]) {
    const r = localRig();
    assert.equal(r.seating.refreshNearby()?.id, A0.id);
    assert.equal(r.seating.toggle(), true);
    assert.deepEqual(r.pos(), { ...A0.position }, "position aligned to the anchor");
    assert.equal(r.yaw(), A0.yaw, "yaw aligned to the anchor");
    assert.equal(r.seating.beforeController(), true, "stays seated without input");
    assert.deepEqual(r.pos(), { ...A0.position });
    act(r);
    r.seating.beforeController();
    assert.equal(r.seating.seats.isSeated, false, `${label} stands up`);
    assert.deepEqual(r.pos(), { ...A0.standPoint }, `${label}: safe standing point`);
    assert.equal(r.controller.grounded, true);
  }
});

test("7, 11. sit is a pose state; the seated pose returns exactly to rest after repeated cycles", () => {
  assert.equal(Anim.SIT, "sit");
  assert.equal(classifyAnim({ seated: true, moving: true }), Anim.SIT);
  const r = localRig();
  const poses = createPoseSource({ player: r.player, controller: r.controller, isSeated: () => r.seating.seats.isSeated });
  poses.sample(1 / 60);
  r.seating.refreshNearby();
  r.seating.toggle();
  const { pose } = poses.sample(1 / 60);
  assert.equal(pose.anim, Anim.SIT);
  assert.deepEqual([pose.vx, pose.vz], [0, 0], "the snap onto the seat is not velocity");
  const base = { bodyY: 0, bodyEuler: [0, 0, 0], wings: [[0, 0, 22], [0, 0, -22]], legs: [0, 0] };
  const seated = composeEmotePose(base, SIT_OFFSETS);
  assert.notDeepEqual(seated, base, "seated pose differs");
  assert.ok(seated.legs[0] > 45 && seated.bodyEuler[0] < 0, "legs forward, slight lean back");
  let pose2 = base;
  for (let i = 0; i < 20; i += 1) { pose2 = composeEmotePose(base, SIT_OFFSETS); pose2 = composeEmotePose(base, REST_OFFSETS); }
  assert.deepEqual(pose2, base, "no drift after 20 sit/stand cycles");
  assert.match(code("../src/character-model.js"), /seated && !mounted \? SIT_OFFSETS/, "character composes the sit offsets per frame");
});

test("23. an emote while seated stands up first, then plays", () => {
  const r = localRig();
  r.seating.refreshNearby();
  r.seating.toggle();
  assert.equal(r.seating.requestEmote("wave", { moving: false, grounded: true, mounted: false }), "started");
  assert.equal(r.seating.seats.isSeated, false);
  assert.deepEqual(r.pos(), { ...A0.standPoint });
  assert.equal(r.emotes.active.id, "wave");
});

test("22, 21. chat typing never stands a seated player (the controller ignores keys typed into inputs)", async () => {
  const listeners = {};
  globalThis.window = { addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn); } };
  globalThis.document = { getElementById: (id) => (id === "profile-panel" || id === "view-settings" ? { hidden: true } : null) };
  globalThis.HTMLElement = FakeElement;
  const { PlayerController } = await import("../src/player-controller.js");
  const controller = new PlayerController({ getLocalPosition: () => ({ ...A0.position }), setLocalPosition() {}, setLocalEulerAngles() {} });
  const input = new FakeElement("input", {});
  input.closest = () => input;
  for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "Space", "KeyM"]) for (const fn of listeners.keydown) fn({ code, target: input, repeat: false, preventDefault() {} });
  const intent = locomotionIntent(controller);
  assert.deepEqual(intent, { move: false, jump: false, mount: false }, "typed text is not locomotion");
  for (const fn of listeners.keydown) fn({ code: "KeyW", target: null, repeat: false, preventDefault() {} });
  assert.equal(locomotionIntent(controller).move, true, "real W still stands up");
  delete globalThis.window; delete globalThis.document; delete globalThis.HTMLElement;
});

async function hubPair() {
  const world = createRealtimeWorld();
  const at = { x: A0.standPoint.x, z: A0.standPoint.z };
  const a = createWorldClient(world, { label: "A", nickname: "앨리스", at });
  const b = createWorldClient(world, { label: "B", nickname: "밥", at: { x: A1.standPoint.x, z: A1.standPoint.z } });
  await runWorld(world, 800);
  return { world, a, b };
}
function seatRigFor(client) {
  const seating = createSeatInteraction({ player: client.local.entity, controller: client.local.controller, emotes: null, places: client.places, getOnline: () => client.online });
  Object.defineProperty(client.seat, "seated", { get: () => seating.seats.isSeated });
  return seating;
}
const remoteAnim = (viewer, sessionId) => viewer.online.network.remotes.get(sessionId)?.latestPose?.anim;

test("14–16, 21. members share sitting as pose state: forced snapshot, late join, stand, chat while seated", async () => {
  const { world, a, b } = await hubPair();
  assert.equal(a.online.status().placeZone, HUB);
  const seatA = seatRigFor(a);
  seatRigFor(b);
  const aSid = a.online.status().sessionId;
  const posesBefore = a.online.network.sent.pose;
  seatA.refreshNearby();
  assert.equal(seatA.toggle(), true);
  await runWorld(world, 120);
  assert.ok(a.online.network.sent.pose > posesBefore, "sitting forces a pose right away");
  const wire = world.server.wire.filter((w) => w.kind === "pose" && w.payload.sid === aSid).at(-1).payload.p;
  assert.equal(wire.anim, "sit");
  assert.deepEqual([wire.x, wire.z], [Math.round(A0.position.x * 100) / 100, Math.round(A0.position.z * 100) / 100]);
  assert.equal(remoteAnim(b, aSid), "sit", "B sees A seated");
  assert.equal(b.avatars.live.get(aSid).last.anim, "sit");
  assert.deepEqual(b.online.remoteSeatedPositions().map((p) => p.sessionId), [aSid], "A's seat counts as occupied for B");
  // Chat while seated.
  assert.equal(a.online.chat.submit("여기 앉아봐").result, "sent");
  await runWorld(world, 150);
  assert.deepEqual(b.online.chat.feed.entries.map((e) => [e.name, e.text]), [["앨리스", "여기 앉아봐"]]);
  assert.equal(seatA.seats.isSeated, true, "chatting keeps the player seated");
  // Late joiner sees the seated player without A moving.
  await runWorld(world, 3000);
  const c = createWorldClient(world, { label: "C", nickname: "찰리", at: { x: A1.standPoint.x, z: A1.standPoint.z } });
  await runWorld(world, 1200);
  assert.equal(remoteAnim(c, aSid), "sit", "late joiner renders A seated");
  // Stand: B and C see locomotion again.
  a.local.controller.keys.add("KeyW");
  seatA.beforeController();
  a.local.controller.keys.delete("KeyW");
  await runWorld(world, 400);
  assert.equal(seatA.seats.isSeated, false);
  assert.notEqual(remoteAnim(b, aSid), "sit", "remote stand restores locomotion state");
  assert.equal(b.online.remoteSeatedPositions().length, 0);
});

test("12–13. guests sit as part of their pose (movement state) and send no actions for it", async () => {
  const world = createRealtimeWorld();
  const guest = createWorldClient(world, { label: "G", user: null, at: { x: A0.standPoint.x, z: A0.standPoint.z } });
  await runWorld(world, 600);
  const seating = seatRigFor(guest);
  seating.refreshNearby();
  assert.equal(seating.toggle(), true, "guest can sit");
  assert.equal(guest.online.forcePose(), true, "a guest session publishes poses like a member");
  await runWorld(world, 500);
  const guestWire = world.server.wire.filter((w) => w.payload?.sid === guest.online.status().sessionId);
  assert.ok(guestWire.some((w) => w.kind === "pose" && w.payload.p.anim === "sit"), "sit travels as pose state");
  assert.equal(guestWire.filter((w) => w.kind === "action").length, 0, "sitting sends no action");
  assert.equal(seating.toggle(), true, "guest can stand");
});

test("17–18. leaving the zone or disconnecting removes the remote seated player", async () => {
  const { world, a, b } = await hubPair();
  const seatA = seatRigFor(a);
  seatRigFor(b);
  const aSid = a.online.status().sessionId;
  seatA.refreshNearby();
  seatA.toggle();
  await runWorld(world, 300);
  assert.equal(b.online.remoteSeatedPositions().length, 1);
  world.server.dropClient(a.online.transport.client);
  await runWorld(world, 300);
  assert.equal(b.online.network.remotes.get(aSid), null, "disconnect clears the remote");
  assert.equal(b.online.remoteSeatedPositions().length, 0, "and the seat frees up");
  // Zone leave: a seated player whose zone changes stands up (local rule).
  const r = localRig();
  r.seating.refreshNearby();
  r.seating.toggle();
  r.setZone("AREA_AGORA_6_9");
  r.seating.beforeController();
  assert.equal(r.seating.seats.isSeated, false);
});

test("24–26. seating is independent of camera, view distance and render chunks", () => {
  for (const file of ["../src/seat-anchors.js", "../src/seat-interaction.js"]) {
    const src = code(file);
    assert.doesNotMatch(src, /orbit|firstPerson|camera|view-distance|viewSettings|render-chunk|streaming|RC_/, file);
  }
  const main = code("../src/main.js");
  assert.match(main, /orbit\.apply\(pos, character\.eyeHeight\)/, "first-person eye follows the (seated) character height");
  assert.match(main, /if \(!seating\.beforeController\(\)\) controller\.update/, "the controller does not move a seated player");
});

test("28. mobile: seating uses the shared context-action slot", () => {
  const css = read("../styles.css");
  const html = read("../campus/index.html");
  const main = code("../src/main.js");
  assert.match(css, /#context-action\s*\{/);
  assert.match(css, /bottom:\s*max\(106px/);
  assert.match(css, /min-height:\s*50px/, "shared action remains a mobile touch target");
  assert.match(css, /width:\s*fit-content/, "shared action hugs short labels instead of spanning the centre");
  assert.match(css, /min-width:\s*112px/, "compact actions keep a stable tap target");
  assert.match(css, /max-width:\s*min\(210px/, "long NPC labels remain bounded");
  assert.match(html, /<button id="context-action"[^>]*hidden>/, "shared slot starts hidden");
  assert.doesNotMatch(html, /id="seat-action"/, "seat no longer owns a separate mobile button");
  assert.match(main, /contextActions\.set\("seat"/, "seat publishes into the shared slot");
  assert.match(main, /shortcut:\s*"F"/, "desktop F shortcut remains part of the interaction contract");
});

test("29–30. seating has no persistence; nickname contract untouched", () => {
  const seating = code("../src/seat-interaction.js") + code("../src/seat-anchors.js");
  assert.doesNotMatch(seating, /localStorage|sessionStorage|indexedDB|\.from\("|\.rpc\(/,
    "seat modules own no persistence or database transport");
  assert.doesNotMatch(seating, /nickname|displayName|profile/);
  assert.ok(FACILITIES.length > 0);
});
