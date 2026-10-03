import { surface } from './campus-render-kit.js';

// At most two shared source materials, never one per window. ChunkRenderer clones
// them per resident chunk for its existing dither fade and disposes those clones.
const cache=new Map();
export function neutralFacadeSurface(color){
  if(!cache.has(color)){
    const material=surface(color).clone();
    // Decals use the exact wall coordinates; offset the depth comparison, not the
    // source geometry. PlayCanvas maps these to WebGL polygonOffset / WebGPU bias.
    material.depthBias=-1;material.slopeDepthBias=-1;material.update();cache.set(color,material);
  }
  return cache.get(color);
}
