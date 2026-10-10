// Room-local seats share the campus pose/interaction controller, never campus coordinates.
// Only known rendered furniture can create anchors; layout ownership stays server-authoritative.
import { GROUND_ORIGIN_Y, SIT_HIP_HEIGHT, SEAT_INTERACT_RANGE } from "../seat-anchors.js";
import { WALK_SHAPE, HUMAN_HEIGHT } from "../player-dimensions.js";
import { FURNITURE_BY_ID, furnitureBox, FURNITURE_UUID } from "./furniture-layout.js";
import { PERSONAL_ROOM_BASIC_FURNITURE, PERSONAL_ROOM_BASIC_OBSTACLES,
  PERSONAL_ROOM_BASIC_BOUNDS, PERSONAL_ROOM_BASIC_SPAWN } from "./personal-room-layout.js";

export const PERSONAL_ROOM_SEAT_TOP = Object.freeze({
  // Fixed chair fallback: centre .24 + thickness .06 / 2. KayKit chair uses the same seat band.
  fixed: .27,
  "furniture.induck_chair": .34,
  "furniture.dorm_single_sofa": .36
});
const CLEARANCE = WALK_SHAPE.radius + .10;
export const personalRoomSeatZone = roomId => typeof roomId === "string" && FURNITURE_UUID.test(roomId.toLowerCase())
  ? `ROOM_${roomId.replaceAll("-", "").toUpperCase()}` : null;

export function roomSeatPointIsClear(point, obstacles = [], bounds = PERSONAL_ROOM_BASIC_BOUNDS) {
  if (!point || ![point.x, point.z].every(Number.isFinite) || point.x < bounds.minX || point.x > bounds.maxX ||
      point.z < bounds.minZ || point.z > bounds.maxZ) return false;
  return !obstacles.some(box => box.minY < HUMAN_HEIGHT && box.maxY > .03 &&
    point.x > box.minX - WALK_SHAPE.radius && point.x < box.maxX + WALK_SHAPE.radius &&
    point.z > box.minZ - WALK_SHAPE.radius && point.z < box.maxZ + WALK_SHAPE.radius);
}

// The full segment to the front of a seat must be clear, so F cannot reach through another prop.
const approachIsClear = (position, stand, obstacles, ownId) => {
  if (!position) return true;
  const steps = Math.max(1, Math.ceil(Math.hypot(position.x - stand.x, position.z - stand.z) / .08));
  const blockers = obstacles.filter(box => box.id !== ownId);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    if (!roomSeatPointIsClear({ x: position.x + (stand.x - position.x) * t,
      z: position.z + (stand.z - position.z) * t }, blockers)) return false;
  }
  return true;
};

export function personalRoomSeatAnchors({ roomId, objects = [], obstacles = null, position = null } = {}) {
  const placeZoneId = personalRoomSeatZone(roomId);
  if (!placeZoneId) return [];
  const blockers = obstacles ?? [...PERSONAL_ROOM_BASIC_OBSTACLES,
    ...objects.filter(object => object.surface === "floor" && FURNITURE_BY_ID.get(object.itemId)?.solid).map(furnitureBox)];
  const chair = PERSONAL_ROOM_BASIC_FURNITURE.find(item => item.id === "chair");
  const sources = [{ id: "fixed-chair", obstacleId: "personal_chair", x: chair.at[0], z: chair.at[2],
    yaw: 0, depth: chair.size[2], top: chair.at[1] + PERSONAL_ROOM_SEAT_TOP.fixed }];
  for (const object of objects) {
    const item = FURNITURE_BY_ID.get(object.itemId), top = PERSONAL_ROOM_SEAT_TOP[object.itemId];
    if (top === undefined || !item || object.surface !== "floor" || !FURNITURE_UUID.test(object.id ?? "") ||
      ![object.x, object.z, object.yaw].every(Number.isFinite) || object.yaw < 0 || object.yaw >= 360 || object.yaw % 45) continue;
    const bounds = furnitureBox(object);
    sources.push({ ...object, obstacleId: object.id, depth: item.depth, bounds, top: bounds.minY + top });
  }
  return sources.flatMap(source => {
    if (position && Math.hypot(position.x - source.x, position.z - source.z) > SEAT_INTERACT_RANGE) return [];
    // Both rendered chairs and the sofa have their backrest at local +Z (face local -Z).
    const yaw = (source.yaw + 180) % 360, rad = yaw * Math.PI / 180;
    const front = { x: Math.sin(rad), z: Math.cos(rad) };
    // Movement uses conservative world-axis boxes even for 45° placements. Step beyond that
    // expanded box, not merely the rotated visual cushion, before resuming collision physics.
    const distance = source.bounds ? Math.min(
      Math.abs(front.x) > 1e-6 ? ((source.bounds.maxX - source.bounds.minX) / 2 + CLEARANCE) / Math.abs(front.x) : Infinity,
      Math.abs(front.z) > 1e-6 ? ((source.bounds.maxZ - source.bounds.minZ) / 2 + CLEARANCE) / Math.abs(front.z) : Infinity
    ) : source.depth / 2 + CLEARANCE;
    const standPoint = { x: source.x + front.x * distance, y: GROUND_ORIGIN_Y,
      z: source.z + front.z * distance };
    if (!roomSeatPointIsClear(standPoint, blockers) || !approachIsClear(position, standPoint, blockers, source.obstacleId)) return [];
    return [Object.freeze({
      id: `SEAT_${placeZoneId}_${source.id}`, interactableId: source.id, type: "seat", placeZoneId,
      roomId: roomId.toLowerCase(), obstacleId: source.obstacleId, yaw, approachDirection: Object.freeze(front),
      position: Object.freeze({ x: source.x, y: GROUND_ORIGIN_Y + source.top - SIT_HIP_HEIGHT, z: source.z }),
      standPoint: Object.freeze(standPoint)
    })];
  });
}

// Layout edits may remove/move a occupied chair or block its original front. Choose a clear floor
// point using the current collision set, with the reserved entrance as a final safety fallback.
export function resolveRoomSeatStandPoint(anchor, obstacles = []) {
  if (roomSeatPointIsClear(anchor.standPoint, obstacles)) return anchor.standPoint;
  for (const distance of [.7, 1, 1.4]) for (const offset of [0, -45, 45, -90, 90, 180]) {
    const rad = (anchor.yaw + offset) * Math.PI / 180;
    const point = { x: anchor.position.x + Math.sin(rad) * distance, y: GROUND_ORIGIN_Y,
      z: anchor.position.z + Math.cos(rad) * distance };
    if (roomSeatPointIsClear(point, obstacles)) return point;
  }
  return { ...PERSONAL_ROOM_BASIC_SPAWN.position };
}
