import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { validateWorld } from '../src/editor/world-schema.js';
import { createCampusStaticPropRuntime } from '../src/campus-static-prop-runtime.js';
import { OBSTACLES, TOUR_STOPS } from '../src/campus-layout.js';
import { canOccupy, moveAroundObstacles, cameraSafeFraction } from '../src/world-collision.js';
import { WALK_SHAPE, MOUNT_SHAPE, PLAYER_ORIGIN_Y } from '../src/player-dimensions.js';
import { getPlaceZoneAt } from '../src/place-zone-registry.js';
import { SITE_FEATURES, BUILDINGS } from '../src/basic-campus.js';
import { FACILITIES } from '../src/campus-facilities.js';
const load = async () => {
  assert.ok(existsSync(new URL('../src/campus-static-props.js', import.meta.url)), 'six-prop batch manifest must exist');
  return import('../src/campus-static-props.js');
};
const near = (a,b) => assert.ok(Math.abs(a-b)<2e-5, `${a} != ${b}`);
const expected = [
 ['TRASHBIN',9528,96,8,2,'48fec26a8e0b948b816dbea136f25668092f506fa8a02f1ca416a6469e24267e'],
 ['BOLLARD',10628,196,3,2,'6e2be5f12e68ae2fc9d68961cc42112731539103c98f0ce1584aa555667d88b9'],
 ['BIKERACK',16028,168,14,1,'71fdd39606a9895985b1930f0146c52310d4a83a45d23ed446174a6e7e4d5005'],
 ['PLANTER',25020,348,12,3,'f3ea8d22be93d29f1e7d69330436224696e1ce3c23efd7057fbef32304d4708a'],
 ['SIGN',36508,384,32,3,'d0f4b15cc47600f0706f3e22d6860190f604d6d29e9881af9a803bba1c8b2a8b'],
 ['VENDING',24288,252,21,3,'4898b5529c659a8753ad2fcc34c7b43e118b997296f29506e48e562782e20f33']
];
test('six original portable GLBs are byte-identical and reference approved Drive provenance',async()=>{
 const {CAMPUS_STATIC_PROPS:p}=await load(); const records=JSON.parse(readFileSync(new URL('../../../ASSET_PROVENANCE.json',import.meta.url))).assets;
 for(const [name,bytes,tri,meshes,materials,hash] of expected){
  const a=p.find(a=>a.assetId===`PROP_${name}_CAMPUS_001`); assert.ok(a);
  const b=readFileSync(new URL(`..${a.url}`,import.meta.url)); assert.equal(b.length,bytes);
  assert.equal(createHash('sha256').update(b).digest('hex'),hash); assert.equal(b.toString('utf8',0,4),'glTF'); assert.equal(b.readUInt32LE(4),2); assert.equal(b.readUInt32LE(8),b.length);
  const g=JSON.parse(b.toString('utf8',20,20+b.readUInt32LE(12)));
  assert.equal(g.meshes.length,meshes); assert.equal(g.materials.length,materials);
  assert.equal(g.meshes.flatMap(m=>m.primitives).reduce((n,q)=>n+g.accessors[q.indices].count/3,0),tri);
  assert.ok(g.buffers.every(b=>!b.uri)); assert.ok((g.images??[]).every(i=>!i.uri)); assert.equal((g.animations??[]).length,0); assert.equal((g.cameras??[]).length,0);
  const pos=g.meshes.flatMap(m=>m.primitives.map(q=>g.accessors[q.attributes.POSITION]));
  for(let axis=0;axis<3;axis++){near(Math.min(...pos.map(q=>q.min[axis])),a.bounds.min[axis]);near(Math.max(...pos.map(q=>q.max[axis])),a.bounds.max[axis]);near(a.authoredDimensions[axis],a.bounds.max[axis]-a.bounds.min[axis]);}
  const r=records.find(r=>r.path===`apps/world${a.url}`); assert.equal(r?.sha256,hash); assert.match(r?.source??'',/^https:\/\/drive.google.com\/file\/d\/[^/]+\/view$/);
 }
});
test('one standard WorldDocument resolves six unique manifests with finite dispersed placements',async()=>{
 const {CAMPUS_STATIC_PROPS:p,CAMPUS_STATIC_PROPS_WORLD:w,CAMPUS_STATIC_PROP_COLLIDERS:boxes}=await load();
 assert.equal(p.length,6); assert.equal(validateWorld(w).valid,true);assert.equal(w.assets.length,6);assert.equal(w.entities.length,6);
 for(const xs of [p.map(a=>a.assetId),p.map(a=>a.url),w.entities.map(e=>e.id),boxes.map(b=>b.id)])assert.equal(new Set(xs).size,xs.length);
 assert.ok(new Set(p.map(a=>a.siteId)).size>=4,'real campus locations, not a six-prop showroom');
 for(const a of p){const e=w.entities.find(e=>e.name===a.assetId); assert.equal(e.components['core.renderable'].assetId,a.assetId); assert.equal(e.components['core.renderable'].castShadow,false);assert.deepEqual(e.transform.scale,[1,1,1]);assert.deepEqual(e.transform.position,a.position.map(v=>v*2));assert.ok([...a.position,a.yaw,...a.scale,...a.authoredDimensions].every(Number.isFinite));assert.equal(getPlaceZoneAt({x:a.position[0],z:a.position[2]}).id,a.zoneId);
  assert.ok([...SITE_FEATURES,...BUILDINGS,...FACILITIES].some(s=>s.id===a.siteId)); assert.ok(TOUR_STOPS.every(s=>Math.hypot(a.position[0]-s.x,a.position[2]-s.z)>s.radius+1));
 }
 for(const b of boxes){assert.equal(OBSTACLES.filter(o=>o.id===b.id).length,1);assert.ok([b.minX,b.maxX,b.minY,b.maxY,b.minZ,b.maxZ].every(Number.isFinite));assert.ok(b.maxX>b.minX&&b.maxY>b.minY&&b.maxZ>b.minZ);}
});
test('six conservative static proxies block four approaches and permit retreat without invisible head walls',async()=>{
 const {CAMPUS_STATIC_PROPS:p,CAMPUS_STATIC_PROP_COLLIDERS:boxes}=await load();
 for(const a of p){const bs=boxes.filter(b=>b.assetId===a.assetId); assert.ok(bs.length>=1&&bs.length<=2); const b=bs[0], y=a.groundHeight+PLAYER_ORIGIN_Y;
  const angle=a.yaw*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),v=(x,z)=>({x:c*x+s*z,z:-s*x+c*z}),point=(x,z)=>{const q=v(x,z);return{x:a.position[0]+q.x,y,z:a.position[2]+q.z};};
  const box=a.collision[0], min=box.min.map(n=>n*.5),max=box.max.map(n=>n*.5),cx=(min[0]+max[0])/2,cz=(min[2]+max[2])/2;
  assert.equal(canOccupy(point(cx,cz)),false,a.assetId);
  for(const [sx,sz,dx,dz,ex,ez] of [[min[0]-.7,cz,2,0,min[0]-WALK_SHAPE.radius,cz],[max[0]+.7,cz,-2,0,max[0]+WALK_SHAPE.radius,cz],[cx,min[2]-.7,0,2,cx,min[2]-WALK_SHAPE.radius],[cx,max[2]+.7,0,-2,cx,max[2]+WALK_SHAPE.radius]]){
   const start=point(sx,sz),d=v(dx,dz),edge=point(ex,ez);assert.ok(canOccupy(start),`${a.assetId} approach starts clear`);const hit=moveAroundObstacles(start,d.x,d.z);near(hit.x,edge.x);near(hit.z,edge.z);const out=moveAroundObstacles({...start,...hit},-d.x*.3,-d.z*.3);assert.ok(canOccupy({...start,...out}));assert.ok(Math.hypot(out.x-hit.x,out.z-hit.z)>.3);
  }
  const center=point(cx,cz),top=Math.max(...bs.map(b=>b.maxY));
  assert.equal(canOccupy(center,MOUNT_SHAPE,bs),false);assert.equal(canOccupy({...center,y:top+PLAYER_ORIGIN_Y+.4},MOUNT_SHAPE,bs),true);
  const from=point(cx,cz-1),to=point(cx,cz+1);
  assert.ok(cameraSafeFraction([from.x,b.minY+.05,from.z],[to.x,b.minY+.05,to.z],bs)<1);assert.equal(cameraSafeFraction([from.x,top+.5,from.z],[to.x,top+.5,to.z],bs),1);
  near(Math.hypot(b.polygon[1].x-b.polygon[0].x,b.polygon[1].z-b.polygon[0].z),(box.max[0]-box.min[0])*.5);
 }
 const sign=p.find(a=>a.assetId==='PROP_SIGN_CAMPUS_001');assert.ok(sign.collision[0].max[0]-sign.collision[0].min[0]<=.13,'sign pole must not become panel-width wall');
 const bollard=p.find(a=>a.assetId==='PROP_BOLLARD_CAMPUS_001');assert.ok(bollard.collision[0].max[0]-bollard.collision[0].min[0]<=.191);
 const rack=p.find(a=>a.assetId==='PROP_BIKERACK_CAMPUS_001');assert.ok(rack.collision[0].max[0]-rack.collision[0].min[0]<=2.00001&&rack.collision[0].max[2]-rack.collision[0].min[2]<=.561);
});
function context({cache=new Map(),wait=Promise.resolve(),failUri=null}={}){const roots=[],loads=[],node=name=>({name,children:[]}); const c={assetCache:cache,roots,loads,released:0,loadAsset:async uri=>{loads.push(uri);await wait;if(uri===failUri)throw Error('fixture load failed');return{uri};},resolveAssetUri:a=>a.uri,createRoot:w=>{const n=node(w.worldId);roots.push(n);return n;},createEntity:e=>node(e.name),attach:(p,c)=>{p.children.push(c);c.parent=p;},setLocalTransform:(n,t)=>{n.transform=t;},createRenderable:()=>node('visual'),createPlaceholder:()=>node('missing'),destroyRoot:r=>{r.destroyed=true;r.children.length=0;},dispose:()=>{c.released++;}};return c;}
test('unchanged shared loader owns six bindings, caches six URLs and disposes/recreates without orphans',async()=>{
 const {CAMPUS_STATIC_PROPS_WORLD:w}=await load();const cache=new Map();
 for(let cycle=0;cycle<3;cycle++){const c=context({cache}),o=createCampusStaticPropRuntime(w,c),r=await o.ready;assert.equal(r.state,'ready');assert.equal(r.bindings.size,6);assert.equal(c.loads.length,cycle?0:6);assert.deepEqual(o.status().assetIds,w.assets.map(a=>a.id));assert.equal(o.status().assetId,null,'batch status does not mislabel all six as first asset');assert.equal(c.roots[0].children.length,6);await o.dispose();await o.dispose();assert.equal(c.released,1);assert.equal(r.bindings.size,0);assert.equal(c.roots[0].children.length,0);assert.equal(cache.size,6);}
});
test('pending batch disposal and a single failed GLB leave no late instances or poisoned cache',async()=>{
 const {CAMPUS_STATIC_PROPS_WORLD:w}=await load();let release;const c=context({wait:new Promise(r=>{release=r;})}),o=createCampusStaticPropRuntime(w,c),p=o.dispose();release();await p;assert.equal(o.status().state,'disposed');assert.equal(c.released,1);assert.equal(c.roots[0].children.length,0);
 const f=context({failUri:w.assets[2].uri}),q=createCampusStaticPropRuntime(w,f);await q.ready;assert.equal(q.status().state,'ready-with-warnings');assert.equal(q.status().diagnostics.filter(d=>d.code==='R_ASSET_LOAD_FAILED').length,1);assert.equal(f.assetCache.size,5);await q.dispose();assert.equal(f.roots[0].children.length,0);
});
test('six grounded proxy circuits stay clear off guidance corridors with explicit NPC filter limits',async()=>{
 const {CAMPUS_STATIC_PROPS:p,CAMPUS_STATIC_PROP_COLLIDERS:boxes}=await load();
 const {roadviewGroundHeight}=await import('../src/roadview-layout.js');
 const {campusNavGraph}=await import('../src/navigation/campus-navigation.js');
 for(const a of p){const [x,y,z]=a.position;near(y-roadviewGroundHeight(x,z),a.groundOffset);
  const angle=a.yaw*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),box=a.collision[0];
  const point=(lx,lz)=>({x:x+c*lx+s*lz,y:a.groundHeight+PLAYER_ORIGIN_Y,z:z-s*lx+c*lz});
  const minX=box.min[0]*.5-.74,maxX=box.max[0]*.5+.74,minZ=box.min[2]*.5-.74,maxZ=box.max[2]*.5+.74;
  const corners=[[minX,minZ],[maxX,minZ],[maxX,maxZ],[minX,maxZ],[minX,minZ]];
  for(let i=0;i<4;i++)for(let n=0;n<=40;n++){const t=n/40,u=corners[i],v=corners[i+1],q=point(u[0]+(v[0]-u[0])*t,u[1]+(v[1]-u[1])*t);assert.ok(canOccupy(q),`${a.assetId} circuit ${i}/${n} clear`);near(roadviewGroundHeight(q.x,q.z),a.groundHeight);}
  assert.ok(campusNavGraph().nearestEdgePoint({x,z},{maxDistance:50}).distance>2.8,'placement stays off nav corridor; not claiming nav reroutes');
  for(const b of boxes.filter(b=>b.assetId===a.assetId))assert.equal(b.maxY>=1.2&&b.minY<=.5,false,'existing guidance filter excludes these decorative proxies');
 }
});
