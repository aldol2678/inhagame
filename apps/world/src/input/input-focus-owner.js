export function createInputFocusOwner({
  manager,
  ownerId,
  policy
} = {}) {
  if (!manager?.claim || !manager?.release) {
    throw new TypeError("Input focus owner requires a manager");
  }
  if (typeof ownerId !== "string" || ownerId.trim() === "") {
    throw new TypeError("Input focus owner requires a non-empty ownerId");
  }
  if (!policy || typeof policy !== "object") {
    throw new TypeError("Input focus owner requires a policy");
  }

  let token = null;

  function acquire() {
    if (token) return false;
    token = manager.claim(ownerId, policy);
    return true;
  }

  function release() {
    if (!token) return false;
    const current = token;
    token = null;
    return manager.release(current);
  }

  return Object.freeze({
    acquire,
    release,
    get active() { return token !== null; }
  });
}
