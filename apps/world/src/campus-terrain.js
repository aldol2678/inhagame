import * as pc from 'playcanvas';
import { polygon, surface } from './campus-render-kit.js';
import { buildCampusTerrainGeometry, buildCampusTerrainSidesGeometry } from './campus-terrain-geometry.js';
import { SITE_FEATURES } from './basic-campus.js';
import { getCanonicalLandmark, projectPolygon } from './reality-adapter.js';
import { LIBRARY_GREENS, GARDEN_FLOOR } from './library-garden-layout.js';
import { SPORTS_CUT_RING, SPORTS_FLOOR } from './stadium-stands-layout.js';

const depressions=[
  {id:'garden',polygon:LIBRARY_GREENS[0].polygon,floor:GARDEN_FLOOR},
  {id:'sports',polygon:SPORTS_CUT_RING,floor:SPORTS_FLOOR}
];
const water=[projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon),
  ...SITE_FEATURES.filter(f=>f.kind==='reflecting_pool').map(f=>f.vertices)];

// This persistent foundation is not garden decoration. Keep it below the lawn
// (.018), paving (.020+) and water (.025), without changing gameplay grounding.
// Water keeps its exact boundary and own material; lowered areas are never capped.
export function buildCampusTerrain(root,bounds){
  const data=buildCampusTerrainGeometry(bounds,[...water,...depressions.map(q=>q.polygon)]);
  const material=surface('#8b9274');
  const addMesh=(name,data)=>{
    const mesh=pc.createMesh(pc.Application.getApplication().graphicsDevice,data.positions,{normals:data.normals,indices:data.indices});
    const entity=new pc.Entity(name);
    entity.addComponent('render',{type:'asset',castShadows:false,meshInstances:[new pc.MeshInstance(mesh,material)]});
    root.addChild(entity);entity.on('destroy',()=>mesh.destroy());return entity;
  };
  const terrain=addMesh('campus_terrain',data);
  // Plain floor surfaces only. Existing stairs, ramps, courts and walls retain
  // their own render/collision authority and can be restored independently.
  for(const q of depressions){
    polygon(root,`campus_terrain_${q.id}_floor`,q.polygon,material,{y:q.floor});
    addMesh(`campus_terrain_${q.id}_sides`,buildCampusTerrainSidesGeometry(q.polygon,q.floor));
  }
  return terrain;
}
