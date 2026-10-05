export const LOBBY_CAMERA_PRESET = Object.freeze({
  yaw: 0,
  pitch: 0.18,
  distance: 5.6,
  playerYaw: 180
});

const eulerSnapshot = (player) => {
  const e = player.getLocalEulerAngles?.();
  return { x: e?.x ?? 0, y: e?.y ?? 0, z: e?.z ?? 0 };
};

export function createLobbyWorldMode({
  player,
  controller,
  orbit,
  character,
  root = null,
  onActiveChange = null
} = {}) {
  let active = false;
  let saved = null;

  const setInputLocked = (locked) => {
    if (typeof onActiveChange === "function") {
      onActiveChange(Boolean(locked));
      return;
    }
    controller?.setInputEnabled?.(!locked);
    orbit?.setInputEnabled?.(!locked);
  };

  const enter = () => {
    if (active) return false;
    saved = {
      orbit: { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance, firstPerson: orbit.firstPerson },
      playerEuler: eulerSnapshot(player)
    };

    // P0.2 preview boots in third person; switch before camera input is locked.
    if (orbit.firstPerson) orbit.togglePerspective();
    setInputLocked(true);
    orbit.yaw = LOBBY_CAMERA_PRESET.yaw;
    orbit.pitch = LOBBY_CAMERA_PRESET.pitch;
    orbit.distance = LOBBY_CAMERA_PRESET.distance;
    player.setLocalEulerAngles(0, LOBBY_CAMERA_PRESET.playerYaw, 0);
    if (root?.dataset) root.dataset.lobbyWorld = "true";
    active = true;
    return true;
  };

  const update = (dt = 0) => {
    if (!active) return false;
    character.setMounted(false);
    character.setFirstPerson(false);
    character.update(Math.min(Math.max(dt, 0), 0.05), {
      mounted: false, moving: false, grounded: true, emote: null, seated: false
    });
    orbit.apply(player.getLocalPosition(), character.eyeHeight);
    return true;
  };

  const leave = ({
    restoreCamera = true,
    restorePlayerEuler = true,
    enableInput = true
  } = {}) => {
    if (!active) return false;
    const previous = saved;
    active = false;
    if (root?.dataset) delete root.dataset.lobbyWorld;
    if (previous && restoreCamera) {
      orbit.yaw = previous.orbit.yaw;
      orbit.pitch = previous.orbit.pitch;
      orbit.distance = previous.orbit.distance;
      if (previous.orbit.firstPerson && !orbit.firstPerson) orbit.togglePerspective();
    }
    if (previous && restorePlayerEuler) {
      player.setLocalEulerAngles(previous.playerEuler.x, previous.playerEuler.y, previous.playerEuler.z);
    }
    if (enableInput) setInputLocked(false);
    else if (typeof onActiveChange === "function") onActiveChange(false);
    return true;
  };

  return {
    get active() { return active; },
    enter,
    update,
    leave,
    gameplayCamera: () => saved ? { ...saved.orbit } : null,
    status: () => ({
      active,
      camera: active ? { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance } : null,
      inputLocked: active ? controller.inputEnabled === false && orbit.inputEnabled === false : false
    })
  };
}
