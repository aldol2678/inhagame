// A fixed, code-registered visual. No model URL, transform or item ownership comes from RPC data.
export function createPersonalRoomFixtureModel({ app, root, anchor, fallback, model: definition }) {
  let disposed = false;
  let pending = null;
  root.once("destroy", () => { disposed = true; });
  return function ensureFixtureModel() {
    if (disposed) return Promise.resolve(false);
    if (pending) return pending;
    // Assign pending before a registry cache hit can call back synchronously.
    pending = Promise.resolve().then(() => new Promise(resolve => {
      if (disposed) { resolve(false); return; }
      let model = null;
      const finish = (error, asset) => {
        if (disposed || error || !asset?.resource) { resolve(false); return; }
        try {
          model = asset.resource.instantiateRenderEntity({ castShadows: true, receiveShadows: true });
          model.name = definition.name;
          model.setLocalPosition(...definition.offset);
          model.setLocalScale(definition.scale, definition.scale, definition.scale);
          model.setLocalEulerAngles(0, definition.yaw, 0);
          anchor.addChild(model);
          fallback.enabled = false;
          resolve(true);
        } catch {
          model?.destroy();
          resolve(false);
        }
      };
      try { app.assets.loadFromUrl(definition.url, "container", finish); }
      catch { resolve(false); }
    }));
    return pending;
  };
}
