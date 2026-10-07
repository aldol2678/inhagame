import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HALL_FRONT } from '../src/basic-campus.js';
import { GATE_FRAME, MAIN_HALL_FRONT_EDGE_WGS84 } from '../src/main-gate-frame.js';

const buildings=JSON.parse(readFileSync(new URL('../data/reality/campus-buildings.json',import.meta.url),'utf8'));
const mainHall=buildings.buildings.find(building=>building.id==='bldg_01');

test('main gate synchronous frame mirror stays pinned to canonical main-hall front edge',()=>{
  assert.deepEqual(MAIN_HALL_FRONT_EDGE_WGS84,[mainHall.polygon[5],mainHall.polygon[6]]);
});

test('synchronous main gate frame preserves the basic-campus derived orientation',()=>{
  assert.ok(Math.abs(GATE_FRAME.yaw-(-Math.atan2(HALL_FRONT.along.z,HALL_FRONT.along.x)*180/Math.PI))<1e-12);
  const u=GATE_FRAME.at(1,0),v=GATE_FRAME.at(0,1);
  assert.ok(Math.abs(u.x-HALL_FRONT.along.x)<1e-12);
  assert.ok(Math.abs((u.z+90)-HALL_FRONT.along.z)<1e-12);
  assert.ok(Math.abs(v.x-HALL_FRONT.inward.x)<1e-12);
  assert.ok(Math.abs((v.z+90)-HALL_FRONT.inward.z)<1e-12);
});
