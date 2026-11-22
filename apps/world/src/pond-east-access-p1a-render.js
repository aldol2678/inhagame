// GPU-owned adapter only. Navigation and geometry remain engine-free.
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { fillP1AEastQaSurface } from './pond-east-access-p1a.js';
export function buildP1AEastQaSurface(root) {
  const batch = new FacilityMeshBatch();
  fillP1AEastQaSurface(batch);
  batch.finish(root, 'p1a_east_access_qa', { castShadows: false });
}
