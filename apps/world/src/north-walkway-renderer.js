import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { fillNorthRoads } from './north-campus-geometry.js';
import { indexWalkwayPavingGroups } from './north-walkway-indexing.js';
// Preserve five shared material owners and the exact float32 triangle stream.
export function buildNorthWalkwayRoads(root){
 const batch=fillNorthRoads(new FacilityMeshBatch()),source=batch.groups;
 batch.groups=indexWalkwayPavingGroups(source);
 const first=root.children.length;
 try{
  batch.finish(root,'north_campus_roads',{castShadows:false});
  let i=first;
  for(const [color,g]of source){
   const owner=root.children[i++];
   if(owner?.name!=='north_campus_roads_'+color.slice(1)||owner.render?.meshInstances.length!==1)throw new Error('Unexpected paving owner order');
   const mesh=owner.render.meshInstances[0].mesh,bounds=mesh.aabb.clone();
   // Bounds are computed before float32 upload; preserve original JS extents.
   bounds.compute(g.positions);mesh.aabb=bounds;
  }
 }catch(error){for(const owner of root.children.slice(first))owner.destroy();throw error;}
}
