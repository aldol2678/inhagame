import { HUMAN_HEIGHT } from '../src/player-dimensions.js';

// Procedural NPCs were authored in a local modelling space whose nominal
// standing silhouette is 2.37 units tall. Convert that space into the same
// world-height contract used by the player, while preserving roster height
// as a relative multiplier (0.94..1.06 in the current roster).
export const NPC_NOMINAL_MODEL_HEIGHT = 2.37;
export const NPC_NAMEPLATE_MODEL_Y = 2.46;
export const NPC_SEAT_ANCHOR_MODEL_Y = 0.85;

export function npcWorldScale(relativeHeight = 1) {
  return HUMAN_HEIGHT / NPC_NOMINAL_MODEL_HEIGHT * relativeHeight;
}

export function npcStandingHeight(relativeHeight = 1) {
  return NPC_NOMINAL_MODEL_HEIGHT * npcWorldScale(relativeHeight);
}

export function npcNameplateOffset(relativeHeight = 1) {
  return NPC_NAMEPLATE_MODEL_Y * npcWorldScale(relativeHeight);
}

export function npcSeatAnchorHeight(relativeHeight = 1) {
  return NPC_SEAT_ANCHOR_MODEL_Y * npcWorldScale(relativeHeight);
}
