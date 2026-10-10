import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { fillPhotoLibraryWest } from './photo-hall-library-geometry.js';
import { fillAgoraPhotoStructure,fillAgoraPhotoNear } from './agora-photo-geometry.js';
import { mainGateProductionPath, mainGateProductionStructure } from './editor/main-gate-production.js';
import { gateCurbFaces, gateRibbon, gateRibbonTop, gateArrowTriangles, MAIN_GATE_LEVELS } from './main-gate-terrain-layout.js';
// Agora uses a bounded photo-informed presentation. Unrelated retired builders
// remain untouched; student center is owned by its connected renderer.
export function buildAgoraStructure(_root,batch) { fillAgoraPhotoStructure(batch); }
export function buildAgoraNear(root) { const batch=new FacilityMeshBatch();fillAgoraPhotoNear(batch);batch.finish(root,'agora_photo_rails'); }
export function buildStudentTerraces(..._args) { return undefined; }
export function fillStudentFront(..._args) { return undefined; }
export function buildGateRoadview(root){
  const b=new FacilityMeshBatch();
  const booth=mainGateProductionStructure('gate_security_booth');
  b.box(booth.color,booth.position,booth.size,booth.yaw);
  for(const id of ['gate_booth_roof_fascia','gate_booth_front_glass','gate_booth_side_panel']){
    const detail=mainGateProductionStructure(id);
    b.box(detail.color,detail.position,detail.size,detail.yaw);
  }
  for(const id of ['gate_curb_west','gate_curb_east']){
    const curb=mainGateProductionPath(id);
    for(const face of gateCurbFaces(curb))b.quad('#c9c8ba',...face);
    const accent=gateRibbon(curb.vertices,curb.width+.5).edges.map(edge=>{
      const p=edge[curb.side<0?1:0];return {x:p[0],y:MAIN_GATE_LEVELS.paint,z:p[2]};
    });
    for(const face of gateRibbonTop(accent,.07))b.quad('#d5bc65',...face);
  }
  for(const id of ['gate_traffic_island_base','gate_traffic_island_green']){
    const structure=mainGateProductionStructure(id);
    b.box(structure.color,structure.position,structure.size,structure.yaw);
  }
  for(const u of [-4.2,4.2])for(const v of [0,8]){
    const direction=u>0?1:-1;
    for(const triangle of gateArrowTriangles(u,v,direction))b.triangle('#eeeadd',...triangle);
  }
  b.finish(root,'gate_roadview');
}
export function buildLibraryWest(root,tier='DETAIL') {
  if(tier!=='BASE'&&tier!=='DETAIL')return;
  const batch=new FacilityMeshBatch();
  fillPhotoLibraryWest(batch,tier);
  batch.finish(root,'library_west_'+tier.toLowerCase());
}
export function buildPondShore(..._args) { return undefined; }
export function buildPondFurniture(..._args) { return undefined; }
