// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { GATE_FRAME } from './roadview-layout.js';
import { HALL_FRONT } from './basic-campus.js';
import { DORM_1_FRAME } from './dorm1-layout.js';
import { streetSign } from './street-sign-layout.js';

export const GATE_NAME_SIGNS = [-1, 1].map(side => streetSign({
  id:`main_gate_name_${side}`, label:side < 0 ? '인하대학교' : 'INHA UNIVERSITY',
  center:GATE_FRAME.at(side * 16, -.665),
  outward:{x:-HALL_FRONT.inward.x,z:-HALL_FRONT.inward.z},
  width:6, bottom:.6, top:1
}));
export const DORM_1_NAME_SIGN = streetSign({
  id:'dorm1_entrance_name',label:'제1생활관 웅비재',center:DORM_1_FRAME.at(0,1.65),
  outward:DORM_1_FRAME.outward,width:3,bottom:2.8,top:3.2
});

export const DORM_1_FENCES = [-1,1].map(side => {
  const start=side*2.8,end=side*5.5,v=4.8,half=.09;
  return {id:`dorm1_front_fence_${side}`,start,end,v,
    polygon:[DORM_1_FRAME.at(start,v-half),DORM_1_FRAME.at(end,v-half),
      DORM_1_FRAME.at(end,v+half),DORM_1_FRAME.at(start,v+half)],minY:0,maxY:1.15};
});
export const DORM_1_EXTERIOR_BOUNDS = [-5.8,5.8].flatMap(u=>[0,5.5].map(v=>DORM_1_FRAME.at(u,v)));
export const DORM_1_EXTERIOR_SPAWN = {
  ...DORM_1_FRAME.at(0,10),yaw:Math.atan2(DORM_1_FRAME.outward.x,-DORM_1_FRAME.outward.z)
};
export const GATE_EXTERIOR_SPAWN = {
  ...GATE_FRAME.at(0,-22),yaw:-Math.atan2(HALL_FRONT.inward.x,HALL_FRONT.inward.z)
};
