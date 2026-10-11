// Synthetic offline room, real scene, shared context controller and existing time API.
// No authenticated account, saved layout, room RPC or production service.
import * as pc from 'playcanvas';
import {createPersonalRoomScene} from '../../src/rooms/personal-room-renderer.js';
import {createPersonalRoomEnvironment,PERSONAL_ROOM_CONTROLS} from '../../src/rooms/personal-room-environment.js';
import {createEnvironmentDirector} from '../../src/environment/environment-director.js';
import {createEnvironmentWorldTime} from '../../src/environment/environment-world-time.js';
import {createGraphicsPresetController} from '../../src/graphics-presets.js';
import {NPC_WORLD_EPOCH_MS} from '../../npc-factory/npc-world-time-contract.mjs';
import {createContextActionController} from '../../src/context-action.js';
const qa=window.__ROOM_ENV_QA__={ready:false,frames:0};
try {
 const canvas=document.querySelector('canvas');
 const device=await pc.createGraphicsDevice(canvas,{deviceTypes:[pc.DEVICETYPE_WEBGL2],antialias:false});
 if(device.deviceType!=='webgl2')throw Error('Real WebGL2 required');
 const app=new pc.Application(canvas,{graphicsDevice:device});
 app.setCanvasFillMode(pc.FILLMODE_FILL_WINDOW);app.setCanvasResolution(pc.RESOLUTION_AUTO);
 const camera=new pc.Entity('camera');camera.addComponent('camera',{fov:65,nearClip:.03,farClip:100});app.root.addChild(camera);
 camera.camera.toneMapping=pc.TONEMAP_NEUTRAL;
 camera.setPosition(0,1.64,3.78);camera.lookAt(0,1.05,-1.3);
 const sun=new pc.Entity('sun');sun.addComponent('light',{type:'directional',castShadows:false});app.root.addChild(sun);
 const settings=new Map();
 const graphics=createGraphicsPresetController({app,device,light:sun.light,storage:{getItem:k=>settings.get(k)??null,setItem:(k,v)=>settings.set(k,v)},viewport:{width:innerWidth,height:innerHeight,dpr:1,mobile:matchMedia('(pointer: coarse)').matches,maxTextureSize:device.maxTextureSize}});graphics.setPreference('low');
 const outdoor=createEnvironmentDirector({scene:app.scene,lightEntity:sun,camera,initialTime:'DAY',initialWeather:'CLEAR'});
 let now=NPC_WORLD_EPOCH_MS+20*60*1000;
 const clock={now:()=>now,refreshIfDue(){},sync:async()=>{},status:()=>({state:'SYNCED',serverNowMs:now})};
 const worldTime=createEnvironmentWorldTime({environment:outdoor,clock});worldTime.update();
 const room=createPersonalRoomScene(app), other=createPersonalRoomScene(app);
 room.root.enabled=true;sun.enabled=false;
 const context={active:true,sessionKey:'synthetic-account-a:room-a',position:{...PERSONAL_ROOM_CONTROLS.light},grounded:true,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches};
 const projection={};
 const runtime=createPersonalRoomEnvironment({getContext:()=>context,getOutdoor:()=>outdoor.copyVisualAtmosphereState(projection),setCurtainOpen:room.setCurtainOpen,applyFrame:frame=>{room.applyEnvironment(frame);app.scene.ambientLight.copy(room.ambient);camera.camera.clearColor.copy(room.clearColor);}});
 const action=createContextActionController({button:document.getElementById('action'),shortcut:'F'});
 const refresh=()=>{action.set('room-environment',runtime.contextAction());action.refresh();};
 addEventListener('keydown',event=>{if(event.code==='KeyF'&&!event.repeat){event.preventDefault();action.trigger();refresh();}});
 qa.control=kind=>{context.position={...PERSONAL_ROOM_CONTROLS[kind]};refresh();};
 qa.block=value=>{context.blocked=value;refresh();};
 qa.account=value=>{context.sessionKey=value;runtime.update(0);refresh();};
 qa.active=value=>{context.active=value;room.root.enabled=value;runtime.update(0);refresh();};
 qa.time=minutes=>{now=NPC_WORLD_EPOCH_MS+minutes*60*1000;worldTime.update();outdoor.update(99);runtime.update(0);};
 qa.snapshot=()=>({ ...runtime.status(),canvasRect:{width:canvas.getBoundingClientRect().width,height:canvas.getBoundingClientRect().height},frames:qa.frames,device:device.deviceType,graphicsTier:graphics.tier,worldTime:worldTime.status().environmentTime,
   ambient:[room.ambient.r,room.ambient.g,room.ambient.b], lights:room.lights.map(e=>({intensity:e.light.intensity,shadow:e.light.castShadows})),
   other:other.lights.map(e=>e.light.intensity),sky:room.root.findByName('window_exterior_sky').render.meshInstances[0].material.diffuse.toString(),
   panels:[-1,1].map(side=>{const e=room.root.findByName(`curtain_open_${side}`);return {x:e.getLocalPosition().x,scale:e.getLocalScale().x};}),
   renderCount:room.root.findComponents('render').length,textures:device.textures.size,lightCount:room.root.findComponents('light').length});
 const resize=()=>device.resizeCanvas(innerWidth,innerHeight);addEventListener('resize',resize);resize();
 app.on('update',dt=>{worldTime.update();outdoor.update(dt);runtime.update(dt);refresh();qa.frames++;document.getElementById('status').textContent=`Room session visual controls · LOW / no shadows\n${worldTime.status().environmentTime} · ${runtime.status().lightsOn?'ceiling lights ON':'ceiling lights OFF'} · ${runtime.status().curtainsOpen?'curtains OPEN':'curtains CLOSED'}`;});
 app.start();await room.ensureVisualAssets();qa.ready=true;
}catch(error){qa.error=String(error.stack??error);console.error(error);}
