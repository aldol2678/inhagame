import { CAMPUS_STREETLAMP_WORLD } from './campus-streetlamp-layout.js';
import { createCampusStaticPropRuntime } from './campus-static-prop-runtime.js';

// P2 visual integration = emissive-only. The source GLB has a non-emissive
// Lamp_Diffuser. Clone only that material on the instance, never mutate the
// container-cache material or add realtime light/shadow entities.
export function createCampusStreetlampRuntime(context) {
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
            surface.emissiveIntensity = .35;
            surface.update();
            clones.set(original, surface);
          }
          mesh.material = clones.get(original);
        }
      }
      visual.on('destroy', () => { for (const surface of clones.values()) surface.destroy(); clones.clear(); });
      return visual;
    }
  };
  return createCampusStaticPropRuntime(CAMPUS_STREETLAMP_WORLD, instanceContext);
}
