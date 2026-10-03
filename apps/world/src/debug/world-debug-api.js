export function installWorldDebugApi({
  windowLike = globalThis.window,
  exposed = {},
  getStatus
} = {}) {
  if (!windowLike) throw new TypeError("World debug API requires a window-like target");
  if (typeof getStatus !== "function") throw new TypeError("World debug API requires getStatus");

  const api = {
    ...exposed,
    getStatus
  };
  windowLike.__INHAGAME_P0__ = api;
  return api;
}
