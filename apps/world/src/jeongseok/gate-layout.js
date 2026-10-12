// Game-only anchors in the public part of the 1F lobby. No real gate positions or staff are
// represented. The lobby owns the rendered gate row; these anchors only describe interactions.
export const JEONGSEOK_GATE_PROVENANCE = Object.freeze({
  buildingId: "bldg_jungseok",
  placeZoneId: "AREA_JUNGSEOK_WOONAM",
  source: "JSL_B_LOBBY_GATE_ROW_SLOT_01 (game-adapted lobby)",
  classification: "GAME_ADAPTATION",
  status: "TEMPORARY",
  realGateLayout: "UNKNOWN_PENDING_JSL_R0",
  interiorLink: "PUBLIC_LOBBY_INTERNAL_GATE"
});

export const JEONGSEOK_GATE = Object.freeze({
  id: "JEONGSEOK_LOBBY_GATE_READER_01",
  ...JEONGSEOK_GATE_PROVENANCE,
  space: "ROOM_JEONGSEOK_LOBBY",
  position: Object.freeze({ x: 0, y: 0, z: -4.0 }),
  radius: 1.1,
  publicMaxZ: -3.2
});

export const JEONGSEOK_GUIDE = Object.freeze({
  id: "JEONGSEOK_LOBBY_GUIDE_01",
  space: "ROOM_JEONGSEOK_LOBBY",
  position: Object.freeze({ x: -4.5, y: 0, z: -4.8 }),
  radius: 1.2,
  publicMaxZ: -3.2,
  label: "로비 안내 NPC",
  classification: "GAME_ADAPTATION",
  fictional: true
});

/** Flat distance on the public side of the interaction, otherwise null. Space is checked by the caller. */
export function nearJeongseokGate(point, anchor = JEONGSEOK_GATE) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return null;
  if (Number.isFinite(anchor.publicMaxZ) && point.z > anchor.publicMaxZ) return null;
  const distance = Math.hypot(point.x - anchor.position.x, point.z - anchor.position.z);
  return distance <= anchor.radius ? distance : null;
}
