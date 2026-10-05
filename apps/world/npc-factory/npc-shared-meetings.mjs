// Presentation of existing NG1 groups on the common world timeline. No local storage,
// player proximity, RNG or frame delta participates in group/motion/dialogue decisions.
import { createNpcSocialNg1Model } from './npc-social-ng1.mjs';
import { createPersistentNpcSocialGraph } from './npc-social-graph.mjs';
import { positionAt } from './dev-runtime-state.mjs';
import { worldScheduleAt, NPC_WORLD_EPOCH_MS, NPC_WORLD_PERIOD_MS, NPC_SCHEDULE_REVISION } from './npc-world-time-contract.mjs';
import { OBSERVED_TEMPLATES, observedPlace, renderObservedTemplate } from './npc-observed-templates.mjs';
import { OBSERVED_POLICY } from './npc-observed-conversation.mjs';

export const SHARED_MEETING_POLICY = Object.freeze({ dwell: 60, travel: 90, lineSeconds: 3.6,
  dialogueDelay: 15, repeatSeconds: 300, seedTicks: 120 });
const distance = (a,b) => Math.hypot(a.x-b.x,a.z-b.z);
const safeActivities = new Set(['RESTING','READING','COFFEE','EATING','PHOTO','PHONE','WAITING','TRANSIT','WALK_BREAK','MUSIC','CLUB']);
function compileRoute(from,to,navigator,speed) {
  if (distance(from,to)/speed > SHARED_MEETING_POLICY.travel) return null;
  const points = navigator.networkRoute?.(from,to) ?? navigator.route(from,to);
  if (!points) return null;
  const segments=[]; let previous=from,total=0;
  for(const p of points){const length=distance(previous,p);if(length>0)segments.push({from:previous,to:p,start:total,length});total+=length;previous=p;}
  if(distance(previous,to)>.01 || total/speed>SHARED_MEETING_POLICY.travel) return null;
  return { from,to,segments,duration:total/speed,speed };
}
function along(route,seconds) {
  const progress=Math.max(0,seconds)*route.speed;let heading=0;
  for(const s of route.segments){heading=Math.atan2(s.to.x-s.from.x,s.to.z-s.from.z)*180/Math.PI;
    if(progress<s.start+s.length){const t=Math.max(0,(progress-s.start)/s.length);return {position:{x:s.from.x+(s.to.x-s.from.x)*t,z:s.from.z+(s.to.z-s.from.z)*t},heading};}}
  return {position:{...route.to},heading};
}
export function createSharedMeetings({batch,profiles,roster,navigator,now,positionAtFn=positionAt,groups: suppliedGroups=null}) {
  const canonicalBatch={...batch,npcs:[...batch.npcs].sort((a,b)=>a.npc_id.localeCompare(b.npc_id))};
  // Replay a bounded, revisioned NG1 seed snapshot; never import one player's learned bonds.
  const graph=createPersistentNpcSocialGraph(canonicalBatch,profiles,NPC_SCHEDULE_REVISION,null);
  const model=suppliedGroups ? null : createNpcSocialNg1Model(canonicalBatch,{relationshipGraph:graph});
  model?.advanceTicks(SHARED_MEETING_POLICY.seedTicks);
  const groups=(suppliedGroups ?? model.snapshot().groups).filter(g=>g.status==='ACTIVE' && g.meetingPlaceRef)
    .sort((a,b)=>a.groupId.localeCompare(b.groupId));
  const profileById=new Map(profiles.npcs.map(n=>[n.npc_id,n]));
  const npcById=new Map(batch.npcs.map(n=>[n.npc_id,n]));
  const base=new Map([...roster].map(([id,m])=>[id,m.controller]));
  const canMeet = (id, state, index) => !roster.get(id)?.schedule[index].walkDestination &&
    state.visible && !state.moving && !state.transfer && safeActivities.has(state.activity);
  const cache=new Map();
  function plansFor(index) {
    if(cache.has(index))return cache.get(index);
    const plans=[];cache.set(index,plans);
    const periodStart=NPC_WORLD_EPOCH_MS+index*NPC_WORLD_PERIOD_MS;
    const occupied=[...base.values()].map(c=>c.sample(periodStart+899000)).filter(s=>s.visible).map(s=>s.position);
    // The stationary quest NPC owns the photo point's first slot.
    occupied.push(positionAtFn('inkyung_photo_point',0));
    const used=new Set();
    for(const [ordinal,g] of groups.entries()) {
      const depart=index===1 ? 420+ordinal*90 : 180+ordinal*120;
      const locations=[g.meetingPlaceRef,...new Set(g.memberNpcIds.filter(id=>base.has(id)).map(id=>{
        const s=base.get(id).sample(periodStart+depart*1000);
        return canMeet(id,s,index)
          ? s.destination.replace(/^c04\./,'').replace(`.${id}`,'') : null;
      }).filter(Boolean))];
      for (const location of locations) {
      const center=positionAtFn(location,0);
      if(!center)continue;
      const spots=[];
      for(let radius=1.8;radius<=4.5 && spots.length<3;radius+=.8)for(let k=0;k<24 && spots.length<3;k++){
        const p={x:center.x+Math.cos(k*Math.PI/12)*radius,z:center.z+Math.sin(k*Math.PI/12)*radius};
        if(navigator.walkable(p) && [...occupied,...spots].every(q=>distance(p,q)>=1.6))spots.push(p);
      }
      const members=[];
      for(const id of [...g.memberNpcIds].sort()) {
        if(used.has(id)||!base.has(id)||members.length>=spots.length)continue;
        const s=base.get(id).sample(periodStart+depart*1000);
        if(!canMeet(id,s,index))continue;
        const target=spots[members.length],speed=roster.get(id).moveSpeed;
        const outward=compileRoute(s.position,target,navigator,speed);
        const home=compileRoute(target,s.position,navigator,speed);
        if(outward&&home)members.push({id,outward,home});
      }
      if(members.length<2)continue;
      const centroid=members.reduce((p,m)=>({x:p.x+m.outward.to.x/members.length,z:p.z+m.outward.to.z/members.length}),{x:0,z:0});
      if(members.length===2 ? distance(members[0].outward.to,members[1].outward.to)>OBSERVED_POLICY.pairDistance : members.some(m=>distance(m.outward.to,centroid)>OBSERVED_POLICY.tripleRadius))continue;
      const arrive=depart+Math.max(...members.map(m=>m.outward.duration));
      const leave=arrive+SHARED_MEETING_POLICY.dwell;
      const end=leave+Math.max(...members.map(m=>m.home.duration));
      if(end>=899)continue;
      members.forEach(m=>used.add(m.id));
      occupied.push(...members.map(m=>m.outward.to));
      plans.push({groupId:g.groupId,location,cohesion:g.cohesion,depart,arrive,leave,end,members});
      break;
      }
    }
    for (const p of [...plans]) if(p.end+SHARED_MEETING_POLICY.repeatSeconds<899) plans.push({...p,depart:p.depart+SHARED_MEETING_POLICY.repeatSeconds,arrive:p.arrive+SHARED_MEETING_POLICY.repeatSeconds,leave:p.leave+SHARED_MEETING_POLICY.repeatSeconds,end:p.end+SHARED_MEETING_POLICY.repeatSeconds});
    return plans;
  }
  function eventFrame(ms=now()) {
    if(ms===null)return [];
    const time=worldScheduleAt(ms),cycle=Math.floor(time.slot/5);
    return plansFor(time.index).filter(p=>time.offsetSeconds>=p.depart && time.offsetSeconds<p.end).map(p=>{
      const phase=time.offsetSeconds<p.arrive?'ASSEMBLING':time.offsetSeconds<p.leave?'MEETING':'RETURNING';
      const start=(time.slot*NPC_WORLD_PERIOD_MS+NPC_WORLD_EPOCH_MS)/1000+p.arrive+SHARED_MEETING_POLICY.dialogueDelay;
      const choices=OBSERVED_TEMPLATES.filter(t=>t.places.includes('*')||t.places.includes(observedPlace(p.location)));
      const template=choices[(cycle*10+time.index*2+(p.depart>=480?1:0)+groups.findIndex(g=>g.groupId===p.groupId))%choices.length];
      const members=p.members.map(m=>({id:m.id,department:profileById.get(m.id)?.department,interests:npcById.get(m.id)?.interests??[]}));
      const tone=p.cohesion>=40?'high':p.cohesion>=12?'medium':'low';
      const lines=renderObservedTemplate(template,members,{period:time.period,tone});
      const lineIndex=Math.floor((ms/1000-start)/SHARED_MEETING_POLICY.lineSeconds);
      return {...p,phase,eventId:`${NPC_SCHEDULE_REVISION}:${time.slot}:${p.groupId}:${p.depart}`,started:start,
        conversation_id:template.conversation_id,tone,index:lineIndex,
        line:phase==='MEETING'&&lineIndex>=0&&lineIndex<lines.length?lines[lineIndex]:null};
    });
  }
  function sample(id,ms=now()) {
    const state=base.get(id).sample(ms);if(ms===null)return state;
    const time=worldScheduleAt(ms),p=plansFor(time.index).find(p=>p.members.some(m=>m.id===id)&&time.offsetSeconds>=p.depart&&time.offsetSeconds<p.end);
    if(!p)return state;
    const m=p.members.find(m=>m.id===id),returning=time.offsetSeconds>=p.leave;
    const route=returning?m.home:m.outward,seconds=time.offsetSeconds-(returning?p.leave:p.depart);
    const moving=seconds<route.duration;
    const pose=along(route,seconds);
    const center=p.members.reduce((a,m)=>({x:a.x+m.outward.to.x/p.members.length,z:a.z+m.outward.to.z/p.members.length}),{x:0,z:0});
    if(!moving&&!returning)pose.heading=Math.atan2(center.x-pose.position.x,center.z-pose.position.z)*180/Math.PI;
    return {...state,...pose,moving,phase:moving?'MOVING':'ACTING',activity:returning?state.activity:'SOCIAL_MEETUP',
      meetingId:p.groupId,meetingLocation:p.location,meetingPhase:returning?'RETURNING':time.offsetSeconds<p.arrive?'ASSEMBLING':'MEETING'};
  }
  for(const [id,m] of roster){m.controller={...m.controller,sample:ms=>sample(id,ms),status:()=>sample(id),tick:()=>sample(id)};}
  return {events:eventFrame,plans:plansFor,groups:()=>groups,status:()=>({groups:groups.length,events:eventFrame().map(e=>({eventId:e.eventId,phase:e.phase,members:e.members.map(m=>m.id),conversation_id:e.line?e.conversation_id:null,index:e.line?e.index:null}))})};
}

// Per-view presentation: hides an event without cancelling the shared social timeline.
export function createSharedMeetingObserver() {
  let active=null,nextPlayer=0,previous=null;const seen=new Set();
  function stop(){active=null;}
  function update({now,events=[],player,forward=null,blocked=false,busyIds=[]}) {
    if(now===null){stop();return null;}
    const teleported=previous&&player&&distance(previous,player)>OBSERVED_POLICY.exit;
    previous=player?{x:player.x,z:player.z}:null;
    if(blocked||teleported||!player){stop();return null;}
    const eligible=e=>e.line&&!e.members.some(m=>busyIds.includes(m.id))&&e.members.every(m=>distance(m.outward.to,player)<(active===e.eventId?OBSERVED_POLICY.exit:OBSERVED_POLICY.enter));
    const score=e=>{
      const p=e.members[0].outward.to, d=distance(p,player);
      const facing=forward&&d>0?((p.x-player.x)*forward.x+(p.z-player.z)*forward.z)/d:0;
      return d-facing*.5-(e.cohesion??0)*.002;
    };
    let e=events.find(e=>e.eventId===active&&eligible(e));
    if(!e){active=null;if(now>=nextPlayer){e=events.filter(e=>eligible(e)&&!seen.has(e.eventId)).sort((a,b)=>score(a)-score(b)||a.eventId.localeCompare(b.eventId))[0];
      if(e){active=e.eventId;seen.add(active);nextPlayer=now+60;while(seen.size>256)seen.delete(seen.values().next().value);}}}
    return e?{eventId:e.eventId,conversation_id:e.conversation_id,members:e.members.map(m=>m.id),line:e.line,index:e.index,tone:e.tone}:null;
  }
  return {update,stop};
}
