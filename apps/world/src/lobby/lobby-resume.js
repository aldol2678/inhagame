import { WORLD_REGION_ID } from "../regions/world-region-registry.js";
import { setLobbyShellVisible } from "./lobby-shell.js";
import { requestLobbyFullscreen } from "./lobby-fullscreen.js";

export function formatResumeAge(savedAt, now = Date.now()) {
  const delta = Math.max(0, Number(now) - Number(savedAt));
  if (!Number.isFinite(delta)) return "";
  const minutes = Math.floor(delta / 60000);
  if (minutes < 1) return "방금 전";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.floor(hours / 24);
  return `${days}일 전`;
}

export function enterResume({
  player,
  orbit,
  lobbyWorld,
  record,
  documentLike = globalThis.document,
  transition = null,
  regionTransition = null,
  isCurrent = () => true
} = {}) {
  if (!isCurrent() || transition?.active || !player || !orbit || !lobbyWorld?.active || !record) return false;

  if (record.regionId === WORLD_REGION_ID.BIRYONG_REALM) {
    // Keep the lobby intact until the regional transaction has settled. A failed or
    // invalidated fade restores its Campus checkpoint instead of teleporting local coordinates.
    return regionTransition?.resume?.(record, {
      isCurrent: () => isCurrent() && lobbyWorld.active && !transition?.active,
      onComplete: () => {
        if (!isCurrent() || !lobbyWorld.active) return;
        const gameplay = lobbyWorld.gameplayCamera?.() ?? {};
        lobbyWorld.leave({ restoreCamera: false, restorePlayerEuler: false });
        orbit.pitch = gameplay.pitch ?? .35;
        orbit.distance = gameplay.distance ?? 3.5;
        setLobbyShellVisible(false, { documentLike });
      }
    }) === true;
  }
  if (record.regionId != null && record.regionId !== WORLD_REGION_ID.CAMPUS) return false;

  if (transition?.start) {
    const started = transition.start({
      position: record,
      yawDeg: record.yawDeg ?? 0,
      cameraYaw: Number.isFinite(record.cameraYaw) ? record.cameraYaw : null,
    });
    return started === true;
  }

  lobbyWorld.leave();
  player.setLocalPosition(record.x, record.y, record.z);
  player.setLocalEulerAngles(0, record.yawDeg ?? 0, 0);
  if (Number.isFinite(record.cameraYaw)) orbit.yaw = record.cameraYaw;
  setLobbyShellVisible(false, { documentLike });
  return true;
}

export function bindResumeEntry({
  button,
  locationElement,
  ageElement,
  resume,
  player,
  orbit,
  lobbyWorld,
  now = () => Date.now(),
  documentLike = globalThis.document,
  transition = null,
  getRegionTransition = () => null,
  requestFullscreen = requestLobbyFullscreen
} = {}) {
  let destroyed = false;
  let pendingRegion = null;
  const record = resume?.state === "VALID" ? resume.record : null;
  if (!button || !record) {
    if (button) button.hidden = true;
    return { available: false, start: () => false, destroy() {} };
  }

  button.hidden = false;
  if (locationElement) locationElement.textContent = record.displayName;
  if (ageElement) ageElement.textContent = formatResumeAge(record.savedAt, now());
  const start = () => {
    if (destroyed) return false;
    requestFullscreen?.({ documentLike });
    const regionTransition = getRegionTransition();
    if (record.regionId === WORLD_REGION_ID.BIRYONG_REALM) pendingRegion = regionTransition;
    return enterResume({ player, orbit, lobbyWorld, record, documentLike, transition, regionTransition,
      isCurrent: () => !destroyed });
  };
  button.addEventListener("click", start);
  return {
    available: true,
    record,
    start,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      button.removeEventListener("click", start);
      pendingRegion?.cancelResume?.();
    }
  };
}
