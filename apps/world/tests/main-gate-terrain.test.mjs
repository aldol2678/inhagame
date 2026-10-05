import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_GATE_LEVELS as L, gateCurbFaces, gateArrowTriangles, MAIN_GATE_TERRAIN_VISTAS,
  MAIN_GATE_CAMPUS_LINK_IDS, MAIN_GATE_CAMPUS_LINK_LEVELS, MAIN_GATE_CENTRAL_POOL_ID, gateCentralPoolRimFaces } from '../src/main-gate-terrain-layout.js';
import { SITE_FEATURES } from '../src/basic-campus.js';
import { mainGateProductionPath, mainGateProductionStructure } from '../src/editor/main-gate-production.js';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { moveAroundObstacles, resolveHeight, canOccupy } from '../src/world-collision.js';
import { MAIN_GATE_SPAWN } from '../src/campus-spawn.js';
import { readFileSync } from 'node:fs';
import { roadFrame, CAMPUS_PATH_WIDTHS } from '../src/campus-road-layout.js';
import { gateGroundOverlaps, fillLegacyGateGround } from '../src/main-gate-surface-ownership.js';
import { roadSurface } from '../src/campus-road-geometry.js';
import { MAIN_HALL_WALKWAY_SOURCE_IDS } from '../src/main-hall-walkway-layout.js';

test('pavement layers are above lawn/asphalt and zebra is above all sidewalk details',()=>{
  assert.ok(.018<L.road&&L.road<L.sidewalk&&L.sidewalk<L.paint&&L.paint<L.joint&&L.joint<L.zebra);
  assert.ok(L.zebra<=.030,'flat paint remains in the existing logical-ground envelope');
});

test('curb faces share canonical low top Y and continuous nonoverlapping join edges',()=>{
  for(const id of ['gate_curb_west','gate_curb_east']){
    const path=mainGateProductionPath(id),faces=gateCurbFaces(path);
    assert.equal(faces.length,11);
    assert.ok(faces.flat().flat().every(Number.isFinite));
    assert.ok(faces.flat().every(p=>p[1]>=L.road&&p[1]<=.065));
    const tops=faces.filter(q=>q.every(p=>p[1]===path.vertices[0].y));
    assert.equal(tops.length,3);
    for(let i=1;i<tops.length;i++)assert.equal(tops[i].filter(p=>tops[i-1].some(q=>p.every((v,k)=>v===q[k]))).length,2,'neighbor top faces share exactly one edge');
    assert.ok(.065-L.road<.05,'curb rise above paving is under 10 cm');
  }
});

test('directional arrows are upward-facing flat paint, not raised tubes',()=>{
  for(const u of [-4.2,4.2])for(const v of [0,12]){
    const triangles=gateArrowTriangles(u,v,u>0?1:-1);
    assert.equal(triangles.length,5);
    for(const [a,b,c] of triangles){
      assert.ok([a,b,c].flat().every(Number.isFinite));
      assert.ok([a,b,c].every(p=>p[1]===L.paint));
      assert.ok((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>0);
    }
  }
});

test('island base sits on pavement and green meets its low retaining edge',()=>{
  const base=mainGateProductionStructure('gate_traffic_island_base'),green=mainGateProductionStructure('gate_traffic_island_green');
  const bottom=base.position[1]-base.size[1]/2,top=base.position[1]+base.size[1]/2;
  assert.ok(Math.abs(bottom-L.road)<1e-9);
  assert.ok(Math.abs(green.position[1]-green.size[1]/2-top)<1e-9);
  assert.ok(green.position[1]+green.size[1]/2<.09);
});

test('gate campus links stay flush and central pool rim corners share exactly one edge',()=>{
  assert.equal(MAIN_GATE_CAMPUS_LINK_IDS.length,3);
  for(const id of MAIN_GATE_CAMPUS_LINK_IDS)assert.equal(SITE_FEATURES.find(f=>f.id===id).kind,'path');
  assert.ok(MAIN_GATE_CAMPUS_LINK_LEVELS.edge>.018);
  assert.ok(MAIN_GATE_CAMPUS_LINK_LEVELS.road>L.road&&MAIN_GATE_CAMPUS_LINK_LEVELS.road<L.sidewalk);
  const pool=SITE_FEATURES.find(f=>f.id===MAIN_GATE_CENTRAL_POOL_ID),faces=gateCentralPoolRimFaces(pool.vertices);
  assert.equal(faces.length,12,'four continuous sides, no overlapping endpoint caps');
  const tops=faces.filter(q=>q.every(p=>p[1]===.08));
  assert.equal(tops.length,4);
  for(let i=0;i<4;i++)assert.equal(tops[i].filter(p=>tops[(i+1)%4].some(q=>p.every((v,k)=>v===q[k]))).length,2);
  assert.ok(faces.flat().every(p=>p[1]>=0&&p[1]<=.08));
});

test('actual campus ground renderer clips every legacy gate overlap and retains other paths',()=>{
  const quads=[],segments=[];
  class Batch { quad(color,...points){quads.push({color,points});} finish(){} }
  const source=readFileSync(new URL('../src/campus-grounds.js',import.meta.url),'utf8')
    .replace(/^import .*;$/gm,'').replaceAll('export function','function');
  const render=new Function('pc','SITE_FEATURES','polygon','segment','surface','box','pondWaterMaterial',
    'CAMPUS_PATH_WIDTHS','FacilityMeshBatch','roadSurface','roadFrame','MAIN_GATE_CAMPUS_LINK_IDS','L',
    'MAIN_GATE_CENTRAL_POOL_ID','gateCentralPoolRimFaces','gateGroundOverlaps','fillLegacyGateGround','MAIN_HALL_WALKWAY_SOURCE_IDS',source+';return buildCampusGrounds;')(
      {Application:{getApplication:()=>({graphicsDevice:{}})}},SITE_FEATURES,()=>{},(_root,id)=>segments.push(id),x=>x,
      ()=>{},()=>{},CAMPUS_PATH_WIDTHS,Batch,roadSurface,roadFrame,MAIN_GATE_CAMPUS_LINK_IDS,
      MAIN_GATE_CAMPUS_LINK_LEVELS,MAIN_GATE_CENTRAL_POOL_ID,gateCentralPoolRimFaces,gateGroundOverlaps,fillLegacyGateGround,MAIN_HALL_WALKWAY_SOURCE_IDS);
  render({});
  assert.ok(quads.some(q=>q.color==='#747d7b'));
  for(const q of quads.filter(q=>['#747d7b','#b4b4a8'].includes(q.color)))
    assert.equal(gateGroundOverlaps(q.points.map(p=>({x:p[0],z:p[2]}))),false,'legacy pavement stays outside gate apron');
  assert.ok(quads.filter(q=>q.color==='#747d7b').every(q=>q.points.every(p=>p[1]===MAIN_GATE_CAMPUS_LINK_LEVELS.road)));
  assert.ok(segments.every(id=>!MAIN_GATE_CAMPUS_LINK_IDS.some(prefix=>id===`${prefix}_1`||id===`${prefix}_sidewalk_1`)&&!id.startsWith(MAIN_GATE_CENTRAL_POOL_ID)));
  for(const feature of SITE_FEATURES.filter(f=>f.kind==='path'))
    for(let i=1;i<feature.vertices.length;i++){
      const f=roadFrame(feature.vertices[i-1],feature.vertices[i]),h=((CAMPUS_PATH_WIDTHS[feature.id]||3.5)+2.1)/2;
      const clipped=gateGroundOverlaps([f.at(0,-h),f.at(f.length,-h),f.at(f.length,h),f.at(0,h)]);
      const flush=(i===1&&MAIN_GATE_CAMPUS_LINK_IDS.includes(feature.id))||MAIN_HALL_WALKWAY_SOURCE_IDS.includes(feature.id);
      assert.equal(segments.includes(`${feature.id}_${i}`),!clipped&&!flush,'legacy segment '+feature.id+'_'+i);
    }
  assert.equal(quads.filter(q=>q.color==='#c8c7b4').length,12);
});

test('spawn, zebra, opening and lawn axis roundtrip preserve movement and per-frame ground Y',()=>{
  const point=id=>MAIN_GATE_TERRAIN_VISTAS.find(p=>p.id===id);
  const route=[point('spawn'),point('before-inner-zebra'),point('after-inner-zebra'),point('gate-opening'),point('central-lawn-axis')];
  let samples=0;
  for(const step of [.15,.3])for(const points of [route,[...route].reverse()]){
    let p={...points[0],y:MAIN_GATE_SPAWN.y};
    assert.ok(canOccupy(p));
    for(const target of points.slice(1)){
      const start={...p},count=Math.ceil(Math.hypot(target.x-p.x,target.z-p.z)/step);
      for(let i=0;i<count;i++){
        const q=moveAroundObstacles(p,(target.x-start.x)/count,(target.z-start.z)/count);
        const ground=MAIN_GATE_SPAWN.y+roadviewGroundHeight(q.x,q.z);
        q.y=resolveHeight(p,ground,ground);
        assert.ok(Math.abs(q.y-p.y)<1e-9,'no height jump or hidden terrain collider');
        assert.equal(q.y,MAIN_GATE_SPAWN.y);
        assert.ok(canOccupy(q));p=q;samples++;
      }
      assert.ok(Math.hypot(target.x-p.x,target.z-p.z)<.001,'semantic route reaches '+target.id);
    }
  }
  assert.ok(samples>600);
});
