// Test-only rendered offline fixture. Production transition/controller/input modules are unchanged.
import * as pc from 'playcanvas';
import { createRoomTransition } from '/src/rooms/room-transition.js';
import { createRoomWorldAdapter } from '/src/rooms/room-world-adapter.js';
import { createSpaceFade } from '/src/rooms/space-fade.js';
import { PlayerController } from '/src/player-controller.js';
import { OrbitCameraController } from '/src/orbit-camera-controller.js';
import { createInputFocusManager, INPUT_FOCUS_POLICY } from '/src/input/input-focus-manager.js';
import { createInputFocusOwner } from '/src/input/input-focus-owner.js';
import { bindInputFocusRuntime } from '/src/input/input-focus-runtime.js';
import { createClubRoomScene } from '/src/rooms/club-room-renderer.js';
import { createDorm1LobbyScene } from '/src/rooms/dorm1-lobby-renderer.js';
import { createPersonalRoomScene } from '/src/rooms/personal-room-renderer.js';
import { PlaceZoneRegistry } from '/src/place-zone-registry.js';
import { ROOMS, RETURN_ANCHORS } from '/src/rooms/room-registry.js';
import { DORM_1_LOBBY_MY_ROOM_RETURN } from '/src/rooms/dorm1-lobby-layout.js';
import { box, surface } from '/src/campus-render-kit.js';
const qa = window.__ROOM_RECOVERY_QA__ = { ready: false };
try {
  const canvas = document.getElementById('stage');
  const device = await pc.createGraphicsDevice(canvas, { deviceTypes: [pc.DEVICETYPE_WEBGL2], antialias: true });
  const app = new pc.Application(canvas, { graphicsDevice: device });
  app.scene.ambientLight = new pc.Color(.58,.64,.7);
  const campusRoot = new pc.Entity('QA_Campus'); campusRoot.setLocalScale(1,1,-1); app.root.addChild(campusRoot);
  const anchor = RETURN_ANCHORS.MAIN_HALL_ROOM_EXIT_RETURN;
  box(campusRoot,'qa_ground',[0,-.05,0],[1000,.1,1000],surface('#718d79'));
  box(campusRoot,'qa_landmark',[anchor.position.x+5,1.5,anchor.position.z+5],[2,3,2],surface('#527c99'));
  const sun = new pc.Entity('QA_Sun'); sun.addComponent('light',{type:'directional',intensity:1.2,castShadows:false}); sun.setLocalEulerAngles(45,25,0); app.root.addChild(sun);
  const camera = new pc.Entity('QA_Camera'); camera.addComponent('camera',{fov:55,nearClip:.05,farClip:400,clearColor:new pc.Color(.55,.69,.8)}); app.root.addChild(camera);
  const player = new pc.Entity('QA_Player'); campusRoot.addChild(player); player.setLocalPosition(anchor.position.x,1.15,anchor.position.z); player.setLocalEulerAngles(0,137,0);
  box(player,'synthetic_player',[0,-.55,0],[.35,.75,.3],surface('#ffe27f'),0,'capsule');
  const controller = new PlayerController(player);
  const orbit = new OrbitCameraController(camera,canvas); orbit.yaw=.8; orbit.pitch=.45; orbit.distance=4;
  const scenes = new Map([['ROOM_CLUBHOUSE_01',createClubRoomScene(app)],['ROOM_DORM1_LOBBY',createDorm1LobbyScene(app)],['ROOM_PERSONAL_BASIC',createPersonalRoomScene(app)]]);
  // Keep real template meshes/colliders. Optional external-looking decoration assets are outside
  // this recovery fixture's purpose and must not add loading variability or a network dependency.
  for (const scene of scenes.values()) scene.ensureVisualAssets = () => Promise.resolve();
  const places = new PlaceZoneRegistry(); places.update(player.getLocalPosition());
  const presence = { campusPaused:false, pauses:0, resumes:0,
    pauseCampus(){this.campusPaused=true;this.pauses++;},resumeCampus(){this.campusPaused=false;this.resumes++;} };
  let location = places.getCurrentPlaceZone()?.displayName ?? '캠퍼스';
  let marker = null;
  const world = createRoomWorldAdapter({ player,controller,orbit,campusRoot,sun,getRoomScene:r=>scenes.get(r.id),
    lighting:{save:()=>({ambient:app.scene.ambientLight.clone(),clearColor:camera.camera.clearColor.clone()}),apply:s=>{app.scene.ambientLight=s.ambient;camera.camera.clearColor=s.clearColor;}},
    getOnline:()=>presence,places,getLocationLabel:()=>location,setLocationLabel:value=>{location=value;},markSpace:id=>{marker=id;} });
  const focus = createInputFocusManager();
  const input = createInputFocusOwner({manager:focus,ownerId:'room-transition',policy:INPUT_FOCUS_POLICY.SYSTEM_LOCK});
  bindInputFocusRuntime({manager:focus,controller,orbit});
  const overlay = document.getElementById('space-fade');
  const actualFade = createSpaceFade({overlay,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)')});
  const events=[],errors=[],trustedTouches=[];
  document.getElementById('joystick').addEventListener('pointerdown',event=>trustedTouches.push({trusted:event.isTrusted,type:event.pointerType}));
  let injection = null, valid = true, ticks = 0;
  const baseCheckpoint=world.createCheckpoint;
  world.createCheckpoint=()=>{
    const restore=baseCheckpoint(); const rollbackFail=injection?.rollbackFail;
    return ()=>{restore();if(rollbackFail)throw Error('QA injected rollback failure');};
  };
  const rooms=createRoomTransition({world,
    fade:run=>{
      const mode=injection?.step;
      if(mode==='fade-before')return actualFade(()=>{throw Error('QA injected fade startup failure');});
      const result=actualFade(run);
      if(mode==='fade-after')return Promise.resolve(result).then(()=>{throw Error('QA injected fade completion failure');});
      return result;
    },
    onBusyChange:busy=>{busy?input.acquire():input.release();},
    onError:info=>{
      errors.push({recovered:info.recovered,fromSpace:info.fromSpace,roomId:info.roomId});
      document.getElementById('qa-message').textContent=info.recovered?'방을 전환하지 못했어요. 이전 위치에서 다시 시도해 주세요.':'방 전환을 복구하지 못했어요. 새로고침해 주세요.';
    }
  });
  rooms.onChange((state,event)=>{events.push({space:state.space,event});document.getElementById('qa-message').textContent='전환 완료 · '+location;});
  const waitReady=async()=>{const end=Date.now()+5000;while(!rooms.status().ready){if(Date.now()>end)throw Error('QA ready timeout');await new Promise(r=>setTimeout(r,20));}};
  const nested=()=>rooms.enterNested('ROOM_PERSONAL_BASIC',{fromRoomId:'ROOM_DORM1_LOBBY',returnPosition:DORM_1_LOBBY_MY_ROOM_RETURN.position,returnYaw:DORM_1_LOBBY_MY_ROOM_RETURN.yaw,isValid:()=>valid,metadata:{qaSynthetic:true}});
  const actions={enter:()=>rooms.enter('ROOM_CLUBHOUSE_01'),lobby:()=>rooms.enter('ROOM_DORM1_LOBBY'),personal:nested,exit:()=>rooms.exit()};
  const updateButtons=()=>{
    const busy=rooms.status().busy,space=rooms.currentSpace;
    document.getElementById('qa-enter').disabled=busy||space!=='campus';
    document.getElementById('qa-lobby').disabled=busy||space!=='campus';
    document.getElementById('qa-personal').disabled=busy||space!=='ROOM_DORM1_LOBBY';
    document.getElementById('qa-exit').disabled=busy||space==='campus';
    document.getElementById('qa-state').textContent=`${location} · ${busy?'SYSTEM_LOCK':'입력 복구'} · ${rooms.currentSpace}`;
  };
  for(const [action,id] of [['enter','qa-enter'],['lobby','qa-lobby'],['personal','qa-personal'],['exit','qa-exit']])document.getElementById(id).onclick=()=>{actions[action]();updateButtons();};
  const resize=()=>device.resizeCanvas(innerWidth,innerHeight); addEventListener('resize',resize); resize();
  canvas.addEventListener('webglcontextlost',()=>{qa.error='WebGL context lost';});
  app.on('update',dt=>{
    if (!rooms.status().busy) controller.update(Math.min(dt,.05),orbit.yaw);
    orbit.apply(player.getLocalPosition(),-.15);updateButtons();ticks++;
  });
  Object.assign(qa,{
    app,player,controller,orbit,rooms,focus,waitReady,
    setValid:value=>{valid=value;},
    arm(config=null){
      injection=config; valid=true;
      if(config?.step&&!config.step.startsWith('fade-')){
        const method=config.step,original=world[method];
        if(typeof original!=='function')throw Error('Unknown injection '+method);
        world[method]=(...args)=>{
          world[method]=original;original(...args);
          if(config.async)return Promise.reject(Error('QA injected async '+method));
          throw Error('QA injected '+method);
        };
      }
    },
    async prepare(space='campus'){
      injection=null;valid=true;await waitReady();
      while(rooms.currentSpace!=='campus'){rooms.exit();await waitReady();}
      if(space!=='campus'){rooms.enter('ROOM_DORM1_LOBBY');await waitReady();}
      if(space==='ROOM_PERSONAL_BASIC'){nested();await waitReady();}
      document.getElementById('qa-message').textContent='검증 준비 · '+location;
    },
    snapshot(){const p=player.getLocalPosition(),q=player.getLocalRotation();return{
      ...rooms.status(),stats:rooms.stats,position:[p.x,p.y,p.z],rotation:[q.x,q.y,q.z,q.w],parent:player.parent.name,
      campus:campusRoot.enabled,visibleRooms:[...scenes].filter(([,s])=>s.root.enabled).map(([id])=>id),
      movement:controller.space.id,inputEnabled:controller.inputEnabled,cameraEnabled:orbit.inputEnabled,
      camera:{yaw:orbit.yaw,pitch:orbit.pitch,distance:orbit.distance,indoor:Boolean(orbit.indoor),limits:orbit.indoor?.limits??null},
      touchVector:{...controller.touchVector},trustedTouches:[...trustedTouches],
      focus:focus.snapshot(),fadeHidden:overlay.hidden,fadeOn:overlay.classList.contains('on'),
      label:location,marker,campusPaused:presence.campusPaused,events:[...events],errors:[...errors],ticks,
      size:[canvas.width,canvas.height],message:document.getElementById('qa-message').textContent,
      renderer:device.deviceType,children:app.root.children.length
    };}
  });
  app.start();qa.ready=true;
}catch(error){qa.error=String(error?.stack??error);throw error;}
