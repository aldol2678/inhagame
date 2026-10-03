// Main-gate presentation heights share the flat-ground contract. Walking ground
// remains roadviewGroundHeight()=0 here; decoration never owns actor grounding.
import { FLAT_GROUND_Y as G, FLAT_GROUND_MAX_Y } from './flat-ground-surface.js';
import { GATE_FRAME } from './main-gate-frame.js';
import { MAIN_GATE_SPAWN } from './campus-spawn.js';
import { triangulatePolygon } from './reality-adapter.js';

export const MAIN_GATE_LEVELS = Object.freeze({ road: G.SURFACE, sidewalk: G.EDGE,
  paint: G.PAINT, joint: G.DETAIL, zebra: FLAT_GROUND_MAX_Y });
// Canonical site paths that cross the gate approach or meet its campus-side end.
// Only their render levels change; their source vertices/widths remain untouched.
export const MAIN_GATE_CAMPUS_LINK_IDS = Object.freeze(['site_481241689','site_481241657','site_258995842']);
export const MAIN_GATE_CAMPUS_LINK_LEVELS = Object.freeze({ edge:G.UNDERLAY,
  road:(G.SURFACE+G.EDGE)/2 });
export const MAIN_GATE_CENTRAL_POOL_ID = 'site_218220690';

function face(points, normal) {
  const [a,b,c]=points,u=b.map((v,i)=>v-a[i]),v=c.map((n,i)=>n-a[i]);
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
  return n.reduce((sum,value,i)=>sum+value*normal[i],0)<0 ? [...points].reverse() : points;
}

// Shared miter vertices avoid overlapping coplanar boxes at a curved curb join.
export function gateRibbon(vertices,width,closed=false) {
  const pairs=closed?vertices.map((_,i)=>[i,(i+1)%vertices.length]):vertices.slice(1).map((_,i)=>[i,i+1]);
  const normals=pairs.map(([i,j])=>{
    const q=vertices[j];
    const p=vertices[i],dx=q.x-p.x,dz=q.z-p.z,len=Math.hypot(dx,dz);
    if(len<1e-9)throw Error('E_GATE_RIBBON_ZERO_SEGMENT');
    return [-dz/len,dx/len];
  });
  const edges=vertices.map((p,i)=>{
    const a=normals[closed?(i+normals.length-1)%normals.length:Math.max(0,i-1)],b=normals[Math.min(i,normals.length-1)];
    const len=Math.hypot(a[0]+b[0],a[1]+b[1]);
    if(len<1e-9)throw Error('E_GATE_RIBBON_REVERSED_SEGMENT');
    const nx=(a[0]+b[0])/len,nz=(a[1]+b[1])/len;
    const extent=Math.min(width,width/2/Math.max(.01,nx*b[0]+nz*b[1]));
    return [[p.x+nx*extent,p.y,p.z+nz*extent],[p.x-nx*extent,p.y,p.z-nz*extent]];
  });
  return { edges, normals };
}

export function gateRibbonTop(vertices,width) {
  const {edges}=gateRibbon(vertices,width);
  return edges.slice(1).map((q,i)=>face([edges[i][0],q[0],q[1],edges[i][1]],[0,1,0]));
}

// The canonical editor path's transformed Y is the real curb top. No hidden
// collider, duplicated runtime top height, or gameplay step is introduced.
export function gateCurbFaces(path,{closed=false,baseY=G.SURFACE}={}) {
  const {edges,normals}=gateRibbon(path.vertices,path.width,closed),bottom=p=>[p[0],baseY,p[2]];
  if(path.vertices.some(p=>p.y<=baseY))throw Error('E_GATE_CURB_TOP_BELOW_PAVEMENT');
  const quads=[];
  for(let i=0;i<(closed?edges.length:edges.length-1);i++){
    const [l,r]=edges[i],[nl,nr]=edges[(i+1)%edges.length],[nx,nz]=normals[i];
    quads.push(face([l,nl,nr,r],[0,1,0]),
      face([bottom(l),l,nl,bottom(nl)],[nx,0,nz]),
      face([bottom(r),bottom(nr),nr,r],[-nx,0,-nz]));
  }
  for(const i of closed?[]:[0,edges.length-1]){
    const [l,r]=edges[i],[nx,nz]=normals[i===0?0:normals.length-1],sign=i===0?-1:1;
    quads.push(face([bottom(l),bottom(r),r,l],[nz*sign,0,-nx*sign]));
  }
  return quads;
}

export function gateCentralPoolRimFaces(vertices) {
  // Preserve the existing low rim top (.08) and width (.3), but join its corners
  // once instead of crossing four raised boxes. The source water ring is unchanged.
  return gateCurbFaces({vertices:vertices.map(p=>({...p,y:.08})),width:.3},{closed:true,baseY:0});
}

export function gateArrowTriangles(u,v,direction) {
  const outline=[[-.075,-1.2],[.075,-1.2],[.075,.3],[.65,.3],[0,1],[-.65,.3],[-.075,.3]]
    .map(([x,z])=>GATE_FRAME.at(u+x,v+z*direction));
  const ids=triangulatePolygon(outline),triangles=[];
  for(let i=0;i<ids.length;i+=3)triangles.push(face(ids.slice(i,i+3).map(id=>[outline[id].x,G.PAINT,outline[id].z]),[0,1,0]));
  return triangles;
}

// QA-only semantic vistas. The authored inner zebra is at gate-local v=-6.25..-3.75
// (outside the opening); names do not silently move that canonical footprint.
export const MAIN_GATE_TERRAIN_VISTAS = Object.freeze([
  { id:'spawn',x:MAIN_GATE_SPAWN.x,z:MAIN_GATE_SPAWN.z },
  { id:'gate-opening',...GATE_FRAME.at(0,0) },
  { id:'before-inner-zebra',...GATE_FRAME.at(0,-7.2) },
  { id:'after-inner-zebra',...GATE_FRAME.at(0,-2.8) },
  { id:'central-lawn-axis',...GATE_FRAME.at(0,20) }
].map(Object.freeze));
