// Bounded data for the shared hosted comparison fixture; no browser launch here.
import { BACK_SIGNAL_CROSSINGS } from '../../src/back-roadside-layout.js';
import { SIDE_GATE_FRAME } from '../../src/north-side-gate-layout.js';
import { CULTURE_GATE } from '../../src/culture-street-layout.js';

export const ROAD_BASELINE='3b95e37f3dec477ebe7e06456907176bb81a63a2';
export const ROAD_BASELINE_PATHS=Object.freeze(['/src/back-street-geometry.js','/src/culture-street-geometry.js','/src/north-side-gate-geometry.js','/src/campus-road-blockout.js']);
export const ROAD_OWNER_PREFIXES=Object.freeze(['back_street_paving_','back_street_signals_','culture_street_paving_','north_side_gate_']);
export const ROAD_VIEWS=Object.freeze([
  ...BACK_SIGNAL_CROSSINGS.map(q=>({name:`${q.id}-crossing`,frame:q.frame,width:15,depth:14,height:4})),
  {name:'side-gate',frame:SIDE_GATE_FRAME,width:12,depth:10,height:2},
  {name:'culture-paving',frame:CULTURE_GATE.frame,width:12,depth:12,height:4}
 ].map(q=>({...q,w:q.width,d:q.depth,h:q.height})));
export function roadCameraFor(view,{width,height}){
  const from=view.frame.at(-7,-10),to=view.frame.at(0);
  return {projection:'orthographic',position:[from.x,10,-from.z],target:[to.x,1,-to.z],
    orthoHeight:Math.max(9,11*height/width),nearClip:.05,farClip:150};
}
export function roadRoutes(){
  const rows=[
    ...BACK_SIGNAL_CROSSINGS.map(q=>({name:`${q.id}-crossing`,a:q.frame.at(0,-4.5),b:q.frame.at(0,5.3)})),
    {name:'side-gate',a:SIDE_GATE_FRAME.at(0,2.5),b:SIDE_GATE_FRAME.at(0,-3)},
    {name:'culture-canopy',a:CULTURE_GATE.frame.at(-4,0),b:CULTURE_GATE.frame.at(4,0)}
  ];
  return rows.flatMap(q=>[{id:q.name+':forward',start:q.a,target:q.b},{id:q.name+':reverse',start:q.b,target:q.a}]);
}

export function roadViewCorners(view){
  return [-1,1].flatMap(u=>[-1,1].flatMap(v=>[0,view.height].map(y=>{const p=view.frame.at(u*view.width/2,v*view.depth/2);return[p.x,y,-p.z];})));
}
export const roadOwnerName=name=>ROAD_OWNER_PREFIXES.some(prefix=>name.startsWith(prefix));
