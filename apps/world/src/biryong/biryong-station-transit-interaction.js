import { PLAYER_ORIGIN_Y } from "../player-dimensions.js";
import { BIRYONG_STATION_RETURN_STOP } from "./biryong-realm-layout.js";

export const BIRYONG_STATION_TRANSIT_CONTEXT_PRIORITY = 180;

export function createBiryongStationTransitInteraction({
  getPosition, getState, returnToCampus
} = {}) {
  if (![getPosition, getState, returnToCampus].every(fn => typeof fn === "function")) {
    throw new TypeError("Biryong station transit interaction dependencies required");
  }

  let nearby = false;
  let distance = Infinity;

  function eligible(position, state = {}) {
    distance = position && [position.x, position.y, position.z].every(Number.isFinite)
      ? Math.hypot(position.x - BIRYONG_STATION_RETURN_STOP.x, position.z - BIRYONG_STATION_RETURN_STOP.z)
      : Infinity;
    if (distance > BIRYONG_STATION_RETURN_STOP.interactionRadius) return false;
    if (state.grounded !== true || state.blocked !== false) return false;
    return Math.abs(position.y - PLAYER_ORIGIN_Y) < 0.15;
  }

  function trigger() {
    if (!eligible(getPosition(), getState())) return false;
    return returnToCampus() === true;
  }

  return {
    observe(position, state) {
      nearby = eligible(position, state);
      return nearby ? {
        id: "biryong-station-transit",
        icon: "🚌",
        label: "F1 · 인하대후문행 탑승",
        compactLabel: "후문행",
        shortcut: "F",
        priority: BIRYONG_STATION_TRANSIT_CONTEXT_PRIORITY,
        distance,
        disabled: false,
        trigger
      } : null;
    },
    trigger,
    status: () => Object.freeze({ nearby, distance: Number.isFinite(distance) ? distance : null })
  };
}
