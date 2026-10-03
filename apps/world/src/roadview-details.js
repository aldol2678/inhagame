import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { mainGateProductionPath, mainGateProductionStructure } from './editor/main-gate-production.js';
import { gateCurbFaces, gateRibbon, gateRibbonTop, gateArrowTriangles, MAIN_GATE_LEVELS } from './main-gate-terrain-layout.js';
// Public QA: image-observation-specific visual dressing is withheld.
export function buildAgoraStructure(..._args) { return undefined; }
export function buildAgoraNear(..._args) { return undefined; }
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
export function buildLibraryWest(..._args) { return undefined; }
export function buildPondShore(..._args) { return undefined; }
export function buildPondFurniture(..._args) { return undefined; }
