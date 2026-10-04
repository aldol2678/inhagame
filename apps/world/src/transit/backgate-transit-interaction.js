import { BACKGATE_TRANSIT, inTransitSidewalk } from './backgate-transit-layout.js';
import { PLAYER_ORIGIN_Y } from '../player-dimensions.js';

export const BACKGATE_TRANSIT_CONTEXT_PRIORITY = 180; // NPC/seat/Follow/shop outrank stop information.
export function createBackgateTransitInteraction({getPosition,getState,getGroundHeight,openPanel} = {}) {
  if (![getPosition,getState,getGroundHeight,openPanel].every(x=>typeof x==='function'))throw new TypeError('Transit interaction dependencies required');
  let nearby=false,distance=Infinity;
  function eligible(p,s={}) {
    distance=p&&[p.x,p.y,p.z].every(Number.isFinite)?Math.hypot(p.x-BACKGATE_TRANSIT.pole.x,p.z-BACKGATE_TRANSIT.pole.z):Infinity;
    if(distance>BACKGATE_TRANSIT.interactionRadius||!inTransitSidewalk(p)||s.grounded!==true||s.blocked!==false)return false;
    const ground=getGroundHeight(p.x,p.z);
    return Number.isFinite(ground)&&Math.abs(p.y-ground-PLAYER_ORIGIN_Y)<.15;
  }
  function open() {
    // Re-read position, focus and mount state at trigger time, not from an old HUD candidate.
    if(!eligible(getPosition(),getState()))return false;
    return openPanel()===true;
  }
  return {
    observe(p,s) {
      nearby=eligible(p,s);
      return nearby?{id:'backgate-transit',icon:'🚌',label:'후문 정류장 보기',compactLabel:'정류장',shortcut:'F',priority:BACKGATE_TRANSIT_CONTEXT_PRIORITY,distance,disabled:false,trigger:open}:null;
    },open,
    status:()=>({nearby,distance:Number.isFinite(distance)?distance:null,gameStatus:BACKGATE_TRANSIT.gameStatus})
  };
}
