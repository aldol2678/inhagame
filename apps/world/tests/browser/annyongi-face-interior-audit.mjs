/** Read-only static GLB facial-overlay/head intersection audit. No dependencies.
 * CLI: node annyongi-face-interior-audit.mjs /private/input.glb [expectedSha256]
 * Outputs summary metadata only; never emits source geometry or writes files.
 * +Z is the authored face-front direction. Static authored pose only.
 */
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const EPS=1e-10;
const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const area=p=>Math.abs(p.reduce((s,a,i)=>{const b=p[(i+1)%p.length];return s+a[0]*b[1]-b[0]*a[1];},0))/2;
const bounds=t=>[Math.min(...t.map(p=>p[0])),Math.min(...t.map(p=>p[1])),Math.max(...t.map(p=>p[0])),Math.max(...t.map(p=>p[1]))];
const overlap=(a,b)=>a[0]<=b[2]+EPS&&a[2]>=b[0]-EPS&&a[1]<=b[3]+EPS&&a[3]>=b[1]-EPS;
function zAt(t,p){const d=cross(...t);if(Math.abs(d)<EPS)return null;const a=cross(t[1],t[2],p)/d,b=cross(t[2],t[0],p)/d,c=1-a-b;return Math.min(a,b,c)<-1e-7?null:a*t[0][2]+b*t[1][2]+c*t[2][2];}
function clip(subject,triangle){
  let p=subject.map(v=>v.slice(0,2));const sign=Math.sign(cross(...triangle));
  for(let k=0;k<3&&p.length;k++){
    const a=triangle[k],b=triangle[(k+1)%3],out=[];
    for(let i=0;i<p.length;i++){
      const u=p[i],v=p[(i+1)%p.length],du=sign*cross(a,b,u),dv=sign*cross(a,b,v),insideU=du>=-EPS,insideV=dv>=-EPS;
      if(insideU)out.push(u);
      if(insideU!==insideV){const r=du/(du-dv);out.push([u[0]+r*(v[0]-u[0]),u[1]+r*(v[1]-u[1])]);}
    }p=out;
  }return p;
}

/** Exact piecewise-planar XY overlap extrema, with frontmost-head witness check.
 * Does not infer GPU depth precision, shadow artifacts, or screen-space visibility.
 */
export function auditTriangles(headTriangles,featureTriangles,{tolerance=1e-5}={}){
  const head=headTriangles.map((t,id)=>({t,id,b:bounds(t)})).filter(h=>Math.abs(cross(...h.t))>EPS);
  let min=Infinity,max=-Infinity,overlapPairs=0,penetratingPairs=0,nearContactPairs=0,interiorOnlyPenetratingTriangles=0;
  const affected=new Set(),interiorOnly=new Set();
  const front=(p)=>{let z=-Infinity;const b=[p[0],p[1],p[0],p[1]];for(const h of head)if(overlap(h.b,b)){const v=zAt(h.t,p);if(v!==null)z=Math.max(z,v);}return z;};
  for(let fi=0;fi<featureTriangles.length;fi++){
    const f=featureTriangles[fi];if(Math.abs(cross(...f))<=EPS)continue;
    const fb=bounds(f),localHead=head.filter(h=>overlap(fb,h.b));
    const originalVertexMin=Math.min(...f.map(p=>{const z=front(p);return Number.isFinite(z)?p[2]-z:Infinity;}));
    for(const h of localHead){
      const polygon=clip(f,h.t);if(polygon.length<3||area(polygon)<=EPS)continue;
      const diffs=[];
      // The pair's separation is affine over this intersection polygon.
      // A negative value at a verified front-surface point is a true witness.
      for(const p of polygon){const hz=zAt(h.t,p),fz=zAt(f,p);if(hz===null||fz===null)continue;if(Math.abs(hz-front(p))>tolerance)continue;diffs.push(fz-hz);}
      if(!diffs.length)continue;
      overlapPairs++;const lo=Math.min(...diffs),hi=Math.max(...diffs);min=Math.min(min,lo);max=Math.max(max,hi);
      if(lo < -tolerance){penetratingPairs++;affected.add(fi);if(originalVertexMin>=-tolerance)interiorOnly.add(fi);}
      if(lo<=tolerance&&hi>=-tolerance)nearContactPairs++;
    }
  }
  interiorOnlyPenetratingTriangles=interiorOnly.size;
  return {headTriangles:headTriangles.length,featureTriangles:featureTriangles.length,overlapPairs,
    minSeparation:Number.isFinite(min)?min:null,maxSeparation:Number.isFinite(max)?max:null,
    penetratingPairs,penetratingFeatureTriangles:affected.size,interiorOnlyPenetratingTriangles,nearContactPairs,tolerance,
    interpretation:'Negative separation proves static +Z head occlusion at a checked overlap point; zero counts do not prove all-view, animated, or GPU render correctness.'};
}

const identity=()=>[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
function multiply(a,b){const o=Array(16).fill(0);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)o[c*4+r]+=a[k*4+r]*b[c*4+k];return o;}
function transform(m,p){return [0,1,2].map(r=>m[r]*p[0]+m[4+r]*p[1]+m[8+r]*p[2]+m[12+r]);}
function matrix(n){
  if(n.matrix)return n.matrix;
  const [x,y,z,w]=n.rotation||[0,0,0,1],s=n.scale||[1,1,1],t=n.translation||[0,0,0];
  return [(1-2*y*y-2*z*z)*s[0],(2*x*y+2*z*w)*s[0],(2*x*z-2*y*w)*s[0],0,
    (2*x*y-2*z*w)*s[1],(1-2*x*x-2*z*z)*s[1],(2*y*z+2*x*w)*s[1],0,
    (2*x*z+2*y*w)*s[2],(2*y*z-2*x*w)*s[2],(1-2*x*x-2*y*y)*s[2],0,...t,1];
}
function parseGlb(bytes){
  if(bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)throw Error('Invalid GLB');
  let g,bin;for(let at=12;at+8<=bytes.length;){const n=bytes.readUInt32LE(at),type=bytes.readUInt32LE(at+4);at+=8;if(type===0x4e4f534a)g=JSON.parse(bytes.toString('utf8',at,at+n));if(type===0x004e4942)bin=bytes.subarray(at,at+n);at+=n;}
  if(!g||!bin||g.buffers.length!==1||g.buffers[0].uri)throw Error('Only embedded single-buffer GLB supported');
  function accessor(i){
    const a=g.accessors[i],v=g.bufferViews[a.bufferView];if(a.sparse||!v||v.extensions?.EXT_meshopt_compression)throw Error('Sparse/compressed accessor unsupported');
    const methods={5120:['readInt8',1],5121:['readUInt8',1],5122:['readInt16LE',2],5123:['readUInt16LE',2],5125:['readUInt32LE',4],5126:['readFloatLE',4]};
    const [method,width]=methods[a.componentType]||[];const count={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];if(!method||!count||a.normalized)throw Error('Accessor representation unsupported');
    const stride=v.byteStride||count*width,offset=(v.byteOffset||0)+(a.byteOffset||0);
    return Array.from({length:a.count},(_,j)=>Array.from({length:count},(_,k)=>bin[method](offset+j*stride+k*width)));
  }
  const parents=new Map();g.nodes.forEach((n,i)=>(n.children||[]).forEach(c=>{if(parents.has(c))throw Error('Multiple-parent node unsupported');parents.set(c,i);}));
  const cache=new Map();function world(i,seen=new Set()){if(cache.has(i))return cache.get(i);if(seen.has(i))throw Error('Cyclic node graph');seen.add(i);const m=multiply(parents.has(i)?world(parents.get(i),seen):identity(),matrix(g.nodes[i]));cache.set(i,m);return m;}
  function triangles(nodeIndex){
    const node=g.nodes[nodeIndex],mesh=g.meshes[node.mesh],out=[],m=world(nodeIndex);
    if(node.skin!==undefined||node.weights?.some(v=>v!==0)||mesh.weights?.some(v=>v!==0))throw Error('Skinned or active morph geometry unsupported');
    for(const p of mesh.primitives){
      if((p.mode??4)!==4||p.extensions?.KHR_draco_mesh_compression)throw Error('Only uncompressed triangle-list primitives supported');
      const positions=accessor(p.attributes.POSITION).map(v=>transform(m,v)),indices=p.indices===undefined?positions.map((_,i)=>i):accessor(p.indices).map(v=>v[0]);
      if(indices.length%3)throw Error('Invalid triangle index count');for(let k=0;k<indices.length;k+=3)out.push(indices.slice(k,k+3).map(i=>positions[i]));
    }return out;
  }
  return {g,triangles};
}

export function auditGlb(bytes,{expectedSha256,headName='Head',featureNames=['Forelock curled contour','Nose lobe contour -1','Nose lobe contour 1','Open smile outer contour','Open smile berry inside','Smile upper lip -1','Smile upper lip 1','Lower tongue','Rosy cheek -1','Rosy cheek 1','Tiny fang -1','Tiny fang 1'],tolerance=1e-5}={}){
  const sha256=createHash('sha256').update(bytes).digest('hex');if(expectedSha256&&sha256!==expectedSha256)throw Error('Asset hash mismatch');
  const {g,triangles}=parseGlb(bytes);const ids=name=>g.nodes.map((n,i)=>n.name===name?i:-1).filter(i=>i>=0);
  const heads=ids(headName);if(heads.length!==1)throw Error('Head name must resolve uniquely');
  const head=triangles(heads[0]);const features={};
  for(const name of featureNames){const found=ids(name);if(found.length!==1)throw Error(`Feature must resolve uniquely: ${name}`);features[name]=auditTriangles(head,triangles(found[0]),{tolerance});}
  return {sha256,bytes:bytes.length,headName,projection:'Authored world +Z; no animation or camera transforms applied',features,
    limitations:['Assumes face-front is world +Z and a single-valued front skin locally.','Checks static mesh triangles, not shadows, transparency, PBR, GPU depth precision or moving poses.','Back-head overlaps are filtered with frontmost-height witnesses. Complex overlapping head shells require separate review.','Positive separation does not establish pixel-level visual quality.']};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.argv[2])throw Error('Usage: node annyongi-face-interior-audit.mjs input.glb [expectedSha256]');
  console.log(JSON.stringify(auditGlb(readFileSync(process.argv[2]),{expectedSha256:process.argv[3]}),null,2));
}
