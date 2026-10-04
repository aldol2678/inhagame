import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import {
  LIBRARY_GREENS, GARDEN_FLOOR, GARDEN_WALLS, GARDEN_BEDS,
  GARDEN_BENCHES, GARDEN_SEAT, GARDEN_TREES, GARDEN_COLLIDERS,
  GARDEN_ENTRANCES, GARDEN_LIBRARY_PATHS, gardenEntryHeight,
  libraryGardenGroundHeight
} from '../src/library-garden-layout.js';
import { FLAT_GROUND_Y } from '../src/flat-ground-surface.js';

// Replace GPU allocation only; exercise the real layout, renderer, mesh math and
// shared material cache. A no-op builder, wrong floor offset, reversed ramp or
// missing ownership filter must fail these geometry assertions.
registerHooks({resolve(specifier,context,next){
  return specifier==='playcanvas'?{url:'data:text/javascript,'+encodeURIComponent(`
    export class Entity {
      constructor(name){this.name=name;this.children=[];this.handlers={};}
      addChild(child){this.children.push(child);child.parent=this;}
      addComponent(type,data){this[type]=data;}
      on(event,fn){this.handlers[event]=fn;}
      destroy(){this.handlers.destroy?.();for(const child of this.children)child.destroy();}
    }
    export class StandardMaterial {update(){} destroy(){this.destroyed=true;}}
    export class Color {constructor(r,g,b){Object.assign(this,{r,g,b});}}
    export class MeshInstance {constructor(mesh,material){Object.assign(this,{mesh,material});}}
    export const Application={getApplication:()=>({graphicsDevice:{}})};
    export function createMesh(_device,positions,rest){return {positions,...rest,destroy(){this.destroyed=true;}};}
  `),shortCircuit:true}:next(specifier,context);
}});
const { Entity }=await import('playcanvas');
const { buildGardenCampusTerrain, buildLibraryGardenBase, buildLibraryGardenDetail }=await import('../src/library-garden-geometry.js');
const { campusMaterialCacheStatus }=await import('../src/campus-render-kit.js');
const colliders=new Map(GARDEN_COLLIDERS.map(q=>[q.id,q]));
const close=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<1e-7;
const allEntities=root=>[root,...root.children.flatMap(allEntities)];
const instances=root=>allEntities(root).flatMap(e=>e.render?.meshInstances??[]);
const vertices=root=>instances(root).flatMap(({mesh})=>Array.from({length:mesh.positions.length/3},(_,i)=>mesh.positions.slice(i*3,i*3+3)));
const triangles=root=>instances(root).flatMap(({mesh})=>Array.from({length:mesh.indices.length/3},(_,i)=>mesh.indices.slice(i*3,i*3+3).map(id=>mesh.positions.slice(id*3,id*3+3))));
function base(){const root=new Entity('CampusBase');buildLibraryGardenBase(root);return root;}
function hasVertex(points,p,y){return points.some(v=>close(v[0],p.x)&&close(v[1],y)&&close(v[2],p.z));}
function heightAt(tris,p){
  const heights=[];
  for(const [a,b,c] of tris){
    const d=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2]);
    if(d>=-1e-9)continue; // upward/front-facing surfaces only
    const u=((b[2]-c[2])*(p.x-c[0])+(c[0]-b[0])*(p.z-c[2]))/d;
    const v=((c[2]-a[2])*(p.x-c[0])+(a[0]-c[0])*(p.z-c[2]))/d;
    const w=1-u-v;
    if(Math.min(u,v,w)>=-1e-8)heights.push(u*a[1]+v*b[1]+w*c[1]);
  }
  return heights.length?Math.max(...heights):null;
}

test('garden BASE visibly covers exact wall and bed collider footprints and elevations',()=>{
  const root=base(),points=vertices(root);
  assert.ok(points.length>0,'garden must not remain a render no-op');
  for(const q of [...GARDEN_WALLS,...GARDEN_BEDS]){
    const bounds=colliders.get(q.id);
    for(const p of q.polygon)for(const y of [bounds.minY,bounds.maxY]){
      assert.ok(hasVertex(points,p,y),`${q.id}: missing collider corner at y=${y}`);
    }
  }
  root.destroy();
});

test('garden bench seat tops and backs use the lowered floor and shared seat dimensions',()=>{
  const root=base(),points=vertices(root),tris=triangles(root);
  const seatTop=GARDEN_FLOOR+GARDEN_SEAT.centerY+GARDEN_SEAT.slatHeight/2;
  for(const q of GARDEN_BENCHES){
    const collider=colliders.get(q.id);
    assert.ok(close(heightAt(tris,q.frame.at(0,.04)),seatTop),`${q.id}: seat top must match seated anchor`);
    assert.ok(close(heightAt(tris,q.frame.at(0,-.24)),collider.maxY),`${q.id}: back reaches collider top`);
    assert.ok(points.some(p=>close(p[1],collider.minY)&&Math.hypot(p[0]-q.center.x,p[2]-q.center.z)<.7),`${q.id}: grounded supports`);
  }
  root.destroy();
});

test('tree collision silhouettes persist in BASE for lowered and ordinary green areas',()=>{
  const root=base(),points=vertices(root);
  assert.ok(GARDEN_TREES.some(q=>q.areaIndex===0)&&GARDEN_TREES.some(q=>q.areaIndex!==0));
  for(const tree of GARDEN_TREES){
    const q=colliders.get(tree.id);
    for(const p of q.polygon)for(const y of [q.minY,q.maxY])assert.ok(hasVertex(points,p,y),`${q.id}: trunk at ${y}`);
    assert.ok(points.some(p=>Math.hypot(p[0]-tree.x,p[2]-tree.z)>.5&&Math.hypot(p[0]-tree.x,p[2]-tree.z)<1.5&&p[1]>q.minY+1&&p[1]<q.maxY),`${q.id}: persistent crown`);
  }
  root.destroy();
});

test('visible stairs and ramp sample the existing entry height function throughout each route',()=>{
  const root=base(),tris=triangles(root);
  for(const q of GARDEN_ENTRANCES){
    for(let i=0;i<24;i++)for(const side of [-.4,0,.4]){
      const v=(i+.31)/24*q.run,p=q.frame.at(q.u+side*q.width,v);
      const expected=gardenEntryHeight(q,v);
      assert.ok(close(libraryGardenGroundHeight(p.x,p.z),expected),`${q.id}: fixture samples navigation route`);
      assert.ok(close(heightAt(tris,p),expected),`${q.id}: visual height at v=${v} must be ${expected}, got ${heightAt(tris,p)}`);
    }
    if(q.steps)for(let i=1;i<=q.steps;i++){
      const v=i*q.run/q.steps;
      for(const u of [q.u-q.width/2,q.u+q.width/2])for(const y of [gardenEntryHeight(q,v-.001),gardenEntryHeight(q,v)]){
        assert.ok(hasVertex(vertices(root),q.frame.at(u,v),y),`${q.id}: closed step riser ${i}`);
      }
    }
  }
  root.destroy();
});

test('public garden-to-library route centrelines have near-ground visible paving',()=>{
  const root=base(),tris=triangles(root);
  for(const path of GARDEN_LIBRARY_PATHS)for(let i=1;i<path.length;i++){
    const a=path[i-1],b=path[i],p={x:(a.x+b.x)/2,z:(a.z+b.z)/2};
    assert.ok(close(heightAt(tris,p),FLAT_GROUND_Y.SURFACE),'route must be visible without becoming raised ground');
  }
  root.destroy();
});

test('decoration never duplicates the persistent campus terrain floor or seals an entrance',()=>{
  const legacy=new Entity('Legacy');buildGardenCampusTerrain(legacy);
  assert.equal(legacy.children.length,0,'campus-terrain owns the foundation');
  const root=base(),tris=triangles(root);
  const floorArea=tris.reduce((sum,[a,b,c])=>{
    if(![a,b,c].every(p=>close(p[1],GARDEN_FLOOR)))return sum;
    const up=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
    return sum+Math.max(0,up)/2;
  },0);
  assert.equal(floorArea,0,'no new upward-facing garden floor');
  assert.ok(allEntities(root).every(e=>!e.collision&&!e.rigidbody),'render-only, no new physics');
  root.destroy();
});

test('garden DETAIL respects chunk ownership and does not rebuild collision-bearing BASE',()=>{
  const other=new Entity('Other');buildLibraryGardenDetail(other,['unrelated_asset']);
  assert.equal(other.children.length,0);
  const empty=new Entity('Empty');buildLibraryGardenDetail(empty,[]);
  assert.equal(empty.children.length,0);
  const selected=new Entity('Selected');buildLibraryGardenDetail(selected,[LIBRARY_GREENS[0].id]);
  assert.ok(vertices(selected).length>0,'selected garden gets optional detail');
  assert.ok(vertices(selected).every(p=>p[1]>GARDEN_FLOOR+.3),'detail contains no foundational walls, routes or trunks');
  const repeated=new Entity('Repeated');buildLibraryGardenDetail(repeated,[LIBRARY_GREENS[0].id,LIBRARY_GREENS[0].id]);
  assert.deepEqual(vertices(repeated),vertices(selected),'duplicate owner IDs do not duplicate geometry');
  selected.destroy();repeated.destroy();
});

test('garden meshes are destroyed with each layer while cached materials survive rebuilds',()=>{
  const root=base(),details=new Entity('DETAIL');buildLibraryGardenDetail(details,LIBRARY_GREENS.map(q=>q.id));
  const rendered=[...instances(root),...instances(details)];
  assert.ok(rendered.length>0);
  assert.ok(rendered.length<=12,'neutral garden stays batched per material, not per ornament');
  assert.ok(rendered.every(({mesh})=>mesh.positions.every(Number.isFinite)&&mesh.normals.every(Number.isFinite)));
  const materialCount=campusMaterialCacheStatus().materialCount;
  root.destroy();details.destroy();
  assert.ok(rendered.every(({mesh})=>mesh.destroyed));
  assert.ok(rendered.every(({material})=>!material.destroyed),'shared materials remain owned by campus-render-kit');
  const rebuilt=base();buildLibraryGardenDetail(rebuilt,LIBRARY_GREENS.map(q=>q.id));
  assert.equal(campusMaterialCacheStatus().materialCount,materialCount);
  rebuilt.destroy();
});
