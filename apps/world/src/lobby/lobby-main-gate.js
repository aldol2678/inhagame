import { MAIN_GATE_SPAWN } from "../campus-spawn.js";
import { setLobbyShellVisible } from "./lobby-shell.js";
import { canStartSpawn } from "./spawn-registry.js";
import { requestLobbyFullscreen } from "./lobby-fullscreen.js";

const SEAMLESS_MAIN_GATE_RADIUS = 0.75;

const alreadyAtTarget = (player, target) => {
  const current = player?.getLocalPosition?.();
  if (!current || !target) return false;
  const dx = Number(current.x) - Number(target.x);
  const dz = Number(current.z) - Number(target.z);
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return false;
  return Math.hypot(dx, dz) <= SEAMLESS_MAIN_GATE_RADIUS;
};

export function enterMainGate({
  player,
  lobbyWorld,
  spawn = MAIN_GATE_SPAWN,
  spawnDefinition = null,
  documentLike = globalThis.document,
  transition = null,
  onEntered = null
} = {}) {
  if (!player || !lobbyWorld?.active) return false;
  if (spawnDefinition && !canStartSpawn(spawnDefinition)) return false;
  const target = spawnDefinition?.spawnAnchor ?? spawn;
  if (!target) return false;
  const notifyEntered = () => {
    try {
      onEntered?.({ target: { ...target } });
    } catch (error) {
      console.warn("Main Gate entry presentation callback failed:", error);
    }
  };

  // The production lobby already renders the player at MAIN_GATE_SPAWN. Running the
  // staged fade + camera blend in that case adds ~0.48 s of locked input and looks
  // like a hitch on touch devices even though there is no actual teleport to hide.
  // Keep the cinematic transition only when the player really has to move to MAIN_GATE.
  if (transition?.start && !alreadyAtTarget(player, target)) {
    const started = transition.start({
      position: target,
      yawDeg: target.yaw * 180 / Math.PI,
      cameraYaw: target.yaw,
      onComplete: notifyEntered
    });
    return started === true;
  }

  lobbyWorld.leave();
  player.setLocalPosition(target.x, target.y, target.z);
  player.setLocalEulerAngles(0, target.yaw * 180 / Math.PI, 0);
  setLobbyShellVisible(false, { documentLike });
  notifyEntered();
  return true;
}

// A touch tap is activated on pointerup so the lobby closes without waiting for the synthetic click.
// The click that follows is ignored for this long; keyboard and mouse activation still use click.
export const MAIN_GATE_TOUCH_CLICK_SUPPRESS_MS = 500;
const TOUCH_POINTERS = new Set(["touch", "pen"]);

export function bindMainGateEntry({
  button,
  player,
  lobbyWorld,
  spawn = MAIN_GATE_SPAWN,
  spawnDefinition = null,
  documentLike = globalThis.document,
  transition = null,
  onEntered = null,
  requestFullscreen = requestLobbyFullscreen,
  clock = () => globalThis.performance?.now?.() ?? Date.now()
} = {}) {
  if (!button) return { start: () => false, destroy() {} };
  const start = () => {
    requestFullscreen?.({ documentLike });
    return enterMainGate({ player, lobbyWorld, spawn, spawnDefinition, documentLike, transition, onEntered });
  };
  let lastTouchActivation = -Infinity;

  const setActivating = (on) => {
    if (button.dataset) {
      if (on) button.dataset.activating = "true";
      else delete button.dataset.activating;
    }
    button.classList?.toggle?.("is-activating", on);
  };
  const insideButton = (event) => {
    const rect = button.getBoundingClientRect?.();
    if (!rect || !Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) return true;
    return event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom;
  };
  // Once the lobby is gone, the browser may still deliver the tap's click to whatever is underneath.
  const swallowGhostClick = () => {
    if (!documentLike?.addEventListener) return;
    let timer = null;
    const stop = (event) => {
      event.preventDefault?.();
      event.stopImmediatePropagation?.();
      release();
    };
    const release = () => {
      documentLike.removeEventListener("click", stop, { capture: true });
      if (timer !== null) clearTimeout(timer);
    };
    timer = setTimeout(release, MAIN_GATE_TOUCH_CLICK_SUPPRESS_MS);
    documentLike.addEventListener("click", stop, { capture: true });
  };

  const onPointerDown = (event) => { if (event.isPrimary !== false) setActivating(true); };
  const onPointerEnd = () => setActivating(false);
  const onPointerUp = (event) => {
    setActivating(false);
    if (!TOUCH_POINTERS.has(event.pointerType) || event.isPrimary === false || !insideButton(event)) return;
    lastTouchActivation = clock();
    if (start()) swallowGhostClick();
  };
  // Returns start()'s result like the plain click handler it replaces.
  const onClick = () => {
    if (clock() - lastTouchActivation < MAIN_GATE_TOUCH_CLICK_SUPPRESS_MS) return false;
    return start();
  };

  button.addEventListener("pointerdown", onPointerDown);
  button.addEventListener("pointerup", onPointerUp);
  button.addEventListener("pointercancel", onPointerEnd);
  button.addEventListener("pointerleave", onPointerEnd);
  button.addEventListener("click", onClick);
  return {
    start,
    definition: spawnDefinition,
    destroy() {
      button.removeEventListener("pointerdown", onPointerDown);
      button.removeEventListener("pointerup", onPointerUp);
      button.removeEventListener("pointercancel", onPointerEnd);
      button.removeEventListener("pointerleave", onPointerEnd);
      button.removeEventListener("click", onClick);
    }
  };
}
