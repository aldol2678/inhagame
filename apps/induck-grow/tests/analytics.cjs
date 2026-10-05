const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');

const code=fs.readFileSync(path.join(__dirname,'..','analytics.js'),'utf8');
const storage=new Map(),calls=[],fetchCalls=[],observers=[];
const documentHandlers={},windowHandlers={};

class ElementMock{
  constructor(id){this.id=id;this.active=false;this.onclick=null;this.classList={contains:name=>name==='active'&&this.active};}
  closest(name){return name==='button'?this:null}
  getAttribute(name){return name==='onclick'?this.onclick:null}
}
class MutationObserverMock{
  constructor(cb){this.cb=cb;this.element=null;observers.push(this)}
  observe(element){this.element=element}
}
const screens={
  'screen-brief':new ElementMock('screen-brief'),
  'screen-recap':new ElementMock('screen-recap'),
  'screen-final':new ElementMock('screen-final')
};
const client={async rpc(name,args){calls.push({name,args});return {data:true,error:null}}};
const windowMock={
  supabase:{createClient:()=>client},
  addEventListener:(type,fn)=>{windowHandlers[type]=fn}
};
const documentMock={
  referrer:'https://inhagame.app/',
  hidden:false,
  getElementById:id=>screens[id]||null,
  querySelector:selector=>selector==='.screen.active'?Object.values(screens).find(x=>x.active)||null:null,
  addEventListener:(type,fn)=>{documentHandlers[type]=fn}
};
const context={
  console,URL,Promise,setTimeout,clearTimeout,Date,
  crypto:{randomUUID},
  Element:ElementMock,
  MutationObserver:MutationObserverMock,
  sessionStorage:{
    getItem:k=>storage.has(k)?storage.get(k):null,
    setItem:(k,v)=>storage.set(k,String(v))
  },
  history:{replaceState(){}},
  location:{hostname:'grow.inhagame.app',origin:'https://grow.inhagame.app',href:'https://grow.inhagame.app/?src=everytime'},
  document:documentMock,
  fetch:async(url,init)=>{fetchCalls.push({url,init,body:JSON.parse(init.body)});return {ok:true}},
  state:{week:1,department:'culture',gpa:0,stamina:75,stress:20,money:70000,baseFree:6,skippedSlots:[]},
  window:windowMock
};
windowMock.window=windowMock;
vm.createContext(context);
vm.runInContext(code,context);

const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
(async()=>{
  await tick();
  assert.equal(calls[0].name,'log_induck_grow_analytics_v1');
  assert.equal(calls[0].args.p_event_type,'landing');
  assert.equal(calls[0].args.p_acquisition_source,'everytime');

  const play=new ElementMock('play');play.onclick='newGame()';
  documentHandlers.click({target:play});await tick();
  assert(calls.some(x=>x.args.p_event_type==='play_start'));

  screens['screen-brief'].active=true;
  observers.find(x=>x.element===screens['screen-brief']).cb();await tick();
  const start=calls.find(x=>x.args.p_event_type==='semester_start');
  assert.equal(start.args.p_week,1);assert.equal(start.args.p_department,'culture');

  screens['screen-brief'].active=false;
  screens['screen-recap'].active=true;
  context.state.week=4;context.state.stamina=61;context.state.stress=47;context.state.money=32500;
  observers.find(x=>x.element===screens['screen-recap']).cb();await tick();
  const checkpoint=calls.find(x=>x.name==='log_induck_grow_analytics_v1'&&x.args.p_event_type==='week_checkpoint');
  assert.equal(checkpoint.args.p_week,4);
  const resource=calls.find(x=>x.name==='log_induck_grow_resource_checkpoint_v1');
  assert.equal(resource.args.p_week,4);
  assert.equal(resource.args.p_department,'culture');
  assert.equal(resource.args.p_stamina,61);
  assert.equal(resource.args.p_stress,47);
  assert.equal(resource.args.p_money,32500);
  assert.equal(resource.args.p_free_slots,6);

  screens['screen-recap'].active=false;
  screens['screen-final'].active=true;
  context.state.week=15;context.state.gpa=3.75;
  observers.find(x=>x.element===screens['screen-final']).cb();await tick();
  const result=calls.find(x=>x.args.p_event_type==='semester_result');
  assert.equal(result.args.p_week,15);assert.equal(result.args.p_gpa,3.75);
  const completed=fetchCalls.find(x=>x.body.p_end_reason==='completed');
  assert(completed);
  assert.equal(completed.body.p_completed,true);
  assert.equal(completed.body.p_last_week,15);
  assert.equal(completed.body.p_last_screen,'screen-final');
  assert.equal(completed.body.p_final_gpa,3.75);
  assert.equal(completed.init.keepalive,true);

  await context.window.InduckGrowAnalytics.accountSave();
  assert(calls.some(x=>x.args.p_event_type==='account_save'));

  const retry=new ElementMock('retry');retry.onclick='replaySame()';
  documentHandlers.click({target:retry});await tick();
  assert(calls.some(x=>x.args.p_event_type==='retry'));

  screens['screen-final'].active=false;
  screens['screen-recap'].active=true;
  context.state.week=8;context.state.gpa=0;
  windowHandlers.pagehide();await tick();
  const exit=fetchCalls.find(x=>x.body.p_end_reason==='pagehide');
  assert(exit);
  assert.equal(exit.body.p_completed,false);
  assert.equal(exit.body.p_last_week,8);
  assert.equal(exit.body.p_last_screen,'screen-recap');

  console.log('grow analytics P1 + P2A client PASS');
})().catch(error=>{console.error(error);process.exitCode=1});