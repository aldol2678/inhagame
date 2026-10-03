import { CAMPUS_STREETLAMP_WORLD, CAMPUS_STREETLAMP_LIGHT } from './campus-streetlamp-layout.js';
import { createCampusStaticPropRuntime } from './campus-static-prop-runtime.js';

// The visual owns its cloned diffuser and a registration in the existing night
// pool. It never owns another light entity or mutates the cached GLB material.
export function createCampusStreetlampRuntime(context, { nightStreetLights } = {}) {
  const instanceContext = {
    ...context,
    createRenderable(asset, data) {
      const visual = context.createRenderable(asset, data);
      const clones = new Map();
      for (const render of visual.findComponents('render')) {
        for (const mesh of render.meshInstances) {
          const original = mesh.material;
          if (original.name !== 'Lamp_Diffuser') continue;
          if (!clones.has(original)) {
            const surface = original.clone();
            surface.emissive.set(.92, .8, .55);
            surface.emissiveIntensity = 0;
            surface.update();
            clones.set(original, surface);
          }
          mesh.material = clones.get(original);
        }
      }
      let unregister;
      visual.on('destroy', () => {
        unregister?.(); unregister = null;
        for (const surface of clones.values()) surface.destroy();
        clones.clear();
      });
      try {
        if (clones.size) unregister = nightStreetLights?.registerLamp({
          ...CAMPUS_STREETLAMP_LIGHT,
          setArtificialLightFactor(factor) {
            for (const surface of clones.values()) {
              surface.emissiveIntensity = factor * 3.2;
              surface.update();
            }
          }
        });
      } catch (error) {
        // The adapter has not attached this visual yet. Release its clone even
        // if registration rejects (for example a duplicate live instance).
        visual.destroy();
        throw error;
      }
      return visual;
    }
  };
  return createCampusStaticPropRuntime(CAMPUS_STREETLAMP_WORLD, instanceContext);
}
