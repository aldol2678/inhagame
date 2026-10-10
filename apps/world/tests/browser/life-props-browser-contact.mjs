// Contact diagnostics only. All inputs come from the real hand/GLB mesh triangles,
// transformed into the primary Hand entity's local coordinates by the fixture.
const dot=(a,b)=>a.reduce((s,n,i)=>s+n*b[i],0);
const sub=(a,b)=>a.map((n,i)=>n-b[i]);
const mul=(a,n)=>a.map(x=>x*n);
const add=(a,b)=>a.map((n,i)=>n+b[i]);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=a=>Math.hypot(...a);
const segmentPoint=(a,b)=>{const edge=sub(b,a),denom=dot(edge,edge);return add(a,mul(edge,denom>0?Math.max(0,Math.min(1,-dot(a,edge)/denom)):0));};
export function closestTrianglePointToOrigin(a,b,c) {
  const ab=sub(b,a),ac=sub(c,a),normal=cross(ab,ac),nn=dot(normal,normal);
  if(nn>1e-24){
    const p=mul(normal,dot(a,normal)/nn),ap=sub(p,a);
    const aa=dot(ab,ab),bb=dot(ab,ac),cc=dot(ac,ac),d=dot(ap,ab),e=dot(ap,ac),denom=aa*cc-bb*bb;
    const v=(cc*d-bb*e)/denom,w=(aa*e-bb*d)/denom;
    if(v>=-1e-10 && w>=-1e-10 && v+w<=1+1e-10)return p;
  }
  return [segmentPoint(a,b),segmentPoint(b,c),segmentPoint(c,a)].sort((x,y)=>dot(x,x)-dot(y,y))[0];
}
function rayTriangle(direction,[a,b,c]) {
  const edge1=sub(b,a),edge2=sub(c,a),h=cross(direction,edge2),det=dot(edge1,h);
  if(Math.abs(det)<1e-12)return null;
  const s=mul(a,-1),u=dot(s,h)/det;if(u<-.000001 || u>1.000001)return null;
  const q=cross(s,edge1),v=dot(direction,q)/det;if(v<-.000001 || u+v>1.000001)return null;
  const t=dot(edge2,q)/det;return t>0?t:null;
}
export const HAND_CONTACT_LIMITS=Object.freeze({maximumPenetrationWorld:.0015,maximumGapWorld:.002,minimumEnvelopeClearance:-.03});
export function contactAcceptable({penetrationDepthWorld,contactGapWorld,minimumEnvelopeClearance}) {
  return Number.isFinite(minimumEnvelopeClearance)&&minimumEnvelopeClearance>=HAND_CONTACT_LIMITS.minimumEnvelopeClearance
    &&Number.isFinite(penetrationDepthWorld)&&penetrationDepthWorld>=0&&penetrationDepthWorld<=HAND_CONTACT_LIMITS.maximumPenetrationWorld
    &&Number.isFinite(contactGapWorld)&&contactGapWorld>=0&&contactGapWorld<=HAND_CONTACT_LIMITS.maximumGapWorld;
}
export function measureHandContact({handTriangles,propTriangles,handWorldScale}) {
  if(!handTriangles.length || !propTriangles.length || handWorldScale.length!==3 || !handWorldScale.every(n=>Number.isFinite(n)&&n>0))throw Error('Missing actual hand/prop contact geometry');
  const handEnvelopeRadius=Math.max(...handTriangles.flatMap(triangle=>triangle.map(length)));
  let closestPropPointLocal=null,minPropRadius=Infinity;
  for(const triangle of propTriangles){
    const point=closestTrianglePointToOrigin(...triangle),radius=length(point);
    if(radius<minPropRadius){minPropRadius=radius;closestPropPointLocal=point;}
  }
  const direction=minPropRadius>1e-10?mul(closestPropPointLocal,1/minPropRadius):[1,0,0];
  const hits=handTriangles.map(t=>rayTriangle(direction,t)).filter(Number.isFinite);
  if(!hits.length)throw Error('Actual hand mesh has no radial surface contact');
  const surfaceContactPointLocal=mul(direction,Math.min(...hits));
  const minimumEnvelopeClearance=minPropRadius-handEnvelopeRadius;
  // The enclosing sphere becomes an ellipsoid under the real hand transform.
  // Its penetration estimate is conservative; actual low-poly hand facets lie
  // inside that envelope. The separate gap uses a real hand triangle ray hit.
  const penetrationDepthWorld=Math.max(0,-minimumEnvelopeClearance)*Math.max(...handWorldScale);
  const contactGapWorld=length(sub(closestPropPointLocal,surfaceContactPointLocal).map((n,i)=>n*handWorldScale[i]));
  return {triangleCount:propTriangles.length,handTriangleCount:handTriangles.length,handEnvelopeRadius,minPropRadius,minimumEnvelopeClearance,
    penetrationDepthWorld,contactGapWorld,handWorldScale,closestPropPointLocal,surfaceContactPointLocal,limits:HAND_CONTACT_LIMITS,
    acceptable:contactAcceptable({penetrationDepthWorld,contactGapWorld,minimumEnvelopeClearance})};
}

const clamp=n=>Math.max(0,Math.min(1,n));
function closestSegments(a,b,c,d) {
  const u=sub(b,a),v=sub(d,c),w=sub(a,c),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w);
  let s=0,t=0;
  if(aa<1e-24)t=cc<1e-24?0:clamp(ee/cc);
  else if(cc<1e-24)s=clamp(-dd/aa);
  else {
    const denominator=aa*cc-bb*bb;s=denominator>1e-24?clamp((bb*ee-cc*dd)/denominator):0;
    t=(bb*s+ee)/cc;
    if(t<0){t=0;s=clamp(-dd/aa);}else if(t>1){t=1;s=clamp((bb-dd)/aa);}
  }
  return {trianglePoint:add(a,mul(u,s)),segmentPoint:add(c,mul(v,t))};
}
export function closestTrianglePointToSegment(a,b,c,start,end) {
  const direction=sub(end,start),hit=rayTriangle(direction,[a,b,c].map(p=>sub(p,start)));
  if(hit!==null && hit<=1){const point=add(start,mul(direction,hit));return{trianglePoint:point,segmentPoint:point,distance:0};}
  const candidates=[start,end].map(point=>({trianglePoint:add(point,closestTrianglePointToOrigin(...[a,b,c].map(p=>sub(p,point)))),segmentPoint:point}));
  for(const edge of [[a,b],[b,c],[c,a]])candidates.push(closestSegments(...edge,start,end));
  return candidates.map(pair=>({...pair,distance:length(sub(pair.trianglePoint,pair.segmentPoint))})).sort((a,b)=>a.distance-b.distance)[0];
}
export function measureCapsuleClearance({bodyTriangles,propTriangles,bodyWorldScale}) {
  if(!bodyTriangles.length || !propTriangles.length || bodyWorldScale.length!==3 || !bodyWorldScale.every(n=>Number.isFinite(n)&&n>0))throw Error('Missing actual forearm/prop geometry');
  const vertices=bodyTriangles.flat(),capsuleRadius=Math.max(...vertices.map(p=>Math.hypot(p[0],p[2])));
  const axisStart=[0,Math.min(...vertices.map(p=>p[1]))+capsuleRadius,0],axisEnd=[0,Math.max(...vertices.map(p=>p[1]))-capsuleRadius,0];
  if(axisEnd[1]<axisStart[1])throw Error('Forearm mesh is not the expected Y-axis capsule');
  let closest={distance:Infinity};
  for(const triangle of propTriangles){const value=closestTrianglePointToSegment(...triangle,axisStart,axisEnd);if(value.distance<closest.distance)closest=value;}
  const minimumEnvelopeClearance=closest.distance-capsuleRadius;
  const penetrationDepthWorld=Math.max(0,-minimumEnvelopeClearance)*Math.max(...bodyWorldScale);
  return {triangleCount:propTriangles.length,bodyTriangleCount:bodyTriangles.length,capsuleRadius,axisStart,axisEnd,minimumAxisDistance:closest.distance,
    minimumEnvelopeClearance,penetrationDepthWorld,bodyWorldScale,closestPropPointLocal:closest.trianglePoint,closestAxisPointLocal:closest.segmentPoint,
    acceptable:Number.isFinite(penetrationDepthWorld)&&penetrationDepthWorld<=HAND_CONTACT_LIMITS.maximumPenetrationWorld&&minimumEnvelopeClearance>=HAND_CONTACT_LIMITS.minimumEnvelopeClearance};
}
