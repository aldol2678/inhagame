import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { WORLD_BOUNDS } from '../src/campus-layout.js';
import { SPORTS_CUT_RING, SPORTS_FLOOR } from '../src/stadium-stands-layout.js';

// Exercise the builder selected by the real persistent renderer. Only GPU allocation
// is replaced: the source imports, generated geometry, materials and ownership run.
const mockPc=`
export class Entity {
  constructor(name){this.name=name;this.children=[];this.handlers={};}
  addChild(child){this.children.push(child);child.parent=this;}
  addComponent(type,data){this[type]=data;}
  on(event,fn){this.handlers[event]=fn;}
  destroy(){this.handlers.destroy?.();for(const c of this.children)c.destroy();}
}
export class StandardMaterial { update(){} }
export class Color {constructor(r,g,b){Object.assign(this,{r,g,b});}}
export class MeshInstance {constructor(mesh,material){Object.assign(this,{mesh,material});}}
export const Application={getApplication:()=>({graphicsDevice:{}})};
export function createMesh(_device,positions,rest){return {positions,...rest,destroy(){this.destroyed=true;}};}
`;
registerHooks({resolve(specifier,context,next){
  return specifier==='playcanvas'?{url:'data:text/javascript,'+encodeURIComponent(mockPc),shortCircuit:true}:next(specifier,context);
}});
const source=readFileSync(new URL('../src/campus-chunk-renderer.js',import.meta.url),'utf8');
const selected=source.match(/import \{ (build(?:GardenCampusTerrain|CampusTerrain))[^\n]* from '([^']+)'/);
assert.ok(selected,'persistent renderer must import a terrain builder');
const module=await import(new URL(selected[2],new URL('../src/campus-chunk-renderer.js',import.meta.url)));
const build=module[selected[1]];
const { Entity }=await import('playcanvas');
function buildRoot(){const root=new Entity('CampusBase');build(root,WORLD_BOUNDS,[{polygon:SPORTS_CUT_RING,floor:SPORTS_FLOOR}]);return root;}

test('persistent campus terrain builder emits an opaque upward mesh instead of a no-op',()=>{
  const root=buildRoot();
  const terrain=root.children.find(c=>c.name==='campus_terrain');
  assert.ok(terrain,'missing base terrain exposes the sky between roads, lawns and buildings');
  assert.equal(terrain.render.castShadows,false);
  const {mesh,material}=terrain.render.meshInstances[0];
  assert.ok(mesh.indices.length>0);
  assert.ok(material.diffuse.g>material.diffuse.b,'neutral earth/grass material, not sky blue');
  assert.ok(material.opacity===undefined||material.opacity===1);
  assert.ok(material.depthWrite===undefined||material.depthWrite);
  for(let i=1;i<mesh.positions.length;i+=3)assert.equal(mesh.positions[i],0);
  for(let i=1;i<mesh.normals.length;i+=3)assert.equal(mesh.normals[i],1);
  root.destroy();assert.equal(mesh.destroyed,true,'mesh lifetime follows the persistent base');
});

const { SITE_FEATURES }=await import('../src/basic-campus.js');
const { LIBRARY_GREENS, GARDEN_FLOOR }=await import('../src/library-garden-layout.js');
const { POND_RING }=await import('../src/roadview-layout.js');
const { computePolygonAreaWU }=await import('../src/reality-adapter.js');
const { polygonOverlap }=await import('../src/polygon-collision.js');
const holes=[POND_RING,SITE_FEATURES.find(f=>f.kind==='reflecting_pool').vertices,LIBRARY_GREENS[0].polygon,SPORTS_CUT_RING];
const cross=(a,b,c)=>(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
const triangles=mesh=>Array.from({length:mesh.indices.length/3},(_,i)=>mesh.indices.slice(i*3,i*3+3).map(id=>mesh.positions.slice(id*3,id*3+3)));
const hits=(tris,x,z)=>tris.some(([a,b,c])=>{
  const p=[x,0,z];return cross(a,b,p)>=-1e-7&&cross(b,c,p)>=-1e-7&&cross(c,a,p)>=-1e-7;
});
function terrainMesh(){const terrain=buildRoot().children.find(c=>c.name==='campus_terrain');assert.ok(terrain,'terrain mesh must exist');return terrain.render.meshInstances[0].mesh;}

test('base covers the playable bounds with exact water and lowered-area holes, no blue seams',()=>{
  const mesh=terrainMesh(),tris=triangles(mesh);
  const area=tris.reduce((sum,[a,b,c])=>{const up=cross(a,b,c);assert.ok(up>1e-9,'front faces point up');return sum+up/2;},0);
  const expected=(WORLD_BOUNDS.maxX-WORLD_BOUNDS.minX)*(WORLD_BOUNDS.maxZ-WORLD_BOUNDS.minZ)-holes.reduce((s,r)=>s+computePolygonAreaWU(r),0);
  assert.ok(Math.abs(area-expected)<1e-6,`${area} != ${expected}`);
  let samples=0;
  for(let x=WORLD_BOUNDS.minX+.371;x<WORLD_BOUNDS.maxX;x+=3.13)for(let z=WORLD_BOUNDS.minZ+.219;z<WORLD_BOUNDS.maxZ;z+=3.07){
    assert.equal(hits(tris,x,z),!holes.some(r=>polygonOverlap(x,z,r)),`coverage ${x}, ${z}`);samples++;
  }
  assert.ok(samples>20000);
  for(const [a,b,c] of tris){
    for(const [u,v,w] of [[.5,.25,.25],[.01,.49,.5],[.49,.01,.5],[.49,.5,.01]]){
      const p={x:a[0]*u+b[0]*v+c[0]*w,z:a[2]*u+b[2]*v+c[2]*w};
      assert.ok(!holes.some(r=>polygonOverlap(p.x,p.z,r)),'no triangle crosses a water/depression boundary');
    }
  }
});

test('depressed floors retain their gameplay elevations below existing sports surfaces',()=>{
  const root=buildRoot();
  for(const [name,ring,y] of [['campus_terrain_garden_floor',LIBRARY_GREENS[0].polygon,GARDEN_FLOOR],['campus_terrain_sports_floor',SPORTS_CUT_RING,SPORTS_FLOOR]]){
    const entity=root.children.find(c=>c.name===name);assert.ok(entity,name);
    const mesh=entity.render.meshInstances[0].mesh;
    assert.ok(mesh.positions.filter((_,i)=>i%3===1).every(v=>v===y));
    assert.ok(Math.abs(triangles(mesh).reduce((s,[a,b,c])=>s+cross(a,b,c)/2,0)-computePolygonAreaWU(ring))<1e-6);
  }
  assert.ok(SPORTS_FLOOR<SPORTS_FLOOR+.035);
});

test('terrain stays in the persistent base and never becomes a camera or movement collider',()=>{
  assert.match(source,/buildCampusTerrain\(base,WORLD_BOUNDS\)/);
  assert.doesNotMatch(source.slice(source.indexOf('create(chunk)')),/buildCampusTerrain\(/);
  assert.match(source,/setViewPolicy\(policy\) \{ this\.base\.enabled=policy\.preserveCampus; \}/);
});

function rayHit([a,b,c],origin,direction){
  const sub=(a,b)=>a.map((v,i)=>v-b[i]);
  const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
  const x=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const e1=sub(b,a),e2=sub(c,a),h=x(direction,e2),det=dot(e1,h);
  if(det<=1e-8)return false; // Same front-face/back-cull convention as the runtime.
  const s=sub(origin,a),u=dot(s,h)/det;if(u<0||u>1)return false;
  const q=x(s,e1),v=dot(direction,q)/det;
  return v>=0&&u+v<=1&&dot(e2,q)/det>0;
}

test('oblique flight rays see closed lower basins rather than sky under the far lip',()=>{
  const root=buildRoot();
  const all=root.children.flatMap(e=>triangles(e.render.meshInstances[0].mesh));
  for(const [origin,direction] of [
    [[9.385236793,8,23.054082889],[-.877375320,-.2,.479804697]],
    [[-66.257813143,8,45.706445268],[-.885024229,-.2,.465544965]]
  ])assert.ok(all.some(t=>rayHit(t,origin,direction)),'blue seam through an uncapped depression side');
});

const { buildCampusTerrainGeometry, buildCampusTerrainSidesGeometry }=await import('../src/campus-terrain-geometry.js');
const ring=points=>points.map(([x,z])=>({x,z}));
const meshArea=mesh=>triangles(mesh).reduce((s,[a,b,c])=>s+cross(a,b,c)/2,0);
test('exact clipping is winding-independent and handles overlapping or exterior cutouts',()=>{
  const envelope={minX:0,maxX:10,minZ:0,maxZ:10};
  const a=ring([[2,2],[6,2],[6,6],[2,6]]),b=ring([[4,4],[8,4],[8,8],[4,8]]);
  for(const cutouts of [[a,b],[a.toReversed(),b.toReversed()]]){
    const mesh=buildCampusTerrainGeometry(envelope,cutouts);
    assert.ok(Math.abs(meshArea(mesh)-72)<1e-8,'subtract the union once');
  }
  assert.equal(meshArea(buildCampusTerrainGeometry(envelope,[ring([[20,20],[30,20],[30,30],[20,30]])])),100);
  assert.equal(meshArea(buildCampusTerrainGeometry(envelope,[ring([[-1,-1],[11,-1],[11,11],[-1,11]])])),0);
  assert.equal(meshArea(buildCampusTerrainGeometry(envelope,[ring([[-2,2],[2,2],[2,4],[-2,4]])])),96);
  assert.throws(()=>buildCampusTerrainGeometry({minX:0,maxX:Infinity,minZ:0,maxZ:1}),/bounds/);
  assert.throws(()=>buildCampusTerrainGeometry(envelope,[ring([[0,0],[1,1],[0,1],[1,0]])]),/self-intersect/);
});

test('depression side meshes have inward unit normals for either source winding and no upper cap',()=>{
  const square=ring([[2,2],[6,2],[6,6],[2,6]]);
  for(const r of [square,square.toReversed()]){
    const mesh=buildCampusTerrainSidesGeometry(r,-.6);
    assert.equal(mesh.indices.length,24);
    for(const [a,b,c] of triangles(mesh)){
      assert.ok(new Set([a[1],b[1],c[1]]).size===2,'side only, never an upper cap');
      const center=[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3];
      assert.ok(rayHit([a,b,c],[4,-.3,4],center.map((v,i)=>v-[4,-.3,4][i])),'front face points into basin');
    }
    for(let i=0;i<mesh.normals.length;i+=3)assert.ok(Math.abs(Math.hypot(...mesh.normals.slice(i,i+3))-1)<1e-9);
  }
  assert.throws(()=>buildCampusTerrainSidesGeometry(square,0),/below zero/);
});
