import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const main=readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
const exp=readFileSync(new URL('../src/giant-roach-experiment.js',import.meta.url),'utf8');
test('GIANT_ROACH_TEST is preview/local-only and defaults off',()=>{
  assert.match(main,/giantRoachTestMode = previewHost && startupParams\.get\('giantRoachTest'\) === '1'/);
  assert.match(main,/if \(giantRoachTestMode\)/);
  assert.match(main,/import\('\.\/giant-roach-experiment\.js'\)/);
});
test('experiment is bounded and exposes cleanup/count controls',()=>{
  assert.match(exp,/GIANT_ROACH_COUNTS = Object\.freeze\(\[10, 30, 50, 100\]\)/);
  assert.match(exp,/GIANT_ROACH_MAX = 100/);
  assert.match(exp,/window\.__GIANT_ROACH_TEST__=api/);
  assert.match(exp,/delete window\.__GIANT_ROACH_TEST__/);
  assert.match(exp,/app\.off\('update',update\)/);
});
test('experiment reuses canonical NPC navigation and throttles distant work',()=>{
  assert.match(exp,/createNpcNavigator/);
  assert.match(exp,/d>55\?\.35:d>30\?\.16:\.05/);
  assert.match(exp,/d>45\?2\.4:d>25\?1\.4:\.8/);
});

test('roach visuals use one shared low-poly mesh and one render component per entity',()=>{
  assert.match(exp,/function createRoachMesh\(device\)/);
  assert.match(exp,/pc\.createMesh\(device,g\.positions/);
  assert.match(exp,/meshInstances:\[new pc\.MeshInstance\(mesh,material\)\]/);
  assert.match(exp,/const mesh=createRoachMesh\(app\.graphicsDevice\)/);
  assert.match(exp,/mesh\.destroy\?\.\(\)/);
  assert.doesNotMatch(exp,/addComponent\('render',\{type:'sphere'\}\)/);
});

test('P2 preserves shared mesh rendering while increasing silhouette and crawl detail',()=>{
  assert.match(exp,/GIANT_ROACH_TRIANGLES = 768/);
  assert.match(exp,/diffuseVertexColor = true/);
  assert.match(exp,/ROACH_COLOR/);
  assert.match(exp,/colors:g\.colors/);
  assert.match(exp,/const legs=\[/);
  assert.match(exp,/ROACH_COLOR\.seam/);
  assert.match(exp,/renderHeading/);
  assert.match(exp,/const bob=moving\?Math\.abs\(Math\.sin\(phase\)\)\*\.040/);
  assert.match(exp,/estimatedRoachTriangles:roaches\.length\*GIANT_ROACH_TRIANGLES/);
});

test('P2 surface quality uses five rounded body rings and readable vertex color',()=>{
  assert.match(exp,/Math\.PI\/6,Math\.PI\/3,Math\.PI\/2,Math\.PI\*2\/3,Math\.PI\*5\/6/);
  assert.match(exp,/m\.useLighting = false/);
  assert.match(exp,/diffuseVertexColor = true/);
});

test('P2 vertex colors use RGBA8 for pc.createMesh Geometry',()=>{
  assert.match(exp,/abdomen: \[184,76,28,255\]/);
  assert.match(exp,/abdomenBand: \[148,52,18,255\]/);
  assert.match(exp,/thorax: \[132,46,16,255\]/);
  assert.match(exp,/elytra: \[164,60,20,255\]/);
  assert.match(exp,/limb: \[45,13,5,255\]/);
  assert.match(exp,/cerci: \[62,18,7,255\]/);
});

test('P2 roach mesh raises detail while preserving shared-render budget',()=>{
  assert.match(exp,/GIANT_ROACH_TRIANGLES = 768/);
  assert.match(exp,/function addTaperedBar/);
  assert.match(exp,/Math\.PI\/6,Math\.PI\/3,Math\.PI\/2,Math\.PI\*2\/3,Math\.PI\*5\/6/);
  assert.match(exp,/abdomenBand/);
  assert.match(exp,/ROACH_COLOR\.cerci/);
  assert.match(exp,/three-segment legs/);
  assert.match(exp,/three tapered segments per side/);
  assert.match(exp,/Total prototype budget = 768 triangles/);
  assert.match(exp,/estimatedRoachTriangles:roaches\.length\*GIANT_ROACH_TRIANGLES/);
  assert.doesNotMatch(exp,/addComponent\('render',\{type:'sphere'\}\)/);
});
test('P2 motion adds moving and idle posture without per-limb runtime entities',()=>{
  assert.match(exp,/const moving=moved\.moved>\.0001/);
  assert.match(exp,/const pitch=moving\?/);
  assert.match(exp,/setLocalEulerAngles\(pitch,r\.renderHeading,sway\)/);
});
