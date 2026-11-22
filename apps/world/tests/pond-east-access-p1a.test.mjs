import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { geoToWorld } from '../src/geo-coordinates.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import {
  P1A_EAST_ROUTES, P1A_POND_RING, isP1AEastQaEnabled,
  p1aEastRoadSurfacePieces
} from '../src/pond-east-access-p1a.js';
const data = JSON.parse(readFileSync(new URL('../data/reality/evidence/roads/inkyung-east-p1a.json', import.meta.url)));
const area = ring => Math.abs(ring.reduce((s,p,i) => {
  const q = ring[(i+1)%ring.length]; return s + p.x*q.z - q.x*p.z;
},0)/2);

test('P1A evidence retains actual OSM way versions, nodes and unknown widths', () => {
  assert.deepEqual(data.ways.map(w=>w.id), [481241663,1063267429]);
  assert.equal(P1A_EAST_ROUTES.length, 2);
  for (let i=0;i<2;i++) {
    const source=data.ways[i],route=P1A_EAST_ROUTES[i];
    assert.equal(source.surveyedWidthM,null);
    assert.equal(route.sourceId,'osm_way_'+source.id);
    assert.equal(route.sourceVersion,source.version);
    assert.deepEqual(route.vertices, source.nodes.map(([,lat,lon])=>geoToWorld(lat,lon)));
  }
});
test('P1A is isolated from production and requires explicit opt-in on QA origin', () => {
  assert.equal(isP1AEastQaEnabled('inhagame.app','?p1a_east=1'),false);
  assert.equal(isP1AEastQaEnabled('inha-world-threejs-preview.pages.dev','?p1a_east=1'),false);
  assert.equal(isP1AEastQaEnabled('inha-world-playcanvas-qa.pages.dev',''),false);
  assert.equal(isP1AEastQaEnabled('inha-world-playcanvas-qa.pages.dev','?p1a_east=1'),true);
  assert.equal(isP1AEastQaEnabled('75ee7674.inha-world-playcanvas-qa.pages.dev','?p1a_east=1'),true);
});
test('P1A road surfaces are finite, bounded and outside the existing pond water', () => {
  const pieces=p1aEastRoadSurfacePieces();
  assert(pieces.length>=6);
  const ids=new Set(pieces.map(p=>p.routeId));
  assert.equal(ids.size,2);
  for(const {polygon,height} of pieces){
    assert(polygon.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.z)));
    assert(area(polygon)>1e-8);
    assert(height>=0&&height<=.03);
    const p={x:polygon.reduce((s,p)=>s+p.x,0)/polygon.length,
      z:polygon.reduce((s,p)=>s+p.z,0)/polygon.length};
    assert.equal(polygonOverlap(p.x,p.z,P1A_POND_RING),false,'surface paints in pond');
  }
});
