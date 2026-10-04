import {surface} from './campus-render-kit.js';
import {PHOTO_STUDENT_COLORS} from './photo-student-center.js';

const cache=new Map();
export function photoLandmarkSurface(color){
  if(!cache.has(color)){
    const material=surface(color).clone();
    // Stable second decal layer for pale mullions/parapets and occasional lit panes.
    // This offsets depth comparison only; the geometry stays on the source wall.
    const top=color===PHOTO_STUDENT_COLORS.trim||color===PHOTO_STUDENT_COLORS.warmWindow;
    material.depthBias=top?-2:-1;material.slopeDepthBias=top?-2:-1;
    material.update();cache.set(color,material);
  }
  return cache.get(color);
}
