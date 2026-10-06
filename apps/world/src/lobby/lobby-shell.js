import "./world-resume-account-scope.js";

// Main Lobby P0 shell bootstrap.
// The production campus stays unchanged unless the explicit preview query is present.
export function isLobbyShellRequested(locationLike = globalThis.location) {
  const search = locationLike?.search ?? "";
  return new URLSearchParams(search).get("lobby") === "1";
}

export function setLobbyShellVisible(visible, {
  documentLike = globalThis.document,
  lobby = documentLike?.getElementById?.("world-lobby") ?? null
} = {}) {
  if (!documentLike?.body || !lobby) return false;
  lobby.hidden = visible !== true;
  if (visible) documentLike.body.dataset.lobbyShell = "true";
  else delete documentLike.body.dataset.lobbyShell;
  return true;
}

if (typeof document !== "undefined" && isLobbyShellRequested(globalThis.location)) {
  setLobbyShellVisible(true);
}
