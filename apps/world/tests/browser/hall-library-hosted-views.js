import {BUILDINGS,HALL_FRONT,LIBRARY_FRONT,LIBRARY_ROOF_PARTS} from '../../src/basic-campus.js';

const dot=(a,b)=>a.reduce((sum,x,i)=>sum+x*b[i],0);
const roofPoints=part=>part.vertices.flatMap(p=>[part.y-part.height/2,part.y+part.height/2].map(y=>[p.x,y,p.z]));
function sourcePoints(id){
 const b=BUILDINGS.find(b=>b.id===id);
 if(!b)throw new Error('Unscoped photo landmark '+id);
 const points=(b.rings?b.rings.flat():b.vertices).flatMap(p=>[0,b.height].map(y=>[p.x,y,p.z]));
 return id==='bldg_jungseok'?points.concat(LIBRARY_ROOF_PARTS.flatMap(roofPoints)):points;
}
export function photoLandmarkView(id,aspect=1,{points,mode='full'}={}){
 let position,target;
 if(mode==='canopy'&&id==='bldg_jungseok'){
  const p=LIBRARY_FRONT.at(8,14),t=LIBRARY_FRONT.at(0,1.1);
  position=[p.x,1.8,p.z];target=[t.x,4.3,t.z];points=roofPoints(LIBRARY_ROOF_PARTS.find(p=>p.id==='library_entry_canopy'));
 }else if(id==='bldg_01'){const h=HALL_FRONT,x=(h.a.x+h.b.x)/2,z=(h.a.z+h.b.z)/2;position=[x-h.inward.x*48,14,z-h.inward.z*48];target=[x,5,z];}
 else if(id==='bldg_jungseok'){const p=LIBRARY_FRONT.at(0,40),t=LIBRARY_FRONT.at(0,-4);position=[p.x,21,p.z];target=[t.x,9,t.z];}
 else throw new Error('Unscoped photo landmark '+id);
 points??=sourcePoints(id);
 // Fit every actual mesh-bound corner, not a distance/aspect heuristic. Keep the
 // established viewing direction and reflection semantics; only the QA camera moves.
 const offset=position.map((x,i)=>x-target[i]),back=offset.map(x=>x/Math.hypot(...offset));
 const side=[back[2],0,-back[0]],right=side.map(x=>x/Math.hypot(...side));
 const up=[back[1]*right[2],back[2]*right[0]-back[0]*right[2],-back[1]*right[0]];
 const tan=Math.tan(48*Math.PI/360),margin=.84;
 let distance=Math.hypot(...offset);
 for(const point of points){const delta=point.map((x,i)=>x-target[i]),toward=dot(delta,back);
  distance=Math.max(distance,toward+Math.abs(dot(delta,right))/(tan*aspect*margin),toward+Math.abs(dot(delta,up))/(tan*margin));}
 return {position:target.map((x,i)=>x+back[i]*distance),target,points,mode};
}
