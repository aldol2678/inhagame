import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { fillNorthRoads } from './north-campus-geometry.js';

// Restore original shared per-color owners after the profile batching experiment
// failed strict framebuffer parity. The experimental grouping module remains
// isolated for investigation; no vertex-color/material clone path ships here.
export function buildNorthWalkwayRoads(root) {
  return fillNorthRoads(new FacilityMeshBatch()).finish(root,'north_campus_roads',{castShadows:false});
}
