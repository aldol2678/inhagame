import * as pc from "playcanvas";
import { box, surface } from "../../campus-render-kit.js";
import { MCM_2026_ROOM, MCM_2026_ROOM_FURNITURE } from "./minigame-room-layout.js";

const {halfWidth:W,halfDepth:D,ceiling:H,wall:T,door:DOOR}=MCM_2026_ROOM;

function glow(hex,intensity=1){
  const n=parseInt(hex.slice(1),16),c=new pc.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255);
  const m=new pc.StandardMaterial();m.diffuse=c;m.emissive=c;m.emissiveIntensity=intensity;m.update();return m;
}
function piece(root,item){
  const [x,y,z]=item.at,[w,h,d]=item.size,g=new pc.Entity(`mcm_room_${item.id}`);
  g.setLocalPosition(x,y,z);root.addChild(g);
  const mat=surface(item.color);
  if(item.kind==="stage"){
    box(g,"stage",[0,h/2,0],[w,h,d],mat);
    box(g,"stage_front",[0,h*.55,-d/2-.015],[w-.25,h*.55,.03],surface("#ab3154"));
  }else if(item.kind==="counter"){
    box(g,"body",[0,h/2,0],[w,h,d],mat);
    box(g,"top",[0,h+.035,0],[w+.08,.07,d+.08],surface("#65565d"));
  }else if(item.kind==="crate"){
    box(g,"crate",[0,h/2,0],[w,h,d],mat);
    box(g,"strap_x",[0,h/2,0],[w+.015,.06,d+.02],surface("#3b2b22"));
    box(g,"strap_z",[0,h/2,0],[.06,h+.01,d+.02],surface("#3b2b22"));
  }else{
    box(g,"poster",[0,0,0],[w,h,d],mat);
    box(g,"poster_mark",[item.at[0]<0?.018:-.018,.05,0],[.012,.42,.3],glow("#f3dce2",.8));
  }
}
export function createMcm2026RoomScene(app){
  const root=new pc.Entity("Room_ROOM_ZOMBIE_UNIVERSITY_2026");
  root.setLocalScale(1,1,-1);
  box(root,"floor",[0,-.05,0],[2*W+2*T,.1,2*D+2*T],surface("#26262b"));
  box(root,"ceiling",[0,H+.05,0],[2*W+2*T,.1,2*D+2*T],surface("#17171a"));
  box(root,"wall_north",[0,H/2,D+T/2],[2*W+2*T,H,T],surface("#261b20"));
  box(root,"wall_south",[0,H/2,-D-T/2],[2*W+2*T,H,T],surface("#211b1e"));
  box(root,"wall_west",[-W-T/2,H/2,0],[T,H,2*D],surface("#231b20"));
  box(root,"wall_east",[W+T/2,H/2,0],[T,H,2*D],surface("#231b20"));
  box(root,"exit_frame",[DOOR.x,DOOR.height/2,-D+.025],[DOOR.width+.16,DOOR.height+.1,.05],surface("#86334d"));
  box(root,"exit_leaf",[DOOR.x,DOOR.height/2,-D+.055],[DOOR.width-.05,DOOR.height-.04,.04],surface("#3b292f"));
  box(root,"exit_sign",[0,DOOR.height+.16,-D+.04],[.65,.12,.025],glow("#e85a79",1.1));
  for(const item of MCM_2026_ROOM_FURNITURE)piece(root,item);
  box(root,"event_banner",[0,1.16,D-.025],[3.8,.34,.025],surface("#6e1935"));
  box(root,"event_banner_line",[0,1.16,D-.042],[3.15,.055,.012],glow("#f3c6d1",1.1));
  for(const x of [-3.1,0,3.1])box(root,`floor_mark_${x}`,[x,.006,.1],[.95,.012,.95],surface("#3a3035"),0,"cylinder");
  const lights=[];
  const addLight=(name,[x,y,z],color,intensity,range)=>{
    const e=new pc.Entity(name);e.addComponent("light",{type:"omni",color:new pc.Color(...color),intensity,range,castShadows:false});
    e.setLocalPosition(x,y,z);root.addChild(e);lights.push(e);
  };
  addLight("mcm_red",[-3.2,H-.2,1.4],[1,.25,.35],1.05,7);
  addLight("mcm_fill",[0,H-.25,-.4],[.72,.78,.9],.7,8);
  addLight("mcm_red_2",[3.2,H-.2,1.4],[1,.25,.35],1.05,7);
  root.enabled=false;app.root.addChild(root);
  return {root,lights,ambient:new pc.Color(.31,.24,.28),clearColor:new pc.Color(.07,.055,.065)};
}
