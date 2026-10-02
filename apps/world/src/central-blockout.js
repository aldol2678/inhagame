import * as pc from "playcanvas";
import { pondWaterMaterial } from "./pond-water.js";
import { getCanonicalLandmark, createPolygonSurface } from "./reality-adapter.js";

export function buildCentralBlockout(root, app = null) {
  const device = app?.graphicsDevice ?? pc.Application.getApplication()?.graphicsDevice;
  if (device) {
    // Verified OSM boundary; this surface does not add swimming or collision behavior.
    const pond = getCanonicalLandmark("lmk_inkyung_pond");
    const waterMesh = createPolygonSurface(pc, device, pond.polygon);
    const water = new pc.Entity(pond.id);
    water.addComponent("render", {
      type: "asset",
      meshInstances: [new pc.MeshInstance(waterMesh, pondWaterMaterial(device, 1))],
      castShadows: false,
      receiveShadows: false
    });
    root.addChild(water);
    water.on('destroy',()=>waterMesh.destroy());
    if (app) {
      const material = water.render.meshInstances[0].material;
      let phase = 0;
      const ripple = dt => {
        phase = (phase + Math.min(dt, .05) * .025) % 1;
        material.normalMapOffset.set(phase, phase * .6);
        material.update();
      };
      app.on("update", ripple);
      water.on("destroy", () => app.off("update", ripple));
    }
  }
}
