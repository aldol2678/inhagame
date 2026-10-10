// Social S1-D1.3 · DORM_1_BASIC template renderer.
// Fixed template fixtures and a separate Collection-owned placement layer.

import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { PERSONAL_ROOM_BASIC, PERSONAL_ROOM_BASIC_FURNITURE } from "./personal-room-layout.js";
import { createPersonalRoomShell } from "./personal-room-shell-renderer.js";
import { createPersonalRoomFloorMaterial } from "./personal-room-floor-material.js";
import { createFurnitureLayer } from "./furniture-renderer.js";
import { createPersonalRoomChairModel } from "./personal-room-chair-model.js";
import { createPersonalRoomDecor } from "./personal-room-decor-renderer.js";

const {ceiling:H}=PERSONAL_ROOM_BASIC;
function glow(hex,intensity=1){
  const n=parseInt(hex.slice(1),16);
  const c=new pc.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255);
  const m=new pc.StandardMaterial();m.diffuse=c;m.emissive=c;m.emissiveIntensity=intensity;m.update();return m;
}
function group(root,name,[x,y,z]){const e=new pc.Entity(name);e.setLocalPosition(x,y,z);root.addChild(e);return e;}
function furniture(root,item,app){
  const g=group(root,"personal_"+item.id,item.at);const [w,h,d]=item.size;
  if(item.kind==="bed"){
    box(g,"frame",[0,0.16,0],[w,0.28,d],surface("#8a6a4a"));
    box(g,"mattress",[0,0.34,0],[w-0.12,0.18,d-0.18],surface("#e8e5dc"));
    box(g,"pillow",[0,0.46,d/2-0.38],[w*0.62,0.1,0.48],surface("#fafafa"));
  }else if(item.kind==="desk"){
    box(g,"top",[0,h-0.03,0],[w,0.06,d],surface("#9a714a"));
    for(const s of [-1,1])box(g,"leg",[s*(w/2-0.08),h/2-0.03,0],[0.08,h-0.06,0.08],surface("#5b4635"));
    box(g,"laptop",[0.35,h+0.03,0],[0.42,0.03,0.28],surface("#cfd6de"));
  }else if(item.kind==="chair"){
    const fallback=group(g,"chair_fallback",[0,0,0]);
    box(fallback,"seat",[0,0.24,0],[w,0.06,d],surface("#60758a"));
    box(fallback,"back",[0,0.46,d/2-0.05],[w,0.4,0.08],surface("#60758a"));
    return createPersonalRoomChairModel({app,root,anchor:g,fallback});
  }else if(item.kind==="bookshelf"){
    box(g,"body",[0,h/2,0],[w,h,d],surface("#6b4a31"));
    for(let i=1;i<4;i++)box(g,"shelf",[0,i*h/4,0],[w-0.05,0.04,d-0.05],surface("#9a714a"));
  }else if(item.kind==="rug"){
    box(g,"rug",[0,0.008,0],[w,0.016,d],surface("#6f8793"));
  }else if(item.kind==="plant"){
    box(g,"pot",[0,0.13,0],[0.32,0.26,0.32],surface("#b5643c"),0,"cylinder");
    box(g,"leaves",[0,0.5,0],[0.46,0.54,0.46],surface("#4f8c47"),0,"sphere");
  }
}
export function createPersonalRoomScene(app){
  const root=new pc.Entity("Room_ROOM_PERSONAL_BASIC");root.setLocalScale(1,1,-1);
  const { floor } = createPersonalRoomShell(root);
  const floorMaterial = createPersonalRoomFloorMaterial({ app, root, floor });
  const fixtureLoaders=[];
  for(const item of PERSONAL_ROOM_BASIC_FURNITURE){
    const ensureModel=furniture(root,item,app);
    if(ensureModel)fixtureLoaders.push(ensureModel);
  }
  for(const x of [-2.2,2.2])box(root,"light_panel",[x,H-0.015,0],[1.1,0.03,0.5],glow("#fff4dc",0.55));
  const lights=[];
  for(const [name,x] of [["personal_light_w",-2.2],["personal_light_e",2.2]]){
    const e=new pc.Entity(name);e.addComponent("light",{type:"omni",color:new pc.Color(1,0.92,0.82),intensity:0.7,range:7,castShadows:false});e.setLocalPosition(x,H-0.25,0);root.addChild(e);lights.push(e);
  }
  root.enabled=false;app.root.addChild(root);
  const ownedFurniture = createFurnitureLayer(app,root);
  const decor = createPersonalRoomDecor(app,root,ownedFurniture.obstacles);
  const setOwnedObjects = ownedFurniture.setObjects;
  ownedFurniture.setObjects = objects => {
    setOwnedObjects(objects);
    decor.update(objects);
  };
  decor.update([]);
  const ensureVisualAssets = () => Promise.all([...fixtureLoaders.map(ensure => ensure()),decor.ensureVisualAssets(),floorMaterial.ensureVisual()]);
  return {root,lights,ownedFurniture,ensureVisualAssets,onDeactivate:floorMaterial.deactivate,obstacles:ownedFurniture.obstacles,ambient:new pc.Color(0.43,0.41,0.39),clearColor:new pc.Color(0.17,0.16,0.15)};
}
