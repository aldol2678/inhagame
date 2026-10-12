import { BUILDINGS, LIBRARY_FRONT, LIBRARY_ROOF_PARTS } from "../basic-campus.js";
import { LIBRARY_ENTRY_HEIGHT } from "../library-route-layout.js";

// JSL-A virtual tag reader. GAME_ADAPTATION / TEMPORARY:
// JSL-R0 has not confirmed the real gate count, positions or the exterior-to-lobby link, so this
// is one reader in front of the already rendered entry canopy of the canonical bldg_jungseok front
// edge (vertices 6 -> 7, LIBRARY_FRONT). It is derived from that geometry, not a fixed world
// coordinate, and is the only thing to replace once R0 / JSL-B fixes the real anchor.
// Nothing here creates a room, a door collider or an interior connection.
export const JEONGSEOK_GATE_PROVENANCE = Object.freeze({
  buildingId: "bldg_jungseok",
  placeZoneId: "AREA_JUNGSEOK_WOONAM",
  source: "LIBRARY_FRONT (canonical footprint edge 6-7, library_entry_canopy)",
  classification: "GAME_ADAPTATION",
  status: "TEMPORARY",
  realGateLayout: "UNKNOWN_PENDING_JSL_R0",
  interiorLink: "PENDING_JSL_B"
});

const canopy = LIBRARY_ROOF_PARTS.find(part => part.id === "library_entry_canopy");
// Under the canopy, outside the facade: v is the outward offset from the front edge.
const READER_OFFSET = Object.freeze({ u: 0, v: 1.0 }); // on the front landing (LIBRARY_FRONT_STAIR.landing 1.4)
const position = LIBRARY_FRONT.at(READER_OFFSET.u, READER_OFFSET.v);

export const JEONGSEOK_GATE = Object.freeze({
  id: "JEONGSEOK_GATE_READER_TEMP_01",
  ...JEONGSEOK_GATE_PROVENANCE,
  position: Object.freeze({ ...position, y: LIBRARY_ENTRY_HEIGHT }),
  radius: 2.2,
  canopyId: canopy?.id ?? null
});

/** Flat distance to the temporary reader when inside its tag radius, else null. */
export function nearJeongseokGate(point, gate = JEONGSEOK_GATE) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  const distance = Math.hypot(point.x - gate.position.x, point.z - gate.position.z);
  return distance <= gate.radius ? distance : null;
}

export const JEONGSEOK_FOOTPRINT = BUILDINGS.find(b => b.id === "bldg_jungseok").vertices;
