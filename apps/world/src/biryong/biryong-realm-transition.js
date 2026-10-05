// Engine-free Campus <-> Biryong Realm transition state.
// The world adapter owns scene roots, presence and movement space.
import { WORLD_REGION_ID } from "../regions/world-region-registry.js";
import { BIRYONG_STATION_SPAWN } from "./biryong-realm-layout.js";

export const BIRYONG_REGION_TRANSITION_COOLDOWN_MS = 800;

export function createBiryongRealmTransition({
  world,
  campusReturnAnchor,
  clock = { now: () => Date.now() },
  fade = run => run(),
  onBusyChange = () => {}
} = {}) {
  if (!world || !campusReturnAnchor) throw new TypeError("Biryong realm transition dependencies required");

  let regionId = WORLD_REGION_ID.CAMPUS;
  let busy = false;
  let cooldownUntil = 0;
  const listeners = new Set();
  const stats = { enters: 0, exits: 0 };

  const ready = () => !busy && clock.now() >= cooldownUntil;
  const setBusy = next => {
    const value = Boolean(next);
    if (value === busy) return false;
    busy = value;
    onBusyChange(value);
    return true;
  };
  const status = () => Object.freeze({
    regionId,
    inCampus: regionId === WORLD_REGION_ID.CAMPUS,
    inBiryong: regionId === WORLD_REGION_ID.BIRYONG_REALM,
    busy,
    ready: ready(),
    stats: Object.freeze({ ...stats })
  });
  const emit = event => {
    const snapshot = status();
    for (const listener of listeners) {
      try { listener(snapshot, event); } catch { /* observer failure never blocks travel */ }
    }
  };

  function enter() {
    if (regionId !== WORLD_REGION_ID.CAMPUS || !ready()) return false;
    setBusy(true);
    fade(() => {
      world.leaveCampus();
      world.showBiryong();
      world.placePlayer(BIRYONG_STATION_SPAWN, BIRYONG_STATION_SPAWN.yaw);
      regionId = WORLD_REGION_ID.BIRYONG_REALM;
      stats.enters += 1;
      cooldownUntil = clock.now() + BIRYONG_REGION_TRANSITION_COOLDOWN_MS;
      setBusy(false);
      emit("enter");
    });
    return true;
  }

  function returnToCampus() {
    if (regionId !== WORLD_REGION_ID.BIRYONG_REALM || !ready()) return false;
    setBusy(true);
    fade(() => {
      world.showCampus();
      world.placePlayer(campusReturnAnchor, campusReturnAnchor.yaw ?? 0);
      regionId = WORLD_REGION_ID.CAMPUS;
      world.resumeCampus();
      stats.exits += 1;
      cooldownUntil = clock.now() + BIRYONG_REGION_TRANSITION_COOLDOWN_MS;
      setBusy(false);
      emit("exit");
    });
    return true;
  }

  return {
    enter,
    returnToCampus,
    status,
    get regionId() { return regionId; },
    get inCampus() { return regionId === WORLD_REGION_ID.CAMPUS; },
    get inBiryong() { return regionId === WORLD_REGION_ID.BIRYONG_REALM; },
    get busy() { return busy; },
    onChange(listener) {
      if (typeof listener !== "function") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
