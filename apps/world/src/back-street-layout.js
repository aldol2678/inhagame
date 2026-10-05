// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { BACK_SEGMENTS, BACK_GATE_FRAME } from './back-gate-layout.js';
import { backApproachClear, backApproachFootprintClear } from './back-approach-layout.js';

let length=0;
export const BACK_STREET_SEGMENTS=BACK_SEGMENTS.filter(s=>s.road.osmWayId===1223158575).map(s=>{
  const start=length;length+=s.frame.length;return {...s,start,end:length};
});
export const BACK_STREET_LENGTH=length;
export function streetFrame(station) {
  const s=BACK_STREET_SEGMENTS.find(s=>station<=s.end)||BACK_STREET_SEGMENTS.at(-1);
  const a=s.frame.at(0),b=s.frame.at(1);
  return {at:(u,v=0)=>s.frame.at(station-s.start+u,v),yaw:-Math.atan2(b.z-a.z,b.x-a.x)*180/Math.PI};
}
export const streetPoint=(station,v=0)=>streetFrame(station).at(0,v);
const crossing=BACK_GATE_FRAME.at(-9.25,6.6);
export const BACK_CROSSING_STATION=BACK_STREET_SEGMENTS.reduce((best,s)=>{
  const a=s.frame.at(0),b=s.frame.at(1),u=Math.max(0,Math.min(s.frame.length,(crossing.x-a.x)*(b.x-a.x)+(crossing.z-a.z)*(b.z-a.z)));
  const p=s.frame.at(u),distance=Math.hypot(p.x-crossing.x,p.z-crossing.z);
  return distance<best.distance?{station:s.start+u,distance}:best;
},{distance:Infinity}).station;
export const crossingClear=station=>Math.abs(station-BACK_CROSSING_STATION)<3.3;
const polygon=(f,u,v,w,d)=>[[-1,-1],[1,-1],[1,1],[-1,1]].map(([x,z])=>f.at(u+x*w/2,v+z*d/2));
const tones=['#598f91'];
const signs=['#d9eeee'];
export const BACK_STREET_BLOCKS=Array.from({length:12},(_,i)=>{
  const station=4+i*7.8,frame=streetFrame(station),w=6,d=4,h=6;
  return {id:`back_street_${i}`,index:i,station,frame,w,d,h,front:6.5,color:tones[i%tones.length],sign:signs[i%signs.length],
    center:frame.at(0,8),bounds:[...polygon(frame,0,10,8,9),...polygon(frame,0,0,8,10)]};
}).filter(q=>backApproachFootprintClear(polygon(q.frame,0,q.front+q.d/2-.45,q.w,q.d+.9)));
export const BACK_STREET_RAILS=Array.from({length:Math.floor((length-2)/1.6)},(_,i)=>1+i*1.6)
  .filter(s=>!crossingClear(s)&&!crossingClear(s+1.6))
  .filter(s=>backApproachClear(streetPoint(s+.8),.9))
  // Keep the existing campus-road junction open as well as the zebra crossing.
  .filter(s=>BACK_SEGMENTS.filter(t=>t.road.osmWayId!==1223158575).every(t=>
    [t.frame.at(0),t.frame.at(t.frame.length)].every(p=>{const q=streetPoint(s+.8);return Math.hypot(p.x-q.x,p.z-q.z)>3.2;})))
  .map((s,i)=>({id:`back_street_rail_${i}`,station:s,frame:streetFrame(s+.8),w:1.6}));
export const BACK_STREET_COLLIDERS=[
  ...BACK_STREET_BLOCKS.map(q=>({id:q.id,polygon:polygon(q.frame,0,q.front+q.d/2,q.w,q.d),minY:0,maxY:q.h})),
  ...BACK_STREET_RAILS.map(q=>({id:q.id,polygon:polygon(q.frame,0,0,q.w,.14),minY:0,maxY:.65}))
];
