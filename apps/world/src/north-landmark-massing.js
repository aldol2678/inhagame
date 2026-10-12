// Qualitative field-photo massing fitted to the existing mapped outlines.
// These are game-scale estimates, not surveyed dimensions. This module is the
// sole source of restored elevated volumes for both rendering and collision.
// The two photographed south arch runs flank the clock. Their mapped join is
// vertex 7 (end of edge 6), not the former midpoint of the western run.
// This relative architectural alignment is DERIVED_BLOCKOUT, not a survey.
export const FIVE_CLOCK_PLACEMENT=Object.freeze({
 edge:6,along:1,status:'DERIVED_BLOCKOUT',surveyPosition:null,
 evidence:'five-sixty-oblique + five-2025-spring; reviewed 2026-10-12'
});
export function photoNorthTowerParts(f){
 if(f.id==='bldg_60th'){
  // The official illustration confirms the N-S long axis and a south setback,
  // not the old north-shifted mini-footprint. Span/width below are a reversible
  // photographic fit; they are explicitly not a surveyed building-part polygon.
  const [a,b]=f.rings[0],length=Math.hypot(b.x-a.x,b.z-a.z);
  const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  const at=(u,inward)=>({x:a.x+tx*u-tz*inward,z:a.z+tz*u+tx*inward});
  return [{id:'bldg_60th_tower',height:36,vertices:[
   at(length*.18,3.6),at(length*.58,3.6),at(length*.58,9.2),at(length*.18,9.2)
  ]}];
 }
 if(f.id==='bldg_05'){
  // One existing attached core, moved to the join of the two south arch runs.
  const {edge,along}=FIVE_CLOCK_PLACEMENT;
  const a=f.rings[0][edge],b=f.rings[0][edge+1],length=Math.hypot(b.x-a.x,b.z-a.z);
  const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  const at=(u,inward)=>({x:a.x+tx*u-tz*inward,z:a.z+tz*u+tx*inward});
  return [{id:'bldg_05_clock_core',height:23.5,
   vertices:[at(length*along-2,.18),at(length*along+2,.18),at(length*along+2,4.2),at(length*along-2,4.2)]}];
 }
 return [];
}
