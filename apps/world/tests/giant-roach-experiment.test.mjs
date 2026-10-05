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

test('P1 roach quality keeps one shared mesh while adding silhouette, tones and crawl motion',()=>{
  assert.match(exp,/GIANT_ROACH_TRIANGLES = 264/);
  assert.match(exp,/diffuseVertexColor = true/);
  assert.match(exp,/ROACH_COLOR/);
  assert.match(exp,/colors:g\.colors/);
  assert.match(exp,/const legs=\[/);
  assert.match(exp,/ROACH_COLOR\.seam/);
  assert.match(exp,/renderHeading/);
  assert.match(exp,/const bob=Math\.abs\(Math\.sin\(phase\)\)\*\.035/);
  assert.match(exp,/estimatedRoachTriangles:roaches\.length\*GIANT_ROACH_TRIANGLES/);
});
