import test from 'node:test';
import assert from 'node:assert/strict';
import { VIEW_DISTANCE_PRESETS as presets, VIEW_DISTANCE_KEY, viewDistancePreset, readViewDistance, saveViewDistance } from '../src/view-distance.js';
import { RenderChunkRegistry, RENDER_CHUNKS } from '../src/render-chunk-registry.js';
import { RenderChunkStreaming, desiredChunkState } from '../src/render-chunk-streaming.js';
import { getPlaceZoneAt, PLACE_ZONES } from '../src/place-zone-registry.js';
import { FACILITY_BOUNDS } from '../src/campus-facilities.js';

function fixture() {
  const renderer={base:{},created:[],destroyed:[],visible:true,
    setViewPolicy(p){this.visible=p.preserveCampus;},
    create(c){const handle={id:c.id};this.created.push(handle);return handle;},
    setState(h,s){h.state=s;},destroy(h){this.destroyed.push(h);}};
  const stream=new RenderChunkStreaming(new RenderChunkRegistry(),renderer);
  const settle=(p,interestPoints=[])=>{for(let i=0;i<80;i++)stream.update(1/60,p,interestPoints);};
  return {renderer,stream,settle};
}

test('presets increase all tier distances with hysteresis and bounded MAX detail',()=>{
  const all=Object.values(presets);
  for(const field of ['detailEnter','detailExit','nearEnter','nearExit','load','unload'])
    for(let i=1;i<all.length;i++)assert.ok(all[i][field]>all[i-1][field],field);
  for(const p of all){
    assert.ok(p.detailEnter<p.detailExit&&p.detailExit<p.nearEnter);
    assert.ok(p.nearEnter<p.nearExit&&p.nearExit<p.load&&p.load<p.unload);
    for(const [enter,exit] of [['detailEnter','detailExit'],['nearEnter','nearExit'],['load','unload']])
      assert.ok(p[exit]-p[enter]>18*.25);
    assert.equal(desiredChunkState(p.detailEnter,'UNLOADED',p),'ACTIVE');
    assert.equal(desiredChunkState(p.nearEnter,'UNLOADED',p),'NEAR');
    assert.equal(desiredChunkState(p.load,'UNLOADED',p),'VISTA');
    assert.equal(desiredChunkState(p.unload+1,'VISTA',p),'UNLOADED');
    assert.equal(desiredChunkState(p.load+1,'VISTA',p),'VISTA');
    assert.equal(desiredChunkState(p.detailEnter+1,'ACTIVE',p),'ACTIVE');
    assert.equal(desiredChunkState(p.nearEnter+1,'NEAR',p),'NEAR');
  }
  assert.ok(presets.MAX.detailEnter<presets.MAX.load/4,'MAX must not draw all-campus detail');
});

test('view preference reload defaults and storage failure leave other saves untouched',()=>{
  const entries=new Map([['inhagame-campus-tour-v1','1'],['inhagame-campus-settings-v1','{"side":"right"}']]);
  const storage={getItem:k=>entries.get(k),setItem:(k,v)=>entries.set(k,v)};
  assert.equal(readViewDistance(storage).id,'NORMAL');
  assert.equal(saveViewDistance(storage,'MAX'),true);
  assert.equal(readViewDistance(storage).id,'MAX');
  assert.equal(entries.get('inhagame-campus-tour-v1'),'1');
  assert.equal(entries.get('inhagame-campus-settings-v1'),'{"side":"right"}');
  for(const invalid of ['__proto__','unknown','null','',null]){
    entries.set(VIEW_DISTANCE_KEY,invalid);assert.equal(readViewDistance(storage).id,'NORMAL');
    assert.equal(viewDistancePreset(invalid).id,'NORMAL');
  }
  assert.equal(readViewDistance({getItem(){throw Error('denied')}}).id,'NORMAL');
  assert.equal(saveViewDistance(undefined,'SHORT'),false);
});

test('preset switches reconcile incrementally without rebuilding near handles or base',()=>{
  const {stream,renderer,settle}=fixture(),position={x:49,z:-5};
  settle(position);
  const nearChunk=stream.registry.chunks.find(c=>c.buildings.includes('bldg_01'));
  const original=stream.runtime.get(nearChunk.id).handle,base=renderer.base;
  for(const preset of [presets.FAR,presets.MAX,presets.SHORT,presets.NORMAL]){
    const created=renderer.created.length,destroyed=renderer.destroyed.length;
    stream.setPolicy(preset);
    assert.equal(renderer.created.length,created,'no synchronous world construction');
    assert.equal(renderer.destroyed.length,destroyed,'no synchronous world destruction');
    stream.update(1/60,position);
    assert.ok(renderer.created.length-created<=1,'one chunk per frame during policy change');
    settle(position);
    assert.strictEqual(stream.runtime.get(nearChunk.id).handle,original,'near entity survives preset changes');
    assert.strictEqual(renderer.base,base);
    assert.ok(!stream.pending.length&&!stream.policyDirty,'no queue starvation');
  }
  assert.ok(renderer.destroyed.length>0,'short range actually releases distant dynamic handles');
});

test('MAX keeps distant campus vista from all corners without enabling every detail',()=>{
  const {stream,renderer,settle}=fixture(),b=FACILITY_BOUNDS;
  stream.setPolicy(presets.MAX);
  for(const x of [b.minX,b.maxX])for(const z of [b.minZ,b.maxZ]){
    settle({x,z});
    assert.equal(renderer.visible,true,'maximum campus vista must remain visible');
    const states=Object.values(stream.snapshot());
    assert.equal(states.length,RENDER_CHUNKS.length);
    assert.equal(states.filter(s=>s==='UNLOADED').length,0,'all campus chunks have vista residency');
    assert.ok(states.includes('VISTA'),'distant buildings do not require full detail');
    const diagonal=Math.hypot(b.maxX-b.minX,b.maxZ-b.minZ);
    assert.ok(presets.MAX.cameraFarClip>diagonal+36,'camera sees distant silhouette');
  }
});

test('every preset preserves semantic place and ignores rendering lifetime',()=>{
  const samples=PLACE_ZONES.flatMap(p=>p.anchors),expected=samples.map(getPlaceZoneAt);
  const {stream,settle}=fixture();
  const chunkIds=RENDER_CHUNKS.map(c=>c.id);
  for(const p of Object.values(presets)){
    stream.setPolicy(p);settle({x:0,z:-98});
    for(const [i,position] of samples.entries())assert.strictEqual(getPlaceZoneAt(position),expected[i]);
  }
  assert.deepEqual(RENDER_CHUNKS.map(c=>c.id),chunkIds);
});


test('temporary render interests can prewarm cinematic detail without moving gameplay position',()=>{
  const {stream,settle}=fixture();
  const target=stream.registry.chunks.find(c=>c.buildings.includes('bldg_01'));
  assert.ok(target,'main hall chunk is registered');
  const interest={
    x:(target.bounds.minX+target.bounds.maxX)/2,
    z:(target.bounds.minZ+target.bounds.maxZ)/2
  };
  settle({x:10_000,z:10_000},[interest]);
  assert.equal(stream.snapshot()[target.id],'ACTIVE');
});
