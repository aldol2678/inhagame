// Club Room P0 · ROOM_CLUBHOUSE_01 layout data (no rendering, no engine).
//
// A room has its own local frame: centre (0, 0, 0), x east, z north, floor at y = 0, in the same
// world units as the campus (1 unit ≈ 2 m, player origin 1.15 above the feet). It is a separate
// scene, never a hidden box placed somewhere under or beside the campus map.
// The door is on the south wall; the room is roughly 18 m × 13 m with a 3.2 m ceiling.

import { PLAYER_ORIGIN_Y, WALK_SHAPE } from "../player-dimensions.js";

export const CLUB_ROOM = Object.freeze({
  halfWidth: 4.5,   // x: −4.5 … 4.5
  halfDepth: 3.25,  // z: −3.25 … 3.25
  ceiling: 1.6,
  wall: 0.3,
  door: Object.freeze({ x: 0, width: 1.0, height: 1.1 })
});

const { halfWidth: W, halfDepth: D, ceiling: H, wall: T } = CLUB_ROOM;

// Just inside the door, facing into the room (+z). Outside the exit radius, so arriving never
// offers "나가기" before the player has moved.
export const CLUB_ROOM_SPAWN = Object.freeze({ position: Object.freeze({ x: 0, y: PLAYER_ORIGIN_Y, z: -1.8 }), yaw: 0 });
// Stand here (inside) to leave.
export const CLUB_ROOM_EXIT = Object.freeze({ id: "CLUB_ROOM_EXIT_DOOR", position: Object.freeze({ x: 0, z: -D + 0.3 }), radius: 1.0 });

// Static furniture. `size` is [x, y, z] in units, `at` is the floor-centre. `collide` marks the
// pieces the player cannot walk through; small decoration is deliberately non-colliding.
export const CLUB_ROOM_FURNITURE = Object.freeze([
  { id: "rug", kind: "rug", at: [0, 0, 0.4], size: [4.4, 0.01, 2.8], color: "#8f3b3b", collide: false },
  { id: "table", kind: "table", at: [0, 0, 0.4], size: [2.2, 0.38, 0.9], color: "#8a5a32", collide: true },
  ...[-0.7, 0, 0.7].flatMap((x, i) => [
    { id: `chair_s${i}`, kind: "chair", at: [x, 0, -0.34], size: [0.38, 0.46, 0.38], yaw: 0, color: "#2f5d8a", collide: false },
    { id: `chair_n${i}`, kind: "chair", at: [x, 0, 1.14], size: [0.38, 0.46, 0.38], yaw: 180, color: "#2f5d8a", collide: false }
  ]),
  { id: "sofa", kind: "sofa", at: [-3.75, 0, 0.4], size: [2.2, 0.46, 0.9], yaw: 90, color: "#3d6b5a", collide: true },
  { id: "side_table", kind: "side_table", at: [-3.8, 0, 1.95], size: [0.5, 0.3, 0.5], color: "#6d4527", collide: true },
  { id: "bookshelf", kind: "bookshelf", at: [-2.2, 0, D - 0.25], size: [1.8, 1.1, 0.4], color: "#5c3b22", collide: true },
  { id: "cabinet", kind: "cabinet", at: [2.4, 0, D - 0.26], size: [1.2, 0.8, 0.44], color: "#7b8794", collide: true },
  { id: "plant", kind: "plant", at: [3.9, 0, -2.7], size: [0.4, 0.7, 0.4], color: "#3f7d3a", collide: true },
  { id: "noticeboard", kind: "noticeboard", at: [W - 0.04, 0.55, 0.4], size: [0.05, 0.6, 1.6], color: "#b98b5a", collide: false },
  { id: "induck_plush", kind: "plush", at: [-3.62, 0.46, 0.95], size: [0.3, 0.3, 0.3], color: "#fff2a8", collide: false }
]);

const boxOf = (id, minX, maxX, minZ, maxZ, minY, maxY) => Object.freeze({ id, minX, maxX, minZ, maxZ, minY, maxY });

// Axis-aligned footprint of a floor piece (yaw 0/90/180/270 only).
function footprint(item) {
  const [x, , z] = item.at;
  const turned = Math.abs(((item.yaw ?? 0) % 180)) === 90;
  const sx = turned ? item.size[2] : item.size[0], sz = turned ? item.size[0] : item.size[2];
  return { minX: x - sx / 2, maxX: x + sx / 2, minZ: z - sz / 2, maxZ: z + sz / 2 };
}

// Walls (full height, thicker than a step), the ceiling slab (caps jumps and the camera) and the
// colliding furniture. Campus colliders never enter this list.
export const CLUB_ROOM_OBSTACLES = Object.freeze([
  boxOf("club_wall_south", -W - T, W + T, -D - T, -D, 0, H + 0.4),
  boxOf("club_wall_north", -W - T, W + T, D, D + T, 0, H + 0.4),
  boxOf("club_wall_west", -W - T, -W, -D - T, D + T, 0, H + 0.4),
  boxOf("club_wall_east", W, W + T, -D - T, D + T, 0, H + 0.4),
  boxOf("club_ceiling", -W - T, W + T, -D - T, D + T, H, H + 0.3),
  ...CLUB_ROOM_FURNITURE.filter((f) => f.collide).map((f) => {
    const p = footprint(f);
    return boxOf(`club_${f.id}`, p.minX, p.maxX, p.minZ, p.maxZ, 0, f.at[1] + f.size[1]);
  })
]);

// Hard clamp for the player's centre: never past the inner wall faces.
export const CLUB_ROOM_BOUNDS = Object.freeze({
  minX: -W + WALK_SHAPE.radius, maxX: W - WALK_SHAPE.radius,
  minZ: -D + WALK_SHAPE.radius, maxZ: D - WALK_SHAPE.radius
});
