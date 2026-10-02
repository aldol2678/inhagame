import { EXTERIOR_WORLD_BOUNDS } from './world-exterior-bounds.js';
import { CHUNK_SIZE } from './render-chunk-registry.js';

export const VIEW_DISTANCE_KEY = 'inhagame-campus-view-distance-v1';
export const DEFAULT_VIEW_DISTANCE = 'NORMAL';
const b = EXTERIOR_WORLD_BOUNDS;
// Cover the playable envelope from every corner, plus the orbit/height margin.
const campusSpan = Math.ceil(Math.hypot(b.maxX-b.minX,b.maxZ-b.minZ)/CHUNK_SIZE)*CHUNK_SIZE;
const cameraFarClip = campusSpan + CHUNK_SIZE;
const preset = (id,label,detailEnter,detailExit,nearEnter,nearExit,load,unload) => Object.freeze({
  id,label,detailEnter,detailExit,nearEnter,nearExit,load,unload,cameraFarClip,preserveCampus:true
});
// NORMAL preserves the tested P0 baseline. Other ranges are calibrated in
// docs/world/VIEW_DISTANCE_P0.md against the current geometry and WebGPU workload.
export const VIEW_DISTANCE_PRESETS = Object.freeze({
  SHORT: preset('SHORT','짧게',22,34,52,68,100,124),
  NORMAL: preset('NORMAL','보통',35,50,85,105,150,180),
  FAR: preset('FAR','멀리',80,100,144,168,224,256),
  MAX: preset('MAX','최대',104,128,200,232,campusSpan,campusSpan+32)
});
export function viewDistancePreset(id) {
  return Object.hasOwn(VIEW_DISTANCE_PRESETS,id) ? VIEW_DISTANCE_PRESETS[id] : VIEW_DISTANCE_PRESETS.NORMAL;
}
export function readViewDistance(storage) {
  try { return viewDistancePreset(storage.getItem(VIEW_DISTANCE_KEY)); }
  catch { return VIEW_DISTANCE_PRESETS.NORMAL; }
}
export function saveViewDistance(storage,id) {
  try { storage.setItem(VIEW_DISTANCE_KEY,viewDistancePreset(id).id); return true; }
  catch { return false; }
}

