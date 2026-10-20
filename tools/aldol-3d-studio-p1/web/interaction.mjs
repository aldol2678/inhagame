// P1 pure geometry and hierarchy functions. No DOM and no editor-side mutation.
export const AXES = Object.freeze({x:[1,0,0],y:[0,1,0],z:[0,0,1]});
export const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
export const roundStep = (value,step) => step > 0 ? Math.round(value/step)*step : value;
export function quatMultiply(a,b) {
 const [x,y,z,w]=a,[u,v,t,s]=b;
 return [w*u+x*s+y*t-z*v,w*v-x*t+y*s+z*u,w*t+x*v-y*u+z*s,w*s-x*u-y*v-z*t];
}
export function rotateAroundAxis(rotation,axis,radians){
 const s=Math.sin(radians/2), c=Math.cos(radians/2), q=AXES[axis].map(n=>n*s).concat(c);
 const result=quatMultiply(q,rotation), l=Math.hypot(...result);
 return result.map(v=>v/l);
}
export function projectedAxis(project,origin,axis) {
 const point=origin.map((v,i)=>v+AXES[axis][i]);
 const a=project(origin),b=project(point), dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
 return {direction:len>1e-4?[dx/len,dy/len]:[1,0],pixelsPerMeter:len};
}
export function dragTransform(start,mode,axis,deltaPixels,axisProjection,{snap=false}={}){
 if(!AXES[axis] || !['move','rotate','scale'].includes(mode)) throw Error('E_GIZMO_MODE');
 const t=structuredClone(start), [dx,dy]=deltaPixels;
 if(![dx,dy].every(Number.isFinite)) throw Error('E_DRAG_NON_FINITE');
 const projectDelta=dx*axisProjection.direction[0]+dy*axisProjection.direction[1];
 if(mode==='move'){
  if(axisProjection.pixelsPerMeter<3) return t; // Axis parallel to view: hide/disable through UI.
  let shift=clamp(projectDelta/axisProjection.pixelsPerMeter,-100,100);
  if(snap) shift=roundStep(shift,.25);
  const i='xyz'.indexOf(axis);t.position[i]=Number((start.position[i]+shift).toFixed(5));
 }else if(mode==='scale'){
  let shift=clamp(projectDelta/75,-.98,20);
  if(snap) shift=roundStep(shift,.25);
  const i='xyz'.indexOf(axis);t.scale[i]=Number(clamp(start.scale[i]*(1+shift),.05,100).toFixed(5));
 }else{
  let radians=clamp((dx-dy)*.013,-Math.PI*6,Math.PI*6);
  if(snap) radians=roundStep(radians,Math.PI/12);
  t.rotation=rotateAroundAxis(start.rotation,axis,radians);
 }
 return t;
}
export function sceneHierarchy(nodes){
 const byId=new Map(nodes.map(n=>[n.id,n]));
 const children=new Map([[null,[]]]);
 for(const n of nodes) children.set(n.id,[]);
 for(const n of nodes) (children.get(n.parentId && byId.has(n.parentId) && n.parentId!==n.id?n.parentId:null)??children.get(null)).push(n);
 const rows=[],visited=new Set();
 function visit(n,depth){if(visited.has(n.id))return;visited.add(n.id);rows.push({node:n,depth,hasChildren:children.get(n.id).length>0});for(const child of children.get(n.id))visit(child,depth+1);}
 for(const node of children.get(null))visit(node,0);
 for(const node of nodes)visit(node,0); // Corrupt cycles cannot loop endlessly.
 return rows;
}
export function canReparent(nodes,id,parentId){
 if(parentId===null)return true;
 if(id===parentId)return false;
 const byId=new Map(nodes.map(n=>[n.id,n]));
 if(!byId.has(id)||!byId.has(parentId))return false;
 const seen=new Set([id]);let current=parentId;
 while(current!==null){if(seen.has(current))return false;seen.add(current);current=byId.get(current)?.parentId??null;}
 return true;
}
export function screenToGround(x,y,width,height,yaw,pitch,distance){
 if(width<=0||height<=0)return null;
 const eye=[Math.sin(yaw)*Math.cos(pitch)*distance,Math.sin(pitch)*distance,Math.cos(yaw)*Math.cos(pitch)*distance];
 const len=Math.hypot(...eye),forward=eye.map(v=>-v/len);
 const norm=v=>{const l=Math.hypot(...v)||1;return v.map(n=>n/l);};
 const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
 const right=norm(cross(forward,[0,1,0])), up=cross(right,forward);
 const f=Math.tan(Math.PI/8),nx=(2*x/width-1)*width/height*f,ny=(1-2*y/height)*f;
 const ray=norm(forward.map((v,i)=>v+right[i]*nx+up[i]*ny));
 if(Math.abs(ray[1])<1e-4)return null;
 const t=-eye[1]/ray[1];if(t<=0)return null;
 return [Number(clamp(eye[0]+ray[0]*t,-100,100).toFixed(3)),0,Number(clamp(eye[2]+ray[2]*t,-100,100).toFixed(3))];
}
