// Independent public QA geometry: uniform primitives, no visual-reference input.
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { mainGateProductionStructure } from './editor/main-gate-production.js';
import { GATE_FRAME } from './main-gate-frame.js';
import { rect, QA } from './public-qa-geometry.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
export function buildMainGateDetail(root){
  const b=new FacilityMeshBatch();
  for(const id of ['gate_booth_detail_fascia','gate_booth_roof_trim','gate_booth_window_bar_0','gate_booth_window_bar_1','gate_booth_window_bar_2','gate_booth_window_bar_3','gate_booth_window_horizontal','gate_booth_plinth_0','gate_booth_plinth_1','gate_booth_plinth_2']){
    const q=mainGateProductionStructure(id);b.box(QA.edge,q.position,q.size,q.yaw);
  }
  for(const side of [-1,1])rect(b,GATE_FRAME,side*5-.2,side*5+.2,-3,3,G.PAINT,QA.edge);
  b.finish(root,'public_gate_detail');
}
