import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

// Replace only GPU allocation; run the real polygon tessellation and batching.
const gpu=`export class Entity {constructor(name){this.name=name;this.children=[];this.handlers={}}addChild(e){this.children.push(e)}addComponent(k,v){this[k]=v}on(k,f){this.handlers[k]=f}destroy(){for(const e of this.children)e.destroy();this.handlers.destroy?.()}}
export class StandardMaterial{update(){}} export class Color{constructor(r,g,b){Object.assign(this,{r,g,b})}}
export class MeshInstance{constructor(mesh,material){Object.assign(this,{mesh,material})}}
export const Application={getApplication:()=>({graphicsDevice:{}})};
export function createMesh(d,positions,rest){return {positions,...rest,destroy(){this.destroyed=true}}}`;
registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:'data:text/javascript,'+encodeURIComponent(gpu),shortCircuit:true}:next(s,c)}});
const {FacilityMeshBatch}=await import('../src/facility-mesh-batch.js');
const alley=await import('../src/back-alley-geometry.js');
const stadium=await import('../src/stadium-stands-geometry.js');
const {BACK_ALLEY_BLOCKS,BACK_ALLEY_COLLIDERS}=await import('../src/back-alley-layout.js');
const {STANDS,SPORTS_FLOOR,SPORTS_COLLIDERS,SPORTS_SIDE_ENTRIES,stadiumGroundHeight}=await import('../src/stadium-stands-layout.js');
const triangles=b=>[...b.groups.values()].flatMap(g=>Array.from({length:g.indices.length/3},(_,i)=>g.indices.slice(i*3,i*3+3).map(n=>g.positions.slice(n*3,n*3+3))));
const cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
function topAt(tris,p){const ys=[];for(const [a,b,c] of tris){if(Math.abs(a[1]-b[1])>1e-9||Math.abs(b[1]-c[1])>1e-9||cross(a,b,c)>=-1e-9)continue;const q=[p.x,0,p.z],cs=[cross(a,b,q),cross(b,c,q),cross(c,a,q)];if(cs.every(x=>x>=-1e-8)||cs.every(x=>x<=1e-8))ys.push(a[1]);}return ys.length?Math.max(...ys):null;}
const center=ring=>({x:ring.reduce((s,p)=>s+p.x,0)/ring.length,z:ring.reduce((s,p)=>s+p.z,0)/ring.length});


test('height sampling rejects inverted or absent top surfaces',()=>{
 const triangle=[[0,1,0],[0,1,1],[1,1,0]],point={x:.2,z:.2};
 assert.equal(topAt([triangle],point),1);
 assert.equal(topAt([[...triangle].reverse()],point),null);
});

test('all 35 existing alley collider envelopes have persistent visible opaque shells',()=>{
 assert.equal(BACK_ALLEY_BLOCKS.length,35);assert.equal(BACK_ALLEY_COLLIDERS.length,35);
 const b=new FacilityMeshBatch();assert.equal(alley.fillBackAlleyBase(b),b);const ts=triangles(b);
 assert.ok(ts.length>0,'alley BASE must not remain a no-op');
 for(const c of BACK_ALLEY_COLLIDERS){assert.ok(Math.abs(topAt(ts,center(c.polygon))-c.maxY)<1e-8,`${c.id}: visible roof must match collision top`);for(const p of c.polygon)assert.ok(ts.flat().some(v=>Math.abs(v[0]-p.x)<1e-8&&Math.abs(v[2]-p.z)<1e-8&&Math.abs(v[1]-c.minY)<1e-8),`${c.id}: source collision corner missing`);}
 // LOD must not duplicate the opaque envelope or make distant obstacles invisible.
 for(const fn of [alley.fillBackAlleyNear,alley.fillBackAlleyDetail]){const detail=new FacilityMeshBatch();assert.equal(fn(detail,BACK_ALLEY_BLOCKS.map(q=>q.id)),detail);const detailTriangles=triangles(detail);for(const c of BACK_ALLEY_COLLIDERS)assert.equal(topAt(detailTriangles,center(c.polygon)),null,'streamed facade dressing must not duplicate a solid rooftop');}
});

test('stadium standing rows and narrow aisles render at the existing height function',()=>{
 assert.equal(typeof stadium.fillStadiumStands,'function','stadium geometry must have a GPU-independent fill stage');
 const b=new FacilityMeshBatch();stadium.fillStadiumStands(b);const ts=triangles(b);
 for(const u of [.37,...STANDS.aisles,STANDS.frame.length-.37])for(let v=.037;v<STANDS.run;v+=.127){const p=STANDS.frame.at(u,v),actual=topAt(ts,p),expected=stadiumGroundHeight(p.x,p.z);assert.ok(actual!==null&&Math.abs(actual-expected)<1e-7,`stand u=${u} v=${v}: ${actual} != ${expected}`);}
 for(const e of SPORTS_SIDE_ENTRIES)for(let v=.017;v<e.run;v+=.071){const p=e.frame.at(e.u,-v),actual=topAt(ts,p),expected=stadiumGroundHeight(p.x,p.z);assert.ok(actual!==null&&Math.abs(actual-expected)<1e-7,`${e.id} ${v}: ${actual} != ${expected}`);}
 for(const c of SPORTS_COLLIDERS)assert.ok(Math.abs(topAt(ts,center(c.polygon))-c.maxY)<1e-7,`${c.id}: retaining collider needs a visible top`);
 assert.ok(ts.flat().every(p=>p[1]>=SPORTS_FLOOR-1e-8&&p[1]<=.10000001));
});

test('restored stadium meshes follow BASE lifetime and keep shared surface material ownership',async()=>{
 const {Entity}=await import('playcanvas');const roots=[new Entity('a'),new Entity('b')];
 for(const r of roots)stadium.buildStadiumStands(r);
 assert.ok(roots[0].children.length>0,'render builder must emit mesh entities');
 const meshes=roots[0].children.map(e=>e.render.meshInstances[0].mesh);
 assert.equal(roots[0].children[0].render.meshInstances[0].material,roots[1].children[0].render.meshInstances[0].material);
 roots[0].destroy();assert.ok(meshes.every(m=>m.destroyed));assert.ok(roots[1].children.every(e=>!e.render.meshInstances[0].mesh.destroyed));roots[1].destroy();
 const source=readFileSync(new URL('../src/campus-chunk-renderer.js',import.meta.url),'utf8');assert.match(source,/buildStadiumStands\(base\)/);
});
