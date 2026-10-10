// PERSONAL-ROOM-V2 PR A · C70 visual shell.
// Shell geometry follows the C · Creative / Open Creator 1.70:1 runtime bounds.
// Furniture persistence and placement authority stay in H2 and are intentionally separate.

import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { PERSONAL_ROOM_BASIC } from "./personal-room-layout.js";

function glow(hex,intensity=1){
  const n=parseInt(hex.slice(1),16);
  const c=new pc.Color((n>>16&255)/255,(n>>8&255)/255,(n&255)/255);
  const m=new pc.StandardMaterial();m.diffuse=c;m.emissive=c;m.emissiveIntensity=intensity;m.update();return m;
}

export function createPersonalRoomShell(root){
  const {halfWidth:W,halfDepth:D,ceiling:H,wall:T,door}=PERSONAL_ROOM_BASIC;
  const wall=surface("#ece7dc"),trim=surface("#756a60");
  const floor=box(root,"floor",[0,-0.05,0],[2*W+2*T,0.1,2*D+2*T],surface("#b99168"));
  box(root,"ceiling",[0,H+0.05,0],[2*W+2*T,0.1,2*D+2*T],surface("#f2f0ea"));
  box(root,"wall_north",[0,H/2,D+T/2],[2*W+2*T,H,T],wall);
  box(root,"wall_south",[0,H/2,-D-T/2],[2*W+2*T,H,T],wall);
  box(root,"wall_west",[-W-T/2,H/2,0],[T,H,2*D],wall);
  box(root,"wall_east",[W+T/2,H/2,0],[T,H,2*D],wall);

  // Low baseboards make the wider C-shell read as one intentional room rather than
  // a stretched primitive box. They are visual-only and add no gameplay collision.
  box(root,"baseboard_north",[0,.055,D-.015],[2*W,.11,.03],trim);
  box(root,"baseboard_south",[0,.055,-D+.015],[2*W,.11,.03],trim);
  box(root,"baseboard_west",[-W+.015,.055,0],[.03,.11,2*D],trim);
  box(root,"baseboard_east",[W-.015,.055,0],[.03,.11,2*D],trim);

  box(root,"door_frame",[door.x,door.height/2+0.03,-D+0.02],[door.width+0.16,door.height+0.08,0.05],trim);
  box(root,"door",[door.x,door.height/2,-D+0.05],[door.width,door.height,0.04],surface("#7d5c3e"));
  box(root,"window",[0.5,1.18,D-0.025],[2.6,0.75,0.03],glow("#cfe9ff",0.45));
  return { floor };
}
