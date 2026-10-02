import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { mainGateProductionPath, mainGateProductionStructure } from './editor/main-gate-production.js';
import { roadFrame } from './campus-road-layout.js';
import { corridor, QA } from './public-qa-geometry.js';
// Public QA: image-observation-specific visual dressing is withheld.
export function buildAgoraStructure(..._args) { return undefined; }
export function buildAgoraNear(..._args) { return undefined; }
export function buildStudentTerraces(..._args) { return undefined; }
export function fillStudentFront(..._args) { return undefined; }
export function buildGateRoadview(root){
  const b=new FacilityMeshBatch();
  const booth=mainGateProductionStructure('gate_security_booth');
  b.box(QA.body,booth.position,booth.size,booth.yaw);
  for(const id of ['gate_booth_roof_fascia','gate_booth_front_glass','gate_booth_side_panel']){
    const q=mainGateProductionStructure(id);b.box(QA.edge,q.position,q.size,q.yaw);
  }
  for(const id of ['gate_curb_west','gate_curb_east']){
    const q=mainGateProductionPath(id);
    for(let i=1;i<q.vertices.length;i++)corridor(b,roadFrame(q.vertices[i-1],q.vertices[i]),q.width);
  }
  b.finish(root,'public_gate_booth');
}
export function buildLibraryWest(..._args) { return undefined; }
export function buildPondShore(..._args) { return undefined; }
export function buildPondFurniture(..._args) { return undefined; }
