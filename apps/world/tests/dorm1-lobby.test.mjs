import test from "node:test";
import assert from "node:assert/strict";
import { canOccupy, moveAroundObstacles } from "../src/world-collision.js";
import { PlaceZoneRegistry } from "../src/place-zone-registry.js";
import { WALK_SHAPE } from "../src/player-dimensions.js";
import {
  DORM_1_LOBBY_ENTRANCE,
  RETURN_ANCHORS,
  ROOMS
} from "../src/rooms/room-registry.js";
import {
  DORM_1_LOBBY,
  DORM_1_LOBBY_BOUNDS,
  DORM_1_LOBBY_EXIT,
  DORM_1_LOBBY_MY_ROOM,
  DORM_1_LOBBY_OBSTACLES,
  DORM_1_LOBBY_SPAWN
} from "../src/rooms/dorm1-lobby-layout.js";
import { createRoomTransition, ROOM_TRANSITION_COOLDOWN_MS } from "../src/rooms/room-transition.js";
import { createRoomWorldAdapter } from "../src/rooms/room-world-adapter.js";

const ROOM = ROOMS.ROOM_DORM1_LOBBY;
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function transitionRig() {
  const clock = { t: 0, now() { return this.t; } };
  const calls = [];
  const world = {
    getPlaceZoneId: () => "AREA_DORM_SOUTH",
    leaveCampus: room => calls.push(["leaveCampus", room.id]),
    showRoom: room => calls.push(["showRoom", room.id]),
    showCampus: room => calls.push(["showCampus", room.id]),
    resumeCampus: () => calls.push(["resumeCampus"]),
    placePlayer: (position, yaw) => calls.push(["placePlayer", { ...position }, yaw])
  };
  return { clock, calls, rooms: createRoomTransition({ world, clock }) };
}

test("D1.2 registry binds the mapped first dormitory entrance to a local Housing Lobby", () => {
  assert.equal(DORM_1_LOBBY_ENTRANCE.id, "DORM_1_ENTRANCE");
  assert.equal(DORM_1_LOBBY_ENTRANCE.roomId, "ROOM_DORM1_LOBBY");
  assert.equal(DORM_1_LOBBY_ENTRANCE.placeZoneId, "AREA_DORM_SOUTH");
  assert.equal(DORM_1_LOBBY_ENTRANCE.returnAnchor, "DORM_1_CAMPUS_RETURN");
  assert.equal(ROOM.type, "housing_lobby");
  assert.equal(ROOM.locationLabel, "🏢 제1생활관 로비");
  assert.equal(ROOM.enterLabel, "제1생활관 들어가기");
  assert.equal(ROOM.exitLabel, "캠퍼스로 나가기");
  assert.equal(new PlaceZoneRegistry().getPlaceZoneAt(DORM_1_LOBBY_ENTRANCE.position)?.id, "AREA_DORM_SOUTH");
});

test("campus → dorm lobby → campus closes one local transition loop", () => {
  const { clock, calls, rooms } = transitionRig();
  const action = rooms.contextAction({ position: DORM_1_LOBBY_ENTRANCE.position, grounded: true, mounted: false });
  assert.equal(action.label, "제1생활관 들어가기");
  assert.equal(rooms.contextAction({ position: DORM_1_LOBBY_ENTRANCE.position, grounded: true, mounted: true }), null);
  assert.ok(action.trigger());
  assert.equal(rooms.currentSpace, "ROOM_DORM1_LOBBY");
  assert.deepEqual(calls.map(call => call[0]), ["leaveCampus", "showRoom", "placePlayer"]);
  assert.deepEqual(calls[2][1], { ...DORM_1_LOBBY_SPAWN.position });
  assert.deepEqual(rooms.status().returnContext, {
    sourceSpace: "campus",
    placeZoneId: "AREA_DORM_SOUTH",
    entranceId: "DORM_1_ENTRANCE",
    returnAnchor: "DORM_1_CAMPUS_RETURN"
  });

  clock.t += ROOM_TRANSITION_COOLDOWN_MS + 1;
  const exit = rooms.contextAction({ position: DORM_1_LOBBY_EXIT.position, grounded: true, mounted: false });
  assert.equal(exit.label, "캠퍼스로 나가기");
  assert.ok(exit.trigger());
  assert.equal(rooms.currentSpace, "campus");
  const anchor = RETURN_ANCHORS.DORM_1_CAMPUS_RETURN;
  assert.deepEqual(calls[4][1], { ...anchor.position });
  assert.ok(flat(anchor.position, DORM_1_LOBBY_ENTRANCE.position) > DORM_1_LOBBY_ENTRANCE.radius);
});

test("lobby shell is expanded for future human-scale avatars and keeps the doorway approach clear", () => {
  assert.ok(DORM_1_LOBBY.halfWidth >= 7);
  assert.ok(DORM_1_LOBBY.halfDepth >= 5.4);
  assert.ok(DORM_1_LOBBY.ceiling >= 2.2);
  assert.ok(DORM_1_LOBBY.camera.initial > 2.2 && DORM_1_LOBBY.camera.max >= 4.5);
  assert.ok(DORM_1_LOBBY.campusDoor.width >= 1.5);
  assert.ok(DORM_1_LOBBY.campusDoor.height < 1.5, "door height stays human-scale in 2m/world-unit coordinates");
  assert.ok(canOccupy(DORM_1_LOBBY_SPAWN.position, WALK_SHAPE, DORM_1_LOBBY_OBSTACLES));
  assert.ok(canOccupy({ ...DORM_1_LOBBY_EXIT.position, y: 1.15 }, WALK_SHAPE, DORM_1_LOBBY_OBSTACLES));
  const next = moveAroundObstacles(
    DORM_1_LOBBY_SPAWN.position,
    0,
    DORM_1_LOBBY_EXIT.position.z - DORM_1_LOBBY_SPAWN.position.z,
    DORM_1_LOBBY_OBSTACLES
  );
  assert.ok(Math.abs(next.z - DORM_1_LOBBY_EXIT.position.z) < 1e-9, "campus doorway approach stays clear");
  assert.equal(DORM_1_LOBBY_MY_ROOM.status, "ACTIVE");
  assert.ok(Math.abs(DORM_1_LOBBY_MY_ROOM.position.x) < DORM_1_LOBBY.halfWidth);
  assert.ok(Math.abs(DORM_1_LOBBY_MY_ROOM.position.z) < DORM_1_LOBBY.halfDepth);
  for (const obstacle of DORM_1_LOBBY_OBSTACLES) assert.ok(obstacle.id.startsWith("dorm1_lobby_"));
  assert.ok(DORM_1_LOBBY_BOUNDS.minX < DORM_1_LOBBY_SPAWN.position.x && DORM_1_LOBBY_BOUNDS.maxX > DORM_1_LOBBY_SPAWN.position.x);
});

const entity = name => ({ name, enabled: true });
test("room world adapter selects the correct scene per room id and leaves Club Room untouched", () => {
  const campusRoot = entity("campus");
  const club = { root: Object.assign(entity("club"), { enabled: false }), ambient: "club", clearColor: "club" };
  const dorm = { root: Object.assign(entity("dorm"), { enabled: false }), ambient: "dorm", clearColor: "dorm" };
  const player = {
    pos: { ...DORM_1_LOBBY_ENTRANCE.position, y: 1.15 }, yaw: 0, parent: campusRoot,
    getLocalPosition() { return { ...this.pos }; },
    setLocalPosition(x, y, z) { this.pos = { x, y, z }; },
    setLocalEulerAngles(_x, y) { this.yaw = y; },
    reparent(parent) { this.parent = parent; }
  };
  const controller = {
    velocityY: 0, jumpQueued: false, grounded: true, touchVector: { x: 0, y: 0 }, keys: new Set(),
    clearAssistedMovement() {}, setMovementSpace(space) { this.space = space; }
  };
  const orbit = { yaw: 0, setIndoor(value) { this.indoor = value; } };
  const places = new PlaceZoneRegistry();
  places.update(player.pos);
  const labels = [];
  const adapter = createRoomWorldAdapter({
    player, controller, orbit, campusRoot,
    getRoomScene: room => room.id === "ROOM_DORM1_LOBBY" ? dorm : club,
    lighting: { save: () => ({ ambient: "outdoor" }), apply() {} },
    places,
    setLocationLabel: text => labels.push(text)
  });
  const clock = { t: 0, now() { return this.t; } };
  const rooms = createRoomTransition({ world: adapter, clock });
  assert.ok(rooms.enter("ROOM_DORM1_LOBBY", { entranceId: "DORM_1_ENTRANCE" }));
  assert.equal(dorm.root.enabled, true);
  assert.equal(club.root.enabled, false);
  assert.equal(player.parent, dorm.root);
  assert.equal(labels.at(-1), "🏢 제1생활관 로비");
  assert.deepEqual(orbit.indoor, { obstacles: DORM_1_LOBBY_OBSTACLES, limits: DORM_1_LOBBY.camera });
  clock.t += ROOM_TRANSITION_COOLDOWN_MS + 1;
  assert.ok(rooms.exit());
  assert.equal(dorm.root.enabled, false);
  assert.equal(player.parent, campusRoot);
});
