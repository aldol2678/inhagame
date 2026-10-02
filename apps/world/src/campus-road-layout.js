// Public QA: OSM footprint/centerline facts and existing game navigation anchors only. Neutral generated presentation; no image-derived facades or measured visual dressing.
import { geoToWorld } from './geo-coordinates.js';
import { FACILITY_COLLIDERS } from './campus-facilities.js';
import { BUILDINGS, SITE_FEATURES } from './basic-campus.js';
import { polygonOverlap } from './polygon-collision.js';
const url=new URL('../data/reality/evidence/roads/source.json',import.meta.url);
const data=url.protocol==='file:'
  ? JSON.parse((await import('node:fs')).readFileSync(url,'utf8'))
  : await (async()=>{const r=await fetch(url);if(!r.ok)throw Error(`Road source load failed: ${r.status}`);return r.json();})();
const roadWidths={481241664:2.9,481241665:3.1,1098491075:2.7,1098491076:2.7,1098539002:2.8,481241676:3.0};
export const CAMPUS_ROADS=data.roads.map(r=>({...r,
  vertices:(r.osmWayId===216916384?r.line.slice(0,4):r.line).map(ll=>geoToWorld(...ll)),
  width:roadWidths[r.osmWayId]||3.5,shoulder:.35
}));
export function roadFrame(a,b) {
  const length=Math.hypot(b.x-a.x,b.z-a.z),tx=(b.x-a.x)/length,tz=(b.z-a.z)/length;
  return {length,at:(u,v=0)=>({x:a.x+tx*u-tz*v,z:a.z+tz*u+tx*v})};
}
export const ROAD_SEGMENTS=CAMPUS_ROADS.flatMap(r=>r.vertices.slice(1).map((b,i)=>({
  id:`${r.id}_${i}`,road:r,frame:roadFrame(r.vertices[i],b)
})));
export const roadSegment=(id,index)=>ROAD_SEGMENTS.find(s=>s.road.osmWayId===id&&s.id.endsWith(`_${index}`));
export const ROAD_CROSSWALKS=[roadSegment(481241661,2),roadSegment(481241685,0),roadSegment(481241675,3)]
  .map(segment=>({segment,u:segment.frame.length/2,width:2}));
export function distanceToRoad(p,s) {
  const a=s.frame.at(0),b=s.frame.at(s.frame.length),dx=b.x-a.x,dz=b.z-a.z;
  const t=Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.z-a.z)*dz)/(dx*dx+dz*dz)));
  return Math.hypot(p.x-a.x-dx*t,p.z-a.z-dz*t);
}
export const CAMPUS_PATH_WIDTHS={site_481241659:2.4,site_481241690:2.4,site_481241692:3.1,site_481241696:3.8};
const pathSegments=SITE_FEATURES.filter(f=>f.kind==='path').flatMap(f=>f.vertices.slice(1).map((b,i)=>({frame:roadFrame(f.vertices[i],b),road:{width:CAMPUS_PATH_WIDTHS[f.id]||3.5,shoulder:1.05}})));
export const roadTreeClear=(p,radius=1.9)=>[...ROAD_SEGMENTS,...pathSegments].every(s=>distanceToRoad(p,s)>s.road.width/2+s.road.shoulder+radius);
export function forestRoadTrees(center) {
  const f=roadSegment(481241661,2).frame,a=f.at(0),b=f.at(1);
  const u=(center.x-a.x)*(b.x-a.x)+(center.z-a.z)*(b.z-a.z);
  const trees=[];
  for(let row=-3;row<=9;row++)for(let col=0;col<3;col++){
    const p=f.at(u+row*5.4+Math.sin(row*2.1+col)*1.2,6.8+col*4.7+Math.cos(row+col*1.7)*.6);
    if(!roadTreeClear(p,2.5)||[...FACILITY_COLLIDERS,...BUILDINGS.map(b=>({polygon:b.vertices}))].some(b=>polygonOverlap(p.x,p.z,b.polygon,2.5)))continue;
    trees.push(p);
  }
  return trees;
}
