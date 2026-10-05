import test from "node:test";
import assert from "node:assert/strict";
import { CLUB_ROOM, CLUB_ROOM_EXIT, CLUB_ROOM_FURNITURE } from "../src/rooms/club-room-layout.js";
import { DORM_1_LOBBY, DORM_1_LOBBY_EXIT } from "../src/rooms/dorm1-lobby-layout.js";
import { PERSONAL_ROOM_BASIC, PERSONAL_ROOM_BASIC_EXIT } from "../src/rooms/personal-room-layout.js";
import { createRoomMapDataSource, ROOM_MAP_GEOMETRY_KIND, setPersonalRoomMapFurniture } from "../src/minimap/room-map-data.js";

test("club room map source reuses authoritative room bounds and layout", () => {
  const source = createRoomMapDataSource("ROOM_CLUBHOUSE_01");
  assert.ok(source);
  assert.equal(source.id, "ROOM_CLUBHOUSE_01");
  assert.equal(source.label, "동아리방 지도");
  assert.equal(source.indoor, true);
  assert.deepEqual(source.bounds, {
    minX: -CLUB_ROOM.halfWidth,
    maxX: CLUB_ROOM.halfWidth,
    minZ: -CLUB_ROOM.halfDepth,
    maxZ: CLUB_ROOM.halfDepth
  });
  assert.ok(source.radiusWorld > CLUB_ROOM.halfWidth);
});

test("room geometry contains one floor and authored furniture footprints without decoration noise", () => {
  const geometry = createRoomMapDataSource("ROOM_CLUBHOUSE_01").geometry();
  assert.equal(geometry.filter(item => item.kind === ROOM_MAP_GEOMETRY_KIND.ROOM_FLOOR).length, 1);
  const furniture = geometry.filter(item => item.kind === ROOM_MAP_GEOMETRY_KIND.ROOM_FURNITURE);
  const expected = CLUB_ROOM_FURNITURE.filter(item => !["rug", "plush"].includes(item.kind));
  assert.equal(furniture.length, expected.length);
  assert.ok(!geometry.some(item => item.id.includes("induck_plush")));
  for (const item of geometry) {
    for (const ring of item.rings) {
      assert.equal(ring.length, 4);
      assert.ok(ring.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)));
    }
  }
});

test("room exit POI follows the authoritative exit position", () => {
  const source = createRoomMapDataSource("ROOM_CLUBHOUSE_01");
  const exit = source.poiRegistry().get("room.exit");
  assert.deepEqual({ x: exit.x, z: exit.z }, CLUB_ROOM_EXIT.position);
  assert.equal(exit.kind, "EXIT");
  assert.equal(exit.iconKey, "exit");
  assert.equal(source.refreshState().length, 1);
});

test("unknown room ids do not invent interior maps", () => {
  assert.equal(createRoomMapDataSource("ROOM_UNKNOWN"), null);
});

test("saved Collection furniture refreshes the cached personal room map and clears across rooms", () => {
  const personal = createRoomMapDataSource("ROOM_PERSONAL_BASIC"), club = createRoomMapDataSource("ROOM_CLUBHOUSE_01");
  const base = personal.geometry(), clubGeometry = club.geometry();
  const object = { id:"11111111-1111-4111-8111-111111111111",itemId:"furniture.induck_chair",surface:"floor",x:-2,z:-1,yaw:45 };
  setPersonalRoomMapFurniture([object]);
  try {
    const geometry = personal.geometry();
    assert.equal(createRoomMapDataSource("ROOM_PERSONAL_BASIC"),personal);
    assert.equal(personal.geometry(),geometry,"geometry identity is stable between updates");
    assert.equal(geometry.length,base.length+1);
    assert.equal(personal.status().geometryCount,geometry.length);
    const owned = geometry.find(item=>item.source === "COLLECTION_FURNITURE");
    assert.equal(owned.id,`room.ROOM_PERSONAL_BASIC.owned.${object.id}`);
    assert.ok(owned.rings[0].every(point=>Number.isFinite(point.x)&&Number.isFinite(point.z)));
    assert.equal(club.geometry(),clubGeometry,"other interiors keep their own geometry");
  } finally { setPersonalRoomMapFurniture([]); }
  assert.deepEqual(personal.geometry(),base,"leaving/rebinding never leaks another owner's placement");
});


test("housing lobby and personal room maps follow their authoritative bounds and exits", () => {
  for (const [roomId, layout, exit] of [
    ["ROOM_DORM1_LOBBY", DORM_1_LOBBY, DORM_1_LOBBY_EXIT],
    ["ROOM_PERSONAL_BASIC", PERSONAL_ROOM_BASIC, PERSONAL_ROOM_BASIC_EXIT]
  ]) {
    const source = createRoomMapDataSource(roomId);
    assert.ok(source, roomId);
    assert.deepEqual(source.bounds, {
      minX: -layout.halfWidth, maxX: layout.halfWidth,
      minZ: -layout.halfDepth, maxZ: layout.halfDepth
    });
    assert.deepEqual(
      { x: source.poiRegistry().get("room.exit").x, z: source.poiRegistry().get("room.exit").z },
      exit.position
    );
    assert.ok(source.geometry().some(item => item.kind === ROOM_MAP_GEOMETRY_KIND.ROOM_FLOOR));
  }
});
