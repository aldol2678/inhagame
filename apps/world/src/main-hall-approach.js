import { stairTreadHeight } from './stair-profile.js';
// OSM way 217958071, edge 5 faces the canal. The field photos fix the form,
// while these dimensions describe the playable reconstruction in world units.
import { HALL_FRONT } from './basic-campus.js';
const { a, along, inward, length } = HALL_FRONT;
const frame = {
  length,
  yaw: -Math.atan2(along.z, along.x) * 180 / Math.PI,
  at(u, out) { return { x: a.x + along.x*u - inward.x*out, z: a.z + along.z*u - inward.z*out }; },
  local(p) { const x=p.x-a.x, z=p.z-a.z; return { u:x*along.x+z*along.z, out:-x*inward.x-z*inward.z }; }
};
export const MAIN_HALL_APPROACH = Object.freeze({
  frame, height:1.35, steps:15, landing:1.45, run:5.1, width:10.4,
  bankExtent:14.7, bankBevel:2.8
});
// Existing entry glazing starts .20 above the facade model's own origin.
export const HALL_FOUNDATION_HEIGHT = MAIN_HALL_APPROACH.height - .20;
export function hallApproachHeight(x, z) {
  const t=MAIN_HALL_APPROACH, {u,out}=frame.local({x,z});
  const side=Math.abs(u-length/2);
  if(out<0 || out>t.landing+t.run || side>t.bankExtent)return 0;
  if(side<=t.width/2)return stairTreadHeight(t,out);
  return t.height*Math.min(1,(t.landing+t.run-out)/t.run,(t.bankExtent-side)/t.bankBevel);
}
