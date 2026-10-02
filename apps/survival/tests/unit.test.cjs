// Stage catalog and local progress rules, loaded exactly as the browser loads them.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.join(__dirname,'..');
// Objects from the vm realm have foreign prototypes; compare them as plain data.
const same=(actual,expected,message)=>assert.deepEqual(structuredClone(actual),structuredClone(expected),message);

function load(){
  const store=new Map();
  const window={
    localStorage:{
      getItem:key=>store.has(key)?store.get(key):null,
      setItem:(key,value)=>store.set(key,String(value)),
      removeItem:key=>store.delete(key)
    },
    dispatchEvent(){}
  };
  const ctx=vm.createContext({window,localStorage:window.localStorage,CustomEvent:class{}});
  for(const file of ['stage-config.js','stage-progress.js'])
    vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),ctx,{filename:file});
  return {stages:window.InduckSurvivalStages,progress:window.InduckSurvivalProgress,store};
}

test('stage catalog: ids, chain and implemented stages', ()=>{
  const {stages}=load();
  same(['survive','attendanceExit','libraryReturn','campusReturn','reviewExit','gateFinal'],[1,2,3,4,5,6].map(id=>stages.get(id).clear.kind));
  const ids=Object.keys(stages.catalog).map(Number);
  same(ids,[1,2,3,4,5,6]);
  for(const id of ids){
    const stage=stages.get(id);
    assert.equal(stage.id,id);
    assert.equal(stage.nextStageId,id===6?null:id+1);
  }
  same(ids.filter(stages.isImplemented),[1,2,3,4,5,6]);
  assert.equal(stages.get(7),null);
});

test('implemented stages are internally consistent', ()=>{
  const {stages}=load();
  for(const id of [1,2,3,4,5,6]){
    const stage=stages.get(id),{world,start,encounters,phases}=stage;
    assert(world.minX<start.x&&start.x<world.maxX&&world.minZ<start.z&&start.z<world.maxZ,`Stage ${id} start outside world`);
    assert(stage.clear.seconds>0,`Stage ${id} clear time`);
    if(stage.clear.deadline!==undefined)assert(stage.clear.deadline>stage.clear.seconds,`Stage ${id} deadline before clear`);
    const untils=encounters.caps.map(c=>c.until);
    same(untils,[...untils].sort((a,b)=>a-b),`Stage ${id} caps unordered`);
    assert.equal(untils.at(-1),Infinity,`Stage ${id} last cap must be open-ended`);
    assert(encounters.caps.every(c=>c.count<=encounters.maxEnemies),`Stage ${id} cap exceeds max`);
    assert(encounters.initialEnemies<=encounters.caps[0].count,`Stage ${id} too many initial enemies`);
    const eventTimes=encounters.events.map(e=>e.at);
    same(eventTimes,[...eventTimes].sort((a,b)=>a-b),`Stage ${id} events unordered`);
    assert.equal(new Set(encounters.events.map(e=>e.id)).size,eventTimes.length,`Stage ${id} duplicate event id`);
    for(const e of encounters.events.filter(e=>e.kind==='wave'))
      assert(['fast','ranged','tank','mixed'].includes(e.enemy),`Stage ${id} unknown wave enemy ${e.enemy}`);
    for(const kind of encounters.waveCycle)assert(encounters.waveLabels[kind],`Stage ${id} unlabeled wave ${kind}`);
    assert.equal(phases.at(-1).until,Infinity,`Stage ${id} last phase must be open-ended`);
    assert.equal(typeof stages.getPhase(stage,0),'string');
    // Only survival stages clear on time; objective stages must never clear by the timer alone.
    const timed=stage.clear.kind==='survive';
    assert.equal(stages.isClear(stage,stage.clear.seconds),timed,`Stage ${id} timer clear`);
    assert.equal(stages.isClear(stage,stage.clear.seconds-1),false);
    assert.equal(stages.getCap(stage,0,false),encounters.caps[0].count);
    assert(stages.getCap(stage,1e6,true)<=encounters.maxEnemies);
    assert.equal(stages.getRandomEnemy(stage,0,.99),'normal');
  }
});

test('progress: only Stage 1 is open for a fresh guest', ()=>{
  const {stages,progress}=load();
  same([1,2,3,4,5,6].map(id=>progress.isUnlocked(id,stages)),[true,false,false,false,false,false]);
});

test('progress: clearing a stage unlocks only the next implemented stage', ()=>{
  const {stages,progress}=load();
  progress.recordResult(1,{clear:true,kills:12});
  progress.recordResult(2,{clear:true,kills:30});
  progress.recordResult(3,{clear:false,kills:40});
  same([1,2,3,4].map(id=>progress.isUnlocked(id,stages)),[true,true,true,false]);
  progress.recordResult(3,{clear:true,kills:5});
  progress.recordResult(4,{clear:true,kills:9});
  assert.equal(progress.isUnlocked(4,stages),true);
  assert.equal(progress.isUnlocked(5,stages),true,'Stage 4 clear unlocks implemented Stage 5');
  assert.equal(progress.isUnlocked(6,stages),false,'Stage 6 waits for Stage 5 clear');
  progress.recordResult(5,{clear:true,kills:11});
  assert.equal(progress.isUnlocked(6,stages),true,'Stage 5 clear unlocks Stage 6');
  same(progress.read().stages['3'],{clear:true,bestKills:40},'Best kills and clear are monotonic');
});

test('progress: campaignClear is derived from all six clears', ()=>{
  const {progress}=load();
  for(let id=1;id<=5;id++)progress.recordResult(id,{clear:true,kills:id});
  assert.equal(progress.campaignClear(),false);
  progress.recordResult(6,{clear:true,kills:20});
  assert.equal(progress.campaignClear(),true);
});

test('progress: invalid input and legacy Stage 1 record', ()=>{
  const {progress,store}=load();
  store.set('inha-duck-survival-stage1-p14',JSON.stringify({clear:true,bestKills:7.9}));
  same(progress.read().stages,{1:{clear:true,bestKills:7}});
  assert(store.has('inha-duck-survival-stage1-p14'),'Legacy key is preserved');
  progress.recordResult(9,{clear:true,kills:1});
  progress.recordResult(2,{clear:'yes',kills:-5});
  same(progress.read().stages['2'],{clear:false,bestKills:0});
  assert.equal(progress.read().stages['9'],undefined);
  same(progress.normalize({schemaVersion:1,stages:{1:{clear:true}}}).stages,{});
});

test('progress: account merge keeps the best of both and scopes storage', ()=>{
  const {progress,store}=load();
  progress.recordResult(1,{clear:true,kills:3});
  const id='00000000-0000-4000-8000-000000000001';
  const merged=progress.useAccount(id,{schemaVersion:2,stages:{1:{clear:false,bestKills:10},2:{clear:true,bestKills:4}}});
  // A new account does not silently absorb guest records; it starts from its own cloud data.
  same(merged.stages,{1:{clear:false,bestKills:10},2:{clear:true,bestKills:4}});
  assert(store.has(`inha-duck-survival-progress-v2-account-${id}`));
  same(progress.importGuest().stages['1'],{clear:true,bestKills:10});
  assert.throws(()=>progress.useAccount('not-a-uuid',null));
  same(progress.clearAccount().stages['1'],{clear:true,bestKills:3},'Guest record is untouched');
});
