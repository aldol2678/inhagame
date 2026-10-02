import { HALL_FRONT } from './basic-campus.js';

export const GATE_FRAME=Object.freeze({
  yaw:-Math.atan2(HALL_FRONT.along.z,HALL_FRONT.along.x)*180/Math.PI,
  at:(u,v)=>({
    x:HALL_FRONT.along.x*u+HALL_FRONT.inward.x*v,
    z:-90+HALL_FRONT.along.z*u+HALL_FRONT.inward.z*v
  })
});

export const rectInGateFrame=(u0,u1,v0,v1)=>[
  GATE_FRAME.at(u0,v0),
  GATE_FRAME.at(u1,v0),
  GATE_FRAME.at(u1,v1),
  GATE_FRAME.at(u0,v1)
];
