import { geoToWorld } from './geo-coordinates.js';
import { roadFrame, distanceToRoad } from './campus-road-layout.js';
import { polygonOverlap } from './polygon-collision.js';

const url=new URL('../data/reality/evidence/roads/back-approaches.json',import.meta.url);
// Node (tests, QA) reads file: URLs from disk; browsers fetch over HTTP. Deciding by protocol,
// not by `window`, keeps tests that shim `window` working.
const data=url.protocol==='file:'
  ? JSON.parse((await import('node:fs')).readFileSync(url,'utf8'))
  : await (async()=>{const r=await fetch(url);if(!r.ok)throw Error(`Back approach source load failed: ${r.status}`);return r.json();})();
export const BACK_APPROACH_ROADS=data.roads.map(r=>({...r,vertices:r.line.map(ll=>geoToWorld(...ll))}));
export const BACK_APPROACH_SEGMENTS=BACK_APPROACH_ROADS.flatMap(r=>r.vertices.slice(1).map((p,i)=>({id:`${r.id}_${i}`,road:r,frame:roadFrame(r.vertices[i],p)})));
export const backApproachClear=(p,pad=0)=>BACK_APPROACH_SEGMENTS.every(s=>distanceToRoad(p,s)>s.road.width/2+pad);
export function backApproachFootprintClear(polygon){
  // Presentation-only shop estimates yield to the observed road network.
  return BACK_APPROACH_SEGMENTS.every(s=>{
    const count=Math.ceil(s.frame.length/.4);
    for(let i=0;i<=count;i++){
      const p=s.frame.at(s.frame.length*i/count);
      if(polygonOverlap(p.x,p.z,polygon,s.road.width/2+.4))return false;
    }
    return true;
  });
}
