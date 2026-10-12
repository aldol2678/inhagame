// Optional showroom renderer. Uses the exact procedural geometry of placed furniture,
// in an isolated, small WebGL2 canvas. No save/placement/purchase operations.
import * as pc from "playcanvas";
import { FURNITURE_BY_ID } from "../rooms/furniture-layout.js";
import { createFurnitureLayer } from "../rooms/furniture-renderer.js";

const PREVIEW_ID = "00000000-0000-4000-8000-000000000000";

export async function createFurnitureShopPreview(canvas) {
  if (!canvas?.getContext) throw new TypeError("Canvas required");
  // WebGL2 is used only here; failure must not disable the store or the main world.
  const device = await pc.createGraphicsDevice(canvas, {
    deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: false, alpha: false
  });
  const options = new pc.AppOptions();
  options.graphicsDevice = device;
  options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem];
  options.resourceHandlers = [pc.TextureHandler];
  const app = new pc.AppBase(canvas);
  try {
    app.init(options);
    app.setCanvasResolution(pc.RESOLUTION_FIXED, 256, 192);
    app.scene.ambientLight = new pc.Color(.70, .76, .85);
    const root = new pc.Entity("FurnitureShopPreview");
    app.root.addChild(root);
    const furniture = createFurnitureLayer(app, root);
    const camera = new pc.Entity("FurniturePreviewCamera");
    camera.addComponent("camera", {
      projection: pc.PROJECTION_ORTHOGRAPHIC, orthoHeight: 1.3,
      nearClip: .01, farClip: 40, clearColor: new pc.Color(.83, .91, .98)
    });
    app.root.addChild(camera);
    const key = new pc.Entity("FurniturePreviewLight");
    key.addComponent("light", { type: "directional", color: new pc.Color(1,.97,.90), intensity: .9 });
    key.setEulerAngles(45, 35, 0);
    app.root.addChild(key);
    app.autoRender = false;
    app.start();
    let current = null;
    let closed = false;
    let angle = 35;
    function show(itemId, degrees = angle, zoom = 1) {
      if (closed) return false;
      const item = FURNITURE_BY_ID.get(itemId);
      if (!item) return false;
      if (current !== itemId) {
        furniture.setObjects([{ id: PREVIEW_ID, itemId, surface: "floor", x: 0, z: 0, yaw: 0 }]);
        current = itemId;
      }
      angle = degrees;
      furniture.root.setLocalEulerAngles(0, angle, 0);
      const extent = Math.max(item.width, item.height, item.depth);
      camera.camera.orthoHeight = Math.max(.48, extent * .85) / Math.max(.75, Math.min(1.75, zoom));
      camera.setPosition(extent * 1.75, item.height * .9 + extent * .6, -extent * 2);
      camera.lookAt(0, .025 + item.height / 2, 0);
      app.renderNextFrame = true;
      return true;
    }
    function capture(itemId) {
      if (!show(itemId, 35)) return Promise.resolve(null);
      return new Promise(resolve => {
        let done = false;
        const finish = image => {
          if (done) return;
          done = true; app.off("postrender", frame); clearTimeout(timeout); resolve(image);
        };
        const frame = () => {
          try {
            const output = canvas.ownerDocument.createElement("canvas");
            output.width = 256; output.height = 192;
            const context = output.getContext("2d");
            if (!context) return finish(null);
            context.drawImage(canvas, 0, 0, output.width, output.height);
            finish(output.toDataURL("image/png"));
          } catch { finish(null); }
        };
        const timeout = setTimeout(() => finish(null), 2200);
        app.on("postrender", frame);
        app.renderNextFrame = true;
      });
    }
    function dispose() {
      if (closed) return;
      closed = true;
      app.destroy();
    }
    return Object.freeze({ show, capture, dispose });
  } catch (error) {
    app.destroy();
    throw error;
  }
}
