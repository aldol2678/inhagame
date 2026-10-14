import test from 'node:test';
import assert from 'node:assert/strict';
import {createLife,advanceLife,chooseLifeEvent,simulateCompleteLife} from '../life-engine.mjs';
import {GROWTH_VERSION,selectMajorActivity,growthCards,earnedTraits,validateGrowth,traitProgress,nextGrowthReward,competencyChanges} from '../campus-growth.mjs';
import {FOLLOWUP_CONTENT_VERSION} from '../major-stories.mjs';
import {FOUNDATION_MAJOR_IDS} from '../major-registry.mjs';
import {GRADUATE_ARCHIVE_KEY,GRADUATE_ARCHIVE_SCHEMA,createGraduateArchive,graduateSummary,rankGraduates} from '../graduate-archive.mjs';
import {createLifeSession,V2_LOCAL_SAVE_KEY,V2_LOCAL_SAVE_SCHEMA} from '../session.mjs';
const opts={majorId:'culture',seed:42,contentVersion:FOLLOWUP_CONTENT_VERSION,growthVersion:GROWTH_VERSION};
function memory(){const data=new Map();return {data,getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}
function step(s){const p=s.life().pendingEvent;if(p)s.choose(p.choices[0].id);else s.nextWeek();}
function finish(s){for(let i=0;i<350&&s.life().status!=='complete';i++)step(s);assert.equal(s.life().status,'complete');return s.life();}
test('new growth is explicit; absent stays legacy and unknown versions fail',()=>{
  const old=createLife({majorId:'culture'});assert.equal(old.growth,undefined);
  assert.equal(simulateCompleteLife({majorId:'culture'}).growth,undefined);
  assert.throws(()=>createLife({...opts,growthVersion:'unknown'}));
  for(const growth of [null,{}, {version:'unknown',plans:[]},{version:GROWTH_VERSION,plans:[{term:2,style:'build'}]}])
    assert.throws(()=>advanceLife({...createLife(opts),growth}));
});
test('semester activity selection has no reward or RNG effects and locks on first week',()=>{
  let life=createLife(opts),stats=structuredClone(life.stats),rng=life.rngState;
  for(const style of ['build','team','explore','build'])life=selectMajorActivity(life,style);
  assert.deepEqual(life.stats,stats);assert.equal(life.rngState,rng);
  life=advanceLife(life);assert.equal(life.growth.plans.length,1);
  assert.throws(()=>selectMajorActivity(life,'team'));
  assert.equal(advanceLife(createLife(opts)).growth.plans[0].style,'explore');
});
test('week5 pending and reload do not award; completed week awards once',()=>{
  const store=memory(),s=createLifeSession({storage:store});s.start(opts);s.setActivity('team');
  for(let i=0;i<4;i++)s.nextWeek();
  const before=s.life().stats.collaboration;
  assert.equal(s.nextWeek().kind,'choice');
  const saved=s.life(),r=createLifeSession({storage:store});assert.equal(r.load(),true);
  assert.deepEqual(r.life(),saved);assert.deepEqual(r.nextWeek().life,saved);
  s.choose(s.life().pendingEvent.choices[0].id);
  const chosen=s.life().stats.collaboration;s.nextWeek();
  assert.equal(s.life().stats.collaboration,chosen+2); // balanced +1, milestone +1
  assert.equal(growthCards(s.life()).filter(c=>c.kind==='전공 성장').length,1);
  assert.equal(s.life().weeksCompleted,5);assert(before<chosen+2);
});
test('all12 majors reload every transition and complete 19 choices,24 growth cards',()=>{
  for(const majorId of FOUNDATION_MAJOR_IDS){
    const store=memory(),s=createLifeSession({storage:store});s.start({...opts,majorId});
    for(let i=0;i<350;i++){
      const life=s.life(),r=createLifeSession({storage:store});assert.equal(r.load(),true,majorId+' '+life.weeksCompleted);assert.deepEqual(r.life(),life);
      if(life.status==='complete'){
        assert.equal(life.memories.length,19);assert.equal(growthCards(life).length,43);
        assert.equal(life.growth.plans.length,8);assert.equal(s.graduateArchive().records.length,1);break;
      }
      if(life.weeksCompleted%15===0&&!life.pendingEvent)s.setActivity(['explore','build','team'][Math.floor(life.weeksCompleted/15)%3]);
      step(s);if(i===349)throw Error('stuck');
    }
  }
});
test('growth corruption fails load and preserves original raw save',()=>{
  const store=memory(),s=createLifeSession({storage:store});s.start(opts);s.nextWeek();
  for(const mutate of [x=>x.growth.plans=[],x=>x.growth.plans.push({term:2,style:'team'}),x=>x.growth.plans[0].style='__proto__',x=>x.growth.version='bad']){
    const life=s.life();mutate(life);const raw=JSON.stringify({schema:V2_LOCAL_SAVE_SCHEMA,life});store.setItem(V2_LOCAL_SAVE_KEY,raw);
    assert.equal(createLifeSession({storage:store}).load(),false);assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);
  }
});
test('graduation archive is idempotent, survives next game and never touches V1',()=>{
  const store=memory();store.setItem('induck-grow-p0','sentinel');
  const s=createLifeSession({storage:store});s.start(opts);const done=finish(s);
  assert.equal(s.graduateArchive().records.length,1);s.retryArchive();assert.equal(s.graduateArchive().records.length,1);
  s.start({...opts,seed:43,replaceExisting:true});
  assert.equal(s.graduateArchive().records.length,1);assert.equal(s.life().weeksCompleted,0);
  assert.equal(store.getItem('induck-grow-p0'),'sentinel');
  assert.equal(s.graduateArchive().records[0].gpa,done.gpa);
});
test('malformed and unknown archive retains bytes and blocks replacing completed life',()=>{
  for(const raw of ['{bad',JSON.stringify({schema:'bad',records:[]}),JSON.stringify({schema:GRADUATE_ARCHIVE_SCHEMA,records:[{gpa:99}]})]){
    const store=memory(),s=createLifeSession({storage:store});s.start(opts);finish(s);
    const save=store.getItem(V2_LOCAL_SAVE_KEY),life=s.life();store.setItem(GRADUATE_ARCHIVE_KEY,raw);
    assert.throws(()=>s.start({...opts,replaceExisting:true}));
    assert.deepEqual(s.life(),life);assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),save);assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),raw);
  }
});
test('archive quota error prevents replacing completion and retry is safe',()=>{
  const store=memory(),s=createLifeSession({storage:store});s.start(opts);
  const setter=store.setItem;store.setItem=(k,v)=>{if(k===GRADUATE_ARCHIVE_KEY)throw Error('quota');setter(k,v);};
  const done=finish(s),raw=store.getItem(V2_LOCAL_SAVE_KEY);
  assert(s.status().archiveError);assert.throws(()=>s.start({...opts,replaceExisting:true}));
  assert.deepEqual(s.life(),done);assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);
  store.setItem=setter;s.retryArchive();assert.equal(s.graduateArchive().records.length,1);
});
test('new-game save failure preserves completed current and saved bytes after archive success',()=>{
  const store=memory(),s=createLifeSession({storage:store});s.start(opts);const done=finish(s),raw=store.getItem(V2_LOCAL_SAVE_KEY);
  const setter=store.setItem;store.setItem=(k,v)=>{if(k===V2_LOCAL_SAVE_KEY)throw Error('quota');setter(k,v);};
  assert.throws(()=>s.start({...opts,replaceExisting:true}));
  assert.deepEqual(s.life(),done);assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);assert.equal(s.graduateArchive().records.length,1);
});
test('archive cap50 rejects51st, accepts existing duplicate without deleting anything',()=>{
  const store=memory(),a=createGraduateArchive(store),life=simulateCompleteLife(opts);
  for(let seed=0;seed<50;seed++)assert.equal(a.add({...life,seed}).ok,true);
  const raw=store.getItem(GRADUATE_ARCHIVE_KEY);
  assert.equal(a.add({...life,seed:50}).ok,false);assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),raw);
  assert.equal(a.add({...life,seed:0}).duplicate,true);assert.equal(a.read().records.length,50);
});
test('personal ranks group versions and majors; same visible GPA shares rank1,1,3',()=>{
  const r=graduateSummary(simulateCompleteLife(opts));
  const ranked=rankGraduates([{...r,gpa:4},{...r,gpa:4,seed:2},{...r,gpa:3,seed:3},{...r,growth:'legacy',gpa:2},{...r,majorId:'cse',gpa:1}]);
  assert.deepEqual(ranked.map(x=>x.rank),[1,1,3,1,1]);
});
test('derived memories and traits do not mutate, award, consume RNG or lose original memories',()=>{
  const life=simulateCompleteLife(opts),before=JSON.stringify(life);
  assert.equal(growthCards(life).length,43);assert(earnedTraits(life).some(x=>x.id==='steady'));
  growthCards(life);earnedTraits(life);validateGrowth(life);assert.equal(JSON.stringify(life),before);
});

test('unreadable primary storage is temporary, explicitly confirmed malformed primary may be replaced',()=>{
  const blocked={getItem(){throw Error('blocked')},setItem(){throw Error('must not write')}};
  const temp=createLifeSession({storage:blocked});temp.start(opts);temp.nextWeek();
  assert.match(temp.status().saveError,/임시/);
  const store=memory();store.setItem(V2_LOCAL_SAVE_KEY,'{bad');
  const s=createLifeSession({storage:store});
  assert.throws(()=>s.start(opts));assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),'{bad');
  s.start({...opts,replaceExisting:true});assert.equal(s.inspectSave().available,true);
});

test('next reward countdown follows completed weeks and selected approach, never grants a reward',()=>{
  let life=createLife(opts);life=selectMajorActivity(life,'build');
  const raw=JSON.stringify(life);assert.equal(nextGrowthReward(life).remaining,5);
  assert.equal(nextGrowthReward(life).stat,'creative');assert.equal(JSON.stringify(life),raw);
  for(let i=0;i<4;i++)life=advanceLife(life);
  assert.equal(nextGrowthReward(life).remaining,1);
  life=advanceLife(life);assert.equal(nextGrowthReward(life).remaining,1);
  life=chooseLifeEvent(life,life.pendingEvent.choices[0].id);life=advanceLife(life);
  assert.equal(nextGrowthReward(life).atWeek,10);assert.equal(nextGrowthReward(life).remaining,5);
  life.stats.creative=100;assert.equal(nextGrowthReward(life).capped,true);
  assert.equal(nextGrowthReward(simulateCompleteLife(opts)),null);
  assert.equal(nextGrowthReward(createLife({majorId:'culture'})),null);
});
test('trait catalog matches earned traits, explains unavailable legacy growth and calculates exact deltas',()=>{
  const fresh=createLife(opts),done=simulateCompleteLife(opts);
  assert.equal(traitProgress(fresh).length,6);
  assert.deepEqual(traitProgress(done).filter(t=>t.earned).map(({id,title})=>({id,title})),earnedTraits(done));
  const legacy=createLife({majorId:'culture'});
  assert.equal(traitProgress(legacy).filter(t=>!t.available).length,4);
  const after=structuredClone(fresh);after.stats.analysis+=2;after.stats.creative-=1;
  assert.deepEqual(competencyChanges(fresh,after).map(x=>x.delta),[2,-1]);
  assert.deepEqual(competencyChanges(null,after),[]);
});
test('backup exports all valid records without mutation and malformed archive never exports partial data',()=>{
  const store=memory(),a=createGraduateArchive(store);a.add(simulateCompleteLife(opts));
  const raw=store.getItem(GRADUATE_ARCHIVE_KEY),backup=a.exportSnapshot();
  assert.equal(backup.ok,true);assert.equal(backup.count,1);assert.deepEqual(JSON.parse(backup.json),JSON.parse(raw));
  assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),raw);
  const bad=JSON.stringify({schema:GRADUATE_ARCHIVE_SCHEMA,records:[JSON.parse(raw).records[0],{gpa:99}]});store.setItem(GRADUATE_ARCHIVE_KEY,bad);
  assert.equal(a.exportSnapshot().ok,false);assert.equal(a.remove('invalid').ok,false);assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),bad);
});
test('selective cleanup uses record identity and preserves other records and primary',()=>{
  const store=memory(),s=createLifeSession({storage:store});s.start(opts);finish(s);
  const first=s.graduateArchive().records[0],key=JSON.stringify(first),save=store.getItem(V2_LOCAL_SAVE_KEY);
  assert.equal(s.removeGraduate(key).ok,false);assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),save);
  s.start({...opts,seed:43,replaceExisting:true});finish(s);
  const latest=store.getItem(V2_LOCAL_SAVE_KEY);assert.equal(s.graduateArchive().records.length,2);
  assert.equal(s.removeGraduate(key).ok,true);assert.equal(s.graduateArchive().records.length,1);
  assert.equal(s.graduateArchive().records[0].seed,43);assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),latest);
  assert.equal(s.removeGraduate(key).ok,false);
});
test('cleanup detects duplicate identities, stale primary, damaged primary and failed writes',()=>{
  const store=memory(),s=createLifeSession({storage:store}),a=createGraduateArchive(store);
  s.start(opts);const done=simulateCompleteLife(opts),record=graduateSummary(done),key=JSON.stringify(record);
  const duplicates=JSON.stringify({schema:GRADUATE_ARCHIVE_SCHEMA,records:[record,record]});store.setItem(GRADUATE_ARCHIVE_KEY,duplicates);
  assert.equal(a.remove(key).ok,false);assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),duplicates);
  store.setItem(GRADUATE_ARCHIVE_KEY,JSON.stringify({schema:GRADUATE_ARCHIVE_SCHEMA,records:[record]}));
  const original=store.getItem(GRADUATE_ARCHIVE_KEY),validPrimary=store.getItem(V2_LOCAL_SAVE_KEY),getter=store.getItem;
  let primaryReads=0;store.getItem=k=>k===V2_LOCAL_SAVE_KEY?(++primaryReads===1?validPrimary:'{changed'):getter(k);
  assert.equal(s.removeGraduate(key).ok,false);assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),original);
  store.getItem=getter;store.setItem(V2_LOCAL_SAVE_KEY,'{bad');
  assert.equal(s.removeGraduate(key).ok,false);assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),original);
  store.setItem(V2_LOCAL_SAVE_KEY,validPrimary);const setter=store.setItem;store.setItem=()=>{throw Error('quota')};
  assert.equal(s.removeGraduate(key).ok,false);assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),original);store.setItem=setter;
});
test('full50 archive is recoverable by removing a past record then retrying unarchived graduation',()=>{
  const store=memory(),a=createGraduateArchive(store),done=simulateCompleteLife(opts);
  for(let seed=0;seed<50;seed++)a.add({...done,seed});
  const s=createLifeSession({storage:store});s.start({...opts,seed:100});finish(s);
  assert(s.status().archiveError);
  const oldKey=JSON.stringify(s.graduateArchive().records[0]);assert.equal(s.removeGraduate(oldKey).ok,true);
  assert.equal(s.retryArchive(),null);assert.equal(s.graduateArchive().records.length,50);
  assert(s.graduateArchive().records.some(r=>r.seed===100));
  s.start({...opts,seed:101,replaceExisting:true});assert.equal(s.life().weeksCompleted,0);
});
