// Actual sample model and production room/furniture renderer. NullDevice is not pixel or GPU evidence.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(s,c,n){return n(s==='playcanvas'?engine:s,c);}});
const pc=await import('playcanvas');
const {createPersonalRoomScene}=await import('../../src/rooms/personal-room-renderer.js');
const {createSampleRoomTrial}=await import('../../src/commissions/sample-room-trial.js');
const {furnitureAssetStatus}=await import('../../src/rooms/furniture-glb-visual.js');
const bytes=readFileSync(new URL('../../assets/furniture/dorm-single-sofa-v1.glb',import.meta.url));
const oldFetch=globalThis.fetch;let pending=[];
globalThis.fetch=()=>new Promise(resolve=>pending.push(()=>resolve(new Response(bytes))));
const canvas={id:'sample-null',width:400,height:220},app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];options.resourceHandlers=[pc.ContainerHandler];app.init(options);
const tick=async()=>{await new Promise(r=>setTimeout(r,25));app.fire('postrender');};
try{
 for(let cycle=0;cycle<5;cycle++){
  const model=createSampleRoomTrial();model.open(`sample-${cycle}`);const room=createPersonalRoomScene(app);room.root.enabled=true;
  const initial=model.state();room.ownedFurniture.setObjects(initial.objects);
  assert.equal(room.ownedFurniture.root.children.length,5);
  // Remove/reset/account-close while the actual GLB bytes are still pending.
  model.edit(initial.objects.filter(o=>!o.itemId.includes('single_sofa')),initial.accountId,initial.generation);room.ownedFurniture.setObjects(model.state().objects);
  model.reset(model.state().accountId,model.state().generation);room.ownedFurniture.setObjects(model.state().objects);
  model.close();room.ownedFurniture.setObjects([]);room.onDeactivate();room.root.destroy();
  const queue=pending;pending=[];queue.forEach(resolve=>resolve());for(let i=0;i<5;i++)await tick();
  assert.equal(room.ownedFurniture.root.children.length,0);assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(app.root.children.length,0);
 }
 console.log(JSON.stringify({status:'PASS',cycles:5,engine:pc.version,device:'NullGraphicsDevice',checks:['sample add/remove/reset','real delayed GLB completion after close','zero retained GLB refs','destroyed room hierarchy'],visualOrPerformancePass:false},null,2));
}finally{app.destroy();globalThis.fetch=oldFetch;}
