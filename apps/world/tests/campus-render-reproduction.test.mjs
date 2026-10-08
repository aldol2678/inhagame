import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
const source = await readFile(new URL('./browser/campus-render-reproduction-support.mjs', import.meta.url), 'utf8').catch(() => '');
test('reproduction exposes explicit fixed app and bounded two-attempt protocol', async () => {
  assert.ok(source.includes('66695573c8857d05a761b987411c6812ea158984'));
  const { PROTOCOL } = await import('./browser/campus-render-reproduction-support.mjs');
  assert.equal(PROTOCOL.attempts, 2); assert.equal(PROTOCOL.sampleMs, 2500);
  assert.equal(PROTOCOL.appPngTimeoutMs, 10000); assert.equal(PROTOCOL.settleRenders, 3);
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
test('workflow pins app independently, preserves partial evidence and cannot claim performance acceptance', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/campus-render-reproduction.yml', import.meta.url), 'utf8').catch(() => '');
  assert.match(workflow, /ref: 66695573c8857d05a761b987411c6812ea158984/);
  assert.match(workflow, /contents: read/); assert.match(workflow, /if: always\(\)/);
  assert.doesNotMatch(workflow, /continue-on-error|secrets\.|pull_request_target/);
  const script = await readFile(new URL('./browser/campus-render-reproduction.mjs', import.meta.url), 'utf8').catch(() => '');
  assert.match(script, /samplerHead/); assert.match(script, /sourceHashes/);
  assert.match(script, /assertSameCampusScene/); assert.match(script, /NATURAL_FAILURE_NOT_REPRODUCED/);
  assert.match(script, /DIAGNOSTIC_ONLY/); assert.match(script, /warmupPolicy/);
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
