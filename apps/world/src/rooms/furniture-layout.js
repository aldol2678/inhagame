// Collection-backed housing placements. Keep dimensions in sync with world_room_furniture_v1 SQL.
// Coordinates are room-local; height is derived from the surface, never supplied by a player.
import { getItemDefinition } from "../collection/item-catalog.js";
import { PERSONAL_ROOM_BASIC_FURNITURE, PERSONAL_ROOM_PLACEMENT_ENVELOPE } from "./personal-room-layout.js";

const definition = (itemId, width, height, depth, surfaces, solid = true, flat = false) => Object.freeze({
  itemId, width, height, depth, surfaces: Object.freeze(surfaces), solid, flat,
  name: getItemDefinition(itemId)?.displayName ?? itemId
});
export const ROOM_FURNITURE = Object.freeze([
  definition("furniture.campus_map_poster", .9, .65, .04, ["north", "east", "south", "west"], false),
  definition("furniture.induck_cushion", .45, .14, .4, ["floor", "bed"]),
  definition("furniture.dorm_desk_lamp", .22, .45, .22, ["desk", "floor"]),
  definition("furniture.induck_chair", .6, .65, .65, ["floor"]),
  definition("furniture.mini_induck", .22, .28, .22, ["desk", "floor"]),
  definition("furniture.campus_rug_blue", 2, .02, 1.5, ["floor"], false, true),
  definition("furniture.dorm_resident_plate", .6, .22, .04, ["north", "east", "south", "west"], false),
  definition("furniture.mcm_2026_landlord_figure", .32, .35, .32, ["desk", "floor"]),
  definition("furniture.mcm_2026_poster", 1, .75, .04, ["north", "east", "south", "west"], false),
  definition("furniture.dorm_single_sofa", 1.10, .72, .78, ["floor"]),
  definition("furniture.dorm_side_table_low", .65, .38, .65, ["floor"]),
  definition("furniture.dorm_bookshelf_slim", .75, 1.25, .35, ["floor"]),
  definition("furniture.dorm_plant_medium", .55, .80, .55, ["floor"]),
  definition("furniture.dorm_monitor", .52, .36, .18, ["desk"]),
  definition("furniture.dorm_trophy_shelf", .90, 1.10, .32, ["floor"]),
  definition("furniture.study_books_set", .38, .18, .22, ["desk"])
]);
export const FURNITURE_BY_ID = new Map(ROOM_FURNITURE.map(item => [item.itemId, item]));
export const FURNITURE_LIMIT = 32;
export const FURNITURE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SURFACE_NAMES = Object.freeze({ floor: "바닥", desk: "책상 위", bed: "침대 위", north: "창문 쪽 벽", east: "오른쪽 벽", south: "문 쪽 벽", west: "왼쪽 벽" });
const WALL_YAW = Object.freeze({ north: 0, east: 90, south: 180, west: 270 });
const { floor: PLACEMENT_FLOOR, exit: PLACEMENT_EXIT, wall: PLACEMENT_WALL } = PERSONAL_ROOM_PLACEMENT_ENVELOPE;
const EPSILON = 1e-7;
export const snapFurniture = value => Math.round(value * 4) / 4;
export function positionOnSurface(surface, x, z, yaw = 0) {
  return {
    x: surface === "east" ? PLACEMENT_WALL.eastX : surface === "west" ? PLACEMENT_WALL.westX : snapFurniture(x),
    z: surface === "north" ? PLACEMENT_WALL.northZ : surface === "south" ? PLACEMENT_WALL.southZ : snapFurniture(z),
    yaw: WALL_YAW[surface] ?? ((Math.round(yaw / 45) * 45 % 360) + 360) % 360
  };
}
export function furnitureBox(object) {
  const item = FURNITURE_BY_ID.get(object.itemId);
  if (!item) return null;
  const rad = object.yaw * Math.PI / 180;
  const width = Math.abs(Math.cos(rad)) * item.width + Math.abs(Math.sin(rad)) * item.depth;
  const depth = Math.abs(Math.sin(rad)) * item.width + Math.abs(Math.cos(rad)) * item.depth;
  const y = object.surface === "desk" ? .48 : object.surface === "bed" ? .43 : WALL_YAW[object.surface] !== undefined ? 1.35 - item.height / 2 : .025;
  return { id: object.id, minX: object.x - width / 2, maxX: object.x + width / 2,
    minZ: object.z - depth / 2, maxZ: object.z + depth / 2, minY: y, maxY: y + item.height };
}
const overlaps = (a, b) => a.minX < b.maxX - EPSILON && a.maxX > b.minX + EPSILON && a.minZ < b.maxZ - EPSILON && a.maxZ > b.minZ + EPSILON;
const within = (box, x1, x2, z1, z2) => box.minX >= x1 - EPSILON && box.maxX <= x2 + EPSILON && box.minZ >= z1 - EPSILON && box.maxZ <= z2 + EPSILON;
const fixedBox = item => ({ minX: item.at[0] - item.size[0]/2, maxX: item.at[0] + item.size[0]/2, minZ: item.at[2] - item.size[2]/2, maxZ: item.at[2] + item.size[2]/2 });
export const FURNITURE_ERRORS = Object.freeze({
  INVALID_LAYOUT: "배치 정보를 확인해 주세요.", ITEM_NOT_OWNED: "보유한 수량까지만 배치할 수 있어요.",
  ROOM_BOUNDS: "가구가 방 또는 놓을 곳 밖으로 나갔어요.", EXIT_BLOCKED: "문과 입장 통로는 비워 주세요.",
  FURNITURE_OVERLAP: "다른 가구나 기본 시설과 겹쳤어요.", LAYOUT_CONFLICT: "다른 화면에서 방을 저장했어요. 현재 배치는 유지돼요. 최신 저장을 불러오려면 꾸미기를 닫아 주세요.",
  LAYOUT_DENIED: "이 방을 꾸밀 권한을 확인하지 못했어요.", UNAVAILABLE: "저장하지 못했어요. 배치는 유지돼요. 다시 시도해 주세요."
});
export function validateFurniture(objects, owned = null) {
  if (!Array.isArray(objects) || objects.length > FURNITURE_LIMIT) return "INVALID_LAYOUT";
  const seen = new Set(), counts = new Map(), boxes = [];
  for (const object of objects) {
    const item = FURNITURE_BY_ID.get(object?.itemId);
    if (!object || Object.keys(object).sort().join() !== "id,itemId,surface,x,yaw,z" || !item || !FURNITURE_UUID.test(object.id) || seen.has(object.id) || !item.surfaces.includes(object.surface) ||
      ![object.x, object.z, object.yaw].every(Number.isFinite) || object.yaw < 0 || object.yaw >= 360 || object.yaw % 45 !== 0) return "INVALID_LAYOUT";
    const p = positionOnSurface(object.surface, object.x, object.z, object.yaw);
    if (Math.abs(p.x - object.x) > EPSILON || Math.abs(p.z - object.z) > EPSILON || p.yaw !== object.yaw) return "INVALID_LAYOUT";
    seen.add(object.id);
    counts.set(object.itemId, (counts.get(object.itemId) ?? 0) + 1);
    if (owned && counts.get(object.itemId) > (owned.find(row => row.itemId === object.itemId)?.quantity ?? 0)) return "ITEM_NOT_OWNED";
    const box = furnitureBox(object);
    if (object.surface === "floor") {
      if (!within(box, PLACEMENT_FLOOR.minX, PLACEMENT_FLOOR.maxX, PLACEMENT_FLOOR.minZ, PLACEMENT_FLOOR.maxZ)) return "ROOM_BOUNDS";
      if (overlaps(box, PLACEMENT_EXIT)) return "EXIT_BLOCKED";
      for (const fixed of PERSONAL_ROOM_BASIC_FURNITURE) {
        if ((!fixed.collide && fixed.kind !== "chair" && !(item.flat && fixed.kind === "rug"))) continue;
        if (overlaps(box, fixedBox(fixed))) return "FURNITURE_OVERLAP";
      }
    } else if (object.surface === "desk") {
      if (!within(box, 2.05, 3.85, 1.375, 2.025)) return "ROOM_BOUNDS";
      if (overlaps(box, { minX: 3.09, maxX: 3.51, minZ: 1.56, maxZ: 1.84 })) return "FURNITURE_OVERLAP";
    } else if (object.surface === "bed") {
      if (!within(box, -4.55, -3.05, .6, 3.2)) return "ROOM_BOUNDS";
      if (overlaps(box, { minX: -4.296, maxX: -3.304, minZ: 2.63, maxZ: 3.11 })) return "FURNITURE_OVERLAP";
    } else {
      const horizontal = object.surface === "north" || object.surface === "south";
      const tangent = horizontal ? object.x : object.z, edge = horizontal ? PLACEMENT_WALL.maxX : PLACEMENT_WALL.maxZ;
      if (Math.abs(tangent) + item.width/2 > edge + EPSILON) return "ROOM_BOUNDS";
      if (object.surface === "north" && object.x - item.width/2 < 1.8 && object.x + item.width/2 > -.8) return "FURNITURE_OVERLAP";
      if (object.surface === "south" && Math.abs(object.x) < .68 + item.width/2) return "EXIT_BLOCKED";
    }
    for (const prior of boxes) {
      if (prior.object.surface !== object.surface) continue;
      if (object.surface === "floor" && prior.item.flat !== item.flat) continue;
      if (overlaps(box, prior.box)) return "FURNITURE_OVERLAP";
    }
    boxes.push({ object, item, box });
  }
  return null;
}
export function canonicalFurniture(objects) {
  return objects.map(({ id, itemId, surface, x, z, yaw }) => ({ id, itemId, surface, x, z, yaw })).sort((a,b) => a.id.localeCompare(b.id));
}
export function firstFurniturePosition(itemId, surface, objects, owned) {
  // Prefer a clear floor patch, then scan a bounded grid. No placement without a valid space.
  const id = "00000000-0000-4000-8000-000000000000";
  for (let z = -3.75; z <= 3.75; z += .25) for (let x = -5; x <= 5; x += .25) {
    const candidate = { id, itemId, surface, ...positionOnSurface(surface, x, z) };
    if (!validateFurniture([...objects, candidate], owned)) return candidate;
  }
  return null;
}
