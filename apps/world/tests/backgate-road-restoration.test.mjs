import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

// CPU geometry and transforms are production code; only GPU allocation is replaced.
const gpu=`export class Entity{constructor(name){this.name=name;this.children=[];this.handlers={}}addChild(e){this.children.push(e)}addComponent(k,v){this[k]=v}on(k,f){this.handlers[k]=f}destroy(){for(const e of this.children)e.destroy();this.handlers.destroy?.()}}
export class StandardMaterial{update(){}}export class Color{constructor(r,g,b){Object.assign(this,{r,g,b})}}export class MeshInstance{constructor(mesh,material){Object.assign(this,{mesh,material})}}
export const Application={getApplication:()=>({graphicsDevice:{}})};export function createMesh(d,positions,rest){return{positions,...rest,destroy(){this.destroyed=true}}}`;
registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:'data:text/javascript,'+encodeURIComponent(gpu),shortCircuit:true}:next(s,c)}});
const {Entity}=await import('playcanvas');
const {FacilityMeshBatch}=await import('../src/facility-mesh-batch.js');
const {campusMaterialCacheStatus}=await import('../src/campus-render-kit.js');
const {inferCampusMaterialProfile}=await import('../src/campus-material-profile.js');
const {fillBackStreetPaving,fillBackStreetSignals}=await import('../src/back-street-geometry.js');
const {fillCulturePaving}=await import('../src/culture-street-geometry.js');
const {fillNorthSideGate}=await import('../src/north-side-gate-geometry.js');
const {BACK_STREET_COLLIDERS,BACK_STREET_RAILS,BACK_STREET_SEGMENTS}=await import('../src/back-street-layout.js');
const {BACK_ROADSIDE_COLLIDERS,BACK_SIGNAL_CROSSINGS}=await import('../src/back-roadside-layout.js');
const {SIDE_GATE_COLLIDERS,SIDE_GATE_PATHS,SIDE_GATE_BOXES,SIDE_GATE_FRAME}=await import('../src/north-side-gate-layout.js');
const {CULTURE_COLLIDERS,CULTURE_SEGMENTS}=await import('../src/culture-street-layout.js');
const {FLAT_GROUND_Y:G,FLAT_GROUND_MAX_Y}=await import('../src/flat-ground-surface.js');
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const record=fill=>{const ops=[];fill(Object.fromEntries(['box','tube','quad','triangle','crown'].map(k=>[k,(...a)=>ops.push({kind:k,args:a})])));return ops;};
const local=(f,p)=>{const o=f.at(0),u=f.at(1),v=f.at(0,1);return[(p[0]-o.x)*(u.x-o.x)+(p[2]-o.z)*(u.z-o.z),(p[0]-o.x)*(v.x-o.x)+(p[2]-o.z)*(v.z-o.z)];};
const close=(a,b)=>Math.abs(a-b)<1e-7;

test('all four existing signal collision anchors regain poles and separate vehicle/pedestrian heads',()=>{
  const ops=record(fillBackStreetSignals);
  for(const crossing of BACK_SIGNAL_CROSSINGS)for(const side of [-1,1]){
    const origin=crossing.frame.at(side*3.3,side*4.15);
    const pole=ops.find(q=>q.kind==='tube'&&close(q.args[1][0],origin.x)&&close(q.args[1][2],origin.z)&&q.args[1][1]<.1&&close(q.args[2][1],3.55));
    assert.ok(pole,`${crossing.id}/${side}: existing collider needs its visible pole`);
    assert.ok(pole.args[3]<=.08);
    const heads=ops.filter(q=>q.kind==='box'&&close(local(crossing.frame,q.args[1])[0],side*3.3));
    assert.ok(heads.some(q=>q.args[1][1]>3&&q.args[2][2]>1),'horizontal three-lens housing');
    assert.ok(heads.some(q=>close(q.args[1][1],1.5)&&q.args[2][1]>.45),'pedestrian head');
  }
  assert.ok(ops.every(q=>!['quad','triangle'].includes(q.kind)),'signal shadow batch contains no ground paint');
  assert.ok(ops.every(q=>inferCampusMaterialProfile(q.args[0])!=='neutral'),'reuse optical-profile palette');
});

test('all 42 divider spans are open rails within their unchanged .14-wide .65-high colliders',()=>{
  const ops=record(fillBackStreetSignals);
  assert.equal(BACK_STREET_RAILS.length,42);
  for(const rail of BACK_STREET_RAILS){
    const tubes=ops.filter(q=>q.kind==='tube'&&q.args[1][1]<.7&&q.args[2][1]<.7&&[q.args[1],q.args[2]].every(p=>Math.abs(local(rail.frame,p)[0])<=rail.w/2+1e-7&&Math.abs(local(rail.frame,p)[1])<.071));
    assert.ok(tubes.length>=4,rail.id+' needs posts and two open bars');
    const post=tubes.find(q=>q.args[2][1]-q.args[1][1]>.6);
    const band=tubes.find(q=>q.args[0]==='#d8b453'&&close(q.args[2][1]-q.args[1][1],.11));
    assert.ok(post&&band&&band.args[3]>post.args[3],rail.id+' colored sleeve must not share the pole surface');
    for(const q of tubes){const r=q.args[3];for(const p of [q.args[1],q.args[2]]){
      const [u,v]=local(rail.frame,p);assert.ok(Math.abs(u)+r<=rail.w/2+1e-7);assert.ok(Math.abs(v)+r<=.07+1e-7);
      assert.ok(p[1]>=0&&p[1]<=.65);
    }}
  }
  assert.ok(!ops.some(q=>q.kind==='box'&&close(q.args[2][1],.65)&&close(q.args[2][2],.14)),'no solid QA dividers');
});

test('street and culture paints are flat upward details rather than a second coplanar QA road slab',()=>{
  for(const fill of [fillBackStreetPaving,fillCulturePaving]){
    const ops=record(fill);assert.ok(ops.length>20);
    assert.ok(ops.every(q=>q.args[0]!=='#758b89'));
    for(const q of ops){assert.ok(['quad','triangle'].includes(q.kind));const ps=q.args.slice(1);const [a,b,c]=ps;
      assert.ok(ps.every(p=>p.every(Number.isFinite)&&close(p[1],a[1])&&p[1]>=G.UNDERLAY&&p[1]<=FLAT_GROUND_MAX_Y));
      assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>1e-10,'upward nondegenerate paint');
    }
  }
  const side=BACK_SIGNAL_CROSSINGS.find(q=>q.id==='side');
  const stripes=record(fillBackStreetPaving).filter(q=>q.kind==='quad'&&q.args[0]==='#e6e4d3'&&q.args.slice(1).every(p=>Math.abs(local(side.frame,p)[0])<2.2&&Math.abs(local(side.frame,p)[1])<=3.51));
  assert.equal(stripes.length,10,'horizontal bars repeat across the existing side crossing');
  const bounds=stripes.map(q=>{const ps=q.args.slice(1).map(p=>local(side.frame,p));return {u0:Math.min(...ps.map(p=>p[0])),u1:Math.max(...ps.map(p=>p[0])),v0:Math.min(...ps.map(p=>p[1])),v1:Math.max(...ps.map(p=>p[1]))};});
  for(const stripe of bounds){
    assert.ok(close(stripe.u0,-2.1)&&close(stripe.u1,2.1),'each stripe must be horizontal along the road');
    assert.ok(close(stripe.v1-stripe.v0,.4),'stripe depth stays narrow across the walking direction');
  }
  assert.ok(close(Math.min(...bounds.map(q=>q.v0)),-3.5)&&close(Math.max(...bounds.map(q=>q.v1)),3.5),'crossing must still span the same two sidewalk approaches');
});

test('side gate restores open rail bars and noticeboard while solid bodies retain collider envelopes',()=>{
  const ops=record(fillNorthSideGate);assert.ok(ops.every(q=>!['#598f91','#d9eeee','#758b89'].includes(q.args[0])));
  for(const q of SIDE_GATE_BOXES.filter(q=>!q.id.includes('railing'))){
    const p=SIDE_GATE_FRAME.at(q.u,q.v);
    assert.ok(ops.some(o=>o.kind==='box'&&close(o.args[1][0],p.x)&&close(o.args[1][2],p.z)&&close(o.args[1][1],(q.minY+q.maxY)/2)&&close(o.args[2][0],q.w)&&close(o.args[2][1],q.maxY-q.minY)&&close(o.args[2][2],q.d)),q.id);
  }
  assert.ok(ops.filter(q=>q.kind==='tube').length>=12,'side gate has open railing bars');
  assert.ok(ops.filter(q=>q.kind==='box'&&q.args[2][0]<.5&&q.args[2][1]<.4).length>=12,'neutral noticeboard panels');
});

test('OSM centerlines widths gate/crossing obstacles and facade collision authority remain identical',()=>{
  assert.equal(hash({street:BACK_STREET_COLLIDERS,roadside:BACK_ROADSIDE_COLLIDERS,side:SIDE_GATE_COLLIDERS,culture:CULTURE_COLLIDERS}),'dee2d0168a23d5eb46101aac7a791fa43caef67ed21ecf5c1a3e177cb2ecd911');
  assert.equal(hash([...BACK_STREET_SEGMENTS,...CULTURE_SEGMENTS,...SIDE_GATE_PATHS].map(s=>({id:s.id,width:s.width??s.road.width,start:s.frame.at(0),end:s.frame.at(s.frame.length)}))),'3248af2711a30bd3c5b33b0a39853e428746201ee8e5bc74a450c7a11f2becd9');
});

test('restored static batches stay deterministic finite bounded and release only owned meshes',()=>{
  let warmed;
  for(let cycle=0;cycle<3;cycle++){
    const root=new Entity('restoration');let triangles=0;
    for(const [name,fill,maxColors] of [['paving',fillBackStreetPaving,3],['signals',fillBackStreetSignals,6],['culture',fillCulturePaving,3],['gate',fillNorthSideGate,6]]){
      assert.deepEqual(record(fill),record(fill));
      const b=new FacilityMeshBatch();fill(b);assert.ok(b.groups.size<=maxColors,name+' batch colors');
      for(const g of b.groups.values()){assert.ok(g.positions.every(Number.isFinite));triangles+=g.indices.length/3;}
      b.finish(root,name,{castShadows:name==='signals'||name==='gate'});
    }
    assert.ok(triangles>4000&&triangles<18000,triangles+' triangle budget');
    const meshes=root.children.map(e=>e.render.meshInstances[0].mesh);
    assert.ok(root.children.filter(e=>e.name.startsWith('paving_')||e.name.startsWith('culture_')).every(e=>!e.render.castShadows));
    const count=campusMaterialCacheStatus().materialCount;if(warmed!==undefined)assert.equal(count,warmed);warmed=count;
    root.destroy();assert.ok(meshes.every(m=>m.destroyed));
  }
});

test('culture accent bands and plaza motif never fight differently colored coplanar curve paint',()=>{
  const faces=record(fillCulturePaving).flatMap(q=>{const ps=q.args.slice(1);return q.kind==='quad'?[[q.args[0],ps[0],ps[1],ps[2]],[q.args[0],ps[0],ps[2],ps[3]]]:[[q.args[0],...ps]];}).filter(q=>q[1][1]===G.DETAIL);
  const cross=(a,b,p)=>(b[0]-a[0])*(p[2]-a[2])-(b[2]-a[2])*(p[0]-a[0]);
  const inside=(p,tri)=>{const s=[cross(tri[0],tri[1],p),cross(tri[1],tri[2],p),cross(tri[2],tri[0],p)];return s.every(n=>n>1e-8)||s.every(n=>n< -1e-8);};
  for(const [color,...tri] of faces){const center=tri[0].map((v,i)=>tri.reduce((sum,p)=>sum+p[i],0)/3);
    assert.ok(!faces.some(([other,...t])=>other!==color&&inside(center,t)),'coplanar '+color+' paint is hidden by another motif');
  }
});
