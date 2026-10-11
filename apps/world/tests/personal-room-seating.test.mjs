import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { personalRoomSeatAnchors, personalRoomSeatZone, roomSeatPointIsClear,
  resolveRoomSeatStandPoint, PERSONAL_ROOM_SEAT_TOP } from "../src/rooms/personal-room-seats.js";
import { PERSONAL_ROOM_BASIC_FURNITURE, PERSONAL_ROOM_BASIC_OBSTACLES, PERSONAL_ROOM_BASIC_SPAWN } from "../src/rooms/personal-room-layout.js";
import { PERSONAL_ROOM_FIXED_CHAIR_YAW } from "../src/rooms/personal-room-chair-design.js";
import { furnitureBox } from "../src/rooms/furniture-layout.js";
import { createSeatInteraction } from "../src/seat-interaction.js";
import { SEAT_ANCHORS, findSeat } from "../src/seat-anchors.js";
import { EmoteController } from "../src/online/emotes.js";
import { createPersonalRoomSession } from "../src/rooms/room-session.js";
import { createRoomWorldAdapter } from "../src/rooms/room-world-adapter.js";
import { ROOMS } from "../src/rooms/room-registry.js";
import { FakeNetworkHub, FakeScheduler } from "../src/network/fake-transport.js";

const ROOM = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const OWNER = "a1000000-0000-4000-8000-0000000000a1";
const FRIEND = "b2000000-0000-4000-8000-0000000000b2";
const LATE = "c3000000-0000-4000-8000-0000000000c3";
const OBJECT = "d4000000-0000-4000-8000-0000000000d4";
const placed = (itemId = "furniture.induck_chair", yaw = 0) => ({ id: OBJECT, itemId, surface: "floor", x: 0, z: 0, yaw });
const fixed = () => personalRoomSeatAnchors({ roomId: ROOM })[0];
const near = anchor => ({ ...anchor.standPoint });
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≈ ${b}`);

function rig({ roomId = ROOM, objects = [], online = null } = {}) {
  let scope = roomId, layout = objects, editing = false, blockers = [...PERSONAL_ROOM_BASIC_OBSTACLES, ...objects.map(furnitureBox)];
  let position = near(fixed()), yaw = 0;
  const player = {
    getLocalPosition: () => ({ ...position }),
    getLocalRotation: () => ({ x: 0, y: Math.sin(yaw * Math.PI / 360), z: 0, w: Math.cos(yaw * Math.PI / 360) }),
    setLocalPosition: (x, y, z) => { position = { x, y, z }; },
    setLocalEulerAngles: (_x, y) => { yaw = y; },
    reparent(parent) { this.parent = parent; }
  };
  const controller = { keys: new Set(), touchVector: { x: 0, y: 0 }, grounded: true, mounted: false,
    moving: false, velocityY: 0, jumpQueued: false, setMovementSpace(space) { this.space = space; } };
  const anchors = () => personalRoomSeatAnchors({ roomId: scope, objects: layout, obstacles: blockers, position });
  const seating = createSeatInteraction({ player, controller, emotes: new EmoteController({ clock: { now: () => 1000 } }),
    getAnchors: anchors, getOnline: () => online, getSpaceId: () => scope,
    getPlaceZoneId: () => personalRoomSeatZone(scope), canInteract: () => !editing && !!personalRoomSeatZone(scope),
    resolveStandPoint: anchor => resolveRoomSeatStandPoint(anchor, blockers) });
  return { player, controller, seating, anchors,
    setScope: value => { scope = value; }, setOnline: value => { online = value; },
    setPosition: value => { position = { ...value }; }, setEditing: value => { editing = value; },
    setLayout: value => { layout = value; blockers = [...PERSONAL_ROOM_BASIC_OBSTACLES, ...value.map(furnitureBox)]; },
    setObstacles: value => { blockers = value; },
    get obstacles() { return blockers; }, get yaw() { return yaw; }
  };
}

test("room anchors have isolated UUID scope; fixed chair is available without owned furniture", () => {
  assert.equal(personalRoomSeatAnchors().length, 0);
  assert.equal(personalRoomSeatAnchors({ roomId: "AREA_MAIN_HALL" }).length, 0);
  const [anchor] = personalRoomSeatAnchors({ roomId: ROOM });
  assert.equal(anchor.interactableId, "fixed-chair");
  assert.equal(PERSONAL_ROOM_FIXED_CHAIR_YAW, 180);
  assert.equal(anchor.yaw, (PERSONAL_ROOM_FIXED_CHAIR_YAW + 180) % 360);
  assert.equal(anchor.yaw, 0);
  assert.equal(PERSONAL_ROOM_SEAT_TOP.fixed, .27);
  assert.equal(anchor.position.x, 2.95);
  assert.equal(anchor.position.z, .85);
  close(anchor.position.y, 1.15 + PERSONAL_ROOM_SEAT_TOP.fixed - .1);
  assert.equal(anchor.placeZoneId, personalRoomSeatZone(ROOM));
  assert.notEqual(anchor.id, personalRoomSeatAnchors({ roomId: OTHER })[0].id);
  assert.ok(SEAT_ANCHORS.every(campus => campus.id !== anchor.id));
  assert.ok(roomSeatPointIsClear(anchor.standPoint, PERSONAL_ROOM_BASIC_OBSTACLES));
  assert.equal(findSeat(near(anchor), { anchors: [anchor] }), anchor);
  assert.equal(findSeat({ x: 2.95, z: 1.2 }, { anchors: [anchor] }), null, "desk-facing yaw is not the side approach");
});

test("fixed chair faces the desk while safe left, right, and rear approaches stay usable", () => {
  const desk = PERSONAL_ROOM_BASIC_FURNITURE.find(item => item.id === "desk");
  for (const position of [{ x: 2.25, z: .85 }, { x: 3.65, z: .85 }, { x: 2.95, z: .15 }]) {
    const [anchor] = personalRoomSeatAnchors({ roomId: ROOM, position });
    assert.ok(anchor);
    assert.equal(anchor.yaw, 0);
    assert.equal(findSeat(position, { anchors: [anchor] }), anchor);
    const distance = Math.hypot(anchor.standPoint.x - anchor.position.x, anchor.standPoint.z - anchor.position.z);
    close(anchor.approachDirection.x, (anchor.standPoint.x - anchor.position.x) / distance);
    close(anchor.approachDirection.z, (anchor.standPoint.z - anchor.position.z) / distance);
    assert.ok(roomSeatPointIsClear(anchor.standPoint, PERSONAL_ROOM_BASIC_OBSTACLES));
    const r = rig(); r.setPosition(position);
    assert.equal(r.seating.toggle(), true);
    assert.equal(r.seating.beforeController(), true, "approach changes do not evict an occupied fixed chair");
    assert.equal(r.yaw, 0);
    close(Math.sin(r.yaw * Math.PI / 180), 0);
    assert.ok(Math.cos(r.yaw * Math.PI / 180) * (desk.at[2] - r.player.getLocalPosition().z) > 0);
    assert.equal(r.seating.toggle(), true);
    assert.deepEqual(r.player.getLocalPosition(), anchor.standPoint);
    assert.ok(roomSeatPointIsClear(r.player.getLocalPosition(), r.obstacles));
  }
  assert.deepEqual(personalRoomSeatAnchors({ roomId: ROOM, position: { x: 2.95, z: 1.55 } }), [],
    "F does not reach through the desk to its chair");
});

test("placed chair and sofa follow all eight saved rotations and use the rendered seat top", () => {
  for (const itemId of ["furniture.induck_chair", "furniture.dorm_single_sofa"]) for (let yaw = 0; yaw < 360; yaw += 45) {
    const object = placed(itemId, yaw), anchors = personalRoomSeatAnchors({ roomId: ROOM, objects: [object] });
    const anchor = anchors.find(value => value.interactableId === OBJECT);
    assert.ok(anchor, `${itemId} ${yaw}`);
    assert.equal(anchor.yaw, (yaw + 180) % 360);
    close(anchor.position.y, 1.15 + .025 + PERSONAL_ROOM_SEAT_TOP[itemId] - .1);
    assert.ok(roomSeatPointIsClear(anchor.standPoint, [furnitureBox(object)]));
    close(anchor.approachDirection.x, Math.sin(anchor.yaw * Math.PI / 180));
    close(anchor.approachDirection.z, Math.cos(anchor.yaw * Math.PI / 180));
    assert.equal(findSeat(near(anchor), { anchors }), anchor);
  }
  for (const object of [placed("furniture.dorm_monitor"), { ...placed(), surface: "desk" },
    { ...placed(), yaw: NaN }, { ...placed(), id: "untrusted" }]) {
    assert.equal(personalRoomSeatAnchors({ roomId: ROOM, objects: [object] }).length, 1);
  }
});

test("owned chairs retain front-only behavior when their landing or approach is blocked", () => {
  const object = placed(), objects = [object];
  const owned = options => personalRoomSeatAnchors({ roomId: ROOM, objects, ...options }).find(a => a.interactableId === OBJECT);
  const chair = owned(), front = chair.standPoint;
  const obstacles = [...PERSONAL_ROOM_BASIC_OBSTACLES, furnitureBox(object)];
  const block = { id: "block", minX: front.x - .15, maxX: front.x + .15,
    minZ: front.z - .15, maxZ: front.z + .15, minY: 0, maxY: .8 };
  assert.equal(owned({ obstacles: [...obstacles, block] }), undefined);
  const approachBlock = { ...block, minZ: front.z - .85, maxZ: front.z - .55 };
  assert.equal(owned({ obstacles: [...obstacles, approachBlock], position: { x: front.x, z: front.z - .9 } }), undefined);
  const hidden = personalRoomSeatAnchors({ roomId: ROOM, objects: [{ ...placed(), z: -3.5 }] });
  assert.equal(hidden.length, 1, "wall-facing owned chair has no safe front landing");
});

test("dense fixed-chair blockers select a safe rear corridor or make the seat unavailable", () => {
  const sides = [
    { id: "left", minX: 2.4, maxX: 2.52, minZ: .52, maxZ: 1.32, minY: 0, maxY: 1 },
    { id: "right", minX: 3.38, maxX: 3.5, minZ: .52, maxZ: 1.32, minY: 0, maxY: 1 }
  ];
  const obstacles = [...PERSONAL_ROOM_BASIC_OBSTACLES, ...sides];
  const [anchor] = personalRoomSeatAnchors({ roomId: ROOM, obstacles });
  assert.ok(anchor);
  assert.equal(anchor.yaw, 0);
  close(anchor.approachDirection.x, 0);
  close(anchor.approachDirection.z, -1);
  assert.ok(anchor.standPoint.z < anchor.position.z);
  assert.ok(roomSeatPointIsClear(anchor.standPoint, obstacles));
  const r = rig(); r.setObstacles(obstacles); r.setPosition(anchor.standPoint);
  assert.equal(r.seating.toggle(), true);
  assert.equal(r.seating.beforeController(), true);
  assert.equal(r.seating.toggle(), true);
  assert.ok(roomSeatPointIsClear(r.player.getLocalPosition(), obstacles));

  const rear = { id: "rear", minX: 2.4, maxX: 3.5, minZ: .4, maxZ: .5, minY: 0, maxY: 1 };
  const enclosed = [...obstacles, rear];
  for (const position of [{ x: 1.95, z: .85 }, { x: 3.95, z: .85 }, { x: 2.95, z: -.15 }]) {
    assert.ok(roomSeatPointIsClear(position, enclosed), "a clear endpoint alone is not a clear corridor");
    assert.deepEqual(personalRoomSeatAnchors({ roomId: ROOM, obstacles: enclosed, position }), []);
  }
  assert.deepEqual(personalRoomSeatAnchors({ roomId: ROOM, obstacles: enclosed }), []);
  assert.equal(resolveRoomSeatStandPoint(anchor, enclosed, { allowSpawnFallback: false }), null);
  const fallback = resolveRoomSeatStandPoint(anchor, enclosed);
  assert.deepEqual(fallback, PERSONAL_ROOM_BASIC_SPAWN.position);
  assert.ok(roomSeatPointIsClear(fallback, enclosed));
});

test("standing resolves changed obstacles and falls back to the reserved entrance", () => {
  const anchor = fixed(), front = anchor.standPoint;
  const block = { id: "new-layout", minX: front.x - .4, maxX: front.x + .4,
    minZ: front.z - .4, maxZ: front.z + .4, minY: 0, maxY: 1 };
  const obstacles = [...PERSONAL_ROOM_BASIC_OBSTACLES, block];
  const point = resolveRoomSeatStandPoint(anchor, obstacles);
  assert.notDeepEqual(point, anchor.standPoint);
  assert.ok(roomSeatPointIsClear(point, obstacles));
  const encircled = [{ minX: 1, maxX: 5, minZ: -2, maxZ: 3, minY: 0, maxY: 2 }];
  assert.deepEqual(resolveRoomSeatStandPoint(anchor, encircled), PERSONAL_ROOM_BASIC_SPAWN.position);
});

test("a fixed chair blocked during sitting releases to clear floor instead of a collision landing", () => {
  const r = rig(); assert.equal(r.seating.toggle(), true);
  const encircled = { id: "new-surroundings", minX: 1.4, maxX: 4.5, minZ: -.7, maxZ: 2.4, minY: 0, maxY: 1 };
  r.setObstacles([...PERSONAL_ROOM_BASIC_OBSTACLES, encircled]);
  assert.equal(r.seating.beforeController(), false);
  assert.deepEqual(r.player.getLocalPosition(), PERSONAL_ROOM_BASIC_SPAWN.position);
  assert.ok(roomSeatPointIsClear(r.player.getLocalPosition(), r.obstacles));
});

test("repeated F/tap cycles refresh candidates at activation and never drift", () => {
  const r = rig();
  for (let i = 0; i < 20; i++) {
    assert.equal(r.seating.toggle(), true, "no prior refresh required");
    assert.equal(r.seating.beforeController(), true);
    assert.deepEqual(r.player.getLocalPosition(), fixed().position);
    assert.equal(r.yaw, 0);
    assert.equal(r.seating.toggle(), true);
    assert.deepEqual(r.player.getLocalPosition(), fixed().standPoint);
    assert.ok(roomSeatPointIsClear(r.player.getLocalPosition(), r.obstacles));
  }
  r.setEditing(true);
  assert.equal(r.seating.refreshNearby(), null);
  assert.equal(r.seating.toggle(), false);
});

test("keyboard, touch, jump, and emote stand in the room frame; decorating can safely stand first", () => {
  for (const input of [r => r.controller.keys.add("KeyW"), r => { r.controller.touchVector.x = 1; },
    r => { r.controller.jumpQueued = true; }, r => r.seating.requestEmote("wave", {}),
    r => { r.setEditing(true); r.seating.standUp("furniture-edit"); }]) {
    const r = rig();
    r.seating.toggle(); input(r); r.seating.beforeController();
    assert.equal(r.seating.seats.isSeated, false);
    assert.deepEqual(r.player.getLocalPosition(), fixed().standPoint);
    assert.ok(roomSeatPointIsClear(r.player.getLocalPosition(), r.obstacles));
  }
});

test("furniture refresh releases a moved/deleted occupied seat without falling into collision", () => {
  for (const layout of [[], [{ ...placed(), x: .5 }], [{ ...placed(), yaw: 90 }]]) {
    const r = rig({ objects: [placed()] });
    const anchor = personalRoomSeatAnchors({ roomId: ROOM, objects: [placed()] }).find(a => a.interactableId === OBJECT);
    r.setPosition(anchor.standPoint); assert.equal(r.seating.toggle(), true);
    r.setLayout(layout); assert.equal(r.seating.beforeController(), false);
    assert.ok(roomSeatPointIsClear(r.player.getLocalPosition(), r.obstacles));
  }
  const r = rig({ objects: [placed()] });
  const anchor = personalRoomSeatAnchors({ roomId: ROOM, objects: [placed()] }).find(a => a.interactableId === OBJECT);
  r.setPosition(anchor.standPoint); r.seating.refreshNearby(); r.setLayout([]);
  assert.equal(r.seating.toggle(), false, "a stale rendered prompt cannot sit on removed furniture");
});

test("room UUID/frame changes clear stale seats without teleporting or touching new-frame motion", () => {
  for (const next of [OTHER, "CAMPUS", "ROOM_DORM1_LOBBY"]) {
    const r = rig(); r.seating.toggle();
    r.setScope(next); r.setPosition({ x: 100, y: 2, z: 40 });
    r.controller.velocityY = 3; r.controller.grounded = false;
    assert.equal(r.seating.beforeController(), false);
    assert.deepEqual(r.player.getLocalPosition(), { x: 100, y: 2, z: 40 });
    assert.equal(r.controller.velocityY, 3);
    assert.equal(r.controller.grounded, false);
    assert.equal(r.seating.refreshNearby(), null);
  }
});

test("nested exit checkpoints stand before reparenting, and rollback stays standing", () => {
  const r = rig(), root = { enabled: false }, campusRoot = { enabled: true };
  const world = createRoomWorldAdapter({ player: r.player, controller: r.controller,
    orbit: { setIndoor(value) { this.indoor = value; } }, campusRoot, roomScene: { root },
    seating: r.seating, seats: r.seating.seats,
    places: { update() {}, getCurrentPlaceZone: () => ({ id: "AREA_DORM_SOUTH" }) } });
  world.showRoom(ROOMS.ROOM_PERSONAL_BASIC);
  r.seating.toggle();
  const restore = world.createCheckpoint();
  assert.equal(r.seating.seats.isSeated, false);
  assert.deepEqual(r.player.getLocalPosition(), fixed().standPoint);
  world.showCampus(); world.placePlayer({ x: 0, y: 1.15, z: -100 }, 0);
  restore();
  assert.equal(r.player.parent, root);
  assert.deepEqual(r.player.getLocalPosition(), fixed().standPoint);
  assert.equal(r.seating.seats.isSeated, false);
});

test("owner/visitor/late joiner share sit and stand only in their room; occupied seat excludes visitors", async () => {
  const scheduler = new FakeScheduler(1000), hub = new FakeNetworkHub({ scheduler, latencyMs: 20 });
  const clients = [];
  async function client(userId, roomId = ROOM) {
    const r = rig({ roomId }), avatars = new Map();
    const role = userId === OWNER ? "owner" : "visitor";
    const session = createPersonalRoomSession({ player: r.player, controller: r.controller,
      isSeated: () => r.seating.seats.isSeated,
      createAvatar: sample => { const avatar = { sample, update(next) { this.sample = next; }, destroy() { avatars.delete(sample.sessionId); } };
        avatars.set(sample.sessionId, avatar); return avatar; },
      getClient: () => ({ rpc: async () => ({ data: { roomId, allowed: true, ownerUserId: OWNER, role, visibility: "friends" } }) }),
      getIdentity: () => ({ userId, displayName: userId }), clock: scheduler,
      randomId: () => `${userId.slice(0, 8)}-${roomId.slice(0, 8)}`,
      createTransport: () => hub.createTransport(`${userId}-${roomId}`) });
    r.setOnline(session);
    assert.equal(await session.enter({ roomId, ownerUserId: OWNER, role }), true);
    const value = { ...r, session, avatars }; clients.push(value); return value;
  }
  function tick(count = 12) {
    for (let i = 0; i < count; i++) { scheduler.advance(50); for (const c of clients) c.session.update(.05); }
  }
  const a = await client(OWNER), b = await client(FRIEND), isolated = await client(LATE, OTHER);
  tick(); assert.equal(a.session.status().phase, "READY");
  assert.equal(a.seating.toggle(), true); tick();
  const remote = () => [...b.avatars.values()].find(avatar => avatar.sample.userId === OWNER)?.sample;
  assert.equal(remote().anim, "sit");
  const packet = hub.wire.filter(message => message.kind === "pose" && message.payload.sid.startsWith(OWNER.slice(0, 8))).at(-1).payload.p;
  assert.deepEqual([packet.vx, packet.vz], [0, 0]);
  close(remote().pose.x, fixed().position.x);
  assert.equal(b.session.remoteSeatedPositions().length, 1);
  assert.equal(b.seating.toggle(), false, "best-effort occupancy in this room");
  assert.equal(isolated.session.remoteSeatedPositions().length, 0, "same local chair in another room remains free");
  assert.equal(isolated.seating.toggle(), true);
  const late = await client(LATE); tick();
  assert.equal(late.session.remoteSeatedPositions().length, 1);
  a.seating.standUp("move"); tick();
  assert.notEqual(remote().anim, "sit");
  assert.equal(b.session.remoteSeatedPositions().length, 0);
  assert.equal(b.seating.toggle(), true); tick();
  b.session.stop(); tick();
  assert.equal(a.session.remoteSeatedPositions().length, 0, "departure releases occupancy");
  assert.equal(b.session.forcePose(), false);
  assert.deepEqual(b.session.remoteSeatedPositions(), []);
  assert.ok([...hub.channels.keys()].every(id => id.startsWith("ROOM_")), "no campus channel receives room poses");
});

test("main wires one existing F/mobile seat slot, editor stand, scoped pose and indoor lookup", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.equal((main.match(/contextActions\.set\("seat"/g) ?? []).length, 1);
  assert.match(main, /const nearbySeat = seating\.refreshNearby\(\)/);
  assert.match(main, /seating\.standUp\("furniture-edit"\)/);
  assert.match(main, /isSeated: \(\) => seats\.isSeated && seats\.seated\?\.roomId === personalSeatRoomId\(\)/);
  assert.match(main, /!state\.editing && !seats\.isSeated/);
  assert.doesNotMatch(main, /const nearbySeat = inside \? null/);
});
