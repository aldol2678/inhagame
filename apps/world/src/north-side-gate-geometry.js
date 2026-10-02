// Independent public QA geometry: uniform primitives, no visual-reference input.
import { SIDE_GATE_PATHS, SIDE_GATE_BOXES, SIDE_GATE_FRAME } from './north-side-gate-layout.js';
import { corridor, box } from './public-qa-geometry.js';
export function fillNorthSideGate(b){
  for(const s of SIDE_GATE_PATHS)corridor(b,s.frame,s.width);
  for(const q of SIDE_GATE_BOXES)box(b,SIDE_GATE_FRAME,q.u,q.v,(q.minY+q.maxY)/2,q.w,q.maxY-q.minY,q.d);
  return b;
}
