import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcNavigator } from '../npc-factory/dev-navigation.mjs';
import { createPurposefulRoster } from '../npc-factory/purposeful-roster.mjs';
import { mergeCampusPopulation } from '../npc-factory/npc-campus-expansion.mjs';
import { bindSharedSchedule } from '../npc-factory/npc-shared-schedule.mjs';
import { createSharedMeetings } from '../npc-factory/npc-shared-meetings.mjs';
import { NPC_WORLD_EPOCH_MS as E, NPC_WORLD_PERIOD_MS as P } from '../npc-factory/npc-world-time-contract.mjs';

test('46 existing campus NPCs share all five safe schedule legs, including night wrap', () => {
  const read = file => JSON.parse(readFileSync(new URL('../npc-factory/data/'+file,import.meta.url),'utf8'));
  const { batch, roster: profiles } = mergeCampusPopulation(read('repaired/INKYUNG-20-A-R1.json'),
    read('fixtures/public-roster.json'),read('expansion/CAMPUS-28-P2A.json'));
  const navigator=createNpcNavigator(batch);
  let now=E;
  const a=bindSharedSchedule(createPurposefulRoster(batch,navigator),navigator,()=>now);
  const b=bindSharedSchedule(createPurposefulRoster(batch,navigator),navigator,()=>now);
  const firstMeetings=createSharedMeetings({batch,profiles,roster:a,navigator,now:()=>now});
  const lateMeetings=createSharedMeetings({batch:{...batch,npcs:[...batch.npcs].reverse()},profiles,roster:b,navigator,now:()=>now});
  assert.equal(a.size,46);
  assert.equal(a.has('INKYUNG-NPC-001'),false);
  assert.equal(a.has('INKYUNG-NPC-002'),false);
  let movingSamples=0, remoteSamples=0;
  for(let index=0;index<5;index++) for(const seconds of [0,.1,1,10,30,120,600,899.999]){
    now=E+index*P+seconds*1000;
    for(const [id,member] of a){
      const first=member.controller.status(),late=b.get(id).controller.status();
      assert.deepEqual(first,late,id);
      if(first.transfer)remoteSamples++;
      else assert.ok(navigator.walkable(first.position),id+' leaves walkable ground');
      if(first.moving)movingSamples++;
      if(seconds>899){
        assert.equal(first.phase,'ACTING',id+' reaches target before next period');
        assert.deepEqual(first.position,member.destinations[member.schedule[index].destination].position);
      }
      const next=member.controller.sample(now+10);
      if(first.moving && next.scheduleIndex===first.scheduleIndex)
        assert.ok(Math.hypot(next.position.x-first.position.x,next.position.z-first.position.z)<=member.moveSpeed*.01+1e-6);
    }
  }
  let sceneCount=0;
  for(let index=0;index<5;index++) {
    const plans=firstMeetings.plans(index);
    assert.deepEqual(plans,lateMeetings.plans(index),'independent NG1 seed replay');
    const resting=[...a.values()].map(m=>m.controller.sample(E+index*P+899999)).filter(s=>s.visible);
    for(let i=0;i<resting.length;i++) for(let j=i+1;j<resting.length;j++)
      assert.ok(Math.hypot(resting[i].position.x-resting[j].position.x,resting[i].position.z-resting[j].position.z)>.6,'resting NPC destinations overlap');
    for(const plan of plans) {
      sceneCount++;
      assert.ok(plan.members.length>=2 && plan.members.length<=3);
      assert.ok(Math.abs(plan.leave-plan.arrive-60)<1e-6);
      const group=firstMeetings.groups().find(g=>g.groupId===plan.groupId);
      assert.ok(plan.members.every(m=>group.memberNpcIds.includes(m.id)));
      const ms=E+index*P+(plan.arrive+19)*1000;
      assert.deepEqual(firstMeetings.events(ms),lateMeetings.events(ms),'same shared speaker and text');
      const event=firstMeetings.events(ms).find(e=>e.groupId===plan.groupId);
      assert.equal(event.index,1); assert.ok(event.line.text.length>0);
      for(const member of plan.members) {
        const controller=a.get(member.id).controller;
        for(const t of [plan.depart+.1,plan.arrive+5,plan.leave+.1,plan.end+.01]) {
          const at=E+index*P+t*1000,s=controller.sample(at),next=controller.sample(at+10);
          assert.ok(navigator.walkable(s.position));
          assert.ok(Math.hypot(s.position.x-next.position.x,s.position.z-next.position.z)<=a.get(member.id).moveSpeed*.01+1e-5,'meeting motion never teleports');
        }
        assert.deepEqual(controller.sample(E+index*P+(plan.end+.01)*1000).position,member.home.to);
      }
      const repeat=plans.find(p=>p.groupId===plan.groupId && p.depart>plan.depart);
      if(repeat) {
        assert.ok(repeat.depart-plan.depart>=300);
        const next=firstMeetings.events(E+index*P+(repeat.arrive+19)*1000).find(e=>e.groupId===plan.groupId);
        assert.notEqual(next.conversation_id,event.conversation_id);
      }
    }
  }
  assert.ok(sceneCount>=6,'real roster produces shared scenes');
  assert.equal(firstMeetings.plans(1).length,0,'class schedule wins');
  console.log(JSON.stringify({sharedScenes:sceneCount}));
  assert.ok(movingSamples>0);assert.ok(remoteSamples>0);
  console.log(JSON.stringify({npcCount:a.size,legs:a.size*5,movingSamples,remoteSamples}));
});

