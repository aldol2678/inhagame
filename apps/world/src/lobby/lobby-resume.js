import { setLobbyShellVisible } from "./lobby-shell.js";

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
  transition = null
} = {}) {
  if (!player || !orbit || !lobbyWorld?.active || !record) return false;

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
  transition = null
} = {}) {
  const record = resume?.state === "VALID" ? resume.record : null;
  if (!button || !record) {
    if (button) button.hidden = true;
    return { available: false, start: () => false, destroy() {} };
  }

  button.hidden = false;
  if (locationElement) locationElement.textContent = record.displayName;
  if (ageElement) ageElement.textContent = formatResumeAge(record.savedAt, now());
  const start = () => enterResume({ player, orbit, lobbyWorld, record, documentLike, transition });
  button.addEventListener("click", start);
  return {
    available: true,
    record,
    start,
    destroy() { button.removeEventListener("click", start); }
  };
}
