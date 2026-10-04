// Inkyung pond fishing spots: the world placement of the two F1/F2 source refs.
// Presentation only. Being near a spot decides whether the 🎣 action is offered; the server
// decides everything else (availability, timing, result, rewards). The server does not
// verify position (T1, see activity/fishing-core.md).
import { getCanonicalLandmark, projectPolygon } from "../reality-adapter.js";
import { FISHING_SOURCES } from "./fishing-core.js";

export const FISHING_SPOT_RADIUS = 3;
// Above ordinary duck observation (200), below the rare mechanical duck (240).
export const FISHING_CONTEXT_PRIORITY = 220;
const SHORE_OFFSET = 1.5;

const ring = projectPolygon(getCanonicalLandmark("lmk_inkyung_pond").polygon);
const centroid = {
  x: ring.reduce((sum, p) => sum + p.x, 0) / ring.length,
  z: ring.reduce((sum, p) => sum + p.z, 0) / ring.length
};

// +z is north. Each spot stands just outside the pond tip, facing the water.
function shoreSpot(vertex) {
  const dx = vertex.x - centroid.x, dz = vertex.z - centroid.z, length = Math.hypot(dx, dz);
  const position = Object.freeze({ x: vertex.x + dx / length * SHORE_OFFSET, z: vertex.z + dz / length * SHORE_OFFSET });
  return { position, facingYaw: Math.atan2(-dx, -dz) };
}
const north = shoreSpot(ring.reduce((a, b) => (b.z > a.z ? b : a)));
const south = shoreSpot(ring.reduce((a, b) => (b.z < a.z ? b : a)));

export const FISHING_SPOTS = Object.freeze([
  Object.freeze({ sourceRef: FISHING_SOURCES[0], label: "인경호 북쪽 낚시터", ...north }),
  Object.freeze({ sourceRef: FISHING_SOURCES[1], label: "인경호 남쪽 낚시터", ...south })
]);

export function getFishingSpot(sourceRef) {
  return FISHING_SPOTS.find(spot => spot.sourceRef === sourceRef) ?? null;
}

export function findNearbyFishingSpot(position, radius = FISHING_SPOT_RADIUS) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
  let best = null;
  for (const spot of FISHING_SPOTS) {
    const distance = Math.hypot(spot.position.x - position.x, spot.position.z - position.z);
    if (distance <= radius && (!best || distance < best.distance)) best = { spot, distance };
  }
  return best;
}

// Context action for the shared F slot, or null. `available` comes from the fishing client
// (signed-in permanent account and an enabled server endpoint).
export function fishingContextAction(position, { available, blocked = false, onOpen } = {}) {
  if (!available || blocked) return null;
  const nearby = findNearbyFishingSpot(position);
  if (!nearby) return null;
  return {
    id: "inkyung-fishing",
    icon: "🎣",
    label: "낚시하기",
    shortcut: "F",
    priority: FISHING_CONTEXT_PRIORITY,
    distance: nearby.distance,
    pressed: false,
    trigger: () => onOpen?.(nearby.spot)
  };
}
