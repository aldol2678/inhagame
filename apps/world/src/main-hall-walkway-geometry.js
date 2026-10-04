import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { MAIN_HALL_WALKWAYS } from './main-hall-walkway-layout.js';
import { roadSurface } from './campus-road-geometry.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';

export function fillMainHallWalkways(batch){
  for(const {frame,width} of MAIN_HALL_WALKWAYS){
    // Narrow paved continuation only: never fill the central planted island.
    // Gray stone identity is photo-informed; all dimensions remain estimates.
    roadSurface(batch,'#b4b4a8',frame,0,frame.length,-width/2,width/2,G.SURFACE);
  }
  return batch;
}
export function buildMainHallWalkways(root){
  const batch=new FacilityMeshBatch();fillMainHallWalkways(batch);
  batch.finish(root,'main_hall_walkways',{castShadows:false});
}
