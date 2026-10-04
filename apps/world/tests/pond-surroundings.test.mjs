import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';

// Only GPU allocation is replaced. Real tessellation/batching and the current
// gameplay coordinates run below; browser/null-device QA checks actual ownership.
const gpu=`export class Entity {constructor(name){this.name=name;this.children=[];this.handlers={}}addChild(e){this.children.push(e)}addComponent(k,v){this[k]=v}on(k,f){this.handlers[k]=f}}
export class StandardMaterial{update(){}} export class Color{constructor(r,g,b){Object.assign(this,{r,g,b})}}
export class MeshInstance{constructor(mesh,material){Object.assign(this,{mesh,material})}}
export const Application={getApplication:()=>({graphicsDevice:{}})};
export function createMesh(d,positions,rest){return {positions,...rest,destroy(){this.destroyed=true}}}`;
registerHooks({resolve(s,c,next){return s==='playcanvas'?{url:'data:text/javascript,'+encodeURIComponent(gpu),shortCircuit:true}:next(s,c)}});
const { FacilityMeshBatch }=await import('../src/facility-mesh-batch.js');
const source=new URL('../src/pond-surroundings-geometry.js',import.meta.url);
const pond=existsSync(source)?await import(source):{};
const { POND_RING, POND_TREE_SEATING, pondSeatTrees, pondBankTrees, roadviewGroundHeight }=await import('../src/roadview-layout.js');
const { SEAT_ANCHORS, SEAT_TOP_Y }=await import('../src/seat-anchors.js');
const { FISHING_SPOTS, FISHING_SPOT_RADIUS }=await import('../src/activity/fishing-spots.js');
const { polygonOverlap }=await import('../src/polygon-collision.js');
const { canOccupy }=await import('../src/world-collision.js');

const triangles=batch=>[...batch.groups.entries()].flatMap(([color,g])=>Array.from({length:g.indices.length/3},(_,i)=>({color,v:g.indices.slice(i*3,i*3+3).map(n=>g.positions.slice(n*3,n*3+3))})));
const cross=(a,b,c)=>(b[0]-a[0])*(c[2]-a[2])-(b[2]-a[2])*(c[0]-a[0]);
function surfacesAt(tris,p){
  return tris.filter(({v:[a,b,c]})=>{
    if(Math.max(a[1],b[1],c[1])-Math.min(a[1],b[1],c[1])>1e-9||cross(a,b,c)>=-1e-9)return false;
    const q=[p.x,0,p.z];return [cross(a,b,q),cross(b,c,q),cross(c,a,q)].every(n=>n<=1e-8);
  }).map(t=>t.v[0][1]);
}
function geometry(){assert.equal(typeof pond.fillPondSurroundingsBase,'function','persistent pond renderer is missing');const b=new FacilityMeshBatch();pond.fillPondSurroundingsBase(b);return {b,tris:triangles(b)};}

test('all 32 existing pond sit anchors have a visible seat top at their unchanged contract height',()=>{
  const {tris}=geometry(),seats=SEAT_ANCHORS.filter(a=>a.id.startsWith('SEAT_INKYUNG_TREE_'));
  assert.equal(seats.length,32);assert.equal(pondSeatTrees().length,4);
  for(const seat of seats){
    assert.ok(surfacesAt(tris,seat.position).some(y=>Math.abs(y-SEAT_TOP_Y)<1e-8),seat.id+' has no matching visible slab');
    assert.equal(roadviewGroundHeight(seat.standPoint.x,seat.standPoint.z),0);
    assert.ok(canOccupy(seat.standPoint),seat.id+' keeps its existing clear stand point');
  }
});

test('shore dressing stays outside the canonical water and uses the flat-ground height budget',()=>{
  const {tris}=geometry(),shore=tris.filter(t=>t.color===pond.POND_COLORS.stone);
  assert.ok(shore.length>20,'the empty shoreline must receive visible ground definition');
  for(const {v} of shore){
    assert.ok(v.every(p=>p[1]>=0&&p[1]<=.03),'shore is a ground cap, not an unsupported raised wall');
    assert.ok(cross(...v)<0,'shore triangles point up');
    for(const weights of [[.8,.1,.1],[.1,.8,.1],[.1,.1,.8],[1/3,1/3,1/3]]){
      const x=v.reduce((s,p,i)=>s+p[0]*weights[i],0),z=v.reduce((s,p,i)=>s+p[2]*weights[i],0);
      assert.equal(polygonOverlap(x,z,POND_RING),false,'shore never paints into the water');
    }
  }
});

test('fishing banks remain clear and base geometry is finite and bounded',()=>{
  const {b,tris}=geometry();assert.ok(b.groups.size<=6,'bounded static color batches');assert.ok(tris.length<=4000,'bounded persistent triangles');
  for(const {v} of tris){assert.ok(v.flat().every(Number.isFinite));
    for(const p of v)if(p[1]>.03&&p[1]<2)for(const spot of FISHING_SPOTS)
      assert.ok(Math.hypot(p[0]-spot.position.x,p[2]-spot.position.z)>FISHING_SPOT_RADIUS+.25,'fishing approach stays clear of props');
  }
  for(const spot of FISHING_SPOTS){assert.ok(canOccupy({...spot.position,y:1.15}));assert.equal(roadviewGroundHeight(spot.position.x,spot.position.z),0);}
  assert.equal(POND_TREE_SEATING.slabs,8);assert.equal(pondBankTrees().filter(t=>t.heroWillow).length,1);
});
