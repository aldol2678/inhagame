import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FACILITIES, FACILITY_COLLIDERS, partitionCourtyard } from '../src/campus-facilities.js';
import { computePolygonAreaWU } from '../src/reality-adapter.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { resolveHeight, moveAroundObstacles } from '../src/world-collision.js';

// A missing implementation is an explicit contract failure, not a test-loader crash.
const api = await import('../src/neutral-campus-buildings.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const { fillNeutralCampusBuilding, isNeutralCampusBuilding, NEUTRAL_FACADE_COLORS } = api;
const ready = typeof fillNeutralCampusBuilding === 'function';
const manifestBytes = readFileSync(new URL('../data/reality/worldforge-campus-buildings.manifest.json', import.meta.url));
const manifest = JSON.parse(manifestBytes);
const buildings = FACILITIES.filter(f => f.kind === 'building');
const before = JSON.stringify({ FACILITIES, FACILITY_COLLIDERS });
const capture = (f,tier='BASE') => {
  const faces = [];
  fillNeutralCampusBuilding({
    quad(color, ...vertices) { faces.push({ color, vertices }); },
    triangle(color, ...vertices) { faces.push({ color, vertices }); }
  }, f,tier);
  return faces;
};
const normal = ([a, b, c]) => {
  const u = b.map((v, i) => v - a[i]), v = c.map((w, i) => w - a[i]);
  return [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
};
const area = vertices => Math.hypot(...normal(vertices)) * (vertices.length === 4 ? 1 : .5);
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-6, `${message}: ${actual} != ${expected}`);

test('neutral geometry is an explicit public campus-only rendering contract', () => {
  assert.equal(typeof fillNeutralCampusBuilding, 'function');
  assert.equal(typeof isNeutralCampusBuilding, 'function');
  assert.equal(Object.keys(NEUTRAL_FACADE_COLORS).length, 4);
});

test('the 21 runtime footprints and heights match the WorldForge-validated public export exactly', () => {
  assert.equal(createHash('sha256').update(manifestBytes).digest('hex'), '3bbcf70874ad99a6736c9be03a28bbcda3809afaebdabae1057747ecbd618360');
  assert.equal(buildings.length, 21);
  assert.equal(manifest.buildings.length, 21);
  for (const f of buildings) {
    const imported = manifest.buildings.find(b => b.id === f.id);
    assert.ok(imported, f.id);
    close(imported.heightMeters / 2, f.height, `${f.id} height`);
    assert.equal(imported.rings.length, f.rings.length);
    for (const [i, ring] of imported.rings.entries()) for (const [j, p] of ring.entries()) {
      close(p.x / 2, f.rings[i][j].x, `${f.id} x`);
      close(-p.z / 2 - 90, f.rings[i][j].z, `${f.id} z`);
    }
  }
});

test('all neutral surfaces remain on the source envelope, cover every wall without gaps and cap only occupied roof area', { skip: !ready }, () => {
  let totalFaces = 0;
  const palette = new Set(Object.values(NEUTRAL_FACADE_COLORS));
  for (const f of buildings) {
    assert.equal(isNeutralCampusBuilding(f), true, f.id);
    const faces = capture(f), points = f.rings.flat();
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x));
    const minZ = Math.min(...points.map(p => p.z)), maxZ = Math.max(...points.map(p => p.z));
    let wallArea = 0, roofArea = 0;
    for (const face of faces) {
      assert.ok(palette.has(face.color), `${f.id} shared palette`);
      assert.ok(area(face.vertices) > 1e-10, `${f.id} nondegenerate face`);
      for (const [x, y, z] of face.vertices) {
        assert.ok([x, y, z].every(Number.isFinite));
        assert.ok(x >= minX-1e-7 && x <= maxX+1e-7 && z >= minZ-1e-7 && z <= maxZ+1e-7, f.id);
        assert.ok(y >= 0 && y <= f.height, `${f.id} height preserved`);
      }
      if (face.color === NEUTRAL_FACADE_COLORS.roof) {
        assert.ok(face.vertices.every(p => p[1] === f.height));
        assert.ok(normal(face.vertices)[1] > 0, 'roof culls upward');
        roofArea += area(face.vertices);
      } else {
        assert.ok(normal(face.vertices)[1] === 0);
        wallArea += area(face.vertices);
      }
    }
    const perimeter = f.rings.reduce((sum, ring) => sum + ring.reduce((s, a, i) => s + Math.hypot(a.x-ring[(i+1)%ring.length].x, a.z-ring[(i+1)%ring.length].z), 0), 0);
    close(wallArea, perimeter*f.height, `${f.id} no wall gaps or overlap`);
    close(roofArea, computePolygonAreaWU(f.rings[0])-f.rings.slice(1).reduce((s, r) => s+computePolygonAreaWU(r), 0), `${f.id} roof area`);
    assert.equal(faces.filter(q => q.color === NEUTRAL_FACADE_COLORS.glass).length,0,'far silhouette has no windows');
    const vertices = faces.reduce((sum, q) => sum + (q.vertices.length === 4 ? 6 : 3), 0);
    assert.ok(vertices < 1000, `${f.id} bounded BASE vertices: ${vertices}`);
    assert.ok(faces.length < 150, `${f.id} bounded BASE faces: ${faces.length}`);
    assert.ok(new Set(faces.map(q => q.color)).size <= 2, `${f.id} max 2 BASE material batches`);
    totalFaces += faces.length;
  }
  assert.ok(totalFaces < 1000, `total BASE face budget: ${totalFaces}`);
  assert.equal(JSON.stringify({ FACILITIES, FACILITY_COLLIDERS }), before, 'rendering never mutates gameplay geometry');
});

test('outer and courtyard walls face empty space for either winding and after a WorldForge Z reflection', { skip: !ready }, () => {
  const f = buildings.find(b => b.id === 'bldg_05');
  for (const flip of [1, -1]) for (const reverse of [false, true]) {
    const rings = f.rings.map(r => {
      const next = r.map(p => ({ x:p.x, z:p.z*flip }));
      return reverse ? next.reverse() : next;
    });
    const input = { ...f, rings, parts:partitionCourtyard(rings) };
    for (const { color, vertices } of capture(input)) {
      if (color === NEUTRAL_FACADE_COLORS.roof) continue;
      const n = normal(vertices), length = Math.hypot(...n);
      const center = vertices.reduce((s, p) => s.map((v, i) => v+p[i]/vertices.length), [0, 0, 0]);
      const x = center[0]+n[0]/length*1e-5, z = center[2]+n[2]/length*1e-5;
      const solid = polygonOverlap(x, z, rings[0]) && !rings.slice(1).some(r => polygonOverlap(x, z, r));
      assert.equal(solid, false, `wall normal faces free space (${flip}/${reverse})`);
    }
  }
});

test('5호관 courtyard roof opening and movement remain open', { skip: !ready }, () => {
  const f = buildings.find(b => b.id === 'bldg_05'), hole = f.rings[1];
  const center = { x:hole.reduce((s,p) => s+p.x,0)/hole.length, z:hole.reduce((s,p) => s+p.z,0)/hole.length, y:30 };
  for (const q of capture(f).filter(q => q.color === NEUTRAL_FACADE_COLORS.roof)) {
    const triangle = q.vertices.map(([x,,z]) => ({ x,z }));
    assert.equal(polygonOverlap(center.x,center.z,triangle),false,'no courtyard cap');
  }
  const colliders = FACILITY_COLLIDERS.filter(c => c.id.startsWith('bldg_05_'));
  assert.equal(resolveHeight(center,1.15,1.15,colliders),1.15);
  close(moveAroundObstacles({...center,y:1.15},1,1,colliders).x,center.x+1,'courtyard walking');
});

test('facades are deterministic, use public floors, and do not enable surrounding shops or existing main buildings', { skip: !ready }, () => {
  const signatures = new Set();
  for (const f of buildings) {
    assert.deepEqual(capture(f,'NEAR'),capture({...f,style:'withheld_do_not_use',center:{x:999,z:999}},'NEAR'),'private style or old anchor does not influence geometry');
    const glass = capture(f,'NEAR').filter(q => q.color === NEUTRAL_FACADE_COLORS.glass);
    assert.equal(new Set(glass.map(q => Math.min(...q.vertices.map(p => p[1])))).size,f.floors);
    signatures.add(api.neutralFacadeProfile(f).name);
  }
  assert.equal(signatures.size,3,'three fresh generic architectural rhythms');
  for (const id of ['bldg_01','bldg_jungseok','shop_01','bldg_unverified']) assert.equal(isNeutralCampusBuilding({...buildings[0],id}),false,id);
  assert.equal(isNeutralCampusBuilding({...buildings[0],kind:'ground'}),false);
});

test('the renderer consumes the WorldForge bridge and streams facade decals only at NEAR', () => {
  const source = readFileSync(new URL('../src/facility-blockout.js',import.meta.url),'utf8');
  assert.match(source,/const neutral = isNeutralCampusBuilding\(f\)/);
  assert.match(source,/resolveWorldForgeBuilding\(f\)/);
  assert.match(source,/fillNeutralCampusBuilding\(envelope,imported,tier\)/);
  assert.match(source,/if\(tier==='BASE'&&!neutral\)for/);
  assert.match(source,/if\(tier==='DETAIL'&&!neutral\)/);
  assert.match(source,/if\(tier==='NEAR'&&!neutral\)for/);
  assert.match(source,/materialForColor:tier==='NEAR'\?neutralFacadeSurface:surface/);
});

test('streamed neutral facade has bounded exact-boundary decals and no roof or wall replacement', { skip:!ready }, () => {
  let vertices=0;
  for(const f of buildings){
    const faces=capture(f,'NEAR');
    assert.ok(faces.length>f.floors);
    assert.ok(faces.every(q=>q.color===NEUTRAL_FACADE_COLORS.glass||q.color===NEUTRAL_FACADE_COLORS.trim));
    assert.ok(faces.every(q=>q.vertices.every(p=>p[1]>=0&&p[1]<=f.height)));
    vertices+=faces.length*6;
    assert.deepEqual(capture(f,'DETAIL'),[],'no duplicate finest-detail facade');
  }
  assert.ok(vertices<40000,`streamed window/trim vertex budget ${vertices}`);
});

const bridge=await import('../src/worldforge-campus-building-import.js').catch(error=>{
  if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;
});
test('the runtime uses converted WorldForge geometry once and rejects a divergent collider source',()=>{
  assert.equal(typeof bridge.resolveWorldForgeBuilding,'function');
  for(const f of buildings){
    const imported=bridge.resolveWorldForgeBuilding(f);
    assert.notEqual(imported.rings,f.rings,'render rings come from the manifest');
    assert.notEqual(imported.parts,f.parts,'render caps come from validated imported parts');
    assert.equal(imported.height,f.height);
    assert.equal(imported.rings.length,f.rings.length);
    for(const [i,ring] of imported.rings.entries())for(const [j,p] of ring.entries()){
      close(p.x,f.rings[i][j].x,'import x');close(p.z,f.rings[i][j].z,'import z');
    }
    assert.throws(()=>bridge.resolveWorldForgeBuilding({...f,height:f.height+1}),/WorldForge.*mismatch/);
    const rings=structuredClone(f.rings);rings[0][0].x+=1;
    assert.throws(()=>bridge.resolveWorldForgeBuilding({...f,rings}),/WorldForge.*mismatch/);
    const parts=structuredClone(f.parts);parts[0][0].z+=1;
    assert.throws(()=>bridge.resolveWorldForgeBuilding({...f,parts}),/WorldForge.*mismatch/);
  }
  assert.equal(bridge.resolveWorldForgeBuilding({id:'shop_unscoped'}),null);
});
