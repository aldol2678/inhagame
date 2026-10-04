import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { POND_RING, POND_TREE_SEATING, edgeFrame, pondSeatTrees, pondBankTrees } from './roadview-layout.js';
import { polygonOverlap } from './polygon-collision.js';
import { FLAT_GROUND_Y as G } from './flat-ground-surface.js';

export const POND_COLORS=Object.freeze({stone:'#b8b4a5',wood:'#776750',trunk:'#6c5942',leaves:'#527745',willow:'#64854a'});

const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
function crosses(a,b,c,d){
  return cross(a,b,c)*cross(a,b,d)<-1e-10 && cross(c,d,a)*cross(c,d,b)<-1e-10;
}
function outsideWater(ring){
  if(ring.some(p=>polygonOverlap(p.x,p.z,POND_RING)))return false;
  if(POND_RING.some(p=>polygonOverlap(p.x,p.z,ring)))return false;
  return ring.every((a,i)=>POND_RING.every((c,j)=>!crosses(a,ring[(i+1)%ring.length],c,POND_RING[(j+1)%POND_RING.length])));
}
function stoneShore(batch){
  // Photos establish an irregular stone margin. This is a flush visual cap,
  // not a surveyed bank height or a new walkable wall. Water stays untouched.
  for(let edge=0;edge<POND_RING.length;edge++){
    const f=edgeFrame(POND_RING,edge);
    for(let u=.10,index=0;u<f.length-.10;u+=.62,index++){
      const end=Math.min(u+.59,f.length-.10),width=.46+.07*Math.sin(index*2.3+edge);
      const ring=[f.at(u,.025),f.at(end,.025),f.at(end,width),f.at(u,width)];
      if(!outsideWater(ring))continue;
      const vertices=ring.map(p=>[p.x,G.EDGE,p.z]);
      const [a,b,c]=vertices;
      if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<0)vertices.reverse();
      batch.quad(POND_COLORS.stone,...vertices);
    }
  }
}
function seatRing(batch,center){
  // Existing 4 × 8 interaction design is the sole seat placement authority.
  // These ring seats are gameplay presentation, not a claim about photographed furniture.
  const {slabs,ringRadius,slabY,slabSize}=POND_TREE_SEATING;
  for(let i=0;i<slabs;i++){
    const a=i/slabs*Math.PI*2,dx=Math.cos(a),dz=Math.sin(a),yaw=Math.atan2(dx,dz)*180/Math.PI;
    const x=center.x+dx*ringRadius,z=center.z+dz*ringRadius;
    batch.box(POND_COLORS.wood,[x,slabY,z],slabSize,yaw);
    batch.box(POND_COLORS.wood,[x,(slabY-slabSize[1]/2)/2,z],[.10,slabY-slabSize[1]/2,.18],yaw);
  }
}
function tree(batch,p,{seat=false}={}){
  const hero=p.heroWillow===true,willow=p.willow===true;
  const height=hero?5.8:seat?3.4:4.3,radius=hero?3.2:seat?1.7:2.1;
  batch.tube(POND_COLORS.trunk,[p.x,0,p.z],[p.x,height-.6,p.z],seat?.13:.18,6);
  const color=willow?POND_COLORS.willow:POND_COLORS.leaves;
  batch.crown(color,[p.x,height,p.z],[radius*2,willow?2.3:2.5,radius*2]);
  if(willow)for(let i=0;i<8;i++){
    const a=i*Math.PI/4,x=p.x+Math.cos(a)*radius*.73,z=p.z+Math.sin(a)*radius*.73;
    // Coarse hanging lobes survive distance/quality changes with the silhouette.
    // Their bottoms stay above the standing player's head; no new collision.
    batch.crown(color,[x,hero?3.8:3.15,z],[hero?.95:.65,hero?2.9:1.7,hero?.95:.65]);
  }
}

export function fillPondSurroundingsBase(batch){
  stoneShore(batch);
  for(const {center} of pondSeatTrees()){seatRing(batch,center);tree(batch,center,{seat:true});}
  for(const p of pondBankTrees())tree(batch,p);
  return batch;
}

// Persistent, independent owner: bldg_07's renderer and its LOD cannot suppress
// these active seats or make the shoreline vanish. No texture, light or collider.
export function buildPondSurroundingsBase(root){
  const batch=new FacilityMeshBatch();fillPondSurroundingsBase(batch);
  batch.finish(root,'pond_surroundings_base');
}
