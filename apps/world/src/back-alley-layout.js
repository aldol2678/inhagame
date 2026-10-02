// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { BACK_APPROACH_ROADS, BACK_APPROACH_SEGMENTS, backApproachFootprintClear } from './back-approach-layout.js';
import { BACK_STREET_BLOCKS } from './back-street-layout.js';
import { BACK_WEST_COLLIDERS } from './back-west-layout.js';
import { CULTURE_COLLIDERS } from './culture-street-layout.js';

const rectangle=(f,w,d,front=0)=>[[-w/2,front],[w/2,front],[w/2,front+d],[-w/2,front+d]].map(([u,v])=>f.at(u,v));
function overlaps(a,b){
  return [...a,...b].every((_,i)=>{
    const ring=i<a.length?a:b,j=i<a.length?i:i-a.length,p=ring[j],q=ring[(j+1)%ring.length];
    const project=r=>r.x*(q.z-p.z)-r.z*(q.x-p.x),aa=a.map(project),bb=b.map(project);
    return Math.max(...aa)>=Math.min(...bb)-.25&&Math.max(...bb)>=Math.min(...aa)-.25;
  });
}
const occupied=[...BACK_STREET_BLOCKS.map(q=>rectangle(q.frame,q.w,q.d,q.front)),...BACK_WEST_COLLIDERS.map(q=>q.polygon),...CULTURE_COLLIDERS.map(q=>q.polygon)];
const blocks=[];
for(const road of BACK_APPROACH_ROADS.filter(r=>r.style!=='avenue'||r.id==='inha_west_extension')){
  if(['inha_67_spur','inha_91_bend'].includes(road.id))continue;
  if(road.id.startsWith('west_'))continue; // Source footprints own these lanes.
  if(road.id==='inha_77_entrance'||road.id.startsWith('culture_'))continue; // Culture Street owns its exterior blockout.
  const segments=BACK_APPROACH_SEGMENTS.filter(s=>s.road===road);
  let stationStart=0;
  const lengths=segments.map(s=>{const start=stationStart;stationStart+=s.frame.length;return {s,start,end:stationStart};});
  const avenue=road.style==='avenue';
  for(const side of avenue?[1]:[1,-1])for(let station=avenue?4:9;station<stationStart-2.5;station+=6.2){
    const segment=lengths.find(s=>station<=s.end),f=segment.s.frame,u=station-segment.start;
    const setback=road.width/2+(avenue?2.8:.65);
    const frame={at:(x,v=0)=>f.at(u+side*x,side*(setback+v))};
    const a=frame.at(0),c=frame.at(1);frame.yaw=-Math.atan2(c.z-a.z,c.x-a.x)*180/Math.PI;
    const index=blocks.length,w=4,d=4,h=6;
    const polygon=rectangle(frame,w,d),bounds=rectangle(frame,w+.4,d+.8,-.5);
    if(bounds.some(p=>p.z>164.5||p.x>307)||!backApproachFootprintClear(polygon)||occupied.some(p=>overlaps(polygon,p)))continue;
    blocks.push({id:`back_alley_${road.id}_${side}_${Math.round(station)}`,index,frame,w,d,h,polygon,bounds,center:frame.at(0,d/2),
      color:'#598f91',sign:'#d9eeee'});
    occupied.push(polygon);
  }
}
export const BACK_ALLEY_BLOCKS=blocks;
export const BACK_ALLEY_COLLIDERS=blocks.map(q=>({id:q.id,polygon:q.polygon,minY:0,maxY:q.h+.3}));

