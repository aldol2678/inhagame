import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePng } from '../src/photo/photo-alpha-worker.js';
function scope({ alpha = 1, width = 3, height = 2, decodeError = false } = {}) {
  const closed = [], cleared = [], pixels = new Uint8ClampedArray(24); pixels[23] = alpha;
  return { closed, cleared, performance: { now: () => 1 },
    async createImageBitmap(blob) { if (decodeError) throw Error('private'); return { width, height, close() { closed.push(true); } }; },
    OffscreenCanvas: class { constructor(w,h) { assert.equal(w,3); assert.equal(h,2); } set width(v) { cleared.push(v); } set height(v) { cleared.push(v); }
      getContext() { return { drawImage() {}, getImageData(x,y,w,h) { assert.deepEqual([x,y,w,h],[0,0,3,2]); return {data:pixels}; } }; } } };
}
for (const alpha of [0,1,255]) test(`native full-plane alpha ${alpha}`, async () => {
  const s=scope({alpha}), r=await validatePng({blob:new Blob(['x']),width:3,height:2},s);
  assert.equal(r.status,alpha?'valid':'invalid'); assert.deepEqual(s.closed,[true]); assert.deepEqual(s.cleared,[0,0]);
});
test('decode and dimension errors fail closed',async()=>{
  for(const options of [{decodeError:true},{width:1}]) assert.equal((await validatePng({blob:new Blob(['x']),width:3,height:2},scope(options))).status,'invalid');
});
test('missing worker canvas capability is distinct from invalid image',async()=>{
  assert.equal((await validatePng({blob:new Blob(['x']),width:3,height:2},{})).status,'unsupported');
});
test('worker canvas/context initialization failures are infrastructure unsupported, not invalid PNG',async()=>{
  for(const contextFailure of [false,true]) {
    const s=scope(); s.OffscreenCanvas=class {constructor(){if(!contextFailure)throw new Error('private capability');} getContext(){throw new Error('private context');}};
    const result=await validatePng({blob:new Blob(['x']),width:3,height:2},s);
    assert.equal(result.status,'unsupported'); assert.deepEqual(s.closed,[true]);
  }
});
test('worker diagnostics default off never reads clock or returns timings',async()=>{
  const s=scope(); let reads=0; s.performance.now=()=>{reads++;return 1;};
  const result=await validatePng({blob:new Blob(['x']),width:3,height:2},s);
  assert.equal(reads,0); assert.equal('timings' in result,false);
});
test('worker diagnostic clock failures omit unknown durations without affecting validation',async()=>{
  const s=scope(); s.performance.now=()=>{throw Error('private clock');};
  const result=await validatePng({blob:new Blob(['x']),width:3,height:2,diagnostics:true},s);
  assert.equal(result.status,'valid'); assert.deepEqual(result.timings,{});
});
