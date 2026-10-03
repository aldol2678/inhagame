import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GATE_DORM_CORRIDORS, GATE_DORM_SEGMENTS, GATE_DORM_WALK_ROUTE, GATE_DORM_ROUTE_SPAWN } from '../src/main-gate-road-layout.js';
import { fillMainGateRoads } from '../src/main-gate-road-geometry.js';
import { FLAT_GROUND_Y, FLAT_GROUND_MAX_Y } from '../src/flat-ground-surface.js';
import { MAIN_GATE_LEVELS } from '../src/main-gate-terrain-layout.js';
import { createMiniMapDataSource } from '../src/minimap/minimap-data.js';
import { canOccupy, moveAroundObstacles } from '../src/world-collision.js';
import { WORLD_BOUNDS, OBSTACLES } from '../src/campus-layout.js';
import { culturePolygonsOverlap } from '../src/culture-street-layout.js';
import { triangulatePolygon } from '../src/reality-adapter.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { distanceToRoad } from '../src/campus-road-layout.js';

test('main gate crossing and first dormitory entrance form one walkable route in both directions',()=>{
  assert.ok(canOccupy({...GATE_DORM_ROUTE_SPAWN,y:1.15}));
  for(const points of [GATE_DORM_WALK_ROUTE,GATE_DORM_WALK_ROUTE.slice().reverse()]) {
    let p={...points[0],y:1.15};
    assert.ok(canOccupy(p));
    for(const target of points.slice(1)) {
      const a={...p},steps=Math.ceil(Math.hypot(target.x-a.x,target.z-a.z)/.15);
      for(let i=0;i<steps;i++)p={...moveAroundObstacles(p,(target.x-a.x)/steps,(target.z-a.z)/steps),y:1.15};
      assert.ok(Math.hypot(p.x-target.x,p.z-target.z)<.01,JSON.stringify(target));
    }
  }
});

test('legacy gate sidewalk and zebra box overlays stay removed; flat tactile dressing remains',()=>{
  const gate=readFileSync(new URL('../src/gate-blockout.js',import.meta.url),'utf8');
  const detail=readFileSync(new URL('../src/main-gate-detail.js',import.meta.url),'utf8');
  assert.ok(FLAT_GROUND_Y.DETAIL<FLAT_GROUND_MAX_Y);
  assert.doesNotMatch(gate,/gate_sidewalk_/);
  assert.doesNotMatch(gate,/gate_crosswalk_/);
  assert.doesNotMatch(gate,/segment\(root/);
  assert.match(detail,/rect\(b,GATE_FRAME/);
  assert.match(detail,/G\.PAINT,QA\.edge/);
  assert.doesNotMatch(detail,/c2aa63|e0c982|939c96|d0b04e/);
});

test('inner gate zebra and sidewalks stay above their visible pavement owner',()=>{
  const quads=[];
  fillMainGateRoads({quad(color,a,b,c,d){quads.push({color,vertices:[a,b,c,d]});},box(){}});
  const zebra=quads.filter(q=>q.color==='#eee9da'&&q.vertices.every(p=>p[1]===MAIN_GATE_LEVELS.zebra));
  assert.equal(zebra.length,11,'inner gate zebra keeps eleven flat white stripes');
  const flush=quads.filter(q=>q.color==='#b9b4a6'&&q.vertices.every(p=>p[1]===MAIN_GATE_LEVELS.sidewalk));
  assert.ok(flush.length>=3,'gate sidewalks and pedestrian exit remain flush overlays');
  assert.ok(MAIN_GATE_LEVELS.sidewalk>MAIN_GATE_LEVELS.road);
  assert.ok(MAIN_GATE_LEVELS.zebra>MAIN_GATE_LEVELS.joint);
});

test('minimap and full map consume every same-width world corridor without building overlap',()=>{
  const records=createMiniMapDataSource().geometry();
  for(const s of GATE_DORM_SEGMENTS) {
    const i=Number(s.id.match(/_(\d+)$/)[1]),prefix=s.road.kind==='ROAD'?'maproad':'mappath';
    const record=records.find(q=>q.id===`${prefix}.${s.road.id}.${i}`);
    assert.ok(record,s.id);assert.equal(record.source,'GATE_DORM_CORRIDORS');
    const ring=record.rings[0];
    assert.ok(Math.abs(Math.hypot(ring[0].x-ring[3].x,ring[0].z-ring[3].z)-s.road.width)<1e-6);
    for(const p of ring)assert.ok(p.x>WORLD_BOUNDS.minX&&p.x<WORLD_BOUNDS.maxX&&p.z>WORLD_BOUNDS.minZ&&p.z<WORLD_BOUNDS.maxZ);
    if(s.road.id!=='main_gate_approach')for(const o of OBSTACLES.filter(q=>q.id.startsWith('bldg_')&&q.minY===0)) {
      const indices=triangulatePolygon(o.polygon);
      for(let j=0;j<indices.length;j+=3)assert.ok(!culturePolygonsOverlap(ring,indices.slice(j,j+3).map(k=>o.polygon[k])),`${s.id}/${o.id}`);
    }
  }
  assert.equal(records.filter(q=>q.source==='GATE_DORM_CORRIDORS').length,GATE_DORM_SEGMENTS.length);
  assert.equal(new Set(GATE_DORM_CORRIDORS.map(q=>q.id)).size,GATE_DORM_CORRIDORS.length);
});

test('road surface is finite, upward-facing and remains clear of procedural tree crowns',()=>{
  let quads=0;
  fillMainGateRoads({quad(c,a,b,d,e){
    quads++;assert.ok([...a,...b,...d,...e].every(Number.isFinite));
    assert.equal(new Set([a[1],b[1],d[1],e[1]]).size,1);
    assert.ok((b[2]-a[2])*(d[0]-a[0])-(b[0]-a[0])*(d[2]-a[2])>0);
  },box(c,p,s,y){assert.ok([...p,...s,y].every(Number.isFinite));}});
  assert.ok(quads>100&&quads<1500,quads);
  for(const c of RENDER_CHUNKS)for(const tree of c.trees)for(const road of GATE_DORM_SEGMENTS)
    assert.ok(distanceToRoad(tree,road)>road.road.width/2+1.9);
});
