// Club Room P0 · main-hall entrance → ROOM_CLUBHOUSE_01 (local interior) → back outside.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { HALL_FRONT, MAIN_ENTRANCE } from "../src/basic-campus.js";
import { canOccupy, moveAroundObstacles } from "../src/world-collision.js";
import { roadviewGroundHeight } from "../src/roadview-layout.js";
import { PlaceZoneRegistry } from "../src/place-zone-registry.js";
import { selectContextAction } from "../src/context-action.js";
import { WALK_SHAPE } from "../src/player-dimensions.js";
import {
  CAMPUS_SPACE, CLUB_ROOM_ENTRANCE, RETURN_ANCHORS, ROOMS, ROOM_ENTRANCES, isRoomId
} from "../src/rooms/room-registry.js";
import { CLUB_ROOM, CLUB_ROOM_BOUNDS, CLUB_ROOM_EXIT, CLUB_ROOM_FURNITURE, CLUB_ROOM_OBSTACLES, CLUB_ROOM_SPAWN } from "../src/rooms/club-room-layout.js";
import { createRoomTransition, ROOM_CONTEXT_PRIORITY, ROOM_TRANSITION_COOLDOWN_MS } from "../src/rooms/room-transition.js";
import { createRoomWorldAdapter, roomMovementSpace, cameraYawBehind } from "../src/rooms/room-world-adapter.js";
import { FOLLOW_CONTEXT_PRIORITY } from "../src/social/follow-controller.js";
import { INDOOR_CAMERA } from "../src/orbit-camera-controller.js";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const ROOM = ROOMS.ROOM_CLUBHOUSE_01;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const hallV = (p) => (p.x - (HALL_FRONT.a.x + HALL_FRONT.b.x) / 2) * HALL_FRONT.inward.x + (p.z - (HALL_FRONT.a.z + HALL_FRONT.b.z) / 2) * HALL_FRONT.inward.z;

// Transition with a recording fake world.
function rig() {
  const clock = { t: 0, now() { return this.t; } };
  const calls = [];
  const world = {
    getPlaceZoneId: () => "AREA_MAIN_HALL",
    leaveCampus: (room) => calls.push(["leaveCampus", room.id]),
    showRoom: (room) => calls.push(["showRoom", room.id]),
    showCampus: (room) => calls.push(["showCampus", room.id]),
    resumeCampus: () => calls.push(["resumeCampus"]),
    placePlayer: (position, yaw) => calls.push(["placePlayer", { ...position }, yaw])
  };
  const rooms = createRoomTransition({ world, clock });
  const tick = (ms = ROOM_TRANSITION_COOLDOWN_MS + 1) => { clock.t += ms; };
  return { clock, calls, rooms, tick };
}

test("1. the main-hall entrance anchor sits on the rendered entry landing, in AREA_MAIN_HALL", () => {
  const e = CLUB_ROOM_ENTRANCE;
  assert.equal(e.id, "CLUB_ROOM_ENTRANCE");
  assert.equal(e.roomId, "ROOM_CLUBHOUSE_01");
  assert.ok(ROOM_ENTRANCES.includes(e));
  assert.equal(ROOM_ENTRANCES.length, 3, "club room coexists with the first-dormitory lobby and MCM event entrances");
  const v = hallV(e.position);
  assert.ok(v < -0.48 && v > -1.2, `on the entry steps in front of the doors, outside the centre column (v=${v.toFixed(2)})`);
  assert.ok(roadviewGroundHeight(e.position.x, e.position.z) > 0.15, "raised entry steps");
  assert.ok(canOccupy({ ...e.position, y: 1.15 + roadviewGroundHeight(e.position.x, e.position.z) }), "reachable, not inside the facade");
  assert.equal(new PlaceZoneRegistry().getPlaceZoneAt({ ...e.position, y: 1.15 })?.id, "AREA_MAIN_HALL");
  assert.ok(Math.abs(e.facingYaw - Math.atan2(HALL_FRONT.inward.x, HALL_FRONT.inward.z) * 180 / Math.PI) < 1e-9, "faces the doors");
  assert.match(code("../src/main-hall-blockout.js"), /'hall_entry_glass'/, "the doors it belongs to are rendered");
  assert.ok(flat(e.position, MAIN_ENTRANCE) > e.radius, "not a floating portal at the plaza point");
});

test("2–5, 35. the enter action: only at the doorway, never mounted or airborne, between Follow and mount", () => {
  const { rooms } = rig();
  const at = (p, extra = {}) => rooms.contextAction({ position: p, grounded: true, mounted: false, ...extra });
  const door = CLUB_ROOM_ENTRANCE.position;
  const action = at(door);
  assert.equal(action.label, "동아리방 들어가기");
  assert.equal(action.icon, "🚪");
  assert.equal(action.shortcut, undefined, "no forced shortcut; mobile shows only the label");
  assert.equal(at({ x: door.x - HALL_FRONT.inward.x * (CLUB_ROOM_ENTRANCE.radius + 0.1), z: door.z - HALL_FRONT.inward.z * (CLUB_ROOM_ENTRANCE.radius + 0.1) }), null, "just past the radius");
  assert.equal(at(MAIN_ENTRANCE), null, "plaza, 10 m out");
  assert.equal(at({ x: 0, z: -98 }), null, "far away");
  assert.equal(at(door, { mounted: true }), null, "mounted");
  assert.equal(at(door, { grounded: false }), null, "airborne");
  assert.ok(ROOM_CONTEXT_PRIORITY < FOLLOW_CONTEXT_PRIORITY && ROOM_CONTEXT_PRIORITY > 120);
  const c = (id, priority) => ({ id, label: id, priority });
  assert.equal(selectContextAction([c("mount", 100), action]).id, "room-door");
  assert.equal(selectContextAction([c("mount", 120), action]).id, "room-door");
  assert.equal(selectContextAction([action, c("follow", FOLLOW_CONTEXT_PRIORITY)]).id, "follow");
  assert.equal(selectContextAction([action, c("seat", 260)]).id, "seat");
  assert.equal(selectContextAction([action, c("npc", 300), c("seat", 280)]).id, "npc");
  const main = code("../src/main.js");
  assert.match(main, /contextActions\.set\("room-door", rooms\.contextAction\(\{ position: pos, grounded: controller\.grounded, mounted: controller\.mounted \}\)\);/);
  for (const id of ["seat", "follow", "npc"]) assert.match(main, new RegExp(`contextActions\\.set\\("${id}"`), `${id} still publishes`);
  // Transport has its own slot (M): the door and the mount never compete for one button.
  assert.match(main, /const mountContextAction = controller\.getMountContextAction\(\);/, "controller provides the mount offer");
  assert.match(main, /transportActions\.set\("mount", mountContextAction \? \{ \.\.\.mountContextAction, trigger: \(\) => controller\.transportAction\(\) \} : null\);/,
    "mount publishes to the transport slot and rechecks controller authority on activation");
  assert.doesNotMatch(main, /contextActions\.set\("mount"/, "mount is not an interaction-slot action");
  assert.match(read("../npc-factory/dev-runtime.mjs"), /priority: 300/);
});

test("6, 9, 19, 32. enter → room spawn; exit → safe anchor; no bounce-back", () => {
  const { rooms, calls, tick } = rig();
  assert.equal(isRoomId("ROOM_CLUBHOUSE_01"), true);
  assert.equal(isRoomId("AREA_CLUBHOUSE_01"), false);
  assert.equal(rooms.currentSpace, CAMPUS_SPACE);
  rooms.contextAction({ position: CLUB_ROOM_ENTRANCE.position }).trigger();
  assert.deepEqual(calls.map((c) => c[0]), ["leaveCampus", "showRoom", "placePlayer"]);
  assert.equal(rooms.currentSpace, "ROOM_CLUBHOUSE_01");
  assert.equal(rooms.insideRoom, true);
  assert.deepEqual(calls[2][1], { ...CLUB_ROOM_SPAWN.position });
  assert.deepEqual(rooms.status().returnContext, { sourceSpace: "campus", placeZoneId: "AREA_MAIN_HALL", entranceId: "CLUB_ROOM_ENTRANCE", returnAnchor: "MAIN_HALL_ROOM_EXIT_RETURN" });
  // Arrival never offers the exit (outside the exit radius and in the cooldown).
  assert.equal(rooms.contextAction({ position: CLUB_ROOM_SPAWN.position }), null);
  tick();
  assert.equal(rooms.contextAction({ position: CLUB_ROOM_SPAWN.position }), null, "spawn is outside the exit radius");
  assert.equal(rooms.contextAction({ position: { x: 0, z: 2 } }), null, "26. exit only near the room door");
  const exit = rooms.contextAction({ position: CLUB_ROOM_EXIT.position });
  assert.equal(exit.label, "본관으로 나가기");
  exit.trigger();
  assert.deepEqual(calls.slice(3).map((c) => c[0]), ["showCampus", "placePlayer", "resumeCampus"]);
  assert.equal(rooms.currentSpace, CAMPUS_SPACE);
  const anchor = RETURN_ANCHORS.MAIN_HALL_ROOM_EXIT_RETURN;
  assert.deepEqual(calls[4][1], { ...anchor.position });
  // No immediate bounce: cooldown, and the anchor is outside the entrance radius anyway.
  assert.equal(rooms.contextAction({ position: CLUB_ROOM_ENTRANCE.position }), null, "cooldown");
  tick();
  assert.equal(rooms.contextAction({ position: anchor.position }), null, "return anchor is outside the entrance radius");
  assert.equal(rooms.enter("NOPE"), false);
  assert.equal(rooms.exit(), false, "already outside");
});

test("11. rooms are a registry of their own spaces (not AREA_* Place Zones)", () => {
  assert.deepEqual(Object.keys(ROOMS), ["ROOM_CLUBHOUSE_01", "ROOM_DORM1_LOBBY", "ROOM_PERSONAL_BASIC", "ROOM_ZOMBIE_UNIVERSITY_2026"]);
  assert.equal(ROOM.label, "동아리방");
  assert.equal(ROOM.type, "club");
  assert.ok(!new PlaceZoneRegistry().zones?.some?.((z) => /CLUB|ROOM/.test(z.id)), "no AREA_CLUBHOUSE place zone");
  assert.doesNotMatch(code("../src/place-zone-registry.js"), /ROOM_|CLUBHOUSE/);
});

test("28. the return anchor: walkable, flat, outside every collider, in AREA_MAIN_HALL, facing away", () => {
  const a = RETURN_ANCHORS.MAIN_HALL_ROOM_EXIT_RETURN;
  assert.equal(roadviewGroundHeight(a.position.x, a.position.z), 0, "flat apron beyond the steps (not under them)");
  assert.equal(a.position.y, 1.15);
  assert.ok(canOccupy(a.position), "not inside the facade, door or steps");
  assert.ok(canOccupy(a.position, { ...WALK_SHAPE, radius: 0.6 }), "with margin");
  assert.ok(hallV(a.position) < -2, "clear of the entrance steps");
  assert.equal(new PlaceZoneRegistry().getPlaceZoneAt(a.position)?.id, "AREA_MAIN_HALL", "31");
  const face = { x: Math.sin(a.yaw * Math.PI / 180), z: Math.cos(a.yaw * Math.PI / 180) };
  assert.ok(face.x * HALL_FRONT.inward.x + face.z * HALL_FRONT.inward.z < -0.99, "facing away from the doors");
  assert.ok(flat(a.position, CLUB_ROOM_ENTRANCE.position) > CLUB_ROOM_ENTRANCE.radius);
});

// ---------------------------------------------------------------- world adapter (fakes)
const entity = (name) => ({ name, enabled: true });
function playerFake(at = { ...CLUB_ROOM_ENTRANCE.position, y: 1.43 }) {
  const p = { pos: { ...at }, yaw: 0, parent: null };
  return Object.assign(p, {
    getLocalPosition: () => ({ ...p.pos }),
    setLocalPosition: (x, y, z) => { p.pos = { x, y, z }; },
    setLocalEulerAngles: (_x, y) => { p.yaw = y; },
    reparent: (parent) => { p.parent = parent; }
  });
}
function adapterRig({ online = null, seated = false } = {}) {
  const campusRoot = entity("CampusCoordinateFrame");
  const roomScene = { root: Object.assign(entity("Room_ROOM_CLUBHOUSE_01"), { enabled: false }), ambient: "room-amb", clearColor: "room-clear" };
  const sun = entity("Sun");
  const player = playerFake();
  const log = [];
  const controller = { velocityY: 3, jumpQueued: true, grounded: false, touchVector: { x: 0.5, y: -0.4 }, keys: new Set(["KeyW"]),
    assist: { x: 1, z: 0 }, space: null,
    clearAssistedMovement() { this.assist = null; }, setMovementSpace(s) { this.space = s ?? "campus"; } };
  const orbit = { yaw: 1, indoor: null, setIndoor(i) { this.indoor = i; } };
  const lightingState = { current: "outdoor" };
  const places = new PlaceZoneRegistry();
  places.update(player.pos);
  const seats = { isSeated: seated };
  const adapter = createRoomWorldAdapter({
    player, controller, orbit, campusRoot, roomScene, sun,
    lighting: { save: () => ({ tag: lightingState.current }), apply: (s) => { lightingState.current = s.ambient ?? s.tag; } },
    follow: { stop: (r) => log.push(["follow.stop", r]) }, stopFollowReason: "room",
    seating: { standUp: (r) => { log.push(["standUp", r]); seats.isSeated = false; } }, seats,
    emotes: { cancel: (r) => log.push(["emote.cancel", r]) },
    getOnline: () => online, places, streaming: { update: () => log.push(["streaming"]) },
    closePanels: () => log.push(["closePanels"]),
    setLocationLabel: (t) => log.push(["label", t]), markSpace: (id) => log.push(["space", id])
  });
  const clock = { t: 0, now() { return this.t; } };
  const rooms = createRoomTransition({ world: adapter, clock });
  return { campusRoot, roomScene, sun, player, controller, orbit, lightingState, places, seats, log, rooms, clock };
}

test("7–8, 10–13, 24, 40. entering hides the campus, resets motion, ends Follow/seat/emote, indoor camera", () => {
  const r = adapterRig({ seated: true });
  assert.ok(r.rooms.enter("ROOM_CLUBHOUSE_01"));
  assert.equal(r.campusRoot.enabled, false, "7. campus scene off");
  assert.equal(r.sun.enabled, false, "outdoor sun off");
  assert.equal(r.roomScene.root.enabled, true, "8. room scene on");
  assert.equal(r.player.parent, r.roomScene.root, "player lives under the room root");
  assert.notEqual(r.roomScene.root, r.campusRoot, "40. independent roots");
  assert.equal(r.lightingState.current, "room-amb", "room lighting");
  assert.deepEqual(r.player.pos, { ...CLUB_ROOM_SPAWN.position }, "9. spawn");
  assert.equal(r.controller.velocityY, 0, "10");
  assert.equal(r.controller.jumpQueued, false);
  assert.equal(r.controller.grounded, true);
  assert.equal(r.controller.assist, null);
  assert.deepEqual(r.controller.touchVector, { x: 0, y: 0 });
  assert.equal(r.controller.keys.size, 0);
  assert.equal(r.controller.space.id, "ROOM_CLUBHOUSE_01", "room collision");
  assert.equal(r.controller.space.allowMount, false);
  assert.deepEqual(r.orbit.indoor, { obstacles: CLUB_ROOM_OBSTACLES }, "24. indoor camera preset + room obstacles");
  assert.equal(r.orbit.yaw, cameraYawBehind(CLUB_ROOM_SPAWN.yaw));
  assert.deepEqual(r.log.slice(0, 4), [["follow.stop", "room"], ["standUp", "room"], ["emote.cancel", "room"], ["closePanels"]], "11–13");
  assert.ok(r.log.some((l) => l[0] === "label" && l[1] === "🏠 동아리방"));
  // Exit: everything comes back.
  r.clock.t += ROOM_TRANSITION_COOLDOWN_MS + 1;
  assert.ok(r.rooms.exit());
  assert.equal(r.campusRoot.enabled, true, "27");
  assert.equal(r.sun.enabled, true);
  assert.equal(r.roomScene.root.enabled, false);
  assert.equal(r.player.parent, r.campusRoot);
  assert.equal(r.lightingState.current, "outdoor", "outdoor lighting restored");
  assert.equal(r.controller.space.id, "campus", "campus collision back");
  assert.equal(r.orbit.indoor, null, "29. outdoor camera restored");
  assert.deepEqual(r.player.pos, { ...RETURN_ANCHORS.MAIN_HALL_ROOM_EXIT_RETURN.position });
  assert.equal(r.places.getCurrentPlaceZone()?.id, "AREA_MAIN_HALL", "31. Place Zone resolves");
  assert.deepEqual(r.log.at(-1), ["streaming"]);
});

test("29 (camera). the indoor preset is temporary; outdoor distance and pitch come back", async () => {
  globalThis.window = { addEventListener() {} };
  globalThis.document = { getElementById: () => null };
  const { OrbitCameraController } = await import("../src/orbit-camera-controller.js");
  const camera = { camera: { nearClip: 0.3 }, setPosition() {}, lookAt() {} };
  const canvas = { addEventListener() {}, setPointerCapture() {}, clientHeight: 800 };
  const orbit = new OrbitCameraController(camera, canvas);
  orbit.distance = 6.2; orbit.pitch = 0.9;
  orbit.setIndoor({ obstacles: CLUB_ROOM_OBSTACLES });
  assert.equal(orbit.distance, INDOOR_CAMERA.initial);
  assert.deepEqual(orbit.zoomLimits, INDOOR_CAMERA);
  orbit.zoom(10);
  assert.equal(orbit.distance, INDOOR_CAMERA.max, "tighter max distance indoors");
  orbit.togglePerspective();
  assert.equal(orbit.firstPerson, true, "25. first person still toggles indoors");
  orbit.togglePerspective();
  orbit.setIndoor(null);
  assert.equal(orbit.distance, 6.2);
  assert.equal(orbit.pitch, 0.9);
  // The chase camera stays inside the room: walls and ceiling are camera obstacles.
  let placed = null;
  camera.setPosition = (x, y, z) => { placed = { x, y, z: -z }; };
  orbit.setIndoor({ obstacles: CLUB_ROOM_OBSTACLES });
  // Near each wall, with the camera swung toward that wall.
  for (const [p, yaw] of [[{ x: 0, y: 1.15, z: -2.8 }, 0], [{ x: -4.1, y: 1.15, z: 0 }, -Math.PI / 2], [{ x: 4.1, y: 1.15, z: 0 }, Math.PI / 2], [{ x: 0, y: 1.15, z: 2.9 }, Math.PI]]) {
    orbit.yaw = yaw; orbit.pitch = 0.3; orbit.distance = INDOOR_CAMERA.max;
    orbit.apply(p, -0.35);
    assert.ok(placed.y < CLUB_ROOM.ceiling && Math.abs(placed.z) < CLUB_ROOM.halfDepth && Math.abs(placed.x) < CLUB_ROOM.halfWidth, `camera inside near ${JSON.stringify(p)}: ${JSON.stringify(placed)}`);
  }
  orbit.pitch = 1.15; orbit.yaw = 0;
  orbit.apply({ x: 0, y: 1.15, z: -1 }, -0.35);
  assert.ok(placed.y < CLUB_ROOM.ceiling, "never above the ceiling");
  delete globalThis.window; delete globalThis.document;
});

// ---------------------------------------------------------------- room collision (real controller)
async function roomController(at = CLUB_ROOM_SPAWN.position) {
  globalThis.window = { addEventListener() {} };
  globalThis.document = { getElementById: (id) => (id === "profile-panel" || id === "view-settings" ? { hidden: true } : null) };
  const { PlayerController } = await import("../src/player-controller.js");
  const pos = { ...at };
  const controller = new PlayerController({ getLocalPosition: () => ({ ...pos }), setLocalPosition: (x, y, z) => Object.assign(pos, { x, y, z }), setLocalEulerAngles() {} });
  controller.setMovementSpace(roomMovementSpace(ROOM));
  const walk = (dir, frames, yaw = 0) => {
    for (const k of dir) controller.keys.add(k);
    for (let i = 0; i < frames; i += 1) controller.update(1 / 60, yaw);
    controller.keys.clear();
  };
  const done = () => { delete globalThis.window; delete globalThis.document; };
  return { controller, pos, walk, done };
}

test("20–23. walls, table and big furniture block; the doorway approach is clear; no way out", async () => {
  const r = await roomController();
  try {
    r.walk(["KeyW"], 60);
    assert.ok(r.pos.z < -0.05 - WALK_SHAPE.radius + 0.01, `21. stopped by the table (${r.pos.z})`);
    for (const [key, axis, sign, wallId] of [["KeyA", "x", -1, "west"], ["KeyD", "x", 1, "east"], ["KeyS", "z", -1, "south"]]) {
      Object.assign(r.pos, { x: 1.5 * (key === "KeyS" ? 1 : 0), y: 1.15, z: -1.8 });
      r.walk(["ShiftLeft", key], 240);
      const limit = axis === "x" ? CLUB_ROOM.halfWidth : CLUB_ROOM.halfDepth;
      assert.ok(Math.abs(r.pos[axis]) <= limit - WALK_SHAPE.radius + 1e-6, `20/23. ${wallId} wall holds (${r.pos[axis]})`);
      assert.ok(canOccupy(r.pos, WALK_SHAPE, CLUB_ROOM_OBSTACLES));
    }
    // The walls themselves collide (not just the bounds clamp): sweep into each wall.
    for (const [x, z, dx, dz, id] of [[-3.9, -1.8, -3, 0, "west"], [3.9, -1.8, 3, 0, "east"], [0.5, -2.6, 0, -3, "south"], [0.5, 2.7, 0, 3, "north"]]) {
      assert.ok(CLUB_ROOM_OBSTACLES.some((o) => o.id === `club_wall_${id}`), `${id} wall collider`);
      const n = moveAroundObstacles({ x, y: 1.15, z }, dx, dz, CLUB_ROOM_OBSTACLES);
      assert.ok(Math.abs(n.x) <= CLUB_ROOM.halfWidth - WALK_SHAPE.radius + 1e-6 && Math.abs(n.z) <= CLUB_ROOM.halfDepth - WALK_SHAPE.radius + 1e-6,
        `${id} wall stops movement by collision: ${JSON.stringify(n)}`);
    }
    // Sofa / bookshelf / cabinet are solid.
    for (const id of ["club_sofa", "club_bookshelf", "club_cabinet", "club_table", "club_wall_north", "club_ceiling"]) {
      assert.ok(CLUB_ROOM_OBSTACLES.some((o) => o.id === id), id);
    }
    assert.ok(!CLUB_ROOM_OBSTACLES.some((o) => /chair|plush|rug|noticeboard/.test(o.id)), "small decoration does not collide");
    // Jumping never goes through the ceiling.
    Object.assign(r.pos, { x: 2, y: 1.15, z: -1.5 });
    r.controller.jumpQueued = true;
    let top = 0;
    for (let i = 0; i < 60; i += 1) { r.controller.update(1 / 60, 0); top = Math.max(top, r.pos.y); }
    assert.ok(top + WALK_SHAPE.headOffset <= CLUB_ROOM.ceiling + 1e-6, `head stays under the ceiling (${top})`);
    // 22. From the spawn to the exit door nothing is in the way.
    Object.assign(r.pos, { ...CLUB_ROOM_SPAWN.position });
    const next = moveAroundObstacles(r.pos, 0, CLUB_ROOM_EXIT.position.z - r.pos.z, CLUB_ROOM_OBSTACLES);
    assert.ok(Math.abs(next.z - CLUB_ROOM_EXIT.position.z) < 1e-9, "doorway approach is clear");
    assert.ok(canOccupy({ ...CLUB_ROOM_EXIT.position, y: 1.15 }, WALK_SHAPE, CLUB_ROOM_OBSTACLES));
    // Mounting is refused indoors.
    r.controller.toggleMount();
    assert.equal(r.controller.mounted, false);
    assert.equal(r.controller.getMountContextAction(), null);
    // Campus colliders never enter the room: the main hall polygon at room (0,0) would block.
    assert.ok(CLUB_ROOM_OBSTACLES.every((o) => o.id.startsWith("club_")));
  } finally { r.done(); }
  // Every furniture piece and the spawn fit inside the shell.
  for (const f of CLUB_ROOM_FURNITURE) {
    assert.ok(Math.abs(f.at[0]) < CLUB_ROOM.halfWidth && Math.abs(f.at[2]) < CLUB_ROOM.halfDepth, f.id);
  }
  assert.ok(canOccupy(CLUB_ROOM_SPAWN.position, WALK_SHAPE, CLUB_ROOM_OBSTACLES), "spawn is free");
  assert.ok(CLUB_ROOM_SPAWN.position.z > CLUB_ROOM_BOUNDS.minZ && CLUB_ROOM_SPAWN.position.z < CLUB_ROOM_BOUNDS.maxZ);
});

// ---------------------------------------------------------------- online: pause / resume (Realtime harness)
function onlineRig(world, client) {
  const campusRoot = entity("CampusCoordinateFrame");
  const roomScene = { root: Object.assign(entity("Room_ROOM_CLUBHOUSE_01"), { enabled: false }) };
  const player = Object.assign(client.local.entity, { reparent: (p) => { player.parent = p; } });
  const ctl = Object.assign(client.local.controller, { setMovementSpace() {}, clearAssistedMovement() {} });
  const adapter = createRoomWorldAdapter({
    player, controller: ctl, orbit: { yaw: 0, setIndoor() {} }, campusRoot, roomScene,
    follow: { stop() {} }, seating: { standUp() {} }, seats: { isSeated: false }, emotes: { cancel() {} },
    getOnline: () => client.online, places: client.places
  });
  return createRoomTransition({ world: adapter, clock: world.scheduler });
}

test("14–18, 30–31, 39. signed in: outside presence leaves at once, no room coordinates or room channel, rejoin on exit", async () => {
  const world = createRealtimeWorld();
  const door = CLUB_ROOM_ENTRANCE.position;
  const a = createWorldClient(world, { label: "A", at: { x: door.x - HALL_FRONT.inward.x * 1.2, z: door.z - HALL_FRONT.inward.z * 1.2 } });
  const b = createWorldClient(world, { label: "B", at: { x: door.x - HALL_FRONT.inward.x * 3, z: door.z - HALL_FRONT.inward.z * 3 } });
  await runWorld(world, 2000);
  assert.equal(a.online.status().placeZone, "AREA_MAIN_HALL");
  assert.equal(b.online.status().remotes.length, 1, "B sees A outside");
  assert.equal(a.online.status().remotes.length, 1, "A sees B");
  a.online.chat.feed.receive({ sender: { sessionId: "b-session-1", userId: "user-b", displayName: "DuckB", placeZoneId: "AREA_MAIN_HALL" },
    placeZoneId: "AREA_MAIN_HALL", text: "hi", position: b.local.pos, receiverPosition: a.local.pos });
  const rooms = onlineRig(world, a);
  assert.ok(rooms.enter("ROOM_CLUBHOUSE_01"));
  const wireAt = world.server.wire.length;
  a.local.input = { speed: 3, heading: 45 }; // walking around inside the room
  await runWorld(world, 2000);
  assert.equal(a.online.campusPaused, true);
  assert.equal(a.online.status().placeZone, null, "left the campus Place Zone channel");
  assert.equal(a.online.status().remotes.length, 0, "14. no outdoor remote players inside");
  assert.equal(a.avatars.live.size, 0, "remote avatars removed");
  assert.equal(a.online.chat.feed.entries.length, 0, "13. outdoor chat cleared");
  assert.equal(b.online.status().remotes.length, 0, "15. B no longer sees a ghost of A outside");
  const fromA = world.server.wire.slice(wireAt).filter((w) => w.kind === "pose" && String(w.payload?.sid ?? "").startsWith("a-"));
  assert.equal(fromA.length, 0, "no pose (room coordinates) ever reaches a campus channel");
  assert.ok(world.server.joins.every((t) => /^world:campus:AREA_[A-Z0-9_]+$/.test(t)), "18/39. no room channel was created");
  assert.equal(a.hud.textContent, "동아리방 · LOCAL", "truthful HUD, no campus population");
  assert.equal(a.online.chat.composer.canSend(), "local_room");
  assert.equal(a.online.reportEmote("wave"), false, "no broadcast from the room");
  assert.ok(a.online.status().signedIn, "17. still signed in");
  // Exit: rejoin the Place Zone at the return anchor; B sees A again.
  a.local.input = { speed: 0, heading: 0 };
  world.scheduler.advanceTo(world.scheduler.now() + ROOM_TRANSITION_COOLDOWN_MS + 1);
  assert.ok(rooms.exit());
  await runWorld(world, 2000);
  assert.equal(a.online.campusPaused, false);
  assert.equal(a.online.status().placeZone, "AREA_MAIN_HALL", "30–31. campus online resumes in AREA_MAIN_HALL");
  assert.equal(b.online.status().remotes.length, 1, "B sees A again");
  assert.equal(a.online.status().remotes.length, 1, "A sees B again");
  assert.match(a.hud.textContent, /ONLINE · 2명/);
  const presenceOfA = world.server.wire.filter((w) => w.kind === "presence" && w.payload?.sessionId?.startsWith?.("a-"));
  assert.ok(presenceOfA.every((w) => /^world:campus:AREA_/.test(w.topic)));
});

test("16. guests enter the local room too (no online session to pause)", () => {
  const r = adapterRig({ online: null });
  assert.ok(r.rooms.enter("ROOM_CLUBHOUSE_01"));
  assert.equal(r.rooms.insideRoom, true);
  r.clock.t += ROOM_TRANSITION_COOLDOWN_MS + 1;
  assert.ok(r.rooms.exit());
  assert.equal(r.rooms.insideRoom, false);
});

test("33–34, 45. mobile: the shared context slot only; no room button, a short fade, the location chip", () => {
  const html = read("../campus/index.html");
  assert.doesNotMatch(html, /<button[^>]*(room|동아리|나가기)/i, "no separate room button");
  assert.match(html, /<button id="context-action"/);
  assert.match(html, /<div id="space-fade" class="space-fade" aria-hidden="true" hidden><\/div>/);
  const css = read("../styles.css");
  assert.match(css, /\.space-fade \{[^}]*transition: opacity \.15s/);
  assert.match(css, /body\[data-space\] #tour \{ display: none; \}/, "outdoor tour compass steps aside indoors");
  const main = code("../src/main.js");
  assert.match(main, /createSpaceFade\(\{ overlay: spaceFade, reducedMotion \}\)/, "shared fade honors reduced motion (behavior covered by space-fade tests)");
  assert.doesNotMatch(main, /createElement\("button"\)/);
  assert.match(code("../src/rooms/room-world-adapter.js"), /setLocationLabel\(room\.locationLabel \?\? `🏠 \$\{room\.label\}`\)/);
});

test("36–38. social modules still start; nothing persisted; no migration; no room protocol", () => {
  const main = code("../src/main.js");
  for (const m of ["SocialClient", "createPlayerCard", "createFriendPanel", "FollowController", "createSeatInteraction", "EmoteController", "createChatPanel"]) {
    assert.match(main, new RegExp(m), m);
  }
  for (const file of ["../src/rooms/room-transition.js", "../src/rooms/room-registry.js", "../src/rooms/club-room-layout.js", "../src/rooms/room-world-adapter.js", "../src/rooms/club-room-renderer.js"]) {
    assert.doesNotMatch(code(file), /localStorage|sessionStorage|indexedDB|\.rpc\(|\.from\(|channel\(/, file);
  }
  const migrations = readdirSync(new URL("../../../supabase/migrations/", import.meta.url)).map((f) => read(`../../../supabase/migrations/${f}`)).join("\n");
  assert.doesNotMatch(migrations, /create table (if not exists )?(public\.)?(\w*_)?(rooms?|room_objects|club\w*)/i, "no rooms/room_objects table");
  for (const file of ["../src/network/protocol.js", "../src/network/network-manager.js", "../src/network/supabase-realtime-transport.js"]) {
    assert.doesNotMatch(code(file), /ROOM_|clubhouse/i, file);
  }
});
