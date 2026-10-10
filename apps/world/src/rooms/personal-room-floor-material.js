// Opt-in visual-only test: Wood Floor 051 never changes gameplay authority.
// Original color floor remains the canonical/fail-closed material.

export const PERSONAL_ROOM_FLOOR_QA_URL = "/assets/rooms/personal-v2/WoodFloor051_Color_1K_Q30.webp";
export const PERSONAL_ROOM_FLOOR_TILING = Object.freeze([8, 5]);

export function localWoodFloorQaEnabled(location = globalThis.location) {
  if (!location || !["localhost", "127.0.0.1", "::1", "[::1]", "inhagame.app", "www.inhagame.app"].includes(location.hostname)) return false;
  return new URLSearchParams(location.search ?? "").get("woodFloor051") === "1";
}

export function createPersonalRoomFloorMaterial({
  app, root, floor, engine, enabled = localWoodFloorQaEnabled(), url = PERSONAL_ROOM_FLOOR_QA_URL
}) {
  if (!floor?.render?.material) throw new TypeError("Original personal-room floor material missing");
  if (typeof engine?.StandardMaterial !== "function" || typeof engine?.Vec2 !== "function")
    throw new TypeError("PlayCanvas material constructors must be injected");
  const original = floor.render.material;
  let disposed = false;
  let active = false;
  let epoch = 0;
  let pending = null;
  let texture = null;
  let custom = null;

  function restore() {
    if (floor.render?.material === custom) floor.render.material = original;
  }
  function deactivate() {
    active = false;
    epoch++;
    restore();
  }
  function destroy() {
    if (disposed) return;
    disposed = true;
    deactivate();
    custom?.destroy(); // Never destroy the original shared material.
    custom = null;
    // PlayCanvas AssetRegistry owns the downloaded resource; it may be shared/cached.
    // Releasing the shared texture here could corrupt another consumer.
  }
  root.once("destroy", destroy);

  function applyLoaded() {
    if (!texture) return false;
    if (!custom) {
      const candidate = new engine.StandardMaterial();
      try {
        candidate.name = "qa-woodfloor051-color-1k";
        candidate.diffuseMap = texture;
        candidate.diffuseMapTiling = new engine.Vec2(...PERSONAL_ROOM_FLOOR_TILING);
        candidate.gloss = 0.28;
        candidate.update();
        custom = candidate;
      } catch {
        candidate.destroy();
        return false;
      }
    }
    try {
      floor.render.material = custom;
      return true;
    } catch {
      restore();
      return false;
    }
  }

  function fetchTextureOnce() {
    if (texture) return Promise.resolve(texture);
    if (pending) return pending;
    // Defer to a microtask: protects against synchronously invoked cache callbacks.
    pending = Promise.resolve().then(() => new Promise(resolve => {
      if (disposed) { resolve(null); return; }
      try {
        app.assets.loadFromUrl(url, "texture", (error, asset) => {
          resolve(error || !asset?.resource ? null : asset.resource);
        });
      } catch { resolve(null); }
    })).then(resource => {
      // Restrict this QA to the user-validated 1024x1024 Color image.
      if (resource && (resource.width !== 1024 || resource.height !== 1024)) resource = null;
      if (!disposed && resource) texture = resource;
      return !disposed && resource ? resource : null;
    }).finally(() => { pending = null; });
    return pending;
  }

  function ensureVisual() {
    if (disposed || !enabled) return Promise.resolve(false);
    active = true;
    const token = ++epoch;
    return fetchTextureOnce().then(() => {
      if (disposed || !active || token !== epoch || !root.enabled) return false;
      return applyLoaded();
    });
  }

  return Object.freeze({ ensureVisual, deactivate, destroy,
    status: () => Object.freeze({ enabled, disposed, active, loaded: Boolean(texture),
      applied: floor.render?.material === custom && Boolean(custom) })
  });
}
