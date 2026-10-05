import { setLobbyShellVisible } from "./lobby-shell.js";

export const LOBBY_TRANSITION = Object.freeze({
  fadeSeconds: 0.16,
  blendSeconds: 0.32
});

const lerp = (a, b, t) => a + (b - a) * t;
const shortestAngle = (from, to) => {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
};

export function createLobbyTransition({
  player,
  controller,
  orbit,
  character,
  lobbyWorld,
  overlay = null,
  documentLike = globalThis.document,
  reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false },
  onActiveChange = null
} = {}) {
  let active = false;
  let phase = "idle";
  let elapsed = 0;
  let target = null;
  let fromCamera = null;
  let toCamera = null;
  let complete = null;

  const root = documentLike?.body ?? null;
  const lobby = documentLike?.getElementById?.("world-lobby") ?? null;

  const setInputLocked = (locked) => {
    if (typeof onActiveChange === "function") {
      onActiveChange(Boolean(locked));
      return;
    }
    controller?.setInputEnabled?.(!locked);
    orbit?.setInputEnabled?.(!locked);
  };

  const setOverlay = (visible, opaque = false) => {
    if (!overlay) return;
    overlay.hidden = !visible;
    overlay.classList?.toggle?.("on", visible && opaque);
  };

  const finish = () => {
    orbit.yaw = toCamera.yaw;
    orbit.pitch = toCamera.pitch;
    orbit.distance = toCamera.distance;
    orbit.apply(player.getLocalPosition(), character.eyeHeight);
    setInputLocked(false);
    setOverlay(false, false);
    if (root?.dataset) delete root.dataset.lobbyTransition;
    active = false;
    phase = "idle";
    const callback = complete;
    complete = null;
    callback?.();
  };

  const switchToWorld = () => {
    const gameplay = lobbyWorld.gameplayCamera?.() ?? {};
    fromCamera = { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance };
    toCamera = {
      yaw: Number.isFinite(target.cameraYaw) ? target.cameraYaw : (gameplay.yaw ?? 0),
      pitch: Number.isFinite(target.cameraPitch) ? target.cameraPitch : (gameplay.pitch ?? 0.35),
      distance: Number.isFinite(target.cameraDistance) ? target.cameraDistance : (gameplay.distance ?? 3.5)
    };

    lobbyWorld.leave({ restoreCamera: false, restorePlayerEuler: false, enableInput: false });
    player.setLocalPosition(target.position.x, target.position.y, target.position.z);
    player.setLocalEulerAngles(0, target.yawDeg ?? 0, 0);
    setLobbyShellVisible(false, { documentLike });
    lobby?.classList?.remove?.("is-leaving");
    setOverlay(true, false);
    phase = "blend";
    elapsed = 0;
  };

  const start = ({
    position,
    yawDeg = 0,
    cameraYaw = null,
    cameraPitch = null,
    cameraDistance = null,
    onComplete = null
  } = {}) => {
    if (active || !lobbyWorld?.active || !position) return false;
    target = { position: { ...position }, yawDeg, cameraYaw, cameraPitch, cameraDistance };
    complete = onComplete;
    active = true;
    phase = "fade";
    elapsed = 0;
    setInputLocked(true);
    if (root?.dataset) root.dataset.lobbyTransition = "true";
    lobby?.classList?.add?.("is-leaving");

    if (reducedMotion?.matches) {
      setOverlay(false, false);
      switchToWorld();
      finish();
      return true;
    }

    setOverlay(true, true);
    return true;
  };

  const update = (dt = 0) => {
    if (!active) return false;
    const step = Math.max(0, Math.min(Number(dt) || 0, 0.05));
    elapsed += step;

    if (phase === "fade") {
      character.setMounted(false);
      character.setFirstPerson(false);
      character.update(step, { mounted: false, moving: false, grounded: true, emote: null, seated: false });
      orbit.apply(player.getLocalPosition(), character.eyeHeight);
      if (elapsed >= LOBBY_TRANSITION.fadeSeconds) switchToWorld();
      return true;
    }

    if (phase === "blend") {
      const t = Math.min(1, elapsed / LOBBY_TRANSITION.blendSeconds);
      orbit.yaw = fromCamera.yaw + shortestAngle(fromCamera.yaw, toCamera.yaw) * t;
      orbit.pitch = lerp(fromCamera.pitch, toCamera.pitch, t);
      orbit.distance = lerp(fromCamera.distance, toCamera.distance, t);
      character.setMounted(false);
      character.setFirstPerson(false);
      character.update(step, { mounted: false, moving: false, grounded: true, emote: null, seated: false });
      orbit.apply(player.getLocalPosition(), character.eyeHeight);
      if (t >= 1) finish();
      return true;
    }
    return false;
  };

  return {
    start,
    update,
    get active() { return active; },
    get phase() { return phase; },
    status: () => ({ active, phase })
  };
}
