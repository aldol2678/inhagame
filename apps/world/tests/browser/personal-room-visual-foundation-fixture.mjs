// Actual candidate renderer, empty owned layer, synthetic local app. No accounts, API or persistence.
// This fixture must run on a supported WebGL2 browser. A Null device is never a pixel pass.
import * as pc from 'playcanvas';
import { createPersonalRoomScene } from '/src/rooms/personal-room-renderer.js';
const qa=window.__ROOM_VISUAL_FOUNDATION_QA__={ready:false,frames:0,view:'entry',assetResults:null};
const status=document.getElementById('status');
const assetMode=new URLSearchParams(location.search).get('assetMode')||'loaded';
const failedLoads=[];
if(!['loaded','fallback'].includes(assetMode))throw Error('Unknown asset mode');
try {
 const canvas=document.getElementById('stage');
 const device=await pc.createGraphicsDevice(canvas,{deviceTypes:[pc.DEVICETYPE_WEBGL2],antialias:true});
 if(device.deviceType!==pc.DEVICETYPE_WEBGL2)throw Error(`Real WebGL2 required; received ${device.deviceType}`);
 const app=new pc.Application(canvas,{graphicsDevice:device});
 if(assetMode==='fallback')app.assets.loadFromUrl=(url,type,callback)=>{failedLoads.push({url,type});queueMicrotask(()=>callback(new Error('QA intentional loader failure')));};
 const scene=createPersonalRoomScene(app);scene.root.enabled=true;app.scene.ambientLight=scene.ambient;
 const camera=new pc.Entity('RoomVisualQACamera');camera.addComponent('camera',{fov:65,nearClip:.03,farClip:100,clearColor:scene.clearColor});app.root.addChild(camera);
 const initiallyEnabled=new Map();scene.root.forEach(entity=>initiallyEnabled.set(entity,entity.enabled));
 const hideInCutaway=name=>['ceiling','light_panel','door','door_frame','personal_light_w_fixture','personal_light_e_fixture'].includes(name)||['wall_south','wall_east','baseboard_south','baseboard_east','ceiling_trim','personal_light_switch'].some(prefix=>name.startsWith(prefix));
 const views={entry:{at:[0,1.64,3.78],target:[0,1.05,-1.3],fov:65},'sleep-study':{at:[-5.65,1.57,-.1],target:[.6,.9,-1.9],fov:65},cutaway:{at:[12,10.8,12],target:[0,.3,0],fov:52}};
 qa.setView=name=>{const pose=views[name];if(!pose)throw Error('Unknown QA view');qa.view=name;camera.setPosition(...pose.at);camera.lookAt(...pose.target);camera.camera.fov=pose.fov;for(const [entity,enabled] of initiallyEnabled)if(hideInCutaway(entity.name))entity.enabled=name==='cutaway'?false:enabled;};
 const modelNames=['personal_chair_oak_linen','personal_reading_table_kaykit','personal_floor_lamp_kaykit','personal_wall_shelf_kaykit'];
 const fallbackNames=['chair_fallback','reading_table_fallback','floor_lamp_fallback','wall_shelf_fallback'];
 const hierarchyEnabled=e=>{for(let node=e;node;node=node.parent)if(!node.enabled)return false;return Boolean(e);};
 const entityState=name=>{const e=scene.root.findByName(name);return {name,present:Boolean(e),enabled:hierarchyEnabled(e),meshes:e?.findComponents('render').reduce((n,c)=>n+c.meshInstances.length,0)??0};};
 qa.snapshot=()=>({assetMode,failedLoads,models:modelNames.map(entityState),fallbacks:fallbackNames.map(entityState),ready:qa.ready,frames:qa.frames,view:qa.view,device:device.deviceType,engine:pc.version,renderComponents:scene.root.findComponents('render').length,meshInstances:scene.root.findComponents('render').reduce((n,c)=>n+c.meshInstances.length,0),lights:scene.root.findComponents('light').length,assetResults:qa.assetResults,error:qa.error??null});
 for(const button of document.querySelectorAll('[data-view]'))button.onclick=()=>qa.setView(button.dataset.view);
 const resize=()=>device.resizeCanvas(innerWidth,innerHeight);addEventListener('resize',resize);resize();qa.setView('entry');
 app.on('update',()=>{qa.frames++;status.textContent=`${qa.view} · ${device.deviceType} · ${scene.root.findComponents('render').length} meshes\n${qa.ready?'Visual assets settled':'Loading visual assets…'}`;});
 app.start();qa.assetResults=await scene.ensureVisualAssets();qa.ready=true;
} catch(error){qa.error=String(error?.stack??error);status.textContent=qa.error;console.error(error);}
