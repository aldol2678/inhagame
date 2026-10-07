// Executes the SAME fixture API against real pinned PlayCanvas containers without
// a browser. This checks setup/lifecycle code, not WebGL, pixels, HTTP or screenshots.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
const engine=new URL('./node_modules/playcanvas/build/playcanvas.dbg.mjs',import.meta.url).href;
const hook=registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engine:specifier,context);}});
const pc=await import('playcanvas');
const { createLifePropsBrowserFixture }=await import('./life-props-browser-fixture.mjs');
const { LIFE_PROP_MODELS,NPC_ACTIVITY_PROPS }=await import('../../src/life-props.js');
const spec=JSON.parse(readFileSync(new URL('../../assets/life-props-v1/attachment-spec.json',import.meta.url)));
const canvas={id:'life-props-browser-contract-null',width:512,height:512,clientWidth:512,clientHeight:512,viewportHeight:512,getBoundingClientRect(){return{width:this.clientWidth,height:this.clientHeight,top:0,left:0};}};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);
options.componentSystems=[pc.RenderComponentSystem,pc.LightComponentSystem,pc.CameraComponentSystem];
options.resourceHandlers=[pc.ContainerHandler];app.init(options);
const approx=(a,b)=>assert.ok(Number.isFinite(a)&&Math.abs(a-b)<2e-6,`${a} != ${b}`);
const vector=(a,b)=>a.forEach((n,i)=>approx(n,b[i]));
let qa;
try {
  for(const [id,url]of Object.entries(LIFE_PROP_MODELS)){
    const bytes=readFileSync(new URL('../..'+url,import.meta.url));
    const asset=new pc.Asset(id,'container',{url,contents:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});app.assets.add(asset);
    await new Promise((resolve,reject)=>app.assets.loadFromUrl(url,'container',error=>error?reject(error):resolve()));
  }
  // Model caption wrapping so viewport tests catch a resize taken before the
  // variable-length label has changed the CSS grid's canvas height.
  const label={scrollWidth:1,clientWidth:1,set textContent(value){canvas.clientHeight=canvas.viewportHeight-(value.length>75?130:90);}};
  qa=createLifePropsBrowserFixture({app,device:options.graphicsDevice,canvas,spec,label});
  assert.equal(qa.roomStats().models.length,0);assert.equal(qa.roomStats().enabled,false);
  let attachmentChecks=0;
  for(const height of [.9,1,1.1]){
    qa.newNpc(height);
    for(const [activity,binding]of Object.entries(NPC_ACTIVITY_PROPS))for(const phase of [0,2]){
      const stats=await qa.setActivity(activity,phase);
      assert.equal(stats.count,1);assert.equal(stats.prop.id,binding.id);assert.ok(stats.fallback.every(f=>!f.enabled));
      vector(stats.prop.scale,[.5,.5,.5]);vector(stats.prop.position,stats.handPosition);
      vector(stats.prop.position,stats.prop.expectedHandPosition);assert.equal(stats.prop.parentIsPrimaryArm,true);
      for(const [name,local]of Object.entries(spec.assets.find(a=>a.id===binding.id).anchors_gltf_metres))vector(stats.prop.anchors[name].local,local);
      attachmentChecks++;
    }
  }
  const fallbacks=await qa.fallbacks();for(const result of fallbacks.receipt){assert.equal(result.destroyed,true);assert.equal(result.stats.count,0);assert.ok(result.stats.fallback.every(f=>f.enabled));}
  assert.equal(fallbacks.unchanged.same,true);assert.equal(fallbacks.unchanged.requestsBefore,fallbacks.unchanged.requestsAfter);
  const races=await qa.npcRaces();assert.equal(races.switched[0].destroyed,true);assert.equal(races.switched[1].destroyed,false);assert.equal(races.switchedStats.prop.id,'compact_camera');assert.equal(races.requestsAfterDispose,0);assert.ok(races.disposed.every(r=>r.destroyed));assert.ok(races.destroyed.every(r=>r.destroyed));
  // The Null device cannot render. Exercise the same fitting and PlayCanvas
  // projection mathematics, explicitly emitting a test-only frame signal.
  let fittedViews=0;
  const checkView=async(mode,id)=>{
    const pending=qa.view(mode,id);
    app.fire('prerender');app.fire('postrender');
    const {framing:f}=await pending;assert.equal(f.height,f.cssHeight,'caption layout must precede drawing-buffer resize');assert.equal(f.width,f.cssWidth);
    assert.ok(f.minDepth>0 && f.minX>=.075 && f.maxX<=.925 && f.minY>=.075 && f.maxY<=.925,JSON.stringify(f));fittedViews++;
  };
  for(const [width,height]of [[1280,800],[390,844],[844,390]]){
    canvas.clientWidth=width;canvas.clientHeight=height;canvas.viewportHeight=height;
    for(const activity of Object.keys(NPC_ACTIVITY_PROPS)){
      await qa.setActivity(activity,0);await checkView('npc-full');await checkView('npc-hand');
    }
  }
  const entered=await qa.enterRoom();assert.equal(entered.models.length,4);for(const model of entered.models){vector(model.scale,[.5,.5,.5]);vector(model.anchors.rest.world,model.restTarget);approx(model.anchors.rest.world[1],entered.tableTop);assert.ok(model.bounds.min[1]>=entered.tableTop-.003);}
  for(const [width,height]of [[1280,800],[390,844],[844,390]]){
    canvas.clientWidth=width;canvas.clientHeight=height;canvas.viewportHeight=height;await checkView('room-table');
    for(const model of entered.models)await checkView('room-prop',model.id);
  }
  const lifecycle=await qa.roomLifecycle();for(const key of ['hidden','reused','oldDetached','cachePreserved','lazy','recreated'])assert.equal(lifecycle[key],true,key);assert.equal(lifecycle.destroyed.length,4);
  const roomRace=await qa.roomRace();assert.equal(roomRace.callbacks,4);assert.equal(roomRace.countAfterDispose,0);assert.equal(roomRace.detached,true);assert.ok(roomRace.cache.every(a=>a.loaded));
  console.log(JSON.stringify({status:'PASS',engine:pc.version,device:'NullGraphicsDevice',scope:'Browser fixture setup, lifecycle and camera mathematics only; no browser/GPU/HTTP evidence',attachmentChecks,fittedViews,fallbacks:fallbacks.receipt.map(r=>r.name),npcRaces:{switched:races.switched,disposed:races.disposed,destroyed:races.destroyed},tableProps:entered.models.map(m=>({id:m.id,rest:m.anchors.rest.world})),roomLifecycle:lifecycle,roomRace},null,2));
}finally{qa?.destroy();app.destroy();hook.deregister();}
