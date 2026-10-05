import { MAIN_GATE_SPAWN } from "../campus-spawn.js";
import { setLobbyShellVisible } from "./lobby-shell.js";
import { canStartSpawn } from "./spawn-registry.js";

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
  transition = null
} = {}) {
  if (!player || !lobbyWorld?.active) return false;
  if (spawnDefinition && !canStartSpawn(spawnDefinition)) return false;
  const target = spawnDefinition?.spawnAnchor ?? spawn;
  if (!target) return false;

  // The production lobby already renders the player at MAIN_GATE_SPAWN. Running the
  // staged fade + camera blend in that case adds ~0.48 s of locked input and looks
  // like a hitch on touch devices even though there is no actual teleport to hide.
  // Keep the cinematic transition only when the player really has to move to MAIN_GATE.
  if (transition?.start && !alreadyAtTarget(player, target)) {
    const started = transition.start({
      position: target,
      yawDeg: target.yaw * 180 / Math.PI,
      cameraYaw: target.yaw,
    });
    return started === true;
  }

  lobbyWorld.leave();
  player.setLocalPosition(target.x, target.y, target.z);
  player.setLocalEulerAngles(0, target.yaw * 180 / Math.PI, 0);
  setLobbyShellVisible(false, { documentLike });
  return true;
}

export function bindMainGateEntry({
  button,
  player,
  lobbyWorld,
  spawn = MAIN_GATE_SPAWN,
  spawnDefinition = null,
  documentLike = globalThis.document,
  transition = null
} = {}) {
  if (!button) return { start: () => false, destroy() {} };
  const start = () => enterMainGate({ player, lobbyWorld, spawn, spawnDefinition, documentLike, transition });
  button.addEventListener("click", start);
  return {
    start,
    definition: spawnDefinition,
    destroy() { button.removeEventListener("click", start); }
  };
}
