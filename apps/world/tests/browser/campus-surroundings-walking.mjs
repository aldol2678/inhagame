// Offline QA only. Runs the real controller and seat interaction, never a
// replacement movement model. Call after pausing the fixture's app update loop.
import { PlayerController } from '../../src/player-controller.js';
import { SEAT_ANCHORS } from '../../src/seat-anchors.js';
import { createSeatInteraction } from '../../src/seat-interaction.js';
import { MAIN_HALL_WALKWAYS } from '../../src/main-hall-walkway-layout.js';
import { FISHING_SPOTS } from '../../src/activity/fishing-spots.js';
import { roadviewGroundHeight } from '../../src/roadview-layout.js';
import { canOccupy } from '../../src/world-collision.js';

const DT=1/60,distance=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const finitePoint=p=>[p.x,p.y,p.z].every(Number.isFinite);
const fields=['inputEnabled','velocityY','grounded','jumpQueued','ascendHeld','descendHeld','touchSprint','assist','moving','lastGroundMove','groundMovementLocks'];
export function surroundingsBaselinePlan(changed,{enabled=true}={}){
  if(!enabled)return null;
  const prefix='apps/world/src/',replace=['campus-chunk-renderer.js','campus-grounds.js','minimap/minimap-data.js','navigation/campus-navigation.js'].map(p=>prefix+p);
  const added=['main-hall-walkway-geometry.js','main-hall-walkway-layout.js','pond-surroundings-geometry.js'].map(p=>prefix+p);
  const expected=[...replace,...added].sort(),actual=[...new Set(changed)].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw Error('Surroundings runtime comparison scope changed');
  return {replace,added};
}
export function runSurroundingsWalking({controller:c,player}){
  if(!(c instanceof PlayerController)||c.entity!==player||c.mounted)throw Error('Actual unmounted campus controller required');
  const saved=Object.fromEntries(fields.map(k=>[k,c[k]])),keys=c.keys,keyValues=[...keys],touch=c.touchVector,touchValues={...touch};
  const original={...player.getLocalPosition()},rotation=player.getLocalEulerAngles?.();
  const report={inputMode:'deterministic-controller-touch-vector',dt:DT,fixtureSideEffect:'local shuttle simulation clock advances',cases:[],passed:false};
  const place=p=>{player.setLocalPosition(p.x,c.groundY+roadviewGroundHeight(p.x,p.z),p.z);c.velocityY=0;c.grounded=true;c.jumpQueued=false;};
  const walk=(target,receipt)=>{
    if(!finitePoint(player.getLocalPosition())||![target.x,target.z].every(Number.isFinite))throw Error('Non-finite movement endpoint');
    const limit=Math.ceil(distance(player.getLocalPosition(),target)/(c.walkSpeed*DT))+120;
    receipt.ticks=0;receipt.maxFootError=0;
    for(let i=0;i<limit;i++){
      const p=player.getLocalPosition();if(!finitePoint(p))throw Error('Non-finite actor position');
      const left=distance(p,target);if(left<.005)break;
      const throttle=Math.min(1,left/(c.walkSpeed*DT));touch.x=(target.x-p.x)/left*throttle;touch.y=-(target.z-p.z)/left*throttle;
      c.update(DT,0);receipt.ticks++;
      const next=player.getLocalPosition();if(!finitePoint(next))throw Error('Non-finite actor position');
      receipt.maxFootError=Math.max(receipt.maxFootError,Math.abs(next.y-c.groundY-roadviewGroundHeight(next.x,next.z)));
      if(!Number.isFinite(receipt.maxFootError))throw Error('Non-finite ground error');
      if(!canOccupy(next)||receipt.maxFootError>1e-6)throw Error('Actor left the existing clear ground');
    }
    touch.x=0;touch.y=0;receipt.end={...player.getLocalPosition()};receipt.remaining=distance(receipt.end,target);
    if(!finitePoint(receipt.end)||!Number.isFinite(receipt.remaining))throw Error('Non-finite final actor state');
    if(receipt.remaining>=.005)throw Error('Actor stalled before the destination');
  };
  const routes=MAIN_HALL_WALKWAYS.flatMap(q=>[
    {id:q.id+':in',kind:'walkway',start:q.frame.at(-.6),end:q.frame.at(q.frame.length+.6)},
    {id:q.id+':out',kind:'walkway',start:q.frame.at(q.frame.length+.6),end:q.frame.at(-.6)}
  ]);
  for(const spot of FISHING_SPOTS){const dx=Math.cos(spot.facingYaw),dz=-Math.sin(spot.facingYaw);
    routes.push({id:spot.sourceRef,kind:'fishing',start:{x:spot.position.x-dx,z:spot.position.z-dz},end:{x:spot.position.x+dx,z:spot.position.z+dz}});
  }
  try{
    c.inputEnabled=true;c.groundMovementLocks=new Set();c.ascendHeld=false;c.descendHeld=false;c.touchSprint=false;c.assist=null;keys.clear();touch.x=0;touch.y=0;
    for(const q of routes){const receipt={id:q.id,kind:q.kind,passed:false};report.cases.push(receipt);
      try{place(q.start);if(!canOccupy(player.getLocalPosition()))throw Error('Start overlaps existing obstacle');walk(q.end,receipt);receipt.passed=true;}catch(error){receipt.error=String(error.message||error);}
    }
    for(const anchor of SEAT_ANCHORS.filter(a=>a.id.startsWith('SEAT_INKYUNG_TREE_'))){
      const receipt={id:anchor.id,kind:'seat',passed:false};report.cases.push(receipt);
      try{
        place(anchor.standPoint);const seating=createSeatInteraction({player,controller:c,places:{getCurrentPlaceZone:()=>({id:anchor.placeZoneId})}});
        if(!seating.sitDown(anchor)||distance(player.getLocalPosition(),anchor.position)>1e-8)throw Error('Seat did not align');
        receipt.seatedY=player.getLocalPosition().y;
        if(!seating.standUp('surroundings-qa'))throw Error('Seat did not release');
        const d=distance(anchor.position,anchor.standPoint),dx=(anchor.standPoint.x-anchor.position.x)/d,dz=(anchor.standPoint.z-anchor.position.z)/d;
        walk({x:anchor.standPoint.x+dx*.35,z:anchor.standPoint.z+dz*.35},receipt);receipt.passed=true;
      }catch(error){receipt.error=String(error.message||error);}
    }
    report.passed=report.cases.every(c=>c.passed);return report;
  }finally{
    Object.assign(c,saved);keys.clear();for(const key of keyValues)keys.add(key);Object.assign(touch,touchValues);
    player.setLocalPosition(original.x,original.y,original.z);if(rotation)player.setLocalEulerAngles(rotation.x,rotation.y,rotation.z);
  }
}
