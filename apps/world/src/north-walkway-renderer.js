import * as pc from 'playcanvas';
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { surface } from './campus-render-kit.js';
import { fillNorthRoads } from './north-campus-geometry.js';
import { groupWalkwayPavingByProfile } from './north-walkway-batching.js';

// Only the existing static north-road BASE owner uses this batching path.
// Geometry, material profiles, depth/culling, shadow and collision stay intact.
export function buildNorthWalkwayRoads(root) {
  const source=fillNorthRoads(new FacilityMeshBatch());
  const device=pc.Application.getApplication().graphicsDevice;
  for(const g of groupWalkwayPavingByProfile(source.groups)){
    const mesh=new pc.Mesh(device);
    mesh.setPositions(g.positions);mesh.setNormals(g.normals);mesh.setIndices(g.indices);
    mesh.setColors(g.colors,4); // FLOAT32 linear RGBA, not setColors32/uint8.
    mesh.update(pc.PRIMITIVE_TRIANGLES);
    const material=surface(g.referenceColor).clone();
    material.name=`north-walkway-vertex-${g.profile}`;
    material.diffuse.set(1,1,1);material.diffuseMapVertexColor=true;material.update();
    const entity=new pc.Entity(`north_campus_roads_profile_${g.profile}`);
    entity.addComponent('render',{type:'asset',castShadows:false,meshInstances:[new pc.MeshInstance(mesh,material)]});
    root.addChild(entity);
    entity.on('destroy',()=>{mesh.destroy();material.destroy();});
  }
}
