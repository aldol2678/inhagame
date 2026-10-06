import { FACILITIES } from './campus-facilities.js';
import { MAIN_ENTRANCE } from './basic-campus.js';

// One gameplay-layout owner for the source-estimated landmark and its natural
// branch seats. Source position is in campus-facilities.json, not copied here.
const facility=FACILITIES.find(f=>f.id==='lmk_matching_tree');
const center=Object.freeze({...facility.center});
// Available photos do not establish a north-calibrated facing. Align the U fork
// with the existing campus axis, opening toward the pool for a clear approach.
const axis=Object.freeze({...MAIN_ENTRANCE.inward}),front=Object.freeze({x:-axis.z,z:axis.x});
const at=(u=0,v=0,y=0)=>({x:center.x+axis.x*u+front.x*v,y,z:center.z+axis.z*u+front.z*v});
const node=(u,y,v,radius)=>Object.freeze({u,y,v,radius});
const branches=Object.freeze([
 Object.freeze([node(-.54,.35,0,.13),node(-.76,.56,0,.11),node(-.82,1.0,.02,.095),node(-.77,1.65,-.04,.075),node(-1.03,2.25,.04,.058),node(-.92,2.8,.13,.038)]),
 Object.freeze([node(.53,.35,0,.14),node(.77,.55,.02,.12),node(.83,1.1,-.035,.10),node(.75,1.7,.01,.075),node(1.09,2.2,-.07,.05),node(1.25,2.85,-.1,.03)]),
 Object.freeze([node(-.77,1.65,-.04,.065),node(-.35,2.2,-.25,.05),node(-.20,2.8,-.3,.03)]),
 Object.freeze([node(.75,1.7,.01,.065),node(.45,2.1,.3,.045),node(.65,2.7,.4,.025)])
]);
export const MATCHING_TREE=Object.freeze({id:facility.id,center,axis,front,at,
 yaw:Math.atan2(front.x,front.z)*180/Math.PI,seatTopY:.42,seatV:.04,standV:.96,
 seatOffsets:Object.freeze([-.27,.27]),branches,
 // Gray-brown fork and uneven broadleaf-like masses follow visible form; no
 // species assertion is made because the published species descriptions differ.
 crowns:Object.freeze([
  {u:-1.1,v:.10,y:3.04,size:[1.5,.9,1.25]},
  {u:-.25,v:-.3,y:3.05,size:[1.45,1.0,1.25]},
  {u:1.22,v:-.1,y:3.12,size:[1.6,1.02,1.3]},
  {u:.65,v:.4,y:2.98,size:[1.5,.88,1.3]}
 ].map(c=>Object.freeze({...c,size:Object.freeze(c.size)})))
});
