// Deterministic inputs to the original controller, collision and grounding only.
import { PlayerController } from '../../src/player-controller.js';
import { OBSTACLES } from '../../src/campus-layout.js';
import { canOccupy } from '../../src/world-collision.js';
import { roadviewGroundHeight } from '../../src/roadview-layout.js';
import { roadRoutes } from './backgate-road-qa-plan.mjs';
const fields=['inputEnabled','velocityY','grounded','jumpQueued','ascendHeld','descendHeld','touchSprint','assist','moving','lastGroundMove','groundMovementLocks'];
export function runBackgateRoadWalking(d){
  const c=d.controller,p=d.player;
  if(!(c instanceof PlayerController)||c.entity!==p||c.mounted||c.space?.id!=='campus'||c.space.groundHeight!==roadviewGroundHeight||(c.space.obstacles!==undefined&&c.space.obstacles!==OBSTACLES))throw Error('Original campus controller, obstacles and ground required');
  const saved=Object.fromEntries(fields.map(k=>[k,c[k]])),pos={...p.getLocalPosition()},rotation={...p.getLocalEulerAngles()},keys=[...c.keys],touch={...c.touchVector};
  const report={inputMode:'deterministic-controller-touch-vector',dt:1/60,scope:'Eight representative crossing/gate paths; not visual or physical-device evidence',cases:[],passed:false};
  try{
    c.inputEnabled=true;c.groundMovementLocks=new Set();c.keys.clear();c.assist=null;c.jumpQueued=c.ascendHeld=c.descendHeld=c.touchSprint=false;
    for(const route of roadRoutes()){
      const receipt={id:route.id,ticks:0,maxFootError:0,trace:[],passed:false};report.cases.push(receipt);
      const record=()=>{const q={...p.getLocalPosition()},ground=roadviewGroundHeight(q.x,q.z);receipt.maxFootError=Math.max(receipt.maxFootError,Math.abs(q.y-c.groundY-ground));receipt.trace.push(q);if(![q.x,q.y,q.z].every(Number.isFinite)||!canOccupy(q)||receipt.maxFootError>1e-6)throw Error(route.id+' lost clearance or grounding');};
      c.velocityY=0;c.grounded=true;c.jumpQueued=false;p.setLocalPosition(route.start.x,c.groundY+roadviewGroundHeight(route.start.x,route.start.z),route.start.z);record();
      const distance=Math.hypot(route.target.x-route.start.x,route.target.z-route.start.z),limit=Math.ceil(distance/c.walkSpeed*60)+120;
      for(let i=0;i<limit;i++){
        const q=p.getLocalPosition(),dx=route.target.x-q.x,dz=route.target.z-q.z,n=Math.hypot(dx,dz);if(n<.005)break;
        const scale=Math.min(1,n/(c.walkSpeed/60))/n;c.touchVector.x=dx*scale;c.touchVector.y=-dz*scale;c.update(1/60,0);receipt.ticks++;record();
      }
      c.touchVector.x=c.touchVector.y=0;const q=p.getLocalPosition();receipt.remaining=Math.hypot(q.x-route.target.x,q.z-route.target.z);
      if(!receipt.ticks||receipt.remaining>=.005)throw Error(route.id+' did not complete');receipt.passed=true;
    }
    report.passed=report.cases.length===8&&report.cases.every(q=>q.passed);return report;
  }finally{Object.assign(c,saved);c.keys.clear();keys.forEach(k=>c.keys.add(k));Object.assign(c.touchVector,touch);p.setLocalPosition(pos.x,pos.y,pos.z);p.setLocalEulerAngles(rotation.x,rotation.y,rotation.z);}
}
