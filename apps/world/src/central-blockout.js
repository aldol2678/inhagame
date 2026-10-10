import * as pc from "playcanvas";
import { applyPondWeatherMaterial, pondWaterMaterial } from "./pond-water.js";
import { pondWeatherProfile } from "./environment/pond-weather-policy.js";
import { getCanonicalLandmark, createPolygonSurface } from "./reality-adapter.js";

export function buildCentralBlockout(root, app = null, {
  getRainIntensity = () => 0,
  getArtificialLightFactor = () => 0
} = {}) {
  const device = app?.graphicsDevice ?? pc.Application.getApplication()?.graphicsDevice;
  if (!device) return null;

  // Verified OSM boundary; this surface does not add swimming or collision behavior.
  const pond = getCanonicalLandmark("lmk_inkyung_pond");
  const waterMesh = createPolygonSurface(pc, device, pond.polygon);
  // P4 gets a private material variant so weather never mutates the Main Gate
  // reflecting pool or other shared water surfaces.
  const material = pondWaterMaterial(device, 1, "inkyung-weather");
  const water = new pc.Entity(pond.id);
  water.addComponent("render", {
    type: "asset",
    meshInstances: [new pc.MeshInstance(waterMesh, material)],
    castShadows: false,
    receiveShadows: false
  });
  root.addChild(water);
  water.on("destroy", () => waterMesh.destroy());

  let phase = 0;
  let rainIntensity = Math.min(1, Math.max(0, Number(getRainIntensity?.()) || 0));
  let artificialLightFactor = Math.min(1, Math.max(0, Number(getArtificialLightFactor?.()) || 0));
  let profile = pondWeatherProfile(rainIntensity, artificialLightFactor);
  applyPondWeatherMaterial(material, profile);

  const ripple = dt => {
    const nextRain = Math.min(1, Math.max(0, Number(getRainIntensity?.()) || 0));
    const nextNight = Math.min(1, Math.max(0, Number(getArtificialLightFactor?.()) || 0));
    if (Math.abs(nextRain - rainIntensity) >= 0.004 || Math.abs(nextNight - artificialLightFactor) >= 0.004) {
      rainIntensity = nextRain;
      artificialLightFactor = nextNight;
      profile = pondWeatherProfile(rainIntensity, artificialLightFactor);
      applyPondWeatherMaterial(material, profile);
    }

    phase = (phase + Math.min(Math.max(0, Number.isFinite(dt) ? dt : 0), 0.05) * profile.rippleSpeed) % 1;
    material.normalMapOffset.set(phase, phase * 0.6);
    material.update();
  };

  if (app) {
    app.on("update", ripple);
    water.on("destroy", () => app.off("update", ripple));
  }

  return Object.freeze({
    status() {
      return Object.freeze({
        entityId: pond.id,
        rainIntensity,
        artificialLightFactor,
        rippleSpeed: profile.rippleSpeed,
        bumpiness: profile.bumpiness,
        reflectivity: profile.reflectivity,
        gloss: profile.gloss,
        diffuse: Object.freeze([...profile.diffuse]),
        specular: Object.freeze([...profile.specular])
      });
    }
  });
}
