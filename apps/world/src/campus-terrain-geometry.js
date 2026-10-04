// Neutral render-only ground, independent of image-derived garden dressing.
// Subtract triangulated cutouts exactly; centroid/grid rejection would leave
// sawtooth shoreline gaps or cover parts of the concave sports/garden basins.
import { triangulatePolygon } from './reality-adapter.js';

const EPS=1e-9;
const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
const area=ring=>ring.reduce((s,p,i)=>{const q=ring[(i+1)%ring.length];return s+p.x*q.z-q.x*p.z;},0)/2;
const bounds=ring=>({minX:Math.min(...ring.map(p=>p.x)),maxX:Math.max(...ring.map(p=>p.x)),minZ:Math.min(...ring.map(p=>p.z)),maxZ:Math.max(...ring.map(p=>p.z))});
const overlap=(a,b)=>a.minX<b.maxX-EPS&&a.maxX>b.minX+EPS&&a.minZ<b.maxZ-EPS&&a.maxZ>b.minZ+EPS;

function halfPlane(ring,a,b,inside){
  const result=[];
  for(let i=0;i<ring.length;i++){
    const p=ring[i],q=ring[(i+1)%ring.length];
    // Cutout triangles are clockwise in XZ, so their inside is the right side.
    const dp=cross(a,b,p)*(inside?-1:1),dq=cross(a,b,q)*(inside?-1:1);
    const pin=dp>=-EPS,qin=dq>=-EPS;
    if(pin)result.push(p);
    if(pin!==qin){const t=dp/(dp-dq);result.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});}
  }
  return result.filter((p,i)=>{const q=result[(i+result.length-1)%result.length];return Math.hypot(p.x-q.x,p.z-q.z)>EPS;});
}

export function buildCampusTerrainGeometry(envelope,cutouts=[]){
  const {minX,maxX,minZ,maxZ}=envelope;
  if(![minX,maxX,minZ,maxZ].every(Number.isFinite)||minX>=maxX||minZ>=maxZ)throw Error('Terrain requires finite ordered bounds');
  let pieces=[[{x:minX,z:minZ},{x:minX,z:maxZ},{x:maxX,z:maxZ},{x:maxX,z:minZ}]];
  for(const ring of cutouts){
    const ids=triangulatePolygon(ring);
    for(let t=0;t<ids.length;t+=3){
      const triangle=ids.slice(t,t+3).map(i=>ring[i]),cutBounds=bounds(triangle),next=[];
      for(const piece of pieces){
        if(!overlap(bounds(piece),cutBounds)){next.push(piece);continue;}
        let remainder=piece;
        for(let i=0;i<3&&remainder.length>=3;i++){
          const a=triangle[i],b=triangle[(i+1)%3],outside=halfPlane(remainder,a,b,false);
          if(outside.length>=3&&Math.abs(area(outside))>EPS)next.push(outside);
          remainder=halfPlane(remainder,a,b,true);
        }
      }
      pieces=next;
    }
  }
  const positions=[],normals=[],indices=[];
  for(const piece of pieces){
    // Each clipped piece remains convex and clockwise; a fan has upward normals.
    for(let i=1;i<piece.length-1;i++){
      const triangle=[piece[0],piece[i],piece[i+1]];
      if(cross(...triangle)>=-EPS)continue;
      const first=positions.length/3;
      for(const p of triangle){positions.push(p.x,0,p.z);normals.push(0,1,0);}
      indices.push(first,first+1,first+2);
    }
  }
  return {positions,normals,indices};
}

// Close the below-grade cross-section without capping a lowered area or adding
// collision. Inward front faces stop oblique rays escaping beneath its far lip.
export function buildCampusTerrainSidesGeometry(vertices,floor){
  triangulatePolygon(vertices); // Same finite/simple ring contract as the floor.
  if(!Number.isFinite(floor)||floor>=0)throw Error('Terrain side floor must be below zero');
  const ring=area(vertices)<0?vertices:[...vertices].reverse();
  const positions=[],normals=[],indices=[];
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],dx=b.x-a.x,dz=b.z-a.z,len=Math.hypot(dx,dz),first=positions.length/3;
    positions.push(a.x,floor,a.z,a.x,0,a.z,b.x,0,b.z,b.x,floor,b.z);
    for(let j=0;j<4;j++)normals.push(dz/len,0,-dx/len);
    indices.push(first,first+1,first+2,first,first+2,first+3);
  }
  return {positions,normals,indices};
}
