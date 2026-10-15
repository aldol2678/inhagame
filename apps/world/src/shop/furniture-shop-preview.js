// Optional showroom renderer. Uses the exact visual layer of placed furniture,
// in an isolated, small WebGL2 canvas. No save/placement/purchase operations.
import * as pc from "playcanvas";
import { FURNITURE_BY_ID, furnitureBox } from "../rooms/furniture-layout.js";
import { createFurnitureLayer } from "../rooms/furniture-renderer.js";
import { captureFurnitureVisual } from "../rooms/furniture-visual-assets.js";

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
  options.resourceHandlers = [pc.TextureHandler, pc.ContainerHandler];
  const app = new pc.AppBase(canvas);
  try {
    app.init(options);
    app.setCanvasResolution(pc.RESOLUTION_FIXED, 256, 192);
    app.scene.ambientLight = new pc.Color(.70, .76, .85);
    const root = new pc.Entity("FurnitureShopPreview", app);
    app.root.addChild(root);
    const furniture = createFurnitureLayer(app, root, { isolatedMaterials: true });
    const camera = new pc.Entity("FurniturePreviewCamera", app);
    camera.addComponent("camera", {
      projection: pc.PROJECTION_ORTHOGRAPHIC, orthoHeight: 1.3,
      nearClip: .01, farClip: 40, clearColor: new pc.Color(.83, .91, .98)
    });
    app.root.addChild(camera);
    const key = new pc.Entity("FurniturePreviewLight", app);
    key.addComponent("light", { type: "directional", color: new pc.Color(1,.97,.90), intensity: .9 });
    key.setEulerAngles(45, 35, 0);
    app.root.addChild(key);
    app.autoRender = false;
    app.start();
    let current = null;
    let closed = false;
    let angle = 35;
    let currentZoom = 1;
    const pendingCaptures = new Set();
    function show(itemId, degrees = angle, zoom = 1) {
      if (closed) return false;
      const item = FURNITURE_BY_ID.get(itemId);
      if (!item) return false;
      if (current !== itemId) {
        furniture.setObjects([{ id: PREVIEW_ID, itemId, surface: "floor", x: 0, z: 0, yaw: 0 }]);
        current = itemId;
      }
      angle = degrees; currentZoom = zoom;
      furniture.root.setLocalEulerAngles(0, angle, 0);
      const bounds = furniture.placementGeometry?.get(PREVIEW_ID)?.box ?? furnitureBox({itemId,surface:'floor',x:0,z:0,yaw:0});
      const height=bounds.maxY-bounds.minY, extent=Math.max(bounds.maxX-bounds.minX,height,bounds.maxZ-bounds.minZ);
      const rad=angle*Math.PI/180,cx=(bounds.minX+bounds.maxX)/2,cz=(bounds.minZ+bounds.maxZ)/2;
      const target={x:Math.cos(rad)*cx+Math.sin(rad)*cz,y:(bounds.minY+bounds.maxY)/2,z:-Math.sin(rad)*cx+Math.cos(rad)*cz};
      camera.camera.orthoHeight = Math.max(.48, extent * .85) / Math.max(.75, Math.min(1.75, zoom));
      camera.setPosition(target.x+extent*1.75,bounds.minY+height*.9+extent*.6,target.z-extent*2);
      camera.lookAt(target.x,target.y,target.z);
      app.renderNextFrame = true;
      return true;
    }
    furniture.root.on("visualchange",()=>{ if(current&&!closed)show(current,angle,currentZoom); });
    async function capture(itemId) {
      if (!show(itemId, 35)) return Promise.resolve(null);
      return captureFurnitureVisual(furniture, () => new Promise(resolve => {
        if (closed) return resolve(null);
        let done = false;
        const finish = image => {
          if (done) return;
          done = true; pendingCaptures.delete(finish);
          app.off("postrender", frame); clearTimeout(timeout); resolve(image);
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
        pendingCaptures.add(finish);
        app.on("postrender", frame);
        app.renderNextFrame = true;
      }), { viewKey: "shop-v2-active-bounds:256x192:angle35:zoom1" });
    }
    function dispose() {
      if (closed) return;
      closed = true;
      for (const finish of pendingCaptures) finish(null);
      app.destroy();
    }
    return Object.freeze({ show, capture, dispose, visualStatus: furniture.visualStatus });
  } catch (error) {
    app.destroy();
    throw error;
  }
}
