import { BACK_GATE_FRAME } from './back-gate-layout.js';
import { PLAYER_ORIGIN_Y } from './player-dimensions.js';
import { GARDEN_PREVIEW_SPAWN, libraryGardenGroundHeight } from './library-garden-layout.js';
import { STANDS_PREVIEW_SPAWN } from './stadium-stands-layout.js';
import { CULTURE_PREVIEW_SPAWN } from './culture-street-layout.js';
import { MARKET_PREVIEWS } from './back-market-layout.js';
import { INTERIOR_PREVIEWS } from './market-interior-layout.js';
import { GAZEBO } from './landmark-detail-layout.js';
import { DORM_1_EXTERIOR_SPAWN, GATE_EXTERIOR_SPAWN } from './gate-dorm-exterior-layout.js';
import { GATE_DORM_ROUTE_SPAWN } from './main-gate-road-layout.js';
import { BIRYONG_AXIS, BIRYONG_CENTER, BIRYONG_DISCOVER_RADIUS } from './biryong/biryong-layout.js';
import { isMcm2026OutdoorPreviewRequest } from './events/zombie-university-2026/event-route.js';
import { BACK_GATE_511_PREVIEW_SPAWN } from './back-transit-stop-layout.js';

export const MAIN_GATE_SPAWN = Object.freeze({ x: 0, y: PLAYER_ORIGIN_Y, z: -98, yaw: 0 });
export const BACK_GATE_SPAWN = Object.freeze({
  ...BACK_GATE_FRAME.at(.5, 2.4),
  y: PLAYER_ORIGIN_Y,
  yaw: -BACK_GATE_FRAME.yaw * Math.PI / 180
});

export function campusSpawn({hostname='',search=''}={}){
  const requested=new URLSearchParams(search).get('spawn');
  if(requested===null&&isMcm2026OutdoorPreviewRequest({hostname,search})) return { ...BACK_GATE_SPAWN };
  if((hostname.endsWith('.vercel.app')||hostname==='localhost'||hostname==='127.0.0.1')&&requested==='inkyung-pond')
    return {x:GAZEBO.center.x-5,y:PLAYER_ORIGIN_Y,z:GAZEBO.center.z,yaw:0};
  // Preview only: on the lawn just outside the 비룡탑 discovery radius, facing the tower.
  if((hostname.endsWith('.vercel.app')||hostname==='localhost'||hostname==='127.0.0.1')&&requested==='biryong-tower'){
    const d=BIRYONG_DISCOVER_RADIUS+3,{toEcho}=BIRYONG_AXIS;
    return {x:BIRYONG_CENTER.x+toEcho.x*d,y:PLAYER_ORIGIN_Y,z:BIRYONG_CENTER.z+toEcho.z*d,yaw:Math.atan2(toEcho.x,-toEcho.z)};
  }
  if((hostname.endsWith('.vercel.app')||hostname==='localhost'||hostname==='127.0.0.1')&&requested==='back-gate-511')
    return {...BACK_GATE_511_PREVIEW_SPAWN,y:PLAYER_ORIGIN_Y};
  if(requested==='gate-dorm-route')return {...GATE_DORM_ROUTE_SPAWN,y:PLAYER_ORIGIN_Y};
  if(requested==='dorm1-exterior')return {...DORM_1_EXTERIOR_SPAWN,y:PLAYER_ORIGIN_Y};
  if(requested==='gate-exterior')return {...GATE_EXTERIOR_SPAWN,y:PLAYER_ORIGIN_Y};
  if(Object.hasOwn(INTERIOR_PREVIEWS,requested))return {...INTERIOR_PREVIEWS[requested],y:PLAYER_ORIGIN_Y};
  if(Object.hasOwn(MARKET_PREVIEWS,requested))return {...MARKET_PREVIEWS[requested],y:PLAYER_ORIGIN_Y};
  if(requested==='culture-street')return {...CULTURE_PREVIEW_SPAWN,y:PLAYER_ORIGIN_Y};
  if(requested==='stadium-stands')return {...STANDS_PREVIEW_SPAWN,y:PLAYER_ORIGIN_Y};
  if(requested==='library-garden')return {...GARDEN_PREVIEW_SPAWN,y:PLAYER_ORIGIN_Y+libraryGardenGroundHeight(GARDEN_PREVIEW_SPAWN.x,GARDEN_PREVIEW_SPAWN.z)};
  const backPreview=hostname==='inhagame-campus-p0-git-feat-back-gate-streetscape-aldol.vercel.app';
  const back=requested==='back-gate'||(requested===null&&backPreview);
  return back ? { ...BACK_GATE_SPAWN } : { ...MAIN_GATE_SPAWN };
}

