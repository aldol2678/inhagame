export const POSES=Object.freeze({idle:'Idle_Breathe',walk:'Phone_Walk',call:'Phone_Call_Listen',bench:'Bench_Sit_Stand'});
export const speedFor=clip=>clip===POSES.walk?.54:0;
const RANGE=2.3, LEAVE=3.5, BENCH=4.83333334;
const dist=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const angle=(dx,dz)=>Math.atan2(dx,dz)*180/Math.PI;
const easeAngle=(x,target,dt)=>{
 const gap=((target-x+540)%360)-180;
 return x+gap*Math.min(1,dt*8);
};
const defaultRoute=[{x:2.25,z:-4.8},{x:2.1,z:-1.15},{x:3.45,z:.15},{x:3.9,z:-2.15}];
export function createScene(options={}){
 const route=(options.route??defaultRoute).map(p=>({...p}));
 if(route.length<2||route.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.z)))throw Error('sprite route needs 2 or more finite anchors');
 const walkSpeed=options.walkSpeed??speedFor(POSES.walk);
 const callPos=options.call??{x:4.7,z:1.7};
 const seat=options.seat??{x:.049,z:0,yaw:90};
 const actors={
  phone:{...route[0],yaw:angle(route[1].x-route[0].x,route[1].z-route[0].z),speed:0,state:'patrol',clip:POSES.walk,phase:1},
  call:{...callPos,yaw:-20,speed:0,state:'call',clip:POSES.call},
  bench:{x:seat.x,z:seat.z,yaw:seat.yaw??90,speed:0,state:'bench',clip:POSES.bench,elapsed:0},
 };
 let activeTalk=null,pending=null;
 const begin=id=>{const a=actors[id];pending=null;activeTalk=id;a.state='dialogue';a.speed=0;a.clip=POSES.idle};
 const restore=id=>{const a=actors[id];if(!a)return;
  if(id==='phone'){a.state='patrol';a.clip=POSES.walk;}
  if(id==='call'){a.state='call';a.clip=POSES.call;}
  if(id==='bench'){a.state='bench';a.clip=POSES.bench;a.elapsed=0;}
 };
 const dismiss=()=>{
  const id=activeTalk??pending;
  if(id==='bench'&&!activeTalk){pending=null;return;}
  activeTalk=null;pending=null;restore(id);
 };
 const interact=(id,p)=>{
  if(!actors[id]||activeTalk||pending||!p||dist(actors[id],p)>RANGE)return false;
  pending=id;
  if(id!=='bench')actors[id].state='stopping';
  if(id==='bench'&&actors.bench.elapsed>BENCH-.0001)begin('bench');
  return true;
 };
 const follow=(p,dt,stopping)=>{
  const target=route[p.phase],dx=target.x-p.x,dz=target.z-p.z,d=Math.hypot(dx,dz);
  if(d<.14&&!stopping){p.phase=(p.phase+1)%route.length;}
  if(d>.001)p.yaw=easeAngle(p.yaw,angle(dx,dz),dt);
  const goal=stopping?0:walkSpeed,diff=goal-p.speed;
  p.speed+=Math.sign(diff)*Math.min(Math.abs(diff),dt*(stopping?1.1:.85));
  const step=Math.min(d,p.speed*dt);
  if(d>.0001){p.x+=dx/d*step;p.z+=dz/d*step;}
 };
 return {actors,get activeTalk(){return activeTalk},get pendingTalk(){return pending},interact,dismiss,range:RANGE,
  update(delta,observer){
   const dt=Math.max(0,Math.min(.10,Number.isFinite(delta)?delta:0));
   const current=activeTalk??pending;
   if(current&&observer&&dist(actors[current],observer)>LEAVE)dismiss();
   const p=actors.phone,c=actors.call,b=actors.bench;
   if(p.state==='patrol'||p.state==='stopping'){
    follow(p,dt,p.state==='stopping');
    if(p.state==='stopping'&&p.speed<.001)begin('phone');
   }
   if(c.state==='stopping')begin('call');
   if(b.state==='bench'){
    b.elapsed+=dt;
    if(b.elapsed>=BENCH){
     if(pending==='bench')begin('bench');
     else {b.state='bench-rest';b.clip=POSES.idle;b.elapsed=BENCH;}
    }
   }else if(b.state==='bench-rest'&&!pending){
    b.elapsed+=dt;
    if(b.elapsed>=BENCH+3)restore('bench');
   }
   if(observer&&activeTalk){
    const a=actors[activeTalk];
    a.yaw=easeAngle(a.yaw,angle(observer.x-a.x,observer.z-a.z),dt);
   } else if(b.state!=='dialogue')b.yaw=easeAngle(b.yaw,seat.yaw??90,dt);
  }};
}
