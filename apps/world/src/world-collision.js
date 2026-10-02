import { OBSTACLES } from "./campus-layout.js";
import { polygonOverlap, moveAroundPolygons, polygonCameraFraction } from './polygon-collision.js';
import { WALK_SHAPE } from './player-dimensions.js';

const { radius: RADIUS, footOffset: FOOT_OFFSET, headOffset: HEAD_OFFSET } = WALK_SHAPE;
const EPSILON = 0.001;

function horizontalOverlap(x, z, box, radius = RADIUS) {
  if (box.polygon) return polygonOverlap(x, z, box.polygon, radius);
  return x > box.minX - radius && x < box.maxX + radius &&
    z > box.minZ - radius && z < box.maxZ + radius;
}

function verticalOverlap(y, box, footOffset, headOffset) {
  return y - footOffset < box.maxY - EPSILON && y + headOffset > box.minY + EPSILON;
}

// Shape changes must fit before they take effect; swept movement assumes a clear start.
export function canOccupy(position, shape = WALK_SHAPE, obstacles = OBSTACLES) {
  return !obstacles.some(box => verticalOverlap(position.y, box, shape.footOffset, shape.headOffset) &&
    horizontalOverlap(position.x, position.z, box, shape.radius));
}

// Swept, axis-separated collision lets the player slide along a facade even at
// sprint speed, without depending on whether the visible zone mesh is loaded.
export function moveAroundObstacles(position, dx, dz, obstacles = OBSTACLES, { radius = RADIUS, footOffset = FOOT_OFFSET, headOffset = HEAD_OFFSET } = {}) {
  let x = position.x;
  let z = position.z;
  let nextX = x + dx;
  for (const box of obstacles) {
    if (box.polygon) continue;
    if (!verticalOverlap(position.y, box, footOffset, headOffset) || z <= box.minZ - radius || z >= box.maxZ + radius) continue;
    if (dx > 0 && x <= box.minX - radius && nextX > box.minX - radius) nextX = Math.min(nextX, box.minX - radius);
    if (dx < 0 && x >= box.maxX + radius && nextX < box.maxX + radius) nextX = Math.max(nextX, box.maxX + radius);
    if (horizontalOverlap(nextX, z, box, radius) && !horizontalOverlap(x, z, box, radius)) nextX = x;
  }
  x = nextX;
  let nextZ = z + dz;
  for (const box of obstacles) {
    if (box.polygon) continue;
    if (!verticalOverlap(position.y, box, footOffset, headOffset) || x <= box.minX - radius || x >= box.maxX + radius) continue;
    if (dz > 0 && z <= box.minZ - radius && nextZ > box.minZ - radius) nextZ = Math.min(nextZ, box.minZ - radius);
    if (dz < 0 && z >= box.maxZ + radius && nextZ < box.maxZ + radius) nextZ = Math.max(nextZ, box.maxZ + radius);
    if (horizontalOverlap(x, nextZ, box, radius) && !horizontalOverlap(x, z, box, radius)) nextZ = z;
  }
  return moveAroundPolygons(position, x-position.x, nextZ-position.z, obstacles.filter(b=>b.polygon), {radius,footOffset,headOffset});
}

// The underside of an overhead beam limits ascent, and the top of a roof
// supports a flying mount until it moves away. Dismount only at actual ground.
export function resolveHeight(position, requestedY, groundY = FOOT_OFFSET, obstacles = OBSTACLES, { radius = RADIUS, footOffset = FOOT_OFFSET, headOffset = HEAD_OFFSET } = {}) {
  let nextY = Math.max(groundY, requestedY);
  for (const box of obstacles) {
    if (!horizontalOverlap(position.x, position.z, box, radius)) continue;
    const currentFeet = position.y - footOffset;
    const currentHead = position.y + headOffset;
    if (requestedY < position.y && currentFeet >= box.maxY - EPSILON && nextY - footOffset < box.maxY) {
      nextY = Math.max(nextY, box.maxY + footOffset);
    }
    if (requestedY > position.y && currentHead <= box.minY + EPSILON && nextY + headOffset > box.minY) {
      nextY = Math.min(nextY, box.minY - headOffset);
    }
  }
  return nextY;
}

// Segment vs expanded AABB, used to move the chase camera in front of a wall.
export function cameraSafeFraction(from, to, obstacles = OBSTACLES) {
  let fraction = 1;
  for (const box of obstacles) {
    if (box.polygon) { fraction = Math.min(fraction, polygonCameraFraction(from, to, box)); continue; }
    const bounds = [[box.minX - 0.35, box.maxX + 0.35], [box.minY, box.maxY + 0.35], [box.minZ - 0.35, box.maxZ + 0.35]];
    let enter = 0;
    let leave = 1;
    for (let axis = 0; axis < 3; axis++) {
      const a = from[axis], delta = to[axis] - a;
      if (Math.abs(delta) < 1e-8) {
        if (a < bounds[axis][0] || a > bounds[axis][1]) { enter = 2; break; }
      } else {
        const t1 = (bounds[axis][0] - a) / delta;
        const t2 = (bounds[axis][1] - a) / delta;
        enter = Math.max(enter, Math.min(t1, t2));
        leave = Math.min(leave, Math.max(t1, t2));
      }
    }
    if (enter <= leave && enter <= 1 && leave >= 0) fraction = Math.min(fraction, Math.max(0.06, enter - 0.025));
  }
  return fraction;
}
