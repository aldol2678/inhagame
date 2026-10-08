import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const read = path => readFile(new URL(path, import.meta.url), 'utf8');
const [smoke, main, campus, harness] = await Promise.all([
  read('./browser/graphics-parallel-smoke.mjs'), read('../src/main.js'),
  read('../campus/index.html'), read('./browser/harness.mjs')
]);
test('graphics smoke parses without launching browser', () => {
  const result = spawnSync(process.execPath, ['--check', new URL('./browser/graphics-parallel-smoke.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
test('mock clock replaces exactly one construction seam and retains offline harness', () => {
  assert.equal(main.split('const worldClock = previewHost ? null : createNpcWorldClock();').length, 2);
  assert.match(smoke, /from '\.\/harness\.mjs'/);
  assert.match(smoke, /main\.replace\(needle/);
  assert.match(harness, /route\.abort\("blockedbyclient"\)/);
  assert.match(harness, /supabase-js stubbed/);
});
test('all fixed smoke ID selectors exist exactly once in campus markup', () => {
  const ids = new Set([...smoke.matchAll(/locator\('#([\w-]+)'\)/g)].map(match => match[1]));
  assert.ok(ids.size >= 10);
  for (const id of ids) assert.equal(campus.split(`id="${id}"`).length, 2, id);
});
test('smoke covers four workstreams, saves failure receipts and labels CI surrogate', () => {
  for (const marker of ['checks.settings', 'checks.framePacing', 'checks.contact', 'checks.daylight', 'checks.biryong',
    "receipt.status = 'FAIL'", 'report.json', "realDevice: false", 'CI_BROWSER_SURROGATE'])
    assert.ok(smoke.includes(marker), marker);
  assert.match(smoke, /app\.on\('postrender', render\)/);
  assert.match(smoke, /app\.off\('postrender', render\)/);
  assert.match(smoke, /returnToCampus\(\)/);
});
test('settings dismissal checks ownership and native movement without forcibly releasing claims', () => {
  for (const marker of ['beforeFocus.owners.viewSettings, false', "beforeFocus.topOwners.includes('view-settings')",
    'beforeFocus.movement, true', "page.keyboard.down('w')", "page.keyboard.up('w')",
    "verifyMovementRestored('after-detail-controls')", "verifyMovementRestored('after-reset-and-quality')"])
    assert.ok(smoke.includes(marker), marker);
  assert.doesNotMatch(smoke, /inputFocus\.(?:release|clear)|controller\.setInputEnabled\(true\)/);
});
test('contact screenshots target an actual canonical garden receiver and restore temporary camera', async () => {
  const {campusBaseContactGeometry}=await import('../src/campus-contact-shading-layout.js');
  const {GARDEN_BENCHES}=await import('../src/library-garden-layout.js');
  const id=GARDEN_BENCHES[0].id;
  assert.ok(campusBaseContactGeometry().sources.some(s=>s.id===id&&s.receivers.includes('garden')));
  for(const marker of ['contact.activeMeshes>0', "b.name==='campus_contact_base'", 'source.id===view.benchId',
    'assert.deepEqual(await cameraState(),onCamera', "findByName('GraphicsContactQaCamera')?.destroy()",
    'd.player.enabled=s.playerEnabled', 'camera.enabled=s.cameraEnabled', "app.once('postrender',rendered)"])
    assert.ok(smoke.includes(marker),marker);
});
test('launch failures reach receipt finally and region return asserts visual settings', () => {
  assert.ok(smoke.indexOf('try {\n  smoke = await startSmoke')>=0);
  assert.ok(smoke.includes('smoke?.problems ?? []')); assert.ok(smoke.includes('await smoke?.close()'));
  assert.ok(smoke.includes('assert.equal(restored.canvasFilter,campusPresentation.canvasFilter'));
  assert.ok(smoke.includes('assert.equal(restored.toneMapping,campusPresentation.toneMapping'));
});
