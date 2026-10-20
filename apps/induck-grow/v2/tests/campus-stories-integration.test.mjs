import test from 'node:test';
import assert from 'node:assert/strict';
import {createLife,simulateCompleteLife,SUPPORTED_POLICIES} from '../life-engine.mjs';
import {CAMPUS_STORY_VERSION,buildTurningPoints} from '../campus-stories.mjs';
import {FOUNDATION_MAJOR_IDS} from '../major-registry.mjs';
import {FOLLOWUP_CONTENT_VERSION} from '../major-stories.mjs';
import {GROWTH_VERSION} from '../campus-growth.mjs';
import {ECONOMY_VERSION} from '../life-spending.mjs';
import {createLifeSession,V2_LOCAL_SAVE_KEY,V2_LOCAL_SAVE_SCHEMA} from '../session.mjs';
import {createGraduateArchive,graduateSummary,rankGraduates,GRADUATE_ARCHIVE_KEY} from '../graduate-archive.mjs';

const options={majorId:'culture',seed:42,contentVersion:FOLLOWUP_CONTENT_VERSION,
  growthVersion:GROWTH_VERSION,economyVersion:ECONOMY_VERSION,campusStoryVersion:CAMPUS_STORY_VERSION};
function storage(){const data=new Map();return {getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v)};}
function step(s){const l=s.life();if(l.pendingEvent)s.choose(l.pendingEvent.choices[0].id);else s.nextWeek();}
function finish(s){for(let i=0;i<300&&s.life().status!=='complete';i++)step(s);assert.equal(s.life().weeksCompleted,120);return s.life();}
function hash(s){let h=2166136261;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);}return (h>>>0).toString(16);}
// Complete JSON snapshots from main 7cbafd9247993f540c354c0d8e35738ab37f413b,
// seed 42, default first-choice route. Non-cryptographic regression checksums.
const legacyHashes={
  "culture.balanced": "e769efe3",
  "culture.academic": "cbc2e777",
  "culture.social": "3d31942e",
  "culture.work": "a34a2985",
  "culture.creative": "d9cd29ea",
  "cse.balanced": "98c5aeb9",
  "cse.academic": "15ed5aea",
  "cse.social": "5ae55b89",
  "cse.work": "2960b7fd",
  "cse.creative": "cb5d1ebc",
  "aero.balanced": "d6587a28",
  "aero.academic": "5904f544",
  "aero.social": "195dd0c3",
  "aero.work": "44d6d41f",
  "aero.creative": "82f9690c",
  "apsl.balanced": "4c1fae4b",
  "apsl.academic": "6d12786d",
  "apsl.social": "cd071b28",
  "apsl.work": "a9aef9c0",
  "apsl.creative": "cb52d9e3",
  "nursing.balanced": "966842f9",
  "nursing.academic": "f849163",
  "nursing.social": "b11f07dc",
  "nursing.work": "fdf8dc84",
  "nursing.creative": "f431f861",
  "theatre.balanced": "76154af5",
  "theatre.academic": "7a792f9d",
  "theatre.social": "6176079f",
  "theatre.work": "fa1b5c65",
  "theatre.creative": "3ca965ce",
  "mech.balanced": "b191bad5",
  "mech.academic": "62076d98",
  "mech.social": "6e60b7cf",
  "mech.work": "299eee21",
  "mech.creative": "94dee06e",
  "ai.balanced": "3351e1d9",
  "ai.academic": "4d73741b",
  "ai.social": "40951a1e",
  "ai.work": "57b2875e",
  "ai.creative": "a64f2a99",
  "life.balanced": "63f55293",
  "life.academic": "b5bacff5",
  "life.social": "9803c63c",
  "life.work": "a040cf7e",
  "life.creative": "8ab487d1",
  "business.balanced": "f07de33e",
  "business.academic": "18cdd3e",
  "business.social": "e12dbd5b",
  "business.work": "d8a4b803",
  "business.creative": "40f1cdae",
  "media.balanced": "f74a8db6",
  "media.academic": "329cadf4",
  "media.social": "eeaba882",
  "media.work": "190a1788",
  "media.creative": "135cc0af",
  "design.balanced": "55ec67fa",
  "design.academic": "210002e8",
  "design.social": "7346d57",
  "design.work": "3b1bf2da",
  "design.creative": "5f018155"
};

test('all 60 historical legacy snapshots retain identical serialized checksums',()=>{
  for(const majorId of FOUNDATION_MAJOR_IDS)for(const policy of SUPPORTED_POLICIES){
    const life=simulateCompleteLife({majorId,policy,seed:42});
    assert.equal(hash(JSON.stringify(life)),legacyHashes[majorId+'.'+policy]);
    assert.equal(life.campusStories,undefined);
  }
});
test('all 12 majors complete basic and simple campus stories with valid archives',()=>{
  for(const majorId of FOUNDATION_MAJOR_IDS)for(const playStyle of ['basic','simple']){
    const store=storage(),s=createLifeSession({storage:store});
    s.start({...options,majorId,playStyle});
    const life=finish(s);
    assert.equal(life.semesters.length,8);assert.equal(life.campusStories.records.length,6);
    assert.equal(new Set(life.completedEventInstances).size,life.completedEventInstances.length);
    assert.equal(new Set(life.shownEventSlots).size,life.shownEventSlots.length);
    assert.equal(s.graduateArchive().ok,true);
    assert.deepEqual(s.graduateArchive().records[0].turningPoints,buildTurningPoints(life));
    assert.equal(s.graduateArchive().records[0].playStyle.simpleWeeks,playStyle==='simple'?120:0);
  }
});
test('each pending campus scene survives save/reload including prepared simple plans',()=>{
  const store=storage();let s=createLifeSession({storage:store});s.start({...options,playStyle:'simple'});
  const restored=[];
  for(let i=0;i<300&&s.life().status!=='complete';i++){
    const before=s.life();
    if(before.pendingEvent?.type==='campus'){
      const raw=store.getItem(V2_LOCAL_SAVE_KEY),next=createLifeSession({storage:store});
      assert.equal(next.load(),true);assert.deepEqual(next.life(),before);
      assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);
      restored.push(before.pendingEvent.eventId);s=next;
    }
    step(s);
  }
  assert.equal(s.life().weeksCompleted,120);assert.equal(new Set(restored).size,6);
});
test('malformed campus saves fail closed and preserve the original stored bytes',()=>{
  const store=storage(),s=createLifeSession({storage:store});s.start(options);
  while(s.life().pendingEvent?.type!=='campus')step(s);
  const valid=s.life();
  for(const mutate of [
    l=>l.campusStories.version='unknown',
    l=>l.campusStories.records.push({id:'invite',choice:'join',at:119}),
    l=>l.campusStories.extra=true,
    l=>l.pendingEvent.choices[0].id='forged',
    l=>l.pendingEvent.year=4,
    l=>delete l.campusStories
  ]){
    const bad=structuredClone(valid);mutate(bad);
    const raw=JSON.stringify({schema:V2_LOCAL_SAVE_SCHEMA,life:bad});
    store.setItem(V2_LOCAL_SAVE_KEY,raw);
    const next=createLifeSession({storage:store});
    assert.equal(next.inspectSave().available,false);assert.equal(next.load(),false);
    assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);
  }
});
test('legacy save reload keeps absence byte-compatible and does not silently activate scenes',()=>{
  const store=storage(),life=createLife({majorId:'culture',seed:42});
  const raw=JSON.stringify({schema:V2_LOCAL_SAVE_SCHEMA,life});store.setItem(V2_LOCAL_SAVE_KEY,raw);
  const session=createLifeSession({storage:store});assert.equal(session.load(),true);
  assert.equal(JSON.stringify(session.life()),JSON.stringify(life));assert.equal(store.getItem(V2_LOCAL_SAVE_KEY),raw);
  assert.equal(finish(session).campusStories,undefined);
});
test('archives dedupe campus summaries and isolate story-version and play-style groups',()=>{
  const store=storage(),archive=createGraduateArchive(store);
  const enabled=simulateCompleteLife(options);
  const legacy=simulateCompleteLife({...options,campusStoryVersion:undefined});
  assert.equal(archive.add(enabled).ok,true);assert.equal(archive.add(enabled).duplicate,true);
  assert.equal(archive.add(legacy).ok,true);assert.equal(archive.read().records.length,2);
  const ranks=rankGraduates(archive.read().records);
  assert.equal(new Set(ranks.map(r=>r.group)).size,2);assert.ok(ranks.every(r=>r.rank===1));
  assert.equal(graduateSummary(legacy).turningPoints,undefined);
  const simple=createLifeSession({storage:storage()});simple.start({...options,playStyle:'simple'});
  assert.equal(archive.add(finish(simple)).ok,true);
  assert.equal(new Set(rankGraduates(archive.read().records).map(r=>r.group)).size,3);
  const corrupted=JSON.parse(store.getItem(GRADUATE_ARCHIVE_KEY));
  corrupted.records[0].turningPoints[0].id='forged';
  const raw=JSON.stringify(corrupted);store.setItem(GRADUATE_ARCHIVE_KEY,raw);
  assert.equal(archive.read().ok,false);assert.equal(store.getItem(GRADUATE_ARCHIVE_KEY),raw);
});
