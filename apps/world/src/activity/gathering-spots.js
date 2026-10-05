// Gathering P1 world placement for the first campus leaf source.
// Browser proximity is presentation only. Reward eligibility is re-checked against fresh
// trusted server position evidence before the server settles a harvest.
import { FACILITIES } from "../campus-facilities.js";
import { metersToWorld } from "../world-scale.js";

export const GATHERING_CONTEXT_PRIORITY = 215;
export const GATHERING_TRUST_RADIUS = metersToWorld(4);

const forest = FACILITIES.find(feature => feature.id === "lmk_heidegger_forest");
if (!forest) throw new Error("Heidegger Forest facility missing");

export const GATHERING_SPOTS = Object.freeze([
  Object.freeze({
    sourceRef: "gathering.campus.leaf_pile_01",
    label: "하이데거 숲 낙엽 더미",
    placeZoneId: "AREA_AGORA_6_9",
    position: Object.freeze({ x: forest.center.x, z: forest.center.z }),
    interactionRadius: GATHERING_TRUST_RADIUS
  })
]);

export function getGatheringSpot(sourceRef) {
  return GATHERING_SPOTS.find(spot => spot.sourceRef === sourceRef) ?? null;
}

export function findNearbyGatheringSpot(position, radius = null) {
  if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.z)) return null;
  let best = null;
  for (const spot of GATHERING_SPOTS) {
    const limit = Number.isFinite(radius) && radius > 0 ? radius : spot.interactionRadius;
    const distance = Math.hypot(spot.position.x - position.x, spot.position.z - position.z);
    if (distance <= limit && (!best || distance < best.distance)) best = { spot, distance };
  }
  return best;
}

export function gatheringContextAction(position, {
  available = false,
  blocked = false,
  busy = false,
  onHarvest
} = {}) {
  if (!available || blocked) return null;
  const nearby = findNearbyGatheringSpot(position);
  if (!nearby) return null;
  return {
    id: "campus-gathering",
    icon: "🍂",
    label: busy ? "채집 중…" : "낙엽 줍기",
    shortcut: "F",
    priority: GATHERING_CONTEXT_PRIORITY,
    distance: nearby.distance,
    pressed: false,
    disabled: busy,
    trigger: () => {
      if (busy) return false;
      onHarvest?.(nearby.spot);
      return true;
    }
  };
}
