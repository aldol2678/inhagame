import { MAIN_GATE_SPAWN } from "../campus-spawn.js";
import { setLobbyShellVisible } from "./lobby-shell.js";
import { canStartSpawn } from "./spawn-registry.js";

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

  if (transition?.start) {
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
