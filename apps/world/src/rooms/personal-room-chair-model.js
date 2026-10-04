// Visual-only replacement for the fixed basic-room chair. Placement and collision stay in
// personal-room-layout.js; Collection-owned furniture never reaches this loader.
export const PERSONAL_ROOM_CHAIR_MODEL_URL = "/assets/kaykit/furniture-bits/chair_A.gltf";
export const PERSONAL_ROOM_CHAIR_MODEL_SCALE = 0.5;

export function createPersonalRoomChairModel({ app, root, anchor, fallback }) {
  let disposed = false;
  let pending = null;
  root.once("destroy", () => { disposed = true; });

  // One attempt per scene, started by the room's first activation. Re-entry shares the same
  // request/result, including failure, so an unavailable asset cannot trigger a request loop.
  return function ensureChairModel() {
    if (disposed) return Promise.resolve(false);
    if (pending) return pending;
    // Start after assigning pending, even if the registry returns a cached asset synchronously.
    pending = Promise.resolve().then(() => new Promise(resolve => {
      if (disposed) { resolve(false); return; }
      let model = null;
      const finish = (error, asset) => {
        if (disposed || error || !asset?.resource) { resolve(false); return; }
        try {
          model = asset.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
          model.name = "personal_chair_kaykit";
          model.setLocalPosition(0, 0, 0);
          model.setLocalScale(PERSONAL_ROOM_CHAIR_MODEL_SCALE, PERSONAL_ROOM_CHAIR_MODEL_SCALE, PERSONAL_ROOM_CHAIR_MODEL_SCALE);
          // The source backrest is at -Z. The old chair backrest is at +Z in room-local space.
          // The room root already mirrors Z; the model needs only this positive-scale rotation.
          model.setLocalEulerAngles(0, 180, 0);
          anchor.addChild(model);
          fallback.enabled = false;
          resolve(true);
        } catch {
          model?.destroy();
          resolve(false);
        }
      };
      try {
        app.assets.loadFromUrl(PERSONAL_ROOM_CHAIR_MODEL_URL, "container", finish);
      } catch {
        resolve(false);
      }
    }));
    return pending;
  };
}
