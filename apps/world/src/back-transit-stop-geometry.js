import { BACK_GATE_511_STOP_FRAME as stop } from './back-transit-stop-layout.js';

const metal='#4f595b',green='#5b9b65',white='#eef1e8',dark='#24363b';
const point=(u,v,y)=>{const p=stop.at(u,v);return[p.x,y,p.z];};
const box=(b,c,u,v,y,w,h,d)=>b.box(c,point(u,v,y),[w,h,d],stop.yaw);

export function fillBackTransitStop(b){
  b.tube(metal,point(0,0,0),point(0,0,2.45),.055,7);
  box(b,green,0,0,2.08,.72,.54,.08);
  box(b,white,0,-.046,2.09,.56,.30,.012);
  box(b,dark,0,-.055,1.86,.48,.08,.012);
  box(b,metal,0,0,.08,.24,.16,.24);
  return b;
}
