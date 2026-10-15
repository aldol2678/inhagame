// Real engine CPU/entity readiness integration. No pixels, GPU, browser or remote requests.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const engine = new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url).href;
registerHooks({ resolve(specifier, context, next) { return next(specifier === 'playcanvas' ? engine : specifier, context); } });
const pc=await import('playcanvas');
const {createPersonalRoomScene}=await import('../../src/rooms/personal-room-renderer.js');
const {createPersonalRoomPreparation}=await import('../../src/rooms/personal-room-preparation.js');
const {createFurnitureClient}=await import('../../src/rooms/furniture-client.js');
const {createRoomTransition}=await import('../../src/rooms/room-transition.js');
const canvas={id:'preparation-null',width:320,height:240},app=new pc.AppBase(canvas),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice(canvas);
options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
app.assets.loadFromUrl=(_url,_type,callback)=>queueMicrotask(()=>callback(Error('intentional offline fallback')));
const roomId='11111111-1111-4111-8111-111111111111',user='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const object={id:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',itemId:'furniture.induck_chair',surface:'floor',x:-2,z:-1,yaw:0};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
let scene;
try{
 scene=createPersonalRoomScene(app);let resolveLayout,paused=false,checks=0;
 const client=createFurnitureClient({getUserId:()=>user,getClient:()=>({rpc:()=>new Promise(resolve=>{resolveLayout=resolve})}),
 onChange:state=>scene.ownedFurniture.setObjects(state.objects)});
 const originalReady=scene.ensureVisualAssets;
 scene.ensureVisualAssets=async()=>{
  assert.equal(scene.root.enabled,false);assert.equal(paused,false);assert.deepEqual(client.state().objects,[object]);
  const result=await originalReady();checks++;return result;
 };
 const preparer=createPersonalRoomPreparation({getFurniture:()=>client,getScene:()=>scene,getUserId:()=>user});
 const rooms=createRoomTransition({prepareRoom:context=>preparer.prepare(context),world:{
 createCheckpoint:()=>()=>{paused=false;scene.root.enabled=false;},leaveCampus:()=>{paused=true;},
 showRoom:()=>{assert.equal(checks,1);scene.root.enabled=true;},placePlayer(){}
 }});
 const entry={parentRoomId:'ROOM_DORM1_LOBBY',returnPosition:{x:0,z:0},metadata:{personalRoomId:roomId}};
 assert.equal(rooms.enterNestedFromCampus('ROOM_PERSONAL_BASIC',entry),true);
 assert.equal(scene.root.enabled,false);assert.equal(paused,false);
 resolveLayout({data:{roomId,role:'owner',revision:0,objects:[object]}});
 await flush();await flush();
 assert.equal(rooms.currentSpace,'ROOM_PERSONAL_BASIC');assert.equal(rooms.status().busy,false);assert.equal(paused,true);
 assert.equal(scene.root.enabled,true);assert.ok(scene.root.findComponents('render').length>0);
 scene.onDeactivate();scene.root.enabled=false;client.reset();
 scene.root.destroy();scene=null;
 assert.equal(app.root.children.length,0);
 console.log(JSON.stringify({status:'PASS',engine:pc.version,device:'NullGraphicsDevice',savedLayoutBeforeHiddenReadiness:true,
 sourceUntouchedUntilReady:true,optionalOfflineFallback:true,teardownRoots:0,pixels:'not_tested',gpu:'not_tested'}));
}finally{scene?.root.destroy();app.destroy();}
