// Real room shell, lighting, renderer, furniture editor/client and plant feature. Only RPCs are synthetic.
import * as pc from 'playcanvas';
import {createPersonalRoomScene} from '/src/rooms/personal-room-renderer.js';
import {createFurnitureClient} from '/src/rooms/furniture-client.js';
import {createFurnitureEditor} from '/src/rooms/furniture-editor.js';
import {createRoomChat} from '/src/rooms/room-chat.js';
import {createRoomPlantFeature} from '/src/rooms/room-plant-feature.js';
const ids={a:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',b:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',roomA:'cccccccc-cccc-4ccc-8ccc-cccccccccccc',roomB:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'};
const qa=window.plantFixture={ready:false,frames:0};
try{
 const query=new URLSearchParams(location.search);let actor=query.get('visitor')?ids.b:ids.a,roomId=ids.roomA,owner=ids.a,sessionVersion=crypto.randomUUID(),active=true,editor,feature,chat;
 const canvas=document.getElementById('stage'),device=await pc.createGraphicsDevice(canvas,{deviceTypes:[pc.DEVICETYPE_WEBGL2],antialias:true});
 if(device.deviceType!=='webgl2')throw Error('Real WebGL2 required');
 const app=new pc.Application(canvas,{graphicsDevice:device}),scene=createPersonalRoomScene(app);scene.root.enabled=true;app.scene.ambientLight=scene.ambient;
 const camera=new pc.Entity('plant_qa_camera');camera.addComponent('camera',{fov:48,nearClip:.025,farClip:60,clearColor:scene.clearColor});app.root.addChild(camera);
 camera.setPosition(-4.9,1.1,1.5);camera.lookAt(-6,.42,0);
 const rpc={rpc:(name,args)=>window.__plantRpc(actor,name,args),
  auth:{getSession:async()=>({data:{session:{user:{id:actor,is_anonymous:false},access_token:'disposable-browser-contract'}}})},
  realtime:{setAuth:async()=>{}},channel:()=>({on(){return this;},subscribe(fn){queueMicrotask(()=>fn('SUBSCRIBED'));return this;}}),removeChannel:async()=>{}};
 // The actual chat lifecycle runs here; websocket delivery is outside plant QA and explicitly doubled.
 chat=createRoomChat({getClient:()=>rpc,getIdentity:()=>({userId:actor}),clock:{now:()=>performance.now()}});
 const enterChat=async()=>{await chat.enter({kind:'personal',roomId,sessionId:sessionVersion});};

 const listeners=new Set(),inventory={accountId:actor,state:'READY',snapshot:{items:[]},onChange(fn){listeners.add(fn);return()=>listeners.delete(fn);},async refresh(){const a=actor,r=await rpc.rpc('fixture_inventory',{});if(a!==actor)return false;this.snapshot=r.data;this.state='READY';for(const fn of listeners)fn(this);return true;}};
 const furniture=createFurnitureClient({getClient:()=>rpc,getUserId:()=>actor,onChange:s=>{scene.ownedFurniture.setObjects(s.objects);editor?.update(s);feature?.update();}});
 const roomState=()=>{const s=furniture.state();return{...s,accountId:actor,ownerUserId:owner,roomId,role:owner===actor?'owner':'visitor',space:'ROOM_PERSONAL_BASIC',ready:s.ready,sessionActive:active,sessionVersion,visitLease:chat.personalVisitLease(roomId),layoutPending:s.reading||s.pending,layoutError:s.error};};
 editor=createFurnitureEditor({client:furniture,inventory});
 feature=createRoomPlantFeature({getClient:()=>rpc,getUserId:()=>actor,getRoomState:roomState,inventory,isAvailable:()=>true,onVisuals:p=>scene.ownedFurniture.setPlants(p),openEditor:()=>editor.openEditor()});
 inventory.onChange(()=>feature.inventoryChanged());
 document.getElementById('plant-open').onclick=()=>feature.handler(furniture.state().objects[0]);
 document.getElementById('editor-open').onclick=()=>{feature.panel.close();editor.openEditor();};
 const resize=()=>device.resizeCanvas(innerWidth,innerHeight);addEventListener('resize',resize);resize();
 qa.refresh=async()=>{if(!chat.personalVisitLease(roomId)){chat.stop();await enterChat();}else await chat.revalidateNow();await inventory.refresh();await furniture.refresh();await feature.client.refresh();};
 qa.switchAccount=async next=>{chat.stop();feature.reset();editor.forceClose();furniture.reset();actor=next;owner=next;roomId=next===ids.a?ids.roomA:ids.roomB;sessionVersion=crypto.randomUUID();await enterChat();inventory.accountId=actor;inventory.snapshot={items:[]};await inventory.refresh();await furniture.bind(roomId);await feature.client.refresh();};
 qa.loseAccess=()=>{chat.stop();active=false;sessionVersion=crypto.randomUUID();feature.update();};
 qa.leaveChat=()=>chat.stop();qa.enterChat=enterChat;
 qa.snapshot=()=>{const object=furniture.state().objects[0],placed=object&&scene.root.findByName(`placed_${object.id}`);const hierarchy=e=>{for(let n=e;n;n=n.parent)if(!n.enabled)return false;return !!e;};return{ready:qa.ready,frames:qa.frames,device:device.deviceType,engine:pc.version,rootEnabled:hierarchy(scene.root),room:roomState(),plant:feature.client.state(),visuals:feature.client.visuals(),meshNames:placed?.children.map(e=>e.name)??[],meshEnabled:placed?.children.every(hierarchy)??false,meshCount:placed?.findComponents('render').reduce((n,c)=>n+c.meshInstances.length,0)??0,hasRoomShell:!!scene.root.findByName('ceiling'),panelOpen:feature.panel.open,editorOpen:editor.open,error:qa.error??null};};
 Object.assign(qa,{chat,feature,furniture,editor,scene,camera,inventory,ids});
 app.on('update',()=>{qa.frames++;chat.update();feature.update();});app.start();await scene.ensureVisualAssets();await enterChat();await inventory.refresh();await furniture.bind(roomId);await feature.client.refresh();qa.ready=true;
}catch(e){qa.error=String(e.stack??e);console.error(e);}
