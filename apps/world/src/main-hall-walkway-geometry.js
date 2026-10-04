import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { MAIN_HALL_WALKWAYS } from './main-hall-walkway-layout.js';
import { SITE_FEATURES } from './basic-campus.js';
import { CAMPUS_PATH_WIDTHS } from './campus-road-layout.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';

// Keep new paving outside the two already-owned source surfaces. Millimetric
// height separation is not enough on every mobile depth buffer or viewing angle.
export function fillMainHallWalkways(batch){
  const receiverWidth=CAMPUS_PATH_WIDTHS.site_481241692||3.5;
  for(const {sourceId,frame,width} of MAIN_HALL_WALKWAYS){
    // The existing perpendicular receiving lane owns its full surface + shoulder.
    // Navigation/map still continue to its center; only overlapping render is cut.
    const end=frame.length-(receiverWidth+2.1)/2;
    const vertices=SITE_FEATURES.find(f=>f.id===sourceId).vertices,[a,b]=vertices.slice(-2);
    const direction={x:b.x-a.x,z:b.z-a.z},start=frame.at(0),step=frame.at(1);
    const denominator=(step.x-start.x)*direction.x+(step.z-start.z)*direction.z;
    const meetAvenue=v=>{
      const p=frame.at(0,v),u=-((p.x-b.x)*direction.x+(p.z-b.z)*direction.z)/denominator;
      return frame.at(u,v);
    };
    // Intersect both side edges with the donor's terminal line, including its
    // slight angle to this connector. This leaves neither an overlap nor a gap.
    const ring=[meetAvenue(-width/2),meetAvenue(width/2),frame.at(end,width/2),frame.at(end,-width/2)];
    batch.quad('#b4b4a8',...ring.map(p=>[p.x,G.SURFACE,p.z]));
  }
  return batch;
}
export function buildMainHallWalkways(root){
  const batch=new FacilityMeshBatch();fillMainHallWalkways(batch);
  batch.finish(root,'main_hall_walkways',{castShadows:false});
}
