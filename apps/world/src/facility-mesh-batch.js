import * as pc from 'playcanvas';
import { surface } from './campus-render-kit.js';

// Static facade details share one mesh per material instead of one draw call per window.
export class FacilityMeshBatch {
  constructor() { this.groups = new Map(); }
  triangle(color,a,b,c) {
    let g=this.groups.get(color);
    if(!g){g={positions:[],normals:[],indices:[]};this.groups.set(color,g);}
    const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
    const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
    if(len<1e-9)return;
    const offset=g.positions.length/3;g.positions.push(...a,...b,...c);
    for(let i=0;i<3;i++)g.normals.push(...n.map(x=>x/len));
    g.indices.push(offset,offset+1,offset+2);
  }
  quad(color,a,b,c,d) { this.triangle(color,a,b,c);this.triangle(color,a,c,d); }
  box(color,p,size,yaw=0) {
    const a=yaw*Math.PI/180,c=Math.cos(a),s=Math.sin(a);
    const pts=[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]]
      .map(([x,y,z])=>[p[0]+x*size[0]/2*c+z*size[2]/2*s,p[1]+y*size[1]/2,p[2]-x*size[0]/2*s+z*size[2]/2*c]);
    for(const face of [[0,3,2,1],[4,5,6,7],[0,4,7,3],[1,2,6,5],[0,1,5,4],[3,7,6,2]])this.quad(color,...face.map(i=>pts[i]));
  }
  tube(color,a,b,radius,sides=8) {
    const axis=b.map((v,i)=>v-a[i]),len=Math.hypot(...axis),n=axis.map(v=>v/len);
    if(!len)return;
    const base=Math.abs(n[1])<.9?[0,1,0]:[1,0,0];
    let u=[n[1]*base[2]-n[2]*base[1],n[2]*base[0]-n[0]*base[2],n[0]*base[1]-n[1]*base[0]];
    const ul=Math.hypot(...u);u=u.map(v=>v/ul);
    const v=[n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]];
    const ring=p=>Array.from({length:sides},(_,i)=>p.map((x,k)=>x+radius*(u[k]*Math.cos(i/sides*Math.PI*2)+v[k]*Math.sin(i/sides*Math.PI*2))));
    const lower=ring(a),upper=ring(b);
    for(let i=0;i<sides;i++){const j=(i+1)%sides;this.quad(color,lower[i],lower[j],upper[j],upper[i]);this.triangle(color,a,lower[j],lower[i]);this.triangle(color,b,upper[i],upper[j]);}
  }
  crown(color,p,size) {
    const top=[p[0],p[1]+size[1]/2,p[2]],bottom=[p[0],p[1]-size[1]/2,p[2]];
    const ring=Array.from({length:8},(_,i)=>[p[0]+Math.cos(i*Math.PI/4)*size[0]/2,p[1],p[2]+Math.sin(i*Math.PI/4)*size[2]/2]);
    for(let i=0;i<8;i++){this.triangle(color,top,ring[(i+1)%8],ring[i]);this.triangle(color,bottom,ring[i],ring[(i+1)%8]);}
  }
  finish(root,name,{castShadows=true}={}) {
    const device=pc.Application.getApplication().graphicsDevice;
    for(const [color,g] of this.groups){
      const mesh=pc.createMesh(device,g.positions,{normals:g.normals,indices:g.indices});
      const e=new pc.Entity(`${name}_${color.slice(1)}`);
      e.addComponent('render',{type:'asset',castShadows,meshInstances:[new pc.MeshInstance(mesh,surface(color))]});
      root.addChild(e);e.on('destroy',()=>mesh.destroy());
    }
  }
}
