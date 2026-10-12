// JSL-B · shared engine-free helpers for the Jeongseok interior layouts.
//
// A layout item is an axis-aligned module instance:
//   { id, module, at: [x, y, z] (centre of the footprint, y = bottom), size: [w, h, d],
//     collide, detail: "core" | "decor", trace, ...module params }
// Visual meshes come from the module renderer; collision is the separate AABB derived here, so
// furniture detail can change without touching walkable space.

import { PLAYER_ORIGIN_Y, WALK_SHAPE } from "../player-dimensions.js";

export const ROOM_FLOOR_Y = PLAYER_ORIGIN_Y;
export const CEILING_CAMERA_CLEARANCE = 0.45;
// The shared chase camera keeps a minimum 6 % of its orbit even when it starts against a wall, so
// players stay this far from interior walls and doors/transfers sit just inside that band.
export const WALL_STANDOFF = 0.5;
export const PORTAL_WALL_INSET = 0.55;

export const boxOf = (id, minX, maxX, minZ, maxZ, minY, maxY) =>
  Object.freeze({ id, minX, maxX, minZ, maxZ, minY, maxY });

export function item(id, module, at, size, trace, extra = {}) {
  return Object.freeze({ id, module, at: Object.freeze([...at]), size: Object.freeze([...size]),
    collide: extra.collide ?? true, detail: extra.detail ?? "core", trace, ...extra });
}

export function footprint({ at: [x, , z], size: [w, , d] }) {
  return { minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2 };
}

export const itemObstacle = (prefix, entry) => {
  const p = footprint(entry);
  return boxOf(`${prefix}_${entry.id}`, p.minX, p.maxX, p.minZ, p.maxZ, entry.at[1], entry.at[1] + entry.size[1]);
};

/** Four walls and the ceiling slab of a W x D x H shell (half extents), all solid for camera too. */
export function shellObstacles(prefix, { halfWidth: W, halfDepth: D, ceiling: H, wall: T }) {
  return [
    boxOf(`${prefix}_wall_south`, -W - T, W + T, -D - T, -D, 0, H + 0.4),
    boxOf(`${prefix}_wall_north`, -W - T, W + T, D, D + T, 0, H + 0.4),
    boxOf(`${prefix}_wall_west`, -W - T, -W, -D - T, D + T, 0, H + 0.4),
    boxOf(`${prefix}_wall_east`, W, W + T, -D - T, D + T, 0, H + 0.4),
    // The slab starts below the visual ceiling: the chase camera stops before its near plane can
    // cut through the ceiling. The band is far above the player's head, so walking is unaffected.
    boxOf(`${prefix}_ceiling`, -W - T, W + T, -D - T, D + T, H - CEILING_CAMERA_CLEARANCE, H + 0.3)
  ];
}

export const shellBounds = ({ halfWidth: W, halfDepth: D }) => {
  const margin = Math.max(WALK_SHAPE.radius, WALL_STANDOFF);
  return Object.freeze({ minX: -W + margin, maxX: W - margin, minZ: -D + margin, maxZ: D - margin });
};

export const anchor = (x, z, yaw, trace) =>
  Object.freeze({ position: Object.freeze({ x, y: ROOM_FLOOR_Y, z }), yaw, trace });

// A table with chairs on both long sides. Chairs are their own (small) colliders so aisles stay
// measurable; the table top never blocks the camera above it.
export function tableWithChairs(id, { x, z, width, depth = 1.0, chairsPerSide, alongZ = false, trace,
  module = "open_table", chairModule = "chair", height = 0.38, detail = "core", sides = [-1, 1] }) {
  const items = [item(id, module, [x, 0, z], alongZ ? [depth, height, width] : [width, height, depth], trace, { detail })];
  const pitch = width / chairsPerSide;
  for (const side of sides) {
    for (let i = 0; i < chairsPerSide; i += 1) {
      const t = -width / 2 + pitch * (i + 0.5);
      const off = depth / 2 + 0.24;
      const cx = alongZ ? x + side * off : x + t;
      const cz = alongZ ? z + t : z + side * off;
      items.push(item(`${id}_chair_${side < 0 ? "a" : "b"}${i}`, chairModule, [cx, 0, cz], [0.34, 0.46, 0.34], trace,
        { facing: alongZ ? (side < 0 ? 90 : -90) : (side < 0 ? 0 : 180), detail }));
    }
  }
  return items;
}

export const seatCount = items => items.filter(entry => entry.module === "chair" || entry.module === "mesh_chair"
  || entry.module === "carrel" || entry.module === "standing_desk_slot" || entry.module === "accessible_seat"
  || entry.module === "sofa").reduce((sum, entry) => sum + (entry.seats ?? 1), 0);

export const freezeLayout = layout => Object.freeze({ ...layout,
  items: Object.freeze(layout.items), obstacles: Object.freeze(layout.obstacles), portals: Object.freeze(layout.portals ?? []),
  aisles: Object.freeze(layout.aisles ?? []), zones: Object.freeze(layout.zones ?? []) });
