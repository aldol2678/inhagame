import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcNavigator } from '../npc-factory/dev-navigation.mjs';
import { createPurposefulRoster } from '../npc-factory/purposeful-roster.mjs';
import { mergeCampusPopulation } from '../npc-factory/npc-campus-expansion.mjs';
import { bindSharedSchedule } from '../npc-factory/npc-shared-schedule.mjs';
import { NPC_WORLD_EPOCH_MS as E, NPC_WORLD_PERIOD_MS as P } from '../npc-factory/npc-world-time-contract.mjs';

test('46 existing campus NPCs share all five safe schedule legs, including night wrap', () => {
  const read = file => JSON.parse(readFileSync(new URL('../npc-factory/data/'+file,import.meta.url),'utf8'));
  const { batch } = mergeCampusPopulation(read('repaired/INKYUNG-20-A-R1.json'),
    read('fixtures/public-roster.json'),read('expansion/CAMPUS-28-P2A.json'));
  const navigator=createNpcNavigator(batch);
  let now=E;
  const a=bindSharedSchedule(createPurposefulRoster(batch,navigator),navigator,()=>now);
  const b=bindSharedSchedule(createPurposefulRoster(batch,navigator),navigator,()=>now);
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
  assert.ok(movingSamples>0);assert.ok(remoteSamples>0);
  console.log(JSON.stringify({npcCount:a.size,legs:a.size*5,movingSamples,remoteSamples}));
});
