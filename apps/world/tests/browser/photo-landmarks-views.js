import {HALL_FRONT,LIBRARY_FRONT} from '../../src/basic-campus.js';

export function photoLandmarkView(id,aspect=1){
 const d=Math.max(1,1/aspect);
 if(id==='bldg_07')return {position:[141-48*d,8+10*d,32+8*d],target:[143,6.5,32]};
 if(id==='bldg_01'){const h=HALL_FRONT,x=(h.a.x+h.b.x)/2,z=(h.a.z+h.b.z)/2;return {position:[x-h.inward.x*48*d,6+8*d,z-h.inward.z*48*d],target:[x,5,z]};}
 if(id==='bldg_jungseok'){const p=LIBRARY_FRONT.at(0,40*d),t=LIBRARY_FRONT.at(0,-4);return {position:[p.x,12+9*d,p.z],target:[t.x,9,t.z]};}
 throw new Error('Unscoped photo landmark '+id);
}
