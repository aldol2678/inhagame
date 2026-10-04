// Qualitative field-photo massing fitted to the existing mapped outlines.
// These are game-scale estimates, not surveyed dimensions. This module is the
// sole source of restored elevated volumes for both rendering and collision.
export function photoNorthTowerParts(f){
 if(f.id==='bldg_60th'){
  // The official illustration confirms the N-S long axis and a south setback,
  // not the old north-shifted mini-footprint. Span/width below are a reversible
  // photographic fit; they are explicitly not a surveyed building-part polygon.
  const [a,b]=f.rings[0],length=Math.hypot(b.x-a.x,b.z-a.z);
  const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  const at=(u,inward)=>({x:a.x+tx*u-tz*inward,z:a.z+tz*u+tx*inward});
  return [{id:'bldg_60th_tower',height:30,vertices:[
   at(length*.18,3.6),at(length*.72,3.6),at(length*.72,9.2),at(length*.18,9.2)
  ]}];
 }
 if(f.id==='bldg_05'){
  // Official campus illustration places the attached clock core on the south
  // frontage, a little east of its midpoint. No free-standing ground obstacle.
  const a=f.rings[0][7],b=f.rings[0][8],length=Math.hypot(b.x-a.x,b.z-a.z);
  const tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  const at=(u,inward)=>({x:a.x+tx*u-tz*inward,z:a.z+tz*u+tx*inward});
  return [{id:'bldg_05_clock_core',height:23.5,
   vertices:[at(.6,.18),at(4.6,.18),at(4.6,4.2),at(.6,4.2)]}];
 }
 return [];
}
