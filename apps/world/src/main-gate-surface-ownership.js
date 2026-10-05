// The editor owns the visible gate apron/frontage. Legacy GIS roads and
// their shoulders continue outside it, without painting across the new gate.
import { MAIN_GATE_FORECOURT_QUADS } from './main-gate-forecourt.js';
import { mainGateProductionPath } from './editor/main-gate-production.js';

const EPS=1e-8;
const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
const area=ring=>ring.reduce((sum,p,i)=>{const q=ring[(i+1)%ring.length];return sum+p.x*q.z-q.x*p.z;},0)/2;
const road=mainGateProductionPath('sosung_ro_frontage');
const [a,b]=road.vertices,span=Math.hypot(b.x-a.x,b.z-a.z);
const nx=-(b.z-a.z)/span*road.width/2,nz=(b.x-a.x)/span*road.width/2;
export const MAIN_GATE_GROUND_MASKS=Object.freeze([
  ...MAIN_GATE_FORECOURT_QUADS,
  [{x:a.x+nx,z:a.z+nz},{x:b.x+nx,z:b.z+nz},{x:b.x-nx,z:b.z-nz},{x:a.x-nx,z:a.z-nz}]
].map(r=>Object.freeze((area(r)<0?[...r].reverse():[...r]).map(p=>Object.freeze({x:p.x,z:p.z})))));

const bounds=ring=>({minX:Math.min(...ring.map(p=>p.x)),maxX:Math.max(...ring.map(p=>p.x)),minZ:Math.min(...ring.map(p=>p.z)),maxZ:Math.max(...ring.map(p=>p.z))});
const maskBounds=MAIN_GATE_GROUND_MASKS.map(bounds);
const overlaps=(a,b)=>a.minX<b.maxX-EPS&&a.maxX>b.minX+EPS&&a.minZ<b.maxZ-EPS&&a.maxZ>b.minZ+EPS;

function halfPlane(ring,a,b,inside){
  const out=[];
  for(let i=0;i<ring.length;i++){
    const p=ring[i],q=ring[(i+1)%ring.length];
    const dp=cross(a,b,p)*(inside?1:-1),dq=cross(a,b,q)*(inside?1:-1);
    const pin=dp>=-EPS,qin=dq>=-EPS;
    if(pin)out.push(p);
    if(pin!==qin){const t=dp/(dp-dq);out.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});}
  }
  return out.filter((p,i)=>{const q=out[(i+out.length-1)%out.length];return Math.hypot(p.x-q.x,p.z-q.z)>EPS;});
}

export function clipLegacyGateGround(ring){
  let pieces=[ring];
  for(let k=0;k<MAIN_GATE_GROUND_MASKS.length;k++){
    const mask=MAIN_GATE_GROUND_MASKS[k],next=[];
    for(const piece of pieces){
      if(!overlaps(bounds(piece),maskBounds[k])){next.push(piece);continue;}
      let remainder=piece;
      for(let i=0;i<mask.length&&remainder.length>=3;i++){
        const a=mask[i],b=mask[(i+1)%mask.length];
        const outside=halfPlane(remainder,a,b,false);
        if(outside.length>=3&&Math.abs(area(outside))>EPS)next.push(outside);
        remainder=halfPlane(remainder,a,b,true);
      }
    }
    pieces=next;
  }
  return pieces;
}

export function gateGroundOverlaps(ring){
  const original=Math.abs(area(ring));
  return clipLegacyGateGround(ring).reduce((sum,r)=>sum+Math.abs(area(r)),0)<original-EPS;
}

// Convex input quads stay convex after half-plane clipping. Emit a triangle
// fan as nondegenerate four-vertex faces for the existing batch API.
export function fillLegacyGateGround(batch,color,ring,y){
  for(let piece of clipLegacyGateGround(ring)){
    if(area(piece)>0)piece=[...piece].reverse();
    if(piece.length===4){batch.quad(color,...piece.map(p=>[p.x,y,p.z]));continue;}
    for(let i=1;i<piece.length-1;i++){
      const a=piece[0],b=piece[i],c=piece[i+1];
      if(Math.abs(cross(a,b,c))<=EPS)continue;
      batch.quad(color,[a.x,y,a.z],[b.x,y,b.z],[(b.x+c.x)/2,y,(b.z+c.z)/2],[c.x,y,c.z]);
    }
  }
}

export function gateClippedRoadBatch(batch){
  return {quad(color,...vertices){
    fillLegacyGateGround(batch,color,vertices.map(p=>({x:p[0],z:p[2]})),vertices[0][1]);
  },box(...args){return batch.box(...args);}};
}
