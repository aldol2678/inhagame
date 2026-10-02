import test from 'node:test';
import assert from 'node:assert/strict';
import { createObservedConversation, observedCandidates, observableNpc, OBSERVED_POLICY } from '../npc-factory/npc-observed-conversation.mjs';
import { OBSERVED_TEMPLATES, observedPlace, renderObservedTemplate } from '../npc-factory/npc-observed-templates.mjs';
import { observedBubbleRect } from '../npc-factory/npc-observed-bubble.mjs';

const npc = (id,x=0,z=0,extra={}) => ({ id,name:id,position:{x,z},visible:true,phase:'ACTING',
  activity:'RESTING',location:'inkyung_bench_east',department:'수학과',moving:false,...extra });
const frame = (extra={}) => ({ now:0,npcs:[npc('a'),npc('b',1)],player:{x:0,z:1},
  forward:{x:0,z:-1},period:'class_time',groups:[],pairInfo:()=>({affinity:30}),...extra });

test('8m enter is 4 world units; remote groups do not trigger',()=>{
  assert.equal(OBSERVED_POLICY.enter,4);
  assert.equal(observedCandidates(frame({npcs:[npc('a',4),npc('b',3)],player:{x:0,z:0}})).length,1);
  assert.equal(observedCandidates(frame({npcs:[npc('a',4.01),npc('b',3)],player:{x:0,z:0}})).length,0);
});
test('two-person 4m separation and three-person 5m radius',()=>{
  assert.equal(observedCandidates(frame({npcs:[npc('a'),npc('b',2.01)]})).length,0);
  const rows=observedCandidates(frame({npcs:[npc('a',-2),npc('b',2),npc('c',0,2)]}));
  assert.ok(rows.some(r=>r.members.length===3));
  assert.ok(!observedCandidates(frame({npcs:[npc('a',-3),npc('b',3),npc('c',0,2)]})).some(r=>r.members.length===3));
});
test('proximity, department and structural affinity alone cannot invent a relationship',()=>{
  assert.equal(observedCandidates(frame({pairInfo:()=>({affinity:0,seedAffinity:99})})).length,0);
  assert.equal(observedCandidates(frame({pairInfo:()=>({affinity:0}),groups:[{groupId:'g',status:'ACTIVE',memberNpcIds:['a','b']}]})).length,1);
  assert.equal(observedCandidates(frame({pairInfo:()=>({affinity:0}),groups:[{groupId:'g',status:'DISSOLVED',memberNpcIds:['a','b']}]})).length,0);
});
test('all pairs in a triple need social evidence',()=>{
  const rows=observedCandidates(frame({npcs:[npc('a'),npc('b',1),npc('c',1,1)],
    pairInfo:(a,b)=>({affinity:[a,b].sort().join('|')==='b|c'?0:30})}));
  assert.ok(!rows.some(r=>r.members.length===3));
});
test('movement, forced detour, hidden, direct interaction and invalid coordinates are excluded',()=>{
  for(const extra of [{moving:true},{phase:'MOVING'},{paused:true},{busy:true},{visible:false},
    {interrupted:true},{activity:'ACADEMIC'},{position:{x:NaN,z:0}}]) assert.equal(observableNpc(npc('a',0,0,extra)),false);
  assert.equal(observableNpc(npc('a',0,0,{interrupted:true,meetingId:'g',activity:'SOCIAL_MEETUP'})),true);
});
test('actual meeting wins over strong unrelated group',()=>{
  const rows=observedCandidates(frame({npcs:[npc('a'),npc('b',1),
    npc('c',0,2,{meetingId:'g'}),npc('d',1,2,{meetingId:'g'})],
    pairInfo:(a,b)=>({affinity:a==='c'&&b==='d'?15:50})}));
  assert.equal(rows[0].key,'c|d');
});
test('camera direction resolves nearby equal-priority groups',()=>{
  const rows=observedCandidates(frame({player:{x:0,z:0},forward:{x:0,z:1},
    npcs:[npc('a',0,-2),npc('b',1,-2),npc('c',0,2),npc('d',1,2)],
    pairInfo:(a,b)=>({affinity:(a==='a'&&b==='b')||(a==='c'&&b==='d')?30:0})}));
  assert.equal(rows[0].key,'c|d');
});
test('one scene, three turns, 9.6 seconds, and no source state mutation',()=>{
  const engine=createObservedConversation(), input=frame(), before=JSON.stringify(input.npcs);
  const first=engine.update(input);
  assert.ok(first);assert.equal(first.index,0);
  assert.equal(engine.update(frame({now:3.3})).line.npcId,'b');
  assert.equal(engine.update(frame({now:6.5})).index,2);
  assert.equal(engine.update(frame({now:9.7})),null);
  assert.equal(JSON.stringify(input.npcs),before);
});
test('direct interaction and each blocking owner immediately yield',()=>{
  for(const reason of ['dialogue','combat','menu','quest','cutscene','teleport']) {
    const engine=createObservedConversation();assert.ok(engine.update(frame()));
    assert.equal(engine.update(frame({now:1,blocked:true,reason})),null);
    assert.equal(engine.status().active,null);
    assert.equal(engine.update(frame({now:2})),null);
  }
});
test('12m boundary releases and 8-to-12m hysteresis keeps current scene',()=>{
  const engine=createObservedConversation();engine.update(frame());
  assert.ok(engine.update(frame({now:1,player:{x:0,z:4.1}})));
  assert.equal(engine.update(frame({now:2,player:{x:0,z:6}})),null);
});
test('schedule movement or time change cancels only presentation',()=>{
  for(const extra of [{npcs:[npc('a',0,0,{moving:true}),npc('b',1)]},{period:'evening'}]) {
    const engine=createObservedConversation();engine.update(frame());
    assert.equal(engine.update(frame({now:1,...extra})),null);
  }
});
test('teleport suppresses immediate start at the new location',()=>{
  const engine=createObservedConversation();engine.update(frame({pairInfo:()=>({affinity:0})}));
  assert.equal(engine.update(frame({now:1,player:{x:100,z:0},npcs:[npc('a',100),npc('b',101)]})),null);
});
test('player cooldown and unordered combination cooldown survive cancellation',()=>{
  const engine=createObservedConversation();engine.update(frame());engine.stop();
  const different=frame({npcs:[npc('c'),npc('d',1)]});
  assert.equal(engine.update({...different,now:61}),null);
  assert.ok(engine.update({...different,now:70}));engine.stop();
  assert.equal(engine.update(frame({now:150,npcs:[npc('b',1),npc('a')]})),null);
  assert.ok(engine.update(frame({now:251})));
});
test('pair history blocks pair-to-triple cooldown bypass and same template repeats',()=>{
  const engine=createObservedConversation();const first=engine.update(frame());engine.stop();
  assert.equal(engine.update(frame({now:80,npcs:[npc('a'),npc('b',1),npc('c',0,1)],
    pairInfo:(a,b)=>({affinity:a==='a'&&b==='b'?30:0})})),null);
  const second=engine.update(frame({now:251}));assert.notEqual(second.conversation_id,first.conversation_id);
});
test('40 unique templates preserve requested category distribution',()=>{
  assert.equal(OBSERVED_TEMPLATES.length,40);
  assert.equal(new Set(OBSERVED_TEMPLATES.map(t=>t.conversation_id)).size,40);
  const counts={};for(const t of OBSERVED_TEMPLATES) counts[t.category]=(counts[t.category]??0)+1;
  assert.deepEqual(counts,{academic:10,food:8,plan:6,department:6,rest:6,place:4});
});
test('six places, five times, three tones and three speakers resolve Korean context',()=>{
  const locations=['study_jungseok','life_student_center','life_back_gate','inkyung_walkway','life_dorm_1','class_building_5'];
  for(const location of locations) for(const period of ['morning','lunch','class_time','evening','night']) {
    const members=[npc('a',0,0,{location}),npc('b',1,0,{location}),npc('c',0,1,{location})];
    const choices=OBSERVED_TEMPLATES.filter(t=>t.places.includes('*')||t.places.includes(observedPlace(location)));
    assert.ok(choices.length>=2);
    for(const t of choices) for(const tone of ['low','medium','high']) {
      const lines=renderObservedTemplate(t,members,{period,tone});
      assert.deepEqual(lines.map(l=>l.npcId),['a','b','c']);
      assert.ok(lines.every(l=>!/[{}]|undefined/.test(l.text)));
    }
  }
});
test('different physical places cannot share a conversation',()=>{
  assert.equal(observedCandidates(frame({npcs:[npc('a'),npc('b',1,0,{location:'study_jungseok'})]})).length,0);
});
for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:844,height:390}]) {
  test(`bubble collision and viewport bounds ${viewport.width}x${viewport.height}`,()=>{
    const input={x:viewport.width/2,y:viewport.height/2,width:220,height:75,viewport};
    const rect=observedBubbleRect(input);assert.ok(rect);
    assert.equal(observedBubbleRect({...input,obstacles:[rect]}),null);
    assert.equal(observedBubbleRect({...input,x:0}),null);
    assert.equal(observedBubbleRect({...input,y:10}),null);
  });
}
