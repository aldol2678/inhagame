// Optional private-payload integration. Exact engine CPU/entity tests, no pixels or GPU proof.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';
const directory=process.env.CHARACTER_FURNITURE_DIR;
if(!directory)throw Error('CHARACTER_FURNITURE_DIR required; never copy private GLBs into checkout');
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
const metadata=new URL('../../src/rooms/character-furniture-assets.js',import.meta.url).href;
// Exercise the shipped activation descriptors without rewriting module source.
registerHooks({resolve(s,c,n){return n(s==='playcanvas'?engine:s,c)}});
const pc=await import('playcanvas');
const {CHARACTER_FURNITURE_CANDIDATES:visuals}=await import(metadata);
const {createFurnitureLayer}=await import('../../src/rooms/furniture-renderer.js');
const {furnitureAssetStatus}=await import('../../src/rooms/furniture-glb-visual.js');
const {validateFurniturePayload}=await import('../../src/rooms/furniture-glb-contract.js');
const {furnitureBox,firstFurniturePosition,validateFurniture}=await import('../../src/rooms/furniture-layout.js');
const {planFurnitureVisualPlacements}=await import('../../src/rooms/furniture-visual-placement.js');
const {personalRoomSeatAnchors,roomSeatPointIsClear}=await import('../../src/rooms/personal-room-seats.js');
const paths=['character-form-furniture-r2/annyongi-chair/annyongi-character-chair-r2.glb','character-form-furniture-r1/induck-nightstand/induck-character-nightstand-r1.glb','character-form-furniture-r3/annyongi-bookshelf/annyongi-bookshelf.glb'];
const payloads=new Map();
for(let i=0;i<visuals.length;i++){const b=readFileSync(resolve(directory,paths[i]));await validateFurniturePayload(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),visuals[i]);payloads.set(visuals[i].url,b)}
const app=new pc.AppBase({id:'character-null',width:64,height:64}),options=new pc.AppOptions();
options.graphicsDevice=new pc.NullGraphicsDevice({id:'character-null',width:64,height:64});
options.componentSystems=[pc.RenderComponentSystem,pc.LightComponentSystem,pc.CameraComponentSystem];options.resourceHandlers=[pc.ContainerHandler];app.init(options);
const load=app.assets.load.bind(app.assets);let loads=0,fetches=0;
app.assets.load=asset=>{if(asset.type==='container'){loads++;asset.options={image:{processAsync(_image,done){const tex=new pc.Asset('null-placeholder','texture');tex.resource=new pc.Texture(app.graphicsDevice,{width:1,height:1});app.assets.add(tex);done(null,tex)}}}};return load(asset)};
const previousFetch=globalThis.fetch;globalThis.fetch=async url=>{fetches++;assert.ok(payloads.has(url));return new Response(payloads.get(url))};
const tick=()=>new Promise(r=>setTimeout(r,5));
const id=n=>`11111111-1111-4111-8111-${String(n).padStart(12,'0')}`;
const object=(n,index=0,x=0,z=0,yaw=0)=>({id:id(n),itemId:visuals[index].itemId,surface:'floor',x,z,yaw});
const root=new pc.Entity('room');root.setLocalScale(1,1,-1);app.root.addChild(root);
const layer=createFurnitureLayer(app,root);let changes=0;layer.root.on('visualchange',()=>changes++);
async function settle(){for(let i=0;i<200&&layer.visualStatus().objects.some(o=>o.state==='LOADING');i++){await tick();app.fire('postrender')}await layer.whenVisualsReady();assert.ok(layer.visualStatus().objects.every(o=>o.state==='GLB'),JSON.stringify(layer.visualStatus().objects));}
const reports=[];
try{
 for(let yaw=0;yaw<360;yaw+=45){
  const o=object(1,0,0,0,yaw),start=performance.now();layer.setObjects([o]);
  assert.equal(layer.placementGeometry.size,0);await settle();assert.equal(layer.placementGeometry.size,1);
  const anchor=personalRoomSeatAnchors({roomId:id(50),objects:[o],obstacles:layer.obstacles,placementGeometry:layer.placementGeometry}).find(s=>s.interactableId===o.id);
  assert.ok(anchor);assert.ok(roomSeatPointIsClear(anchor.standPoint,layer.obstacles));
  reports.push({case:'chair-yaw',yaw,cpuReadyMs:performance.now()-start});
 }
 const mixed=[object(1,0,-2,-1),object(2,1,2,-1),object(3,2,5,0)];assert.equal(validateFurniture(mixed),null);
 layer.setObjects(mixed);await settle();assert.equal(layer.placementGeometry.size,3);
 const before=JSON.stringify(mixed);app.graphicsDevice.fire('devicelost');assert.equal(layer.placementGeometry.size,0);
 for(const o of mixed)assert.deepEqual(layer.obstacles.find(b=>b.id===o.id),furnitureBox(o));
 assert.equal(JSON.stringify(mixed),before);assert.ok(changes>0);
 // Rebuild after fallback and ensure edit/save ordering selects the same geometry.
 const dense=[],owned=visuals.map(v=>({itemId:v.itemId,quantity:32}));
 for(let n=1;n<=32;n++){const o=firstFurniturePosition(visuals[(n-1)%3].itemId,'floor',dense,owned,{id:id(n)});assert.ok(o);dense.push(o)}
 const plan=planFurnitureVisualPlacements(dense,{visualForItem:item=>visuals.find(v=>v.itemId===item)});
 const count=[...plan.values()].filter(p=>p.eligible).length,start=performance.now();layer.setObjects(dense);await settle();
 assert.equal(layer.placementGeometry.size,count);assert.equal(layer.root.children.length,32);
 const selected=[...layer.placementGeometry.keys()].sort();layer.setObjects([...dense].reverse());await settle();assert.deepEqual([...layer.placementGeometry.keys()].sort(),selected);
 reports.push({case:'dense32',expanded:count,legacy:32-count,cpuReadyAndReorderMs:performance.now()-start});
 for(let cycle=0;cycle<5;cycle++){layer.deactivate();await tick();assert.equal(layer.placementGeometry.size,0);assert.deepEqual(furnitureAssetStatus(app),[]);layer.activate();await settle();assert.equal(layer.placementGeometry.size,count)}
 layer.setObjects([]);await tick();assert.equal(layer.root.children.length,0);assert.deepEqual(furnitureAssetStatus(app),[]);assert.equal(app.assets.list().length,0);
 // Pending load removal/account invalidation cannot activate new collision or a model later.
 let finish;globalThis.fetch=()=>{fetches++;return new Promise(r=>{finish=r})};layer.setObjects([object(1)]);await tick();layer.setObjects([]);
 finish(new Response(payloads.get(visuals[0].url)));await tick();await tick();assert.equal(layer.placementGeometry.size,0);assert.equal(layer.root.children.length,0);assert.deepEqual(furnitureAssetStatus(app),[]);
 // Actual personal-room composition + authority/preparation + real world adapter lifecycle.
 const {createPersonalRoomScene}=await import('../../src/rooms/personal-room-renderer.js');
 const {createRoomWorldAdapter}=await import('../../src/rooms/room-world-adapter.js');
 const {createRoomTransition}=await import('../../src/rooms/room-transition.js');
 const {createPersonalRoomPreparation}=await import('../../src/rooms/personal-room-preparation.js');
 const {createFurnitureClient}=await import('../../src/rooms/furniture-client.js');
 app.assets.loadFromUrl=(_url,_type,callback)=>queueMicrotask(()=>callback(Error('fixed optional asset intentionally offline')));
 globalThis.fetch=async url=>{fetches++;assert.ok(payloads.has(url));return new Response(payloads.get(url))};
 const scene=createPersonalRoomScene(app),campus=new pc.Entity('campus'),player=new pc.Entity('player');
 app.root.addChild(campus);campus.addChild(player);player.setLocalPosition(0,1.15,0);
 let paused=false,account=id(60),epoch=0;
 const controller={velocityY:0,jumpQueued:false,grounded:true,keys:new Set(),touchVector:{x:0,y:0},setMovementSpace(space){this.space=space},clearAssistedMovement(){}};
 const orbit={yaw:0,pitch:0,distance:3,setIndoor(value){this.indoor=value}};
 const client=createFurnitureClient({getUserId:()=>account,getClient:()=>({rpc:async()=>({data:{roomId:id(50),role:'owner',revision:42,objects:mixed}})}),onChange:state=>scene.ownedFurniture.setObjects(state.objects)});
 const preparation=createPersonalRoomPreparation({getFurniture:()=>client,getScene:()=>scene,getUserId:()=>account});
 const world=createRoomWorldAdapter({player,controller,orbit,campusRoot:campus,getRoomScene:()=>scene,
  getOnline:()=>({pauseCampus(){paused=true},resumeCampus(){paused=false}}),places:{update(){},getCurrentPlaceZone(){return null}}});
 const rooms=createRoomTransition({world,prepareRoom:context=>context.roomId==='ROOM_PERSONAL_BASIC'?preparation.prepare(context):undefined});
 const entry={parentRoomId:'ROOM_DORM1_LOBBY',returnPosition:{x:0,z:0},metadata:{personalRoomId:id(50),ownerUserId:account}};
 rooms.onChange(state=>{if(!state.insideRoom)client.reset()});
 for(let cycle=0;cycle<5;cycle++){
  const start=performance.now(),generation=epoch;
  assert.equal(rooms.enterNestedFromCampus('ROOM_PERSONAL_BASIC',{...entry,isValid:()=>epoch===generation}),true);
  assert.equal(campus.enabled,true);assert.equal(paused,false);assert.equal(scene.root.enabled,false);
  for(let i=0;i<200&&rooms.status().busy;i++){await tick();app.fire('postrender')}
  assert.equal(rooms.currentSpace,'ROOM_PERSONAL_BASIC');assert.equal(scene.ownedFurniture.placementGeometry.size,3);
  assert.equal(campus.enabled,false);assert.equal(paused,true);assert.equal(player.parent,scene.root);
  assert.equal(rooms.exit({force:true,toCampus:true}),true);await tick();
  assert.equal(campus.enabled,true);assert.equal(paused,false);assert.equal(scene.root.enabled,false);assert.equal(player.parent,campus);
  assert.equal(scene.ownedFurniture.placementGeometry.size,0);assert.deepEqual(furnitureAssetStatus(app),[]);
  reports.push({case:'whole-room-entry-exit',cycle,cpuReadyAndExitMs:performance.now()-start});
  // Forced exit cooldown still prevents ordinary bounce; the fixture waits for the existing cooldown.
  if(cycle<4)await new Promise(r=>setTimeout(r,805));
 }
 await new Promise(r=>setTimeout(r,805));
 const pendingAccount=[];globalThis.fetch=url=>{fetches++;return new Promise(resolve=>{pendingAccount.push({url,resolve})})};
 const generation=epoch;rooms.enterNestedFromCampus('ROOM_PERSONAL_BASIC',{...entry,isValid:()=>epoch===generation});await tick();
 epoch++;account=id(61);rooms.cancelPending();client.reset();
 assert.equal(campus.enabled,true);assert.equal(scene.root.enabled,false);assert.equal(paused,false);
 for(const pending of pendingAccount)pending.resolve(new Response(payloads.get(pending.url)));await tick();await tick();
 assert.equal(scene.root.enabled,false);assert.equal(scene.ownedFurniture.placementGeometry.size,0);
 scene.root.destroy();campus.destroy();await tick();assert.deepEqual(furnitureAssetStatus(app),[]);
 console.log(JSON.stringify({status:'PASS',engine:pc.version,device:'NullGraphicsDevice',loads,fetches,reports,savedObjectsUnchanged:true,teardownAssets:app.assets.list().length,pixels:'NOT_TESTED',imageDecode:'PLACEHOLDER',gpuFps:'UNKNOWN'},null,2));
}finally{root.destroy();app.destroy();globalThis.fetch=previousFetch;}
