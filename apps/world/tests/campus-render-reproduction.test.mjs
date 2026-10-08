import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('./browser/campus-render-reproduction-support.mjs', import.meta.url), 'utf8').catch(() => '');
test('reproduction preserves the bounded two-attempt protocol', async () => {
  const { PROTOCOL } = await import('./browser/campus-render-reproduction-support.mjs');
  assert.equal(PROTOCOL.attempts, 2); assert.equal(PROTOCOL.sampleMs, 2500);
  assert.equal(PROTOCOL.appPngTimeoutMs, 10000); assert.equal(PROTOCOL.settleRenders, 3);
});
test('source identity requires explicit immutable app and sampler pins, ignoring synthetic merge SHA', async () => {
  const { assertReproductionSourceIdentity } = await import('./browser/campus-render-reproduction-support.mjs');
  assert.equal(typeof assertReproductionSourceIdentity, 'function');
  const head = 'a'.repeat(40), merge = 'b'.repeat(40);
  const env = { CAMPUS_REPRO_APP_SHA: head, CAMPUS_REPRO_SAMPLER_SHA: head, GITHUB_SHA: merge };
  assert.deepEqual(assertReproductionSourceIdentity({ appHead: head, samplerHead: head }, env), { app: head, sampler: head });
  for (const key of ['CAMPUS_REPRO_APP_SHA', 'CAMPUS_REPRO_SAMPLER_SHA']) {
    for (const invalid of [undefined, '', 'main', head.slice(0, 8), 'g'.repeat(40)]) {
      assert.throws(() => assertReproductionSourceIdentity({ appHead: head, samplerHead: head }, { ...env, [key]: invalid }), new RegExp(key));
    }
  }
  assert.throws(() => assertReproductionSourceIdentity({ appHead: merge, samplerHead: head }, env), /application checkout/);
  assert.throws(() => assertReproductionSourceIdentity({ appHead: head, samplerHead: merge }, env), /sampler checkout/);
  assert.throws(() => assertReproductionSourceIdentity({ appHead: head, samplerHead: merge }, { ...env, CAMPUS_REPRO_SAMPLER_SHA: merge }), /same immutable revision/);
});
test('async-v2 permits separately pinned application and common sampler without relaxing v1 identity', async () => {
  const { assertReproductionSourceIdentity } = await import('./browser/campus-render-reproduction-support.mjs');
  const appHead = 'a'.repeat(40), samplerHead = 'b'.repeat(40);
  const env = { CAMPUS_REPRO_APP_SHA: appHead, CAMPUS_REPRO_SAMPLER_SHA: samplerHead, CAMPUS_REPRO_MODE: 'async-v2' };
  assert.deepEqual(assertReproductionSourceIdentity({ appHead, samplerHead }, env), { app: appHead, sampler: samplerHead });
  assert.throws(() => assertReproductionSourceIdentity({ appHead, samplerHead }, { ...env, CAMPUS_REPRO_MODE: undefined }), /same immutable revision/);
  assert.throws(() => assertReproductionSourceIdentity({ appHead, samplerHead }, { ...env, CAMPUS_REPRO_MODE: 'typo' }), /mode/);
  assert.throws(() => assertReproductionSourceIdentity({ appHead: samplerHead, samplerHead }, env), /application checkout/);
});
test('scene invariant compares actual camera, source-independent environment and drawing buffer', async () => {
  assert.ok(source.includes('assertSameCampusScene'));
  const { assertSameCampusScene } = await import('./browser/campus-render-reproduction-support.mjs');
  const scene = { viewport:[1280,720,1], drawingBuffer:[1280,720], driver:{renderer:'test'}, visible:'visible', inBiryong:false,
    position:[0,1,-98], camera:[0,.4,8,false], cameraTransform:[0,3,90,0,0,0,1], environment:['DAY','CLEAR'],
    graphics:{tier:'high',frameLimit:30,renderScale:1,castShadows:true}, photoActive:true, cameraFov:45, worldClockMs:123 };
  assert.doesNotThrow(() => assertSameCampusScene(scene, structuredClone(scene)));
  for (const key of Object.keys(scene)) {
    const changed = structuredClone(scene); changed[key] = null;
    assert.throws(() => assertSameCampusScene(scene, changed), undefined, key);
  }
});
test('sampler retains actual postrender counts and unchanged minimum/ceiling/window', async () => {
  assert.ok(source.includes('sampleCampusPacing'));
  const { sampleCampusPacing, assessPacing } = await import('./browser/campus-render-reproduction-support.mjs');
  const callbacks = new Map(); let complete, deadline, now = 0;
  const app = {graphicsDevice:{},autoRender:false,renderNextFrame:false,on:(k,v)=>callbacks.set(k,v),off:k=>callbacks.delete(k)};
  const pending = runInNewContext(`(${sampleCampusPacing.toString()})()`, {
    window:{__INHAGAME_P0__:{app}},document:{visibilityState:'visible'}, performance:{now:()=>now},setTimeout:(fn,ms)=>{complete=fn;deadline=ms;}
  });
  assert.equal(deadline,2500);
  for (let i=0;i<2;i++) { now+=1000; callbacks.get('update')(); callbacks.get('postrender')(); }
  now=2500; complete(); const sample = await pending;
  assert.equal(sample.renders,2); assert.equal(sample.updates,2); assert.equal(callbacks.size,0);
  assert.equal(assessPacing(sample).passed,false);
  assert.equal(assessPacing({renders:3,updates:3,renderedFps:1.2}).passed,true);
  assert.equal(assessPacing({renders:90,updates:90,renderedFps:36}).passed,false);
});
test('workflow checks out the instrumented PR head with separate explicit app and sampler identities', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/campus-render-reproduction.yml', import.meta.url), 'utf8').catch(() => '');
  for (const identity of ['APP', 'SAMPLER']) {
    assert.match(workflow, new RegExp(`CAMPUS_REPRO_${identity}_SHA: \\$\\{\\{ github\\.event\\.pull_request\\.head\\.sha \\|\\| github\\.sha \\}\\}`));
    assert.match(workflow, new RegExp(`ref: \\$\\{\\{ env\\.CAMPUS_REPRO_${identity}_SHA \\}\\}`));
  }
  assert.match(workflow, /'apps\/world\/src\/photo\/photo-capture.js'/);
  assert.doesNotMatch(workflow, /ref: 66695573|GITHUB_SHA=/);
  assert.match(workflow, /contents: read/); assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(workflow, /continue-on-error|secrets\.|pull_request_target/);
  const script = await readFile(new URL('./browser/campus-render-reproduction.mjs', import.meta.url), 'utf8').catch(() => '');
  assert.match(script, /samplerHead/); assert.match(script, /sourceHashes/);
  assert.match(script, /assertSameCampusScene/); assert.match(script, /NATURAL_FAILURE_NOT_REPRODUCED/);
  assert.match(script, /DIAGNOSTIC_ONLY/); assert.match(script, /warmupPolicy/);
  assert.match(script, /assertReproductionSourceIdentity/);
  assert.match(script, /samplerTree/); assert.match(script, /samplerHashes/);
  assert.doesNotMatch(script, /process\.env\.GITHUB_SHA/);
});
test('warmup waits for three natural completed renders without forcing application frames', async () => {
  const { settleCampusRenders } = await import('./browser/campus-render-reproduction-support.mjs');
  let listener, removed=false, done=false;
  const app={on:(name,fn)=>{assert.equal(name,'postrender');listener=fn;},off:()=>{removed=true;}};
  const pending=runInNewContext(`(${settleCampusRenders.toString()})(3)`,{window:{__INHAGAME_P0__:{app}}});
  pending.then(()=>done=true);listener();listener();await Promise.resolve();assert.equal(done,false);
  listener();await pending;assert.equal(removed,true);assert.equal(app.renderNextFrame,undefined);
});
test('no measurements and partial measurements are not mislabeled as a completed natural-failure search', async () => {
  const support=await import('./browser/campus-render-reproduction-support.mjs');
  assert.equal(typeof support.classifyReproduction,'function');
  const classify=support.classifyReproduction;
  assert.equal(classify([{status:'PARTIAL'}]),'NOT_MEASURED');
  assert.equal(classify([{status:'PARTIAL',png:{success:true}}]),'INCONCLUSIVE_PARTIAL');
  assert.equal(classify([{status:'COLLECTED',png:{success:true},pacing:{assessment:{passed:true}}}]),'NATURAL_FAILURE_NOT_REPRODUCED');
  assert.equal(classify([{status:'COLLECTED',png:{success:false},pacing:{assessment:{passed:true}}}]),'OBSERVED_SEE_INDIVIDUAL_RESULTS');
});
test('download event is prearmed before native request and awaited only inside bounded successful-PNG phase', async () => {
  const script=await readFile(new URL('./browser/campus-render-reproduction.mjs',import.meta.url),'utf8');
  const arm=script.indexOf("const downloadReady=new Promise(resolve=>page.once('download',resolve));");
  const request=script.indexOf("await phase('native-png-request-and-terminal-state'");
  const bounded=script.indexOf("if(run.png.success) await phase('preserve-and-decode-png'");
  const wait=script.indexOf('const download=await downloadReady;');
  assert.ok(arm>=0 && arm<request && request<bounded && bounded<wait);
});
test('late diagnostics are reread once after the unchanged pacing sample without replacing terminal evidence', async () => {
  const script = await readFile(new URL('./browser/campus-render-reproduction.mjs', import.meta.url), 'utf8');
  const pacing = script.indexOf("run.pacing=await phase('unchanged-2500ms-pacing'");
  const reread = script.indexOf("run.photoDiagnosticsAfterPacing=await phase('photo-diagnostics-after-pacing'");
  const collected = script.indexOf("run.status='COLLECTED'");
  assert.ok(pacing >= 0 && pacing < reread && reread < collected);
  assert.equal(script.split("phase('photo-diagnostics-after-pacing'").length, 2);
  assert.match(script, /run\.photoDiagnosticsAfterPacing=await phase\('photo-diagnostics-after-pacing',\(\)=>page\.evaluate\(\(\)=>window\.__INHAGAME_P0__\.getPhotoCaptureDiagnostics\(\)\)\)/);
  assert.match(script, /Absent late callback evidence does not prove the callback never ran/);
});
test('post-terminal warmup does not claim a timed-out native encoder has stopped', async () => {
  const script = await readFile(new URL('./browser/campus-render-reproduction.mjs', import.meta.url), 'utf8');
  assert.match(script, /does not establish that native encoding or GPU\/driver work is idle/);
  assert.doesNotMatch(script, /excludes active encoding/);
});
