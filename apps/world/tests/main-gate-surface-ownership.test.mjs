import test from 'node:test';
import assert from 'node:assert/strict';
import { GATE_FRAME as f } from '../src/main-gate-frame.js';
import { clipLegacyGateGround, MAIN_GATE_GROUND_MASKS } from '../src/main-gate-surface-ownership.js';
import { fillCampusRoadBatch } from '../src/campus-road-geometry.js';
import { createMiniMapDataSource } from '../src/minimap/minimap-data.js';

const area=r=>Math.abs(r.reduce((s,p,i)=>{const q=r[(i+1)%r.length];return s+p.x*q.z-q.x*p.z;},0)/2);
const rect=(u0,u1,v0,v1)=>[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>f.at(u,v));
const strictlyInside=(p,r)=>r.every((a,i)=>{const b=r[(i+1)%r.length];return (b.x-a.x)*(p.z-a.z)-(b.z-a.z)*(p.x-a.x)>1e-6;});
function assertOutside(r){
  assert.ok(r.length>=3&&area(r)>1e-8);
  assert.ok(r.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)));
  const c={x:r.reduce((s,p)=>s+p.x,0)/r.length,z:r.reduce((s,p)=>s+p.z,0)/r.length};
  for(const p of [c,...r.map(p=>({x:(c.x+p.x)/2,z:(c.z+p.z)/2}))])
    assert.ok(!MAIN_GATE_GROUND_MASKS.some(mask=>strictlyInside(p,mask)),'legacy ground intrudes into authored gate pavement');
}

test('gate surface subtraction covers the apron, preserves outside geometry and cuts a crossing at its true boundary',()=>{
  assert.deepEqual(clipLegacyGateGround(rect(-1,1,-1,1)),[]);
  const outside=rect(120,125,30,35);
  assert.deepEqual(clipLegacyGateGround(outside),[outside]);
  const crossing=rect(40,50,-20,-18);
  for(const ring of [crossing,[...crossing].reverse()]){
    const pieces=clipLegacyGateGround(ring);
    assert.ok(Math.abs(pieces.reduce((s,r)=>s+area(r),0)-10)<1e-6,'exactly half the crossing remains');
    pieces.forEach(assertOutside);
  }
});

test('all rendered legacy road faces remain upward and outside the editor-owned gate surface',()=>{
  let faces=0;
  fillCampusRoadBatch({quad(_color,...p){
    const [a,b,c]=p;
    assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>1e-10,'upward nondegenerate face');
    assertOutside(p.map(v=>({x:v[0],z:v[2]})));faces++;
  }});
  assert.ok(faces>100);
});

test('minimap suppresses the three covered gate path segments and clips every remaining legacy strip',()=>{
  const geometry=createMiniMapDataSource().geometry(),ids=new Set(geometry.map(g=>g.id));
  for(const id of ['mappath.site_481241658.1','mappath.site_481241658.0','mappath.site_481241689.0'])
    assert.equal(ids.has(id),false,id);
  for(const g of geometry.filter(g=>['CAMPUS_ROADS','SITE_FEATURES_PATH'].includes(g.source)))g.rings.forEach(assertOutside);
  assert.ok(ids.has('maproad.main_gate_forecourt'));
});

test('the separate library gate connector renderer cannot paint a strip through the apron',async()=>{
  const {readFileSync}=await import('node:fs');
  const {LIBRARY_ROUTE_CELLS}=await import('../src/library-route-layout.js');
  const {fillLegacyGateGround}=await import('../src/main-gate-surface-ownership.js');
  const faces=[];
  class Batch{quad(_color,...p){faces.push(p);}triangle(_color,...p){faces.push(p);}finish(){}}
  const source=readFileSync(new URL('../src/library-route-geometry.js',import.meta.url),'utf8')
    .replace(/^import .*;$/gm,'').replace('export function','function');
  const build=new Function('FacilityMeshBatch','LIBRARY_BANK_CELLS','LIBRARY_ROUTE_CELLS','LIBRARY_ROUTE_GUARDS','fillLegacyGateGround',source+';return buildLibraryRoute;')
    (Batch,[],LIBRARY_ROUTE_CELLS.filter(q=>q.line==='main_gate_walk_link'),[],fillLegacyGateGround);
  build({});assert.ok(faces.length>0,'the portion outside the apron is retained');
  faces.forEach(p=>assertOutside(p.map(v=>({x:v[0],z:v[2]}))));
});
