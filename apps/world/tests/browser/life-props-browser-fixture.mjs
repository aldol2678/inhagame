import * as pc from 'playcanvas';
import { createHumanAvatar } from '../../npc-factory/dev-human-avatar.mjs';
import { purposefulActivityPose } from '../../npc-factory/purposeful-activity-motion.mjs';
import { createPurposefulActivityProps } from '../../npc-factory/purposeful-activity-props.mjs';
import { createEquipmentModelLoader } from '../../src/appearance/equipment-asset-loader.js';
import { createClubRoomScene } from '../../src/rooms/club-room-renderer.js';
import { CLUB_ROOM_FURNITURE } from '../../src/rooms/club-room-layout.js';
import { LIFE_PROP_MODELS, NPC_ACTIVITY_PROPS, CLUB_TABLE_PROPS } from '../../src/life-props.js';
import { fitDiagnosticPoints, framebufferEvidence } from './life-props-browser-helpers.mjs';

const xyz=v=>[v.x,v.y,v.z], quaternion=q=>[q.x,q.y,q.z,q.w];
const meshes=root=>root.findComponents('render').filter(c=>c.enabled && c.entity.enabled).flatMap(c=>c.meshInstances);
const corners=root=>meshes(root).flatMap(m=>{
  const min=m.aabb.getMin(),max=m.aabb.getMax();
  return [min.x,max.x].flatMap(x=>[min.y,max.y].flatMap(y=>[min.z,max.z].map(z=>[x,y,z])));
});
const fallbackNames=['HeldBook','BookSpine'];
const activityModels=visual=>visual.arms[0].children.filter(e=>e.name.startsWith('NPC_Activity_'));
const tableModels=table=>table.children.filter(e=>e.name.startsWith('Club_Life_Prop_'));
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

// Browser-only instrumentation wraps the actual loader; delayed responses are real
// parsed HTTP containers, never fake geometry or production runtime hooks.
export function createLifePropsBrowserFixture({app,device,canvas,spec,label=null,caption=null}) {
  app.scene.ambientLight=new pc.Color(.67,.67,.67);
  const campus=new pc.Entity('Synthetic_Life_NPC');campus.setLocalScale(1,1,-1);app.root.addChild(campus);
  const camera=new pc.Entity('Diagnostic_Camera');camera.addComponent('camera',{fov:40,nearClip:.001,farClip:100,clearColor:new pc.Color(.79,.84,.89)});app.root.addChild(camera);
  const sun=new pc.Entity('Diagnostic_Sun');sun.addComponent('light',{type:'directional',intensity:1,castShadows:false});sun.setLocalEulerAngles(40,25,0);app.root.addChild(sun);
  const loadReal=createEquipmentModelLoader({app,registry:LIFE_PROP_MODELS});
  let npc=null,room=createClubRoomScene(app),state={mode:'npc-full',activity:null,phase:0},lastPixels=null,currentPoints=[];
  const requests=[],held=[],loadPromises=[];
  let holdLoads=false,deliverySequence=0;
  const loadModel=id=>{
    const record={id,index:requests.length,ready:false,destroyed:false,entity:null};requests.push(record);
    const promise=loadReal(id).then(async entity=>{
      record.ready=true;record.entity=entity;entity.once('destroy',()=>{record.destroyed=true;});
      if(holdLoads) await new Promise(resolve=>held.push({record,resolve}));
      record.deliveryOrder=++deliverySequence;return entity;
    });
    loadPromises.push(promise);return promise;
  };
  function newNpc(height=1) {
    npc?.visual.avatar.destroy();
    campus.enabled=false; // regression: fallback created under a hidden ancestor
    const visual=createHumanAvatar(campus,{id:'SYNTHETIC-001'},{height,outfit_color:'#456789',accent_color:'#deba60',skin_tone:0,hair_color:'#252525',presentation:'male',outfit_style:'shirt',hair_style:'short',accessory:'book'});
    visual.marker.enabled=false; // synthetic selection marker is not a hand-fit target
    npc={visual,props:createPurposefulActivityProps({visual,loadModel}),height};
    campus.enabled=true;state={mode:'npc-full',activity:null,phase:0};return npcStats();
  }
  async function settle(){await Promise.all(loadPromises);await flush();}
  function pose(activity,phase=0,options={}) {
    const value=purposefulActivityPose(activity,{phase,...options});
    npc.visual.arms.forEach((arm,i)=>arm.setLocalEulerAngles(value.armPitch[i],value.armYaw[i],value.armRoll[i]));
    npc.visual.legs.forEach((leg,i)=>leg.setLocalEulerAngles(value.legPitch[i],0,0));
    state.activity=activity;state.phase=phase;return value;
  }
  async function setActivity(activity,phase=0,options={}) {
    pose(activity,phase,options);npc.props.update(activity,options);await settle();return npcStats();
  }
  function assetStats(model,id) {
    const definition=spec.assets.find(a=>a.id===id);
    return {id,name:model.name,scale:xyz(model.getWorldTransform().getScale(new pc.Vec3())),localScale:xyz(model.getLocalScale()),position:xyz(model.getPosition()),localPosition:xyz(model.getLocalPosition()),
      meshes:meshes(model).length,triangles:meshes(model).reduce((n,m)=>n+m.mesh.primitive[0].count/3,0),
      anchors:Object.fromEntries(Object.keys(definition.anchors_gltf_metres).map(name=>{
        const anchor=model.findByName('ANCHOR_'+name);return [name,anchor?{local:xyz(anchor.getLocalPosition()),world:xyz(anchor.getPosition())}:null];
      })),collision:model.findComponents('collision').length,rigidbody:model.findComponents('rigidbody').length};
  }
  function npcStats() {
    const {visual,props,height}=npc,model=activityModels(visual)[0],binding=NPC_ACTIVITY_PROPS[state.activity];
    const hand=visual.arms[0].findByName('Hand_-1');
    const result={height,worldScale:visual.worldScale,reflection:campus.worldScaleSign,activity:state.activity,phase:state.phase,
      count:activityModels(visual).length,fallback:fallbackNames.map(n=>({name:n,enabled:visual.avatar.findByName(n).enabled})),
      handPosition:xyz(hand.getPosition()),facePosition:xyz(visual.face.head.getPosition()),armRotation:quaternion(visual.arms[0].getLocalRotation()),requests:requests.length};
    if(model && binding) {
      result.prop=assetStats(model,binding.id);result.prop.parent=model.parent.name;
      result.prop.parentIsPrimaryArm=model.parent===visual.arms[0];
      result.prop.localRotation=quaternion(model.getLocalRotation());
      result.prop.avatarFrameRotation=quaternion(new pc.Quat().mul2(visual.arms[0].getLocalRotation(),model.getLocalRotation()));
      result.prop.expectedHandPosition=xyz(visual.arms[0].getWorldTransform().transformPoint(new pc.Vec3(...binding.position)));
    }
    return result;
  }
  function roomStats() {
    const table=room.root.findByName('club_table'),top=table.findByName('top');
    const tableTop=top.render.meshInstances[0].aabb.getMax().y;
    return {enabled:room.root.enabled,reflection:room.root.worldScaleSign,models:tableModels(table).map(model=>{
      const binding=CLUB_TABLE_PROPS.find(p=>model.name==='Club_Life_Prop_'+p.id);
      const stats=assetStats(model,binding.id);
      const all=corners(model),bounds=all.length?{min: [0,1,2].map(i=>Math.min(...all.map(p=>p[i]))),max:[0,1,2].map(i=>Math.max(...all.map(p=>p[i])))}:null;
      return {...stats,restTarget:xyz(table.getWorldTransform().transformPoint(new pc.Vec3(binding.restTarget[0],.38+binding.restTarget[1],binding.restTarget[2]))),bounds,
        fallback:binding.fallback?{name:binding.fallback,enabled:table.findByName(binding.fallback).enabled}:null};
    }),tableTop,tableSize:CLUB_ROOM_FURNITURE.find(p=>p.id==='table').size,cache:cacheStats()};
  }
  function cacheStats(){return Object.entries(LIFE_PROP_MODELS).map(([id,url])=>{const asset=app.assets.getByUrl(url);return{id,loaded:!!asset?.resource,assetId:asset?.id??null};});}
  async function waitFrame(){return new Promise((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);resolve();};
    const timer=setTimeout(()=>{app.off('postrender',done);reject(Error('WebGL diagnostic frame exceeded 6000ms'));},6000);
    app.once('postrender',done);app.renderNextFrame=true;
  });}
  async function view(mode,id=null) {
    campus.enabled=mode.startsWith('npc');room.root.enabled=!campus.enabled;
    state.mode=mode;
    let points,direction;
    if(campus.enabled) {
      points=mode==='npc-hand'?corners(npc.visual.arms[0].findByName('Hand_-1')).concat(activityModels(npc.visual).flatMap(corners)):corners(npc.visual.avatar);
      direction=[-1,.5,-2];
      if(label)label.textContent=`Synthetic NPC · ${state.activity} · phase ${state.phase} · ${mode==='npc-hand'?'primary-hand detail':'full avatar'} · height ${npc.height}`;
    } else {
      const table=room.root.findByName('club_table');
      // Isolate the real table only for diagnostics; retain its true room parent,
      // reflection, placement and model transforms. No runtime room is modified.
      for(const child of room.root.children) child.enabled=child===table;
      const selected=id?table.findByName('Club_Life_Prop_'+id):table;
      points=corners(selected);direction=[.6,1,-1.5];
      if(label)label.textContent=`Synthetic club room · ${id||'four table props'} · isolated actual table detail`;
    }
    // The caption can wrap differently in portrait: settle its grid height
    // before measuring the canvas and fitting this camera.
    device.resizeCanvas(canvas.clientWidth,canvas.clientHeight);device.updateClientRect();lastPixels=null;
    const fit=fitDiagnosticPoints(points,{aspect:canvas.width/canvas.height,direction});
    camera.setPosition(...fit.position);camera.lookAt(...fit.target);currentPoints=points;
    await waitFrame();return {mode,camera:{position:xyz(camera.getPosition()),target:fit.target},framing:framing()};
  }
  function project(points) {
    const positions=points.map(p=>camera.camera.worldToScreen(new pc.Vec3(...p)));
    return {points:positions.length,minDepth:Math.min(...points.map(p=>-camera.camera.viewMatrix.transformPoint(new pc.Vec3(...p)).z)),minX:Math.min(...positions.map(p=>p.x)),maxX:Math.max(...positions.map(p=>p.x)),minY:Math.min(...positions.map(p=>p.y)),maxY:Math.max(...positions.map(p=>p.y))};
  }
  function framing(){const projected=project(currentPoints),c=caption?.getBoundingClientRect(),stage=canvas.getBoundingClientRect();return{...projected,minX:projected.minX/canvas.width,maxX:projected.maxX/canvas.width,minY:projected.minY/canvas.height,maxY:projected.maxY/canvas.height,
    width:canvas.width,height:canvas.height,cssWidth:canvas.clientWidth,cssHeight:canvas.clientHeight,captionOverlapsCanvas:!!c&&c.bottom>stage.top+.5,labelOverflows:!!label&&label.scrollWidth>label.clientWidth};}
  async function pixels(roi=null) {
    const gl=device.gl;
    return new Promise((resolve,reject)=>{
      const finish=()=>{
        clearTimeout(timer);
        try{
          if(gl.isContextLost())throw Error('WebGL context lost');
          const width=gl.drawingBufferWidth,height=gl.drawingBufferHeight,data=new Uint8Array(width*height*4),old=gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
          try{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,null);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,data);}finally{gl.bindFramebuffer(gl.READ_FRAMEBUFFER,old);}
          const result=framebufferEvidence(data,width,height,{previous:lastPixels,roi});lastPixels=data;
          resolve({...result,glError:gl.getError(),contextLost:gl.isContextLost()});
        }catch(error){reject(error);}
      };
      const timer=setTimeout(()=>{app.off('postrender',finish);reject(Error('Framebuffer read exceeded 6000ms'));},6000);
      app.once('postrender',finish);app.renderNextFrame=true;
    });
  }
  async function contribution(id=null) {
    const model=state.mode.startsWith('npc')?activityModels(npc.visual)[0]:room.root.findByName('Club_Life_Prop_'+id);
    if(!model?.enabled) throw Error('No visible prop for contribution evidence');
    const p=project(corners(model)),roi={minX:Math.max(0,Math.floor(p.minX)-2),maxX:Math.min(canvas.width,Math.ceil(p.maxX)+2),minY:Math.max(0,Math.floor(p.minY)-2),maxY:Math.min(canvas.height,Math.ceil(p.maxY)+2)};
    const on=await pixels();model.enabled=false;
    let off;try{off=await pixels(roi);}finally{model.enabled=true;}
    const restored=await pixels(roi);return {id:id||NPC_ACTIVITY_PROPS[state.activity].id,on,off,restored};
  }
  async function fallbacks() {
    const receipt=[];
    for(const [name,activity,options] of [['walking','COFFEE',{moving:true}],['seated','COFFEE',{sitting:true}],['hidden','COFFEE',{visible:false}],['clear',null,{}]]) {
      await setActivity('COFFEE');const old=activityModels(npc.visual)[0];let destroyed=false;old.once('destroy',()=>{destroyed=true;});
      if(name==='hidden')campus.enabled=false;
      await setActivity(activity,0,options);
      campus.enabled=true;receipt.push({name,destroyed,stats:npcStats()});
    }
    await setActivity('COFFEE');const before=requests.length,old=activityModels(npc.visual)[0];
    for(let i=0;i<30;i++)npc.props.update('COFFEE');await settle();
    return {receipt,unchanged:{same:old===activityModels(npc.visual)[0],requestsBefore:before,requestsAfter:requests.length}};
  }
  async function releaseHeld(reverse=false){const list=held.splice(0);for(const item of (reverse?[...list].reverse():list)){item.resolve();await flush();}await settle();return list.map(({record})=>({id:record.id,deliveryOrder:record.deliveryOrder,destroyed:record.destroyed,parent:record.entity?.parent?.name??null}));}
  async function waitHeld(count){const start=Date.now();while(held.length<count){if(Date.now()-start>8000)throw Error('Real container did not reach delayed callback');await new Promise(r=>setTimeout(r,5));}}
  async function npcRaces() {
    await setActivity(null);holdLoads=true;
    npc.props.update('READING');await waitHeld(1);npc.props.update('PHOTO');await waitHeld(2);
    state.activity='PHOTO';holdLoads=false;const switched=await releaseHeld(true);
    const switchedStats=npcStats();
    await setActivity(null);holdLoads=true;npc.props.update('EATING');await waitHeld(1);npc.props.dispose();holdLoads=false;
    const disposed=await releaseHeld(),disposedStats=npcStats();
    const requestCount=requests.length;npc.props.update('PHONE');await flush();const requestsAfterDispose=requests.length-requestCount;
    newNpc(1);holdLoads=true;npc.props.update('PHONE');await waitHeld(1);const avatar=npc.visual.avatar;avatar.destroy();holdLoads=false;
    const destroyed=await releaseHeld();const cache=cacheStats();newNpc(1);
    return {arrivalOrder:[...switched].sort((a,b)=>a.deliveryOrder-b.deliveryOrder).map(r=>r.id),switched,switchedStats,disposed,disposedStats,requestsAfterDispose,destroyed,avatarDetached:avatar.parent===null,cache};
  }
  async function enterRoom(){campus.enabled=false;room.root.enabled=true;await room.ensureVisualAssets();return roomStats();}
  async function roomLifecycle() {
    const table=room.root.findByName('club_table'),before=tableModels(table),cache=Object.fromEntries(Object.values(LIFE_PROP_MODELS).map(url=>[url,app.assets.getByUrl(url)?.resource]));
    room.root.enabled=false;await room.ensureVisualAssets();const hidden=!room.root.enabled;
    room.root.enabled=true;await Promise.all([room.ensureVisualAssets(),room.ensureVisualAssets()]);
    const reused=before.every((e,i)=>tableModels(table)[i]===e),count=tableModels(table).length;
    const destroyed=[];for(const model of before)model.once('destroy',()=>destroyed.push(model.name));
    const oldRoot=room.root;oldRoot.destroy();await room.ensureVisualAssets();
    const cachePreserved=Object.entries(cache).every(([url,resource])=>resource&&app.assets.getByUrl(url)?.resource===resource);
    room=createClubRoomScene(app);const lazy=tableModels(room.root.findByName('club_table')).length===0&&!room.root.enabled;
    await enterRoom();const newModels=tableModels(room.root.findByName('club_table'));
    return {hidden,reused,count,destroyed,oldDetached:oldRoot.parent===null,cachePreserved,lazy,recreated:newModels.every(e=>!before.includes(e)),stats:roomStats()};
  }
  async function roomRace() {
    room.root.destroy();room=createClubRoomScene(app);room.root.enabled=true;
    const original=app.assets.loadFromUrl,callbacks=[];
    app.assets.loadFromUrl=function(url,type,callback,...rest){return original.call(this,url,type,(...args)=>callbacks.push(()=>callback(...args)),...rest);};
    let pending;
    try {
      pending=room.ensureVisualAssets();const started=Date.now();
      while(callbacks.length<4){if(Date.now()-started>8000)throw Error('Room callbacks did not settle');await new Promise(r=>setTimeout(r,5));}
      const table=room.root.findByName('club_table'),root=room.root;root.destroy();
      for(const callback of callbacks)callback();await pending;await room.ensureVisualAssets();
      return {callbacks:callbacks.length,countAfterDispose:tableModels(table).length,detached:root.parent===null,cache:cacheStats()};
    } finally {app.assets.loadFromUrl=original;}
  }
  function stats(){
    const gl=device.gl,debug=gl?.getExtension('WEBGL_debug_renderer_info');
    return {engine:pc.version,device:device.deviceType,gpu:gl?{version:gl.getParameter(gl.VERSION),renderer:gl.getParameter(gl.RENDERER),unmaskedRenderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):null}:null,
      room:roomStats(),npc:npcStats(),scope:'Synthetic production-helper fixture; no campus gameplay, elbow rig, two-hand contact or face-level PHOTO claim'};
  }
  newNpc();
  return {newNpc,setActivity,npcStats,roomStats,cacheStats,view,framing,pixels,contribution,fallbacks,npcRaces,enterRoom,roomLifecycle,roomRace,stats,
    destroy(){npc?.props.dispose();campus.destroy();room.root.destroy();camera.destroy();sun.destroy();}};
}
