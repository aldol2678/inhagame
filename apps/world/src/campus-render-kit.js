import * as pc from 'playcanvas';
import { buildPolygonMeshGeometry, buildPolygonSurfaceGeometry } from './reality-adapter.js';
const cache=new Map();
export function surface(hex) {
  if(cache.has(hex))return cache.get(hex);
  const n=parseInt(hex.slice(1),16),m=new pc.StandardMaterial();
  m.diffuse=new pc.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255);
  m.update();cache.set(hex,m);return m;
}
export function box(root,name,p,size,material,yaw=0,type='box') {
  const e=new pc.Entity(name);e.addComponent('render',{type});e.render.material=material;
  e.setLocalPosition(...p);e.setLocalScale(...size);e.setLocalEulerAngles(0,yaw,0);root.addChild(e);return e;
}
export function polygon(root,name,vertices,material,{height=0,y=0}={}) {
  const device=pc.Application.getApplication().graphicsDevice;
  const data=height?buildPolygonMeshGeometry(vertices,{yBase:y,height}):buildPolygonSurfaceGeometry(vertices,{y});
  const mesh=pc.createMesh(device,data.positions,{normals:data.normals,uvs:data.uvs,indices:data.indices});
  const e=new pc.Entity(name);e.addComponent('render',{type:'asset',meshInstances:[new pc.MeshInstance(mesh,material)],castShadows:height>0});root.addChild(e);
  e.on('destroy',()=>mesh.destroy());return e;
}
export function segment(root,name,a,b,width,material,y=.04,height=.03) {
  return box(root,name,[(a.x+b.x)/2,y,(a.z+b.z)/2],[width,height,Math.hypot(b.x-a.x,b.z-a.z)],material,Math.atan2(b.x-a.x,b.z-a.z)*180/Math.PI);
}
