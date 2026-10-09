import { triangulatePolygon } from './reality-adapter.js';

const EPS = 1e-8;
const cross = (a, b, p) => (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
const area = ring => ring.reduce((s,p,i) => {
  const q=ring[(i+1)%ring.length]; return s+p.x*q.z-q.x*p.z;
},0)/2;
export const contactBounds = ring => ({
  minX:Math.min(...ring.map(p=>p.x)), maxX:Math.max(...ring.map(p=>p.x)),
  minZ:Math.min(...ring.map(p=>p.z)), maxZ:Math.max(...ring.map(p=>p.z))
});
const overlaps = (a,b) => a.minX<b.maxX-EPS && a.maxX>b.minX+EPS &&
  a.minZ<b.maxZ-EPS && a.maxZ>b.minZ+EPS;

// Clip with interpolated opacity. Corner/centroid rejection would allow a thin
// shadow to bridge a path, basin or stair even when its centre is safe.
function halfPlane(ring,a,b,inside) {
  const result=[];
  for(let i=0;i<ring.length;i++) {
    const p=ring[i],q=ring[(i+1)%ring.length];
    const dp=cross(a,b,p)*(inside?-1:1),dq=cross(a,b,q)*(inside?-1:1);
    const pin=dp>=-EPS,qin=dq>=-EPS;
    if(pin)result.push(p);
    if(pin!==qin) {
      const t=dp/(dp-dq);
      result.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t,
        alpha:p.alpha+(q.alpha-p.alpha)*t});
    }
  }
  return result.filter((p,i)=>{
    const q=result[(i+result.length-1)%result.length];
    return Math.hypot(p.x-q.x,p.z-q.z)>EPS;
  });
}
export function contactMask(ring) {
  const ids=triangulatePolygon(ring),triangles=[];
  for(let i=0;i<ids.length;i+=3) {
    let vertices=ids.slice(i,i+3).map(k=>ring[k]);
    if(area(vertices)>0)vertices=[...vertices].reverse();
    triangles.push({vertices,bounds:contactBounds(vertices)});
  }
  return {bounds:contactBounds(ring),triangles};
}
export function subtractContactMasks(pieces,masks) {
  for(const mask of masks) {
    if(!pieces.some(p=>overlaps(contactBounds(p),mask.bounds)))continue;
    for(const cut of mask.triangles) {
      const next=[];
      for(const piece of pieces) {
        if(!overlaps(contactBounds(piece),cut.bounds)){next.push(piece);continue;}
        let intersection=piece;
        for(let i=0;i<3 && intersection.length>=3;i++)
          intersection=halfPlane(intersection,cut.vertices[i],cut.vertices[(i+1)%3],true);
        if(intersection.length<3 || Math.abs(area(intersection))<=EPS){next.push(piece);continue;}
        let remainder=piece;
        for(let i=0;i<3 && remainder.length>=3;i++) {
          const a=cut.vertices[i],b=cut.vertices[(i+1)%3];
          const outside=halfPlane(remainder,a,b,false);
          if(outside.length>=3 && Math.abs(area(outside))>EPS)next.push(outside);
          remainder=halfPlane(remainder,a,b,true);
        }
      }
      pieces=next;
    }
  }
  return pieces;
}

export function contactEllipse(center,at,radiusX,radiusZ,alpha=.16) {
  const ring=(scale,opacity)=>Array.from({length:8},(_,i)=>{
    const a=i/8*Math.PI*2,p=at(Math.cos(a)*radiusX*scale,Math.sin(a)*radiusZ*scale);
    return {...p,alpha:opacity};
  });
  const inner=ring(.35,alpha),outer=ring(1,0),c={...center,alpha},pieces=[];
  for(let i=0;i<8;i++) {
    const j=(i+1)%8;
    pieces.push([c,inner[i],inner[j]],[inner[i],outer[i],outer[j],inner[j]]);
  }
  return pieces;
}

export function buildContactGeometry(patches,receivers,{maxTriangles=400,maxBytes=256*1024}={}) {
  const positions=[],normals=[],colors=[],indices=[],sources=[],occupied=[];
  let skipped=0;
  for(const patch of patches) {
    const triangles=[];
    for(const receiver of receivers) {
      if(patch.receiver && patch.receiver!==receiver.id)continue;
      for(const input of patch.pieces) {
        if(!overlaps(contactBounds(input),receiver.mask.bounds))continue;
        for(const target of receiver.mask.triangles) {
          if(!overlaps(contactBounds(input),target.bounds))continue;
          let piece=input;
          for(let i=0;i<3 && piece.length>=3;i++)
            piece=halfPlane(piece,target.vertices[i],target.vertices[(i+1)%3],true);
          const pieces=subtractContactMasks(piece.length>=3?[piece]:[],[...receiver.exclude,...occupied]);
          for(let part of pieces) {
            if(area(part)>0)part=[...part].reverse();
            for(let i=1;i<part.length-1;i++) {
              const tri=[part[0],part[i],part[i+1]];
              if(Math.abs(cross(...tri))>EPS)triangles.push({tri,y:receiver.y+.0015,receiver:receiver.id});
            }
          }
        }
      }
    }
    // Keep whole patches, rather than partially emitting a circle at the cap.
    // Position + normal + RGBA floats + uint16 index = 42 bytes/vertex.
    if(!triangles.length || indices.length/3+triangles.length>maxTriangles ||
      (positions.length+triangles.length*9)/3*42>maxBytes){skipped++;continue;}
    const first=indices.length/3;
    for(const {tri,y} of triangles) {
      const offset=positions.length/3;
      for(const p of tri){positions.push(p.x,y,p.z);normals.push(0,1,0);colors.push(1,1,1,p.alpha);}
      indices.push(offset,offset+1,offset+2);
    }
    // Receivers are exclusive and patches have disjoint primitives. Subtract
    // emitted coverage from subsequent objects to prevent compounded darkness.
    occupied.push(...triangles.map(({tri})=>contactMask(tri)));
    sources.push({id:patch.id,kind:patch.kind,first,triangles:triangles.length,
      receivers:[...new Set(triangles.map(t=>t.receiver))]});
  }
  return {positions,normals,colors,indices,sources,skipped,
    triangles:indices.length/3,bufferBytes:positions.length/3*42};
}

export function contactVisibility({tier='medium',snow=0,fade=1,enabled=true,near=false}={}) {
  const clamp=v=>Math.min(1,Math.max(0,Number.isFinite(v)?v:0));
  return enabled && !(near && tier==='low') ? clamp(fade)*(1-clamp(snow/.14)) : 0;
}
