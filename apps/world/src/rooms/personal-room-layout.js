// Social S1-D1.3 · DORM_1_BASIC personal room template.
// One scene template is reused for every account; persistent identity comes from the server room UUID.

import { PLAYER_ORIGIN_Y, WALK_SHAPE } from "../player-dimensions.js";

export const PERSONAL_ROOM_BASIC=Object.freeze({
  // C · Creative / Open Creator runtime shell. 7.14 / 4.2 = 1.70 exactly.
  // These remain world units, not surveyed physical metres.
  halfWidth:7.14,
  halfDepth:4.2,
  aspectRatio:1.70,
  ceiling:2.15,
  wall:0.32,
  camera:Object.freeze({initial:2.7,min:1.2,max:4.2}),
  door:Object.freeze({x:0,width:1.2,height:1.22})
});

// H2 persistence compatibility: existing saved coordinates remain valid. Housing F0 widens only
// the floor placement envelope to the C70 shell; legacy east/west wall anchors remain unchanged
// until a dedicated wall-placement migration can move persisted wall objects safely.
export const PERSONAL_ROOM_PLACEMENT_ENVELOPE=Object.freeze({
  floor:Object.freeze({minX:-7.04,maxX:7.04,minZ:-4.1,maxZ:4.1}),
  exit:Object.freeze({minX:-.9,maxX:.9,minZ:-4.2,maxZ:-2.25}),
  wall:Object.freeze({northZ:4.15,southZ:-4.15,eastX:5.35,westX:-5.35,maxX:5.3,maxZ:4.1})
});
const {halfWidth:W,halfDepth:D,ceiling:H,wall:T}=PERSONAL_ROOM_BASIC;

export const PERSONAL_ROOM_BASIC_SPAWN=Object.freeze({
  position:Object.freeze({x:0,y:PLAYER_ORIGIN_Y,z:-2.65}),
  yaw:0
});
export const PERSONAL_ROOM_BASIC_EXIT=Object.freeze({
  id:"PERSONAL_ROOM_BASIC_EXIT",
  position:Object.freeze({x:0,z:-D+0.34}),
  radius:1.0
});
export const PERSONAL_ROOM_BASIC_FURNITURE=Object.freeze([
  {id:"bed",kind:"bed",at:[-3.8,0,1.9],size:[1.6,0.42,2.7],collide:true},
  {id:"desk",kind:"desk",at:[2.95,0,1.7],size:[1.9,0.48,0.75],collide:true},
  {id:"chair",kind:"chair",at:[2.95,0,0.85],size:[0.55,0.5,0.55],collide:false},
  {id:"bookshelf",kind:"bookshelf",at:[4.65,0,2.15],size:[0.6,1.25,1.5],collide:true},
  {id:"rug",kind:"rug",at:[0,0,0.65],size:[2.8,0.01,2.1],collide:false},
  {id:"plant",kind:"plant",at:[4.5,0,-2.9],size:[0.45,0.8,0.45],collide:true}
]);

const boxOf=(id,minX,maxX,minZ,maxZ,minY,maxY)=>Object.freeze({id,minX,maxX,minZ,maxZ,minY,maxY});
const footprint=item=>({minX:item.at[0]-item.size[0]/2,maxX:item.at[0]+item.size[0]/2,minZ:item.at[2]-item.size[2]/2,maxZ:item.at[2]+item.size[2]/2});

export const PERSONAL_ROOM_BASIC_OBSTACLES=Object.freeze([
  boxOf("personal_wall_south",-W-T,W+T,-D-T,-D,0,H+0.4),
  boxOf("personal_wall_north",-W-T,W+T,D,D+T,0,H+0.4),
  boxOf("personal_wall_west",-W-T,-W,-D-T,D+T,0,H+0.4),
  boxOf("personal_wall_east",W,W+T,-D-T,D+T,0,H+0.4),
  boxOf("personal_ceiling",-W-T,W+T,-D-T,D+T,H,H+0.3),
  ...PERSONAL_ROOM_BASIC_FURNITURE.filter(x=>x.collide).map(item=>{
    const p=footprint(item);
    return boxOf("personal_"+item.id,p.minX,p.maxX,p.minZ,p.maxZ,0,item.at[1]+item.size[1]);
  })
]);

export const PERSONAL_ROOM_BASIC_BOUNDS=Object.freeze({
  minX:-W+WALK_SHAPE.radius,maxX:W-WALK_SHAPE.radius,
  minZ:-D+WALK_SHAPE.radius,maxZ:D-WALK_SHAPE.radius
});
