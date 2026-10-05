import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { GATE_FRAME } from './roadview-layout.js';
import { GATE_NAME_SIGNS } from './gate-dorm-exterior-layout.js';
import { buildStreetSigns } from './street-sign-renderer.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';
import { mainGateProductionStructure } from './editor/main-gate-production.js';

export function buildMainGateDetail(root) {
  const b=new FacilityMeshBatch(),f=GATE_FRAME;
  const p=(u,y,v)=>{const q=f.at(u,v);return [q.x,y,q.z];};
  const box=(color,u,y,v,w,h,d)=>b.box(color,p(u,y,v),[w,h,d],f.yaw);
  for(const side of [-1,1]) {
    // Existing low walls: individual stone courses, inset lettering, planting behind.
    box('#687472',side*16,.84,-.625,12,.83,.06);
    for(let u=side>0?10.3:8.5;u<24;u+=1.8)box('#b0ada2',side*u,.75,-.614,.025,1.45,.018);
    for(const y of [.38,.76,1.14])box('#b0ada2',side>0?16.75:-16,y,-.618,side>0?14.5:16,.025,.02);
    for(let u=side>0?10.5:9;u<24;u+=1.5)b.crown('#496443',p(side*u,.72,1.45),[1.7,1.15,1.4]);
    // Tactile pads and paving joints are flat visual dressing, not a walkable step.
    box('#c2aa63',side*8,G.PAINT,-6.5,1.3,.008,.65);
    for(let u=-.5;u<=.5;u+=.2)for(let v=-.2;v<=.2;v+=.2)
      box('#e0c982',side*8+u,G.DETAIL,-6.5+v,.055,.004,.055);
    // Paving joints follow the actual sidewalk in main-gate-road-geometry.js.
  }
  // Guardhouse fascia, framed windows and brick plinth are editor-authored structures.
  for(const id of [
    'gate_booth_detail_fascia','gate_booth_roof_trim',
    'gate_booth_window_bar_0','gate_booth_window_bar_1','gate_booth_window_bar_2','gate_booth_window_bar_3',
    'gate_booth_window_horizontal',
    'gate_booth_plinth_0','gate_booth_plinth_1','gate_booth_plinth_2'
  ]){
    const detail=mainGateProductionStructure(id);
    b.box(detail.color,detail.position,detail.size,detail.yaw);
  }
  // Painted double centre line is presentation-only; the traffic island geometry remains separate.
  for(const u of [-2.48,-1.52])box('#d0b04e',u,G.PAINT,3.6,.055,.006,6.3);
  b.finish(root,'main_gate_stone_paving_booth_detail');
  buildStreetSigns(root,GATE_NAME_SIGNS,'main_gate_names');
}
