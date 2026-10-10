import { forestRoadTrees, roadSegment } from './campus-road-layout.js';
import { FLAT_GROUND_Y } from './flat-ground-surface.js';

// Photo-informed silhouettes, not surveyed individual trees. Keep the existing
// forest positions, road-side brick walk and gameplay/navigation authorities.
// References and dated limitations: docs/implementation/heidegger-greenery-slice.md.
export const FOREST_COLORS=Object.freeze({trunk:'#6c5942',broadleaf:'#567f48',pine:'#41694b',soil:'#b5a187'});
export function forestTreeProfiles(center) {
  return forestRoadTrees(center).map((p,i)=>{
    const pine=i%3===1,turn=i*2.399963,kind=pine?'pine':'broadleaf';
    const height=7.4+(i%5)*.38,trunkHeight=height-(pine?1.45:2.0);
    const crowns=Array.from({length:3},(_,j)=>{
      const angle=turn+j*Math.PI*2/3,r=j===0?.2:.85;
      return {dx:Math.cos(angle)*r,dz:Math.sin(angle)*r,
        y:height-(pine?.85:1.2)-(j===0?0:j*.24),
        size:pine?[3.15,1.7-j*.12,2.85]:[3.15,2.4-j*.15,3.05]};
    });
    return {...p,index:i,kind,height,trunkHeight,radius:.23+(i%3)*.025,crowns};
  });
}
const cross=(a,b,c)=>(b.x-a.x)*(c.z-a.z)-(b.z-a.z)*(c.x-a.x);
function hull(points){
  const sorted=[...points].sort((a,b)=>a.x-b.x||a.z-b.z);
  const half=pts=>{const h=[];for(const p of pts){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=0)h.pop();h.push(p);}return h;};
  return [...half(sorted).slice(0,-1),...half(sorted.reverse()).slice(0,-1)];
}
export function forestSoilRing(center) {
  // One small clearing around the existing four-tree cluster. Restrict support
  // to the current grove, never the whole un-surveyed forest or central lawn.
  const frame=roadSegment(481241661,2).frame,a=frame.at(0),b=frame.at(1);
  const selected=forestRoadTrees(center).filter(p=>{
    const u=(p.x-a.x)*(b.x-a.x)+(p.z-a.z)*(b.z-a.z);
    return u>=6&&u<=13;
  });
  return hull(selected.flatMap((p,i)=>Array.from({length:8},(_,j)=>{
    const angle=j*Math.PI/4,r=1.85+.08*Math.sin(i+j*1.7);
    return {x:p.x+Math.cos(angle)*r,z:p.z+Math.sin(angle)*r};
  })));
}
export function fillHeideggerForest(batch,center) {
  const ring=forestSoilRing(center);
  // Convex, non-overlapping upward triangles in the existing flat render band.
  for(let i=1;i<ring.length-1;i++)batch.triangle(FOREST_COLORS.soil,
    ...[ring[0],ring[i+1],ring[i]].map(p=>[p.x,FLAT_GROUND_Y.UNDERLAY,p.z]));
  for(const t of forestTreeProfiles(center)){
    batch.tube(FOREST_COLORS.trunk,[t.x,0,t.z],[t.x,t.trunkHeight,t.z],t.radius,6);
    for(const crown of t.crowns){
      // Tall visible trunks and open irregular branch forks distinguish the
      // grove from the old equal-height single crowns, including at far LOD.
      batch.tube(FOREST_COLORS.trunk,[t.x,t.trunkHeight-1.35,t.z],
        [t.x+crown.dx,crown.y,t.z+crown.dz],t.radius*.48,4);
      batch.crown(FOREST_COLORS[t.kind],[t.x+crown.dx,crown.y,t.z+crown.dz],crown.size);
    }
  }
  return batch;
}
