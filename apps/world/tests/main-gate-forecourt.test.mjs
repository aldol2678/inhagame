import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_GATE_FORECOURT_RING, MAIN_GATE_FORECOURT_QUADS, gateForecourtTreeClear } from '../src/main-gate-forecourt.js';
import { GATE_FRAME } from '../src/main-gate-frame.js';
import { mainGateProductionPath } from '../src/editor/main-gate-production.js';
import { createMiniMapDataSource } from '../src/minimap/minimap-data.js';
import { fillMainGateRoads } from '../src/main-gate-road-geometry.js';
import { MAIN_GATE_LEVELS } from '../src/main-gate-terrain-layout.js';
import { canOccupy, moveAroundObstacles } from '../src/world-collision.js';
import { RENDER_CHUNKS } from '../src/render-chunk-registry.js';

test('flared apron reaches inside curb edges and the map uses its exact outline',()=>{
  const record=createMiniMapDataSource().geometry().find(r=>r.source==='MAIN_GATE_FORECOURT');
  assert.deepEqual(record.rings[0],MAIN_GATE_FORECOURT_RING);
  for(const id of ['gate_curb_west','gate_curb_east']){
    const curb=mainGateProductionPath(id);
    for(const p of curb.vertices){
      const nearest=Math.min(...MAIN_GATE_FORECOURT_RING.map(q=>Math.hypot(q.x-p.x,q.z-p.z)));
      assert.ok(Math.abs(nearest-curb.width/2)<1e-8,'apron must meet the curb inside edge');
    }
  }
  const quads=[];
  fillMainGateRoads({quad(color,...vertices){quads.push({color,vertices});},box(){}});
  for(const q of MAIN_GATE_FORECOURT_QUADS){
    const actual=q.map(p=>[p.x,MAIN_GATE_LEVELS.road,p.z]);
    assert.ok(quads.some(r=>r.color==='#666f70'&&JSON.stringify(r.vertices)===JSON.stringify(actual)));
  }
});

test('new red promenade is flush, continuous and walkable both ways',()=>{
  const path=mainGateProductionPath('main_gate_red_promenade');
  const faces=[];
  fillMainGateRoads({quad(color,...points){if(color==='#a76264')faces.push(points);},box(){}});
  assert.equal(faces.length,1);
  assert.ok(faces[0].every(p=>p[1]===MAIN_GATE_LEVELS.sidewalk));
  for(const vertices of [path.vertices,path.vertices.slice().reverse()]){
    const [a,b]=vertices,steps=Math.ceil(Math.hypot(b.x-a.x,b.z-a.z)/.15);
    let p={...a,y:1.15};
    assert.ok(canOccupy(p));
    for(let i=0;i<steps;i++)p={...moveAroundObstacles(p,(b.x-a.x)/steps,(b.z-a.z)/steps),y:1.15};
    assert.ok(Math.hypot(p.x-b.x,p.z-b.z)<.01);
  }
});

test('procedural trees stay out of the widened apron and its shoulder',()=>{
  assert.equal(gateForecourtTreeClear(GATE_FRAME.at(11,11),0),false);
  assert.equal(gateForecourtTreeClear(GATE_FRAME.at(14,11),1.9),false);
  assert.equal(gateForecourtTreeClear(GATE_FRAME.at(30,11),1.9),true);
  for(const chunk of RENDER_CHUNKS)for(const tree of chunk.trees)assert.ok(gateForecourtTreeClear(tree,1.9));
});
