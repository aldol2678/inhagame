// Render only: the pure canonical approach geometry is shared with engine-free QA.
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { fillLibraryApproaches } from './jeongseok-entry-geometry.js';
export { fillLibraryApproaches } from './jeongseok-entry-geometry.js';

export function buildLibraryApproaches(root) {
  const batch=new FacilityMeshBatch();
  fillLibraryApproaches(batch);
  batch.finish(root,'library_canonical_approaches');
}
