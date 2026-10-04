import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, existsSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');

test('hosted integration evidence covers real consumers and entrance pixel repair', () => {
  const harness = read('./browser/hall-library-hosted-harness.html');
  for (const text of ['CampusChunkRenderer', 'RenderChunkRegistry', 'gl.readPixels', 'entryChanged', 'maskChanged', 'webglcontextlost']) assert.ok(harness.includes(text), text);
  const runner = read('./browser/hall-library-hosted-smoke.mjs');
  for (const text of ['ad89daf0a190ea6b8664da0459822d1084aef247', '316c8ff95f7a12618ec8db61342d153f3cbb29ea', '68d64e7466a2971256485b74e76c89a31e91547a', '/editor/music/', 'PlaceScenePreview', 'withDeadline', '1280', '720', '390', '844', 'unexpectedRequests', 'entryChanged', 'report.json']) assert.ok(runner.includes(text), text);
  assert.doesNotMatch(harness, /NullGraphicsDevice|data:image/);
  assert.ok(existsSync(new URL('./browser/hall-library-integration-null-smoke.mjs', import.meta.url)));
});

test('historical source routes reject arbitrary files and traversal', () => {
  const runner = read('./browser/hall-library-hosted-smoke.mjs');
  const source = runner.match(/function isBaselinePath\(relative\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const allowed = runInNewContext(`(${source})`, {}, {timeout:1000});
  for (const name of ['src/main-hall-blockout.js', 'src/editor/main-gate-production.js', 'data/reality/campus-buildings.json', 'data/reality/evidence/roads/back-gate.json', 'data/editor/main-gate.world.json']) assert.equal(allowed(name),true,name);
  for (const name of ['data/private.json','src/../private.js','src/./main.js','../src/main.js','/src/main.js','data/editor/other.world.json','.git/config','src/secret.txt','https://example.com/src/main.js']) assert.equal(allowed(name),false,name);
});

test('current-main preservation allows only the eight approved runtime files', () => {
  const manifest = JSON.parse(read('./fixtures/hall-library-candidate-source-manifest.json'));
  assert.equal(manifest.currentMain, 'ad89daf0a190ea6b8664da0459822d1084aef247');
  assert.equal(manifest.allowedRuntimeChanges.length,8);
  assert.equal(new Set(manifest.allowedRuntimeChanges).size,8);
  assert.deepEqual(manifest.allowedMetadataChanges,['apps/world/data/reality/hall-library-integration.provenance.json']);
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  assert.match(runner,/changedPaths/);
  assert.match(runner,/outside approved integration scope/);
  assert.ok(!manifest.allowedRuntimeChanges.some(name=>/facility|student|environment|collision|reality/.test(name)));
});

test('workflow checks exact head, offline evidence and a bounded read-only job', () => {
  const workflow = read('../../../.github/workflows/hall-library-candidate-browser.yml');
  assert.match(workflow, /ref: \$\{\{ github.event.pull_request.head.sha \}\}/);
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /timeout-minutes: 15/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /hall-library-integration-null-smoke.mjs/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|deploy|--force|contents: write/);
});

test('entry crop validates doorway pixels without treating apron color as a full silhouette', () => {
  const runner=read('./browser/hall-library-hosted-smoke.mjs');
  const crop=runner.slice(runner.indexOf('// Adjacent pre-fix/fixed captures'));
  const body=crop.match(/if\(presentation==='candidate'\) \{([\s\S]*?)\n    \}/)?.[1];
  assert.ok(body,'the real candidate-entry assertion block is exercised');
  const helper=runner.match(/function checkEntranceCrop\(pixels\) \{[\s\S]*?\n\}/)?.[0]??'';
  const validate=runInNewContext(`${helper}\n(pixels)=>{${body}}`,{assert},{timeout:1000});
  const valid={width:1280,height:653,entryChanged:1031,maskChanged:2,maskReferenceRgb:[196,195,179],entryBounds:{minX:530.4,maxX:747.8,minY:357.1,maxY:400.4}};
  assert.doesNotThrow(()=>validate(valid),'a control crop corner is apron, so color-mask differences are not silhouette evidence');
  assert.throws(()=>validate({...valid,entryChanged:0}),/doorway/);
  assert.throws(()=>validate({...valid,entryBounds:{...valid.entryBounds,minX:-1}}),/ROI/);
  assert.throws(()=>validate({...valid,entryBounds:{...valid.entryBounds,maxY:Infinity}}),/ROI/);
  assert.match(runner,/assert\.equal\(pixels\.maskChanged,0,'entry repair preserves the pre-fix Main Hall silhouette'\)/,'full-view silhouette gate stays exact');
  assert.match(crop,/assert\.equal\(stable\.exactChanged,0\)/,'cropped stationary frames remain exact');
});
