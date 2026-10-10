// Social S1-D2 · 제1생활관 로비 local interior.
// The lobby is a Housing Hub interior, not a campus AREA_* Place Zone and not a personal room.
// D1.2 keeps it local-only; Room Presence/Reatime arrives in D2 proper.

import { PLAYER_ORIGIN_Y, WALK_SHAPE } from "../player-dimensions.js";

export const DORM_1_LOBBY = Object.freeze({
  // Expanded for future human-scale avatars, wider third-person camera arcs and friend traffic.
  // 1 world unit ≈ 2 m, so door heights remain near real-world scale instead of doubling with the room.
  halfWidth: 7.0,
  halfDepth: 5.4,
  ceiling: 2.2,
  wall: 0.35,
  camera: Object.freeze({ initial: 2.9, min: 1.25, max: 4.6 }),
  campusDoor: Object.freeze({ x: 0, width: 1.6, height: 1.25 }),
  myRoomDoor: Object.freeze({ x: 5.25, z: 5.08, width: 1.15, height: 1.22 }),
  // Housing H3: west-corridor door to friends' rooms. Visits knock here; it clears the directory.
  friendRoomDoor: Object.freeze({ x: -6.05, z: 5.08, width: 1.15, height: 1.22 })
});

const { halfWidth: W, halfDepth: D, ceiling: H, wall: T } = DORM_1_LOBBY;

export const DORM_1_LOBBY_SPAWN = Object.freeze({
  position: Object.freeze({ x: 0, y: PLAYER_ORIGIN_Y, z: -3.7 }),
  yaw: 0
});

export const DORM_1_LOBBY_EXIT = Object.freeze({
  id: "DORM_1_LOBBY_CAMPUS_DOOR",
  position: Object.freeze({ x: 0, z: -D + 0.34 }),
  radius: 1.0
});

// Reserved seam for D1.3 Personal Room. D1.2 renders the door/sign but publishes no action.
export const DORM_1_LOBBY_MY_ROOM = Object.freeze({
  id: "DORM_1_LOBBY_MY_ROOM",
  position: Object.freeze({ x: DORM_1_LOBBY.myRoomDoor.x, z: DORM_1_LOBBY.myRoomDoor.z - 0.18 }),
  radius: 1.0,
  status: "ACTIVE"
});

// Housing H3 · friend visits knock at the west-corridor door instead of appearing in the room.
export const DORM_1_LOBBY_FRIEND_ROOM = Object.freeze({
  id: "DORM_1_LOBBY_FRIEND_ROOM",
  position: Object.freeze({ x: DORM_1_LOBBY.friendRoomDoor.x, z: DORM_1_LOBBY.friendRoomDoor.z - 0.18 }),
  radius: 1.0
});

export const DORM_1_LOBBY_MY_ROOM_RETURN = Object.freeze({
  id: "DORM_1_LOBBY_MY_ROOM_RETURN",
  position: Object.freeze({
    x: DORM_1_LOBBY.myRoomDoor.x - 0.95,
    y: PLAYER_ORIGIN_Y,
    z: DORM_1_LOBBY.myRoomDoor.z - 1.15
  }),
  yaw: -135
});

export const DORM_1_LOBBY_FURNITURE = Object.freeze([
  { id: "reception", at: [0, 0, 1.85], size: [2.8, 0.5, 0.8], kind: "desk", collide: true },
  { id: "bench_w", at: [-5.2, 0, -0.5], size: [2.1, 0.42, 0.68], kind: "bench", collide: true },
  { id: "bench_e", at: [5.2, 0, -0.5], size: [2.1, 0.42, 0.68], kind: "bench", collide: true },
  { id: "noticeboard", at: [-W + 0.04, 1.05, 2.15], size: [0.05, 1.0, 2.0], kind: "noticeboard", collide: false },
  { id: "mailboxes", at: [W - 0.08, 0.78, 2.0], size: [0.12, 1.25, 2.4], kind: "mailboxes", collide: false },
  { id: "plant", at: [5.9, 0, 3.65], size: [0.5, 0.9, 0.5], kind: "plant", collide: true }
]);

const boxOf = (id, minX, maxX, minZ, maxZ, minY, maxY) =>
  Object.freeze({ id, minX, maxX, minZ, maxZ, minY, maxY });

function footprint(item) {
  const [x, , z] = item.at;
  return { minX: x - item.size[0] / 2, maxX: x + item.size[0] / 2,
    minZ: z - item.size[2] / 2, maxZ: z + item.size[2] / 2 };
}

export const DORM_1_LOBBY_OBSTACLES = Object.freeze([
  boxOf("dorm1_lobby_wall_south", -W - T, W + T, -D - T, -D, 0, H + 0.4),
  boxOf("dorm1_lobby_wall_north", -W - T, W + T, D, D + T, 0, H + 0.4),
  boxOf("dorm1_lobby_wall_west", -W - T, -W, -D - T, D + T, 0, H + 0.4),
  boxOf("dorm1_lobby_wall_east", W, W + T, -D - T, D + T, 0, H + 0.4),
  boxOf("dorm1_lobby_ceiling", -W - T, W + T, -D - T, D + T, H, H + 0.3),
  ...DORM_1_LOBBY_FURNITURE.filter(item => item.collide).map(item => {
    const p = footprint(item);
    return boxOf("dorm1_lobby_" + item.id, p.minX, p.maxX, p.minZ, p.maxZ, 0, item.at[1] + item.size[1]);
  })
]);

export const DORM_1_LOBBY_BOUNDS = Object.freeze({
  minX: -W + WALK_SHAPE.radius,
  maxX: W - WALK_SHAPE.radius,
  minZ: -D + WALK_SHAPE.radius,
  maxZ: D - WALK_SHAPE.radius
});
