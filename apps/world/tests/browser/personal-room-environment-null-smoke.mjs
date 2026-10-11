// Real pinned PlayCanvas CPU geometry/lifecycle check. No pixels or mobile GPU proof.
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
const engine=new URL('./node_modules/playcanvas/build/playcanvas.mjs',import.meta.url).href;
registerHooks({resolve(specifier,context,next){return next(specifier==='playcanvas'?engine:specifier,context);}});
const pc=await import('playcanvas');
const {createPersonalRoomScene}=await import('../../src/rooms/personal-room-renderer.js');
const {createPersonalRoomEnvironment,PERSONAL_ROOM_CONTROLS}=await import('../../src/rooms/personal-room-environment.js');
const {createEnvironmentDirector}=await import('../../src/environment/environment-director.js');
const {createEnvironmentWorldTime}=await import('../../src/environment/environment-world-time.js');
const {createRoomWorldAdapter}=await import('../../src/rooms/room-world-adapter.js');
const {ROOMS}=await import('../../src/rooms/room-registry.js');
const {NPC_WORLD_EPOCH_MS}=await import('../../npc-factory/npc-world-time-contract.mjs');
const canvas={id:'room-environment-null',width:1280,height:720};
const app=new pc.AppBase(canvas),options=new pc.AppOptions();options.graphicsDevice=new pc.NullGraphicsDevice(canvas);options.componentSystems=[pc.RenderComponentSystem,pc.CameraComponentSystem,pc.LightComponentSystem];app.init(options);
app.assets.loadFromUrl=(url,type,callback)=>queueMicrotask(()=>callback(new Error('Intentional optional asset fallback')));
const camera=new pc.Entity('camera');camera.addComponent('camera');app.root.addChild(camera);
const sun=new pc.Entity('sun');sun.addComponent('light',{type:'directional'});app.root.addChild(sun);
const environment=createEnvironmentDirector({scene:app.scene,lightEntity:sun,camera,initialTime:'DAY',initialWeather:'CLEAR'});
let now=NPC_WORLD_EPOCH_MS+20*60_000;
const clock={now:()=>now,refreshIfDue(){},status:()=>({state:'SYNCED',serverNowMs:now})};
const worldTime=createEnvironmentWorldTime({environment,clock});worldTime.update();
const scene=createPersonalRoomScene(app),other=createPersonalRoomScene(app);scene.root.enabled=true;
const c={active:true,sessionKey:'a:room-a',position:PERSONAL_ROOM_CONTROLS.light,grounded:true,reducedMotion:true},projection={};
const control=createPersonalRoomEnvironment({getContext:()=>c,getOutdoor:()=>environment.copyVisualAtmosphereState(projection),applyFrame:scene.applyEnvironment,setCurtainOpen:scene.setCurtainOpen});
try{
 await scene.ensureVisualAssets();control.update(0);
 const components=scene.root.findComponents('render').length,textures=app.graphicsDevice.textures.size;
 const sky=()=>scene.root.findByName('window_exterior_sky').render.meshInstances[0].material;
 const day=sky().diffuse.clone();
 control.contextAction().trigger();assert.ok(scene.lights.every(e=>e.light.intensity===0&&!e.light.castShadows));
 now=NPC_WORLD_EPOCH_MS+67*60_000;worldTime.update();environment.update(99);control.update(0);assert.equal(worldTime.status().environmentTime,'NIGHT');assert.notDeepEqual(sky().diffuse,day);
 c.position=PERSONAL_ROOM_CONTROLS.curtain;control.contextAction().trigger();assert.equal(control.status().openness,0);
 const left=scene.root.findByName('curtain_open_-1'),right=scene.root.findByName('curtain_open_1');
 const fabric=e=>e.findByName(`${e.name}_fabric`).render.meshInstances[0];
 const vertices=e=>{const p=[];fabric(e).mesh.getPositions(p);return p;};
 const lp=vertices(left),rp=vertices(right),stride=33*3;
 for(let row=0;row<=8;row++){
  const a=left.getLocalPosition().x+lp[row*stride+32*3]*left.getLocalScale().x;
  const b=right.getLocalPosition().x+rp[row*stride]*right.getLocalScale().x;
  assert.ok(a>=b,`closed panels overlap at row ${row}: ${a} >= ${b}`);
 }
 assert.equal(scene.root.findComponents('light').length,3);assert.ok(other.lights.every(e=>e.light.intensity===.7));
 const otherSky=other.root.findByName('window_exterior_sky').render.meshInstances[0].material;
 assert.notStrictEqual(sky(),otherSky);assert.notDeepEqual(sky().diffuse,otherSky.diffuse);
 for(let i=0;i<20;i++){
  c.active=false;scene.onDeactivate();scene.root.enabled=false;control.update();
  c.active=true;scene.root.enabled=true;control.update();
  assert.equal(control.status().lightsOn,true);assert.equal(control.status().openness,1);
  assert.equal(scene.root.findComponents('render').length,components);assert.equal(app.graphicsDevice.textures.size,textures);
 }
 // Actual adapter save/apply/restore with real Color objects: never alias room
 // palette objects into the global director's mutable lighting bindings.
 const campus=new pc.Entity('campus'),player=new pc.Entity('player');app.root.addChild(campus);campus.addChild(player);
 const controller={keys:new Set(),touchVector:{x:0,y:0},setMovementSpace(){}};
 const orbit={setIndoor(){}};
 const world=createRoomWorldAdapter({player,controller,orbit,campusRoot:campus,sun,
   getRoomScene:()=>scene,places:{getCurrentPlaceZone:()=>null,update(){}},
   lighting:{save:()=>({ambient:app.scene.ambientLight.clone(),clearColor:camera.camera.clearColor.clone()}),
     apply:({ambient,clearColor})=>{app.scene.ambientLight.copy(ambient);camera.camera.clearColor.copy(clearColor);}}});
 app.scene.ambientLight.set(.52,.56,.6);camera.camera.clearColor.set(.1,.2,.3);
 const originalAmbient=app.scene.ambientLight.clone(),originalClear=camera.camera.clearColor.clone();
 for(let i=0;i<10;i++){
   world.leaveCampus(ROOMS.ROOM_PERSONAL_BASIC);world.showRoom(ROOMS.ROOM_PERSONAL_BASIC);
   c.active=true;control.update();app.scene.ambientLight.copy(scene.ambient);
   assert.notStrictEqual(app.scene.ambientLight,scene.ambient);
   const clear=scene.clearColor.clone();environment.setTimeOfDay(i%2?'NIGHT':'DAY',{immediate:true});
   assert.deepEqual(scene.clearColor,clear,'world director cannot overwrite reusable room clearColor');
   world.showCampus();c.active=false;control.update();
   assert.deepEqual(app.scene.ambientLight,originalAmbient);assert.deepEqual(camera.camera.clearColor,originalClear);
   assert.equal(sun.enabled,true);assert.equal(scene.root.enabled,false);
 }
 console.log(JSON.stringify({status:'PASS',device:'NullGraphicsDevice; not pixel evidence',engine:pc.version,cycles:20,ceilingLights:2,existingReadingLamp:1,newLights:0,campusRestoreCycles:10,materialsIsolated:true,closedPanelsOverlap:true},null,2));
}finally{scene.root.destroy();other.root.destroy();app.destroy();}
