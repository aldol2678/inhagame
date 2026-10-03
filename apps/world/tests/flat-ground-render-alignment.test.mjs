import test from 'node:test';
import assert from 'node:assert/strict';
import { FLAT_GROUND_Y, FLAT_GROUND_MAX_Y } from '../src/flat-ground-surface.js';
import { fillCampusRoadBatch } from '../src/campus-road-geometry.js';
import { fillMainGateRoads } from '../src/main-gate-road-geometry.js';
import { fillBackGatePaving } from '../src/back-gate-geometry.js';
import { fillBackApproaches } from '../src/back-approach-geometry.js';
import { fillCulturePaving } from '../src/culture-street-geometry.js';
import { fillNorthSideGate } from '../src/north-side-gate-geometry.js';
import { fillInteriorBase } from '../src/market-interior-geometry.js';
import { fillBackStreetBase, fillBackStreetSignals } from '../src/back-street-geometry.js';
import { fillNorthRoads, fillFiveGardenPaths } from '../src/north-campus-geometry.js';

function captureSurfaceYs(run) {
  const ys=[];
  const batch={
    quad(_color,...vertices){for(const p of vertices)if(Array.isArray(p))ys.push(p[1]);},
    triangle(_color,...vertices){for(const p of vertices)if(Array.isArray(p))ys.push(p[1]);},
    box(){},tube(){},crown(){}
  };
  run(batch);
  assert.ok(ys.every(Number.isFinite));
  return ys;
}

const cases=[
  ['campus roads',fillCampusRoadBatch,FLAT_GROUND_Y.UNDERLAY],
  ['main gate / Sosung-ro',fillMainGateRoads,FLAT_GROUND_Y.UNDERLAY],
  ['back gate paving',fillBackGatePaving,FLAT_GROUND_Y.UNDERLAY],
  ['back approaches',fillBackApproaches,FLAT_GROUND_Y.UNDERLAY],
  ['culture street paving',fillCulturePaving,FLAT_GROUND_Y.UNDERLAY],
  ['north side gate paving',fillNorthSideGate,FLAT_GROUND_Y.UNDERLAY],
  ['market interior paving',fillInteriorBase,FLAT_GROUND_Y.UNDERLAY],
  ['back street paving',fillBackStreetBase,FLAT_GROUND_Y.UNDERLAY],
  ['back street signals',fillBackStreetSignals,FLAT_GROUND_Y.UNDERLAY],
  ['north campus roads',fillNorthRoads,FLAT_GROUND_Y.UNDERLAY],
  ['Building 5 garden paths',fillFiveGardenPaths,FLAT_GROUND_Y.UNDERLAY]
];

test('flat walkable render layers stay inside their documented near-ground envelope',()=>{
  assert.ok(FLAT_GROUND_Y.UNDERLAY>.018);
  assert.ok(FLAT_GROUND_Y.DETAIL<FLAT_GROUND_MAX_Y);
  for(const [name,run,minY] of cases){
    const ys=captureSurfaceYs(run);
    assert.ok(ys.length>0,name+': no captured surface geometry');
    assert.ok(Math.min(...ys)>=minY-1e-9,name+': below documented presentation underlay');
    assert.ok(Math.max(...ys)<=FLAT_GROUND_MAX_Y+1e-9,
      name+': flat presentation surface above logical-ground envelope: '+Math.max(...ys));
  }
});
