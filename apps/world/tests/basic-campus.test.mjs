import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BUILDINGS, SITE_FEATURES, MAIN_ENTRANCE } from '../src/basic-campus.js';
import { moveAroundObstacles, resolveHeight, cameraSafeFraction } from '../src/world-collision.js';
import { geoToWorld, WORLD_BOUNDS } from '../src/campus-layout.js';
import { buildPolygonMeshGeometry, computePolygonAreaWU } from '../src/reality-adapter.js';
const evidence = JSON.parse(readFileSync(new URL('../data/reality/evidence/basic-campus/source.json', import.meta.url)));

test('runtime buildings and grounds preserve every source vertex and fit the playable envelope', () => {
  for (const feature of [...BUILDINGS, ...SITE_FEATURES]) {
    const source = evidence.features.find(s => `osm_way_${s.id}` === feature.sourceId);
    assert.ok(source);
    const expected = source.coordinates.map(([lat, lon]) => geoToWorld(lat, lon));
    if (feature.kind !== 'path') expected.pop();
    assert.deepEqual(feature.vertices, expected);
    for (const p of expected) assert.ok(p.x > WORLD_BOUNDS.minX && p.x < WORLD_BOUNDS.maxX && p.z > WORLD_BOUNDS.minZ && p.z < WORLD_BOUNDS.maxZ);
  }
  assert.equal(SITE_FEATURES.filter(f => f.kind === 'lawn').length, 4);
  assert.equal(SITE_FEATURES.filter(f => f.kind === 'reflecting_pool').length, 1);
  assert.ok(BUILDINGS.find(b => b.id === 'bldg_jungseok').vertices.every(p => p.x < 0), 'library is west of the central lawn, not mirrored');
});

test('rotated concave building collision prevents tunnelling without blocking its empty corner', () => {
  const body = { id: 'rotated', polygon: [{x:0,z:0},{x:4,z:4},{x:6,z:2},{x:4,z:0},{x:6,z:-2},{x:4,z:-4}], minY:0,maxY:10 };
  const hit = moveAroundObstacles({x:-5,y:1.15,z:0}, 20, 0, [body]);
  assert.ok(hit.x < 0, 'high-speed crossing stops at actual angled facade');
  const clear = moveAroundObstacles({x:5.7,y:1.15,z:0}, 3, 0, [body], {radius:.1});
  assert.ok(clear.x > 8, 'concavity stays open instead of using the enclosing AABB');
  assert.equal(resolveHeight({x:2,y:15,z:0}, 1.15, 1.15, [body]), 11.15);
  assert.equal(resolveHeight({x:7,y:15,z:0}, 1.15, 1.15, [body]), 1.15);
  assert.ok(cameraSafeFraction([-5,3,0],[7,3,0],[body]) < 1);
  assert.equal(cameraSafeFraction([-5,13,0],[7,13,0],[body]), 1);
});

test('concave building roof triangles preserve the footprint area with upward normals', () => {
  for (const building of BUILDINGS) {
    const mesh=buildPolygonMeshGeometry(building.vertices,{height:building.height});
    const triangles=mesh.indices.slice(0,(building.vertices.length-2)*3);
    let area=0;
    for(let i=0;i<triangles.length;i+=3) {
      const [a,b,c]=triangles.slice(i,i+3).map(id=>({x:mesh.positions[id*3],z:mesh.positions[id*3+2]}));
      const up=(b.z-a.z)*(c.x-a.x)-(b.x-a.x)*(c.z-a.z);
      assert.ok(up>0);area+=up/2;
    }
    assert.ok(Math.abs(area-computePolygonAreaWU(building.vertices))<1e-6);
  }
});

test('main entrance is outside the exact facade, remains walkable, and stops at the building', () => {
  const { x, z, inward } = MAIN_ENTRANCE;
  const start = { x:x-inward.x*5, z:z-inward.z*5, y:1.15 };
  const approach = moveAroundObstacles(start, inward.x*5, inward.z*5);
  assert.ok(Math.hypot(approach.x-x,approach.z-z)<.01);
  const stopped = moveAroundObstacles({...approach,y:1.15},inward.x*20,inward.z*20);
  assert.ok(Math.hypot(stopped.x-x,stopped.z-z)<6);
});
