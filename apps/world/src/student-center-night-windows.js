// Night overlays use the reviewed v09 glass bands, not the displaced OSM outline.
import {V09_PRIMITIVES} from './student-center-candidate-data.js';
import {studentConnectedFrame} from './student-center-frame.js';
export function studentNightWindows(){
 const f=studentConnectedFrame(),o=f.toWorld([0,0,0]),u=f.toWorld([2,0,0]),n=f.toWorld([0,0,2]);
 return V09_PRIMITIVES.filter(p=>/^SC[3-6]_WindowBand_glass$/.test(p.name)).flatMap(p=>{
  const bays=Math.max(3,Math.floor(p.size[0]/4.5));
  return Array.from({length:bays},(_,i)=>{
   const point=f.toWorld([p.position[0]-p.size[0]/2+(i+.5)*p.size[0]/bays,p.position[1],p.position[2]+p.size[2]/2+.025]);
   return Object.freeze({buildingId:'bldg_07',sourceName:p.name,x:point[0],y:point[1],z:point[2],tx:u[0]-o[0],tz:u[2]-o[2],nx:n[0]-o[0],nz:n[2]-o[2],width:Math.min(1.65,p.size[0]/bays/2-.16),height:p.size[1]/2-.12,tone:i%5===0?'cool':'warm'});
  });
 });
}
