import { PLAYER_ORIGIN_Y, WALK_SHAPE } from "../../player-dimensions.js";

export const MCM_2026_ROOM_ID = "ROOM_ZOMBIE_UNIVERSITY_2026";

export const MCM_2026_ROOM = Object.freeze({
  halfWidth: 5.2,
  halfDepth: 3.8,
  ceiling: 1.75,
  wall: 0.28,
  door: Object.freeze({ x: 0, width: 1.15, height: 1.18 }),
  camera: Object.freeze({ min: 2.2, max: 5.4, initial: 4.1 })
});

const { halfWidth: W, halfDepth: D, ceiling: H, wall: T } = MCM_2026_ROOM;
const boxOf=(id,minX,maxX,minZ,maxZ,minY,maxY)=>Object.freeze({id,minX,maxX,minZ,maxZ,minY,maxY});

export const MCM_2026_ROOM_SPAWN = Object.freeze({
  position: Object.freeze({ x: 0, y: PLAYER_ORIGIN_Y, z: -2.45 }),
  yaw: 0
});
export const MCM_2026_ROOM_EXIT = Object.freeze({
  id: "MCM_2026_ROOM_EXIT",
  position: Object.freeze({ x: 0, z: -D + .32 }),
  radius: 1.0
});

export const MCM_2026_ROOM_FURNITURE = Object.freeze([
  { id:"stage",kind:"stage",at:[0,0,D-.8],size:[4.8,.22,1.05],color:"#5f1b2d",collide:true },
  { id:"counter_w",kind:"counter",at:[-4.35,0,.25],size:[.95,.62,2.25],color:"#3c3437",collide:true },
  { id:"counter_e",kind:"counter",at:[4.35,0,.25],size:[.95,.62,2.25],color:"#3c3437",collide:true },
  { id:"crate_w",kind:"crate",at:[-3.4,0,2.15],size:[.75,.55,.75],color:"#79553b",collide:true },
  { id:"crate_e",kind:"crate",at:[3.45,0,2.05],size:[.7,.5,.7],color:"#79553b",collide:true },
  { id:"poster_w",kind:"poster",at:[-W+.03,.9,-1.2],size:[.03,.85,.7],color:"#7d1734",collide:false },
  { id:"poster_e",kind:"poster",at:[W-.03,.9,-1.2],size:[.03,.85,.7],color:"#7d1734",collide:false }
]);

const footprint=item=>{
  const [x,,z]=item.at, turned=Math.abs((item.yaw??0)%180)===90;
  const sx=turned?item.size[2]:item.size[0], sz=turned?item.size[0]:item.size[2];
  return {minX:x-sx/2,maxX:x+sx/2,minZ:z-sz/2,maxZ:z+sz/2};
};

export const MCM_2026_ROOM_OBSTACLES = Object.freeze([
  boxOf("mcm_wall_south",-W-T,W+T,-D-T,-D,0,H+.4),
  boxOf("mcm_wall_north",-W-T,W+T,D,D+T,0,H+.4),
  boxOf("mcm_wall_west",-W-T,-W,-D-T,D+T,0,H+.4),
  boxOf("mcm_wall_east",W,W+T,-D-T,D+T,0,H+.4),
  boxOf("mcm_ceiling",-W-T,W+T,-D-T,D+T,H,H+.25),
  ...MCM_2026_ROOM_FURNITURE.filter(item=>item.collide).map(item=>{
    const p=footprint(item);
    return boxOf(`mcm_${item.id}`,p.minX,p.maxX,p.minZ,p.maxZ,0,item.at[1]+item.size[1]);
  })
]);

export const MCM_2026_ROOM_BOUNDS = Object.freeze({
  minX:-W+WALK_SHAPE.radius,maxX:W-WALK_SHAPE.radius,
  minZ:-D+WALK_SHAPE.radius,maxZ:D-WALK_SHAPE.radius
});

export const MCM_2026_MINIGAME_POINTS = Object.freeze([
  Object.freeze({x:-3.15,z:-1.6}),
  Object.freeze({x:-1.55,z:1.2}),
  Object.freeze({x:0,z:.15}),
  Object.freeze({x:1.65,z:1.35}),
  Object.freeze({x:3.1,z:-1.55})
]);
