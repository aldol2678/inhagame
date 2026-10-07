// Fullscreen is deliberately orientation-neutral: portrait and landscape are both valid
// play modes. We never call ScreenOrientation.lock(); rotating the device while fullscreen
// should simply trigger the normal responsive layout.
const SHORT_LANDSCAPE_MAX_HEIGHT = 720;

export function lobbyFullscreenEligible({
  documentLike = globalThis.document,
  windowLike = globalThis.window
} = {}) {
  const root = documentLike?.documentElement;
  const request = root?.requestFullscreen ?? root?.webkitRequestFullscreen;
  if (typeof request !== "function") return false;
  if (documentLike?.fullscreenElement || documentLike?.webkitFullscreenElement) return false;

  const displayFullscreen = windowLike?.matchMedia?.("(display-mode: fullscreen)")?.matches === true;
  const displayStandalone = windowLike?.matchMedia?.("(display-mode: standalone)")?.matches === true;
  if (displayFullscreen || displayStandalone) return false;

  const coarsePointer = windowLike?.matchMedia?.("(pointer: coarse)")?.matches === true;
  const width = Number(windowLike?.innerWidth);
  const height = Number(windowLike?.innerHeight);
  const shortLandscape = Number.isFinite(width) && Number.isFinite(height) &&
    width > height && height <= SHORT_LANDSCAPE_MAX_HEIGHT;

  return coarsePointer || shortLandscape;
}

export function requestLobbyFullscreen({
  documentLike = globalThis.document,
  windowLike = globalThis.window
} = {}) {
  if (!lobbyFullscreenEligible({ documentLike, windowLike })) return false;
  const root = documentLike.documentElement;

  try {
    const pending = typeof root.requestFullscreen === "function"
      ? root.requestFullscreen({ navigationUI: "hide" })
      : root.webkitRequestFullscreen();
    pending?.catch?.(() => {});
    return true;
  } catch {
    return false;
  }
}
