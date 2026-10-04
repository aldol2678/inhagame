import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { registerHooks } from 'node:module';

// Only GPU allocation is replaced. Production batching, transforms and geometry run unchanged.
const gpu = `export class Entity {constructor(name){this.name=name;this.children=[];this.handlers={}}addChild(e){this.children.push(e)}addComponent(k,v){this[k]=v}on(k,f){this.handlers[k]=f}destroy(){for(const e of this.children)e.destroy();this.handlers.destroy?.()}}
export class StandardMaterial{update(){} destroy(){this.destroyed=true}} export class Color{constructor(r,g,b){Object.assign(this,{r,g,b})}}
export class Texture{setSource(){} destroy(){this.destroyed=true}}
export class MeshInstance{constructor(mesh,material){Object.assign(this,{mesh,material})}}
export const Application={getApplication:()=>({graphicsDevice:{}})};
export function createMesh(d,positions,rest){return {positions,...rest,destroy(){this.destroyed=true}}}`;
registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:'data:text/javascript,'+encodeURIComponent(gpu),shortCircuit:true}:next(s,c)}});
const { FacilityMeshBatch } = await import('../src/facility-mesh-batch.js');
const { campusMaterialCacheStatus } = await import('../src/campus-render-kit.js');
const { Entity } = await import('playcanvas');
const { BACK_STREET_BLOCKS, BACK_STREET_COLLIDERS } = await import('../src/back-street-layout.js');
const { CULTURE_BUILDINGS, CULTURE_COLLIDERS } = await import('../src/culture-street-layout.js');
const { backApproachClear } = await import('../src/back-approach-layout.js');
const street = await import('../src/back-street-geometry.js');
const culture = await import('../src/culture-street-geometry.js');
const { buildCultureSigns } = await import('../src/culture-street-signs.js');
const market = await import('../src/back-market-geometry.js');
const { fillShopfrontBase, shopfrontProfile, shopfrontEnvelope } = await import('../src/backgate-shopfront-geometry.js');
const { fillShopfrontDetail } = await import('../src/backgate-shopfront-geometry.js');
const { MARKET_BUILDINGS, MARKET_EXISTING_SHOPS } = await import('../src/back-market-layout.js');
const targets = [...BACK_STREET_BLOCKS, ...CULTURE_BUILDINGS];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const record = () => {
  const operations = [];
  return {operations, batch:Object.fromEntries(['box','tube','quad','triangle','crown'].map(kind => [kind,(...args)=>operations.push([kind,...args])]))};
};
const points = b => [...b.groups.values()].flatMap(g=>Array.from({length:g.positions.length/3},(_,i)=>g.positions.slice(i*3,i*3+3)));
const tiers = (b, q) => {
  const source=BACK_STREET_BLOCKS.includes(q)?street:culture;
  (source.fillBackStreetNear||source.fillCultureNear)(b,[q.id]);
  (source.fillBackStreetDetail||source.fillCultureDetail)(b,[q.id]);
};

test('all 37 shopfronts have persistent neutral windows and varied wall materials instead of cyan QA bodies', () => {
  assert.equal(targets.length,37);
  for(const fill of [street.fillBackStreetBase,culture.fillCultureBase]) {
    const b=new FacilityMeshBatch();fill(b);
    const cyanTriangles=(b.groups.get('#598f91')?.indices.length||0)/3;
    assert.equal(cyanTriangles,fill===culture.fillCultureBase?48:0,'only the four unchanged canopy posts may keep QA material');
    assert.ok(b.groups.has('#396773'),'closed ground glazing and upper windows must survive distant LOD');
    assert.ok(b.groups.size>=7 && b.groups.size<=14,'bounded, varied neutral palette');
  }
});

test('shop facade details are deterministic, ID-scoped and confined to the existing envelopes', () => {
  for(const q of targets) {
    const a=record(),b=record();tiers(a.batch,q);tiers(b.batch,q);
    assert.deepEqual(a.operations,b.operations,q.id+' must be stable across repeated streaming');
    assert.ok(a.operations.length>=10,q.id+' needs window frames and facade details');
    const mesh=new FacilityMeshBatch();tiers(mesh,q);
    const f=q.frame,o=f.at(0),u=f.at(1),v=f.at(0,1);
    const local=p=>[(p[0]-o.x)*(u.x-o.x)+(p[2]-o.z)*(u.z-o.z),(p[0]-o.x)*(v.x-o.x)+(p[2]-o.z)*(v.z-o.z)];
    const ring=q.polygon?.map(p=>local([p.x,0,p.z]));
    const front=ring?Math.min(...ring.map(p=>p[1])):q.front;
    const back=ring?Math.max(...ring.map(p=>p[1])):q.front+q.d;
    for(const p of points(mesh)) {
      const [x,z]=local(p);
      assert.ok(Math.abs(x)<=q.w/2+1e-7 && z>=front-.151 && z<=back+1e-7,q.id+' dressing escapes envelope');
      assert.ok(p[1]>=0 && p[1]<=q.h+1e-7,q.id+' changes building height');
    }
  }
  const b=record();street.fillBackStreetNear(b.batch,['unknown']);culture.fillCultureDetail(b.batch,['unknown']);
  assert.deepEqual(b.operations,[]);
});

test('persistent shells have exact source corners and roof height with outward wall winding', () => {
  for(const q of targets) {
    const r=record();fillShopfrontBase(r.batch,q);
    const {ring,front}=shopfrontEnvelope(q),center={x:ring.reduce((n,p)=>n+p.x,0)/ring.length,z:ring.reduce((n,p)=>n+p.z,0)/ring.length};
    const walls=r.operations.filter(([kind,color])=>kind==='quad'&&color===shopfrontProfile(q.id).wall);
    assert.equal(walls.length,ring.length);
    for(const [, ,a,b,c,d] of walls) {
      const u=b.map((n,i)=>n-a[i]),v=c.map((n,i)=>n-a[i]);
      const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]];
      const mid={x:(a[0]+b[0]+c[0]+d[0])/4,z:(a[2]+b[2]+c[2]+d[2])/4};
      assert.ok(normal[0]*(mid.x-center.x)+normal[2]*(mid.z-center.z)>0,q.id+' inward wall');
      assert.deepEqual([...new Set([a,b,c,d].map(p=>p[1]))].sort((a,b)=>a-b),[0,q.h]);
      for(const p of [a,b,c,d])assert.ok(ring.some(v=>v.x===p[0]&&v.z===p[2]));
    }
    const roof=r.operations.find(([kind,color])=>kind==='quad'&&color==='#687472');
    assert.ok(roof.slice(2).every(p=>p[1]===q.h));
    if(q.id==='culture_terminal')assert.ok(Math.abs(front-1)<1e-10);
  }
});

test('all facade vertices leave source road corridors clear and presentation variants depend only on ID', () => {
  const profiles=new Map(targets.map(q=>[q.id,shopfrontProfile(q.id)]));
  assert.equal(new Set([...profiles.values()].map(p=>p.wall)).size,4);
  assert.equal(new Set([...profiles.values()].map(p=>p.variant)).size,3);
  for(const q of [...targets].reverse()) {
    assert.deepEqual(shopfrontProfile(q.id),profiles.get(q.id));
    const b=new FacilityMeshBatch();fillShopfrontBase(b,q);tiers(b,q);
    for(const p of points(b))assert.ok(backApproachClear({x:p[0],z:p[2]}),q.id+' protrudes over a mapped road');
  }
});

test('detail mullion side caps are inset from glazing side caps to avoid coplanar color fighting', () => {
  for(const q of targets) {
    const base=record(),detail=record();fillShopfrontBase(base.batch,q);fillShopfrontDetail(detail.batch,q);
    const panes=base.operations.filter(([kind,color,p])=>kind==='box'&&color==='#396773'&&p[1]>2.5);
    const bars=detail.operations.filter(([kind,color])=>kind==='box'&&color==='#505b5b');
    assert.equal(bars.length,panes.length);
    for(let i=0;i<bars.length;i++)assert.ok(bars[i][3][0]<panes[i][3][0]-.01,q.id+' coplanar mullion/glazing side caps');
  }
});

test('shared back-market geometry and all street/culture collision facts remain byte-equivalent', () => {
  assert.equal(hash([...BACK_STREET_COLLIDERS,...CULTURE_COLLIDERS]),'c72322e73e40e06902f5cad5f6cae08f92ee9e0b350f3a987f65e3df619c2ff2');
  const r=record(),ids=[...MARKET_BUILDINGS,...MARKET_EXISTING_SHOPS].map(q=>q.id);
  market.fillMarketBase(r.batch);market.fillMarketNear(r.batch,ids);market.fillMarketDetail(r.batch,ids);
  assert.equal(hash(r.operations),'b05cc33b86c6459272b2d0c324a431ecb42f672c8234cf2da78d95855b43d653');
});

test('anonymous shopfronts do not allocate QA lettering or invented business labels', () => {
  const labels=[];
  globalThis.document={createElement:()=>({getContext:()=>({measureText:label=>({width:label.length*50}),fillText:label=>labels.push(label)})})};
  const root=new Entity('signs');buildCultureSigns(root,CULTURE_BUILDINGS.map(q=>q.id));
  assert.deepEqual(labels,[]);assert.equal(root.children.length,0);
  buildCultureSigns(root,[],{canopy:true});
  assert.ok(labels.includes('문화의거리'),'public street title remains');
  root.destroy();delete globalThis.document;
});

test('batched facade layers own meshes independently and reuse shared materials without growth', () => {
  let warmed;
  for(let cycle=0;cycle<3;cycle++) {
    const base=new Entity('base'),near=new Entity('near'),detail=new Entity('detail');
    const roots=[base,near,detail],ids=targets.map(q=>q.id);
    for(const [index,fill] of [street.fillBackStreetBase,street.fillBackStreetNear,street.fillBackStreetDetail].entries()) {
      const b=new FacilityMeshBatch();fill(b,ids);b.finish(roots[index],'street');
    }
    for(const [index,fill] of [culture.fillCultureBase,culture.fillCultureNear,culture.fillCultureDetail].entries()) {
      const b=new FacilityMeshBatch();fill(b,ids);b.finish(roots[index],'culture');
    }
    const meshes=root=>root.children.map(e=>e.render.meshInstances[0].mesh);
    const baseMeshes=meshes(base),detailMeshes=meshes(detail);
    const triangles=roots.reduce((n,r)=>n+meshes(r).reduce((sum,m)=>sum+m.indices.length/3,0),0);
    assert.ok(triangles<26000,'37 shopfronts use a bounded triangle budget');
    near.destroy();detail.destroy();
    assert.ok(detailMeshes.every(m=>m.destroyed));assert.ok(baseMeshes.every(m=>!m.destroyed));
    assert.ok(base.children.every(e=>!e.render.meshInstances[0].material.destroyed));
    const count=campusMaterialCacheStatus().materialCount;
    if(warmed!==undefined)assert.equal(count,warmed);warmed=count;
    base.destroy();assert.ok(baseMeshes.every(m=>m.destroyed));
  }
});
