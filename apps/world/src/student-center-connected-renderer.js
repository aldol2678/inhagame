import * as pc from 'playcanvas';
import {FacilityMeshBatch} from './facility-mesh-batch.js';
import {surface} from './campus-render-kit.js';
import {PHOTO_STUDENT_COLORS} from './student-center-palette.js';
import {fillStudentCenterConnected} from './student-center-connected-geometry.js';
export {fillStudentCenterConnected};
const detailMaterials=new WeakMap();
const materialProfiles=new Map([[PHOTO_STUDENT_COLORS.glass,'glass'],[PHOTO_STUDENT_COLORS.wall,'brick'],[PHOTO_STUDENT_COLORS.trim,'concrete'],[PHOTO_STUDENT_COLORS.stairRed,'paint'],['#596065','metal'],['#6d5845','wood'],['#b5a487','concrete'],['#c7b596','concrete'],['#f2cb5b','paint']]);
function detailMaterial(source){
 if(!detailMaterials.has(source)){
  const material=source.clone(),top=[PHOTO_STUDENT_COLORS.trim,PHOTO_STUDENT_COLORS.warmWindow].some(c=>source.name.endsWith(c));
  // Preserve #135's depth-only decal offset and current-main optical profile.
  // Never mutate the shared BASE material or introduce the old batch-hook API.
  material.depthBias=top?-2:-1;material.slopeDepthBias=top?-2:-1;
  material.update();detailMaterials.set(source,material);
 }
 return detailMaterials.get(source);
}
export function buildStudentCenterConnected(root,tier='BASE',options={}){
 const batch=new FacilityMeshBatch();fillStudentCenterConnected(batch,tier,options);
 const group=new pc.Entity(`bldg_07_connected_${tier}`);root.addChild(group);
 batch.finish(group,`student_connected_${tier}`,{castShadows:tier==='BASE'});
 for(const component of group.findComponents('render'))for(const mesh of component.meshInstances){
  const color=mesh.material.name.slice(-7),profile=materialProfiles.get(color);
  const source=profile?surface(color,profile):mesh.material;
  mesh.material=tier==='NEAR'?detailMaterial(source):source;
 }
 return group;
}
