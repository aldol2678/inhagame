// Convex surface partitioning. Cut geometry, never stack replacement slabs.
export const surfaceArea = ring => ring.reduce((s,p,i)=>{
  const q=ring[(i+1)%ring.length];return s+p.x*q.z-q.x*p.z;
},0)/2;
const cross=(a,b,p)=>(b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x);
const clean=ring=>ring.filter((p,i)=>Math.hypot(p.x-ring[(i+ring.length-1)%ring.length].x,p.z-ring[(i+ring.length-1)%ring.length].z)>1e-8);
function half(ring,a,b,sign){
  const out=[];
  for(let i=0;i<ring.length;i++){
    const p=ring[i],q=ring[(i+1)%ring.length],dp=sign*cross(a,b,p),dq=sign*cross(a,b,q);
    if(dp>=0)out.push(p);
    if((dp>=0)!==(dq>=0)){const t=dp/(dp-dq);out.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t});}
  }
  return clean(out);
}
export function intersectSurface(ring,mask){
  let out=ring;const sign=Math.sign(surfaceArea(mask));
  for(let i=0;i<mask.length&&out.length>=3;i++)out=half(out,mask[i],mask[(i+1)%mask.length],sign);
  return out.length>=3&&Math.abs(surfaceArea(out))>1e-8?out:[];
}
export function subtractSurface(ring,mask){
  if(!intersectSurface(ring,mask).length)return [ring];
  const pieces=[],sign=Math.sign(surfaceArea(mask));let rest=ring;
  for(let i=0;i<mask.length&&rest.length>=3;i++){
    const a=mask[i],b=mask[(i+1)%mask.length],out=half(rest,a,b,-sign);
    if(out.length>=3&&Math.abs(surfaceArea(out))>1e-8)pieces.push(out);
    rest=half(rest,a,b,sign);
  }
  return pieces;
}
export const cutSurfaces=(rings,masks)=>masks.reduce((pieces,mask)=>pieces.flatMap(r=>subtractSurface(r,mask)),rings);
export const surfaceRect=(frame,u0,u1,v0,v1)=>[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(p=>frame.at(...p));
export function emitSurface(batch,color,ring,y){
  const p=surfaceArea(ring)>0?[...ring].reverse():ring;
  // Nondegenerate quads keep the existing CPU recorders and GPU batch API.
  for(let i=1;i<p.length-1;i++){
    const [a,b,c]=[p[0],p[i],p[i+1]];
    if(Math.abs(cross(a,b,c))<1e-8)continue;
    batch.quad(color,[a.x,y,a.z],[b.x,y,b.z],[(b.x+c.x)/2,y,(b.z+c.z)/2],[c.x,y,c.z]);
  }
}
