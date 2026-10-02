// INHA WORLD Player Auto Move P0 + P1-A.
// Owns the local auto-move session lifecycle, pause/resume, manual-pause wiring,
// route-following intent and bounded stuck recovery. It never writes the player transform:
// PlayerController remains the sole movement/collision authority.

import { metersToWorld } from "../world-scale.js";

export const AUTO_MOVE_STATUS = Object.freeze({
  IDLE: "IDLE",
  PREPARING: "PREPARING",
  MOVING: "MOVING",
  PAUSED: "PAUSED",
  CANCELLED: "CANCELLED"
});

export const AUTO_MOVE_CANCEL_REASON = Object.freeze({
  MANUAL_INPUT: "manual_input",
  INTERACTION: "interaction",
  TRANSPORT: "transport",
  USER_CANCEL: "user_cancel",
  DESTINATION_CHANGED: "destination_changed",
  NAVIGATION_CLEARED: "navigation_cleared",
  NAVIGATION_PAUSED: "navigation_paused",
  ARRIVED: "arrived",
  ASSIST_CONFLICT: "assist_conflict",
  STUCK: "stuck"
});

export const AUTO_MOVE_DEFAULTS = Object.freeze({
  stuckMs: 2500,
  stuckProgressMeters: 0.5,
  maxReroutes: 1
});

const finitePoint = value => Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.z);
const editableTarget = target => target?.closest?.("input, textarea, select, [contenteditable]") != null;
const MANUAL_KEYS = new Set([
  "KeyW", "KeyA", "KeyS", "KeyD",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
  "Space"
]);

export function autoMoveIntent(navigationSnapshot, position) {
  if (navigationSnapshot?.status !== "GUIDING" || !finitePoint(position)) return null;
  const waypoint = navigationSnapshot.nextWaypoint;
  if (!finitePoint(waypoint)) return null;
  const dx = waypoint.x - position.x;
  const dz = waypoint.z - position.z;
  const length = Math.hypot(dx, dz);
  if (length <= 1e-6) return null;
  // Existing PlayerController speed, collision, facing and character animation remain authoritative.
  return Object.freeze({ x: dx / length, z: dz / length, sprint: false });
}

export function createPlayerAutoMove({
  setAssist = () => {},
  clearAssist = () => {},
  requestReroute = () => false,
  clock = { now: () => Date.now() },
  ...options
} = {}) {
  const config = Object.freeze({ ...AUTO_MOVE_DEFAULTS, ...options });
  const listeners = new Set();
  let progressCheckpoint = null;
  let rerouteAttempts = 0;
  let state = Object.freeze({
    status: AUTO_MOVE_STATUS.IDLE,
    active: false,
    destinationId: null,
    destinationTitle: null,
    destinationPosition: null,
    startedAt: null,
    cancelReason: null,
    pauseReason: null,
    rerouteAttempts: 0
  });

  const emit = event => {
    const snapshot = state;
    for (const listener of listeners) {
      try { listener(snapshot, event); } catch { /* local UI listeners are isolated */ }
    }
  };

  function start(navigationSnapshot) {
    const destination = navigationSnapshot?.destination;
    if (navigationSnapshot?.status !== "GUIDING" || !destination?.id || !finitePoint(destination) ||
        !finitePoint(navigationSnapshot.nextWaypoint)) return false;

    clearAssist();
    progressCheckpoint = null;
    rerouteAttempts = 0;
    const base = {
      active: true,
      destinationId: destination.id,
      destinationTitle: destination.title ?? "목적지",
      destinationPosition: Object.freeze({ x: destination.x, z: destination.z }),
      startedAt: clock.now(),
      cancelReason: null,
      pauseReason: null,
      rerouteAttempts: 0
    };
    state = Object.freeze({ status: AUTO_MOVE_STATUS.PREPARING, ...base });
    emit("start");
    state = Object.freeze({ status: AUTO_MOVE_STATUS.MOVING, ...base });
    emit("ready");
    return true;
  }

  function pause(reason = AUTO_MOVE_CANCEL_REASON.USER_CANCEL) {
    if (!state.active) return false;
    clearAssist();
    progressCheckpoint = null;
    state = Object.freeze({
      ...state,
      status: AUTO_MOVE_STATUS.PAUSED,
      active: false,
      cancelReason: null,
      pauseReason: reason
    });
    emit("pause");
    return true;
  }

  function resume(navigationSnapshot) {
    if (state.status !== AUTO_MOVE_STATUS.PAUSED) return false;
    const destination = navigationSnapshot?.destination;
    if (navigationSnapshot?.status !== "GUIDING" || !destination?.id ||
        destination.id !== state.destinationId || !finitePoint(destination) ||
        !finitePoint(navigationSnapshot.nextWaypoint)) return false;

    clearAssist();
    progressCheckpoint = null;
    rerouteAttempts = 0;
    state = Object.freeze({
      ...state,
      status: AUTO_MOVE_STATUS.MOVING,
      active: true,
      cancelReason: null,
      pauseReason: null,
      rerouteAttempts: 0
    });
    emit("resume");
    return true;
  }

  // Permanent end of this Auto Move session. Navigation guidance may remain unless its owner clears it.
  function cancel(reason = AUTO_MOVE_CANCEL_REASON.USER_CANCEL) {
    if (state.status === AUTO_MOVE_STATUS.IDLE || state.status === AUTO_MOVE_STATUS.CANCELLED) return false;
    clearAssist();
    progressCheckpoint = null;
    state = Object.freeze({
      ...state,
      status: AUTO_MOVE_STATUS.CANCELLED,
      active: false,
      cancelReason: reason,
      pauseReason: null
    });
    emit("cancel");
    return true;
  }

  function syncNavigation(navigationSnapshot) {
    const resumable = state.active || state.status === AUTO_MOVE_STATUS.PAUSED;
    if (!resumable) return false;
    const destination = navigationSnapshot?.destination;
    if (!destination) return cancel(AUTO_MOVE_CANCEL_REASON.NAVIGATION_CLEARED);
    if (destination.id !== state.destinationId) return cancel(AUTO_MOVE_CANCEL_REASON.DESTINATION_CHANGED);
    if (navigationSnapshot.status === "ARRIVED") return cancel(AUTO_MOVE_CANCEL_REASON.ARRIVED);
    if (navigationSnapshot.status === "PAUSED") {
      return state.active ? pause(AUTO_MOVE_CANCEL_REASON.NAVIGATION_PAUSED) : false;
    }
    return false;
  }

  function update(navigationSnapshot, position) {
    // Do not clear the shared assist while idle/paused: Follow uses the same PlayerController channel.
    if (!state.active) return false;
    if (syncNavigation(navigationSnapshot)) return false;
    const intent = autoMoveIntent(navigationSnapshot, position);
    if (!intent) {
      clearAssist();
      return false;
    }

    const now = clock.now();
    const threshold = metersToWorld(config.stuckProgressMeters);
    if (!progressCheckpoint || !finitePoint(position) ||
        Math.hypot(position.x - progressCheckpoint.x, position.z - progressCheckpoint.z) >= threshold) {
      progressCheckpoint = finitePoint(position) ? { x: position.x, z: position.z, at: now } : null;
    } else if (now - progressCheckpoint.at >= config.stuckMs) {
      clearAssist();
      if (rerouteAttempts < config.maxReroutes) {
        rerouteAttempts += 1;
        progressCheckpoint = { x: position.x, z: position.z, at: now };
        state = Object.freeze({ ...state, rerouteAttempts });
        if (requestReroute(navigationSnapshot.destination, position) === true) {
          emit("reroute");
          return false;
        }
      }
      cancel(AUTO_MOVE_CANCEL_REASON.STUCK);
      return false;
    }

    setAssist(intent);
    return true;
  }

  return Object.freeze({
    start,
    pause,
    resume,
    cancel,
    syncNavigation,
    update,
    snapshot: () => state,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    config,
    get active() { return state.active; },
    get paused() { return state.status === AUTO_MOVE_STATUS.PAUSED; }
  });
}

export function bindAutoMoveManualCancellation({
  autoMove,
  windowTarget = globalThis.window,
  joystick = null,
  jumpButton = null,
  descendButton = null,
  shouldIgnoreEscape = () => false
} = {}) {
  if (!autoMove?.pause || !windowTarget?.addEventListener) return () => {};

  const onKeyDown = event => {
    if (!autoMove.active || editableTarget(event.target)) return;
    if (MANUAL_KEYS.has(event.code)) {
      autoMove.pause(AUTO_MOVE_CANCEL_REASON.MANUAL_INPUT);
      return;
    }
    if (event.code === "KeyF") {
      autoMove.pause(AUTO_MOVE_CANCEL_REASON.INTERACTION);
      return;
    }
    if (event.code === "KeyM") {
      autoMove.pause(AUTO_MOVE_CANCEL_REASON.TRANSPORT);
      return;
    }
    if (event.code === "Escape" && shouldIgnoreEscape() !== true) {
      autoMove.pause(AUTO_MOVE_CANCEL_REASON.USER_CANCEL);
    }
  };
  const onPointerDown = () => {
    if (autoMove.active) autoMove.pause(AUTO_MOVE_CANCEL_REASON.MANUAL_INPUT);
  };

  windowTarget.addEventListener("keydown", onKeyDown);
  for (const target of [joystick, jumpButton, descendButton]) target?.addEventListener?.("pointerdown", onPointerDown);

  return () => {
    windowTarget.removeEventListener?.("keydown", onKeyDown);
    for (const target of [joystick, jumpButton, descendButton]) target?.removeEventListener?.("pointerdown", onPointerDown);
  };
}
