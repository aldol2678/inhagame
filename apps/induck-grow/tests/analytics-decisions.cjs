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
class MutationObserverMock{constructor(cb){this.cb=cb;observers.push(this)}observe(element){this.element=element}}
const screens={'screen-brief':new ElementMock('screen-brief'),'screen-recap':new ElementMock('screen-recap'),'screen-final':new ElementMock('screen-final')};
const client={async rpc(name,args){calls.push({name,args});return {data:true,error:null}}};
const windowMock={supabase:{createClient:()=>client},addEventListener:(t,f)=>{windowHandlers[t]=f}};
const documentMock={
  referrer:'https://inhagame.app/',hidden:false,
  getElementById:id=>screens[id]||null,
  querySelector:selector=>selector==='.screen.active'?Object.values(screens).find(x=>x.active)||null:null,
  addEventListener:(t,f)=>{documentHandlers[t]=f}
};
const context={
  console,URL,Promise,setTimeout,clearTimeout,Date,
  crypto:{randomUUID},Element:ElementMock,MutationObserver:MutationObserverMock,
  sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,String(v))},
  history:{replaceState(){}},
  location:{hostname:'grow.inhagame.app',origin:'https://grow.inhagame.app',href:'https://grow.inhagame.app/?src=everytime'},
  document:documentMock,
  fetch:async(url,init)=>{fetchCalls.push({url,init});return {ok:true}},
  state:{
    week:1,department:'culture',gpa:0,stamina:75,stress:20,money:70000,baseFree:6,skippedSlots:[],
    otChoice:null,priorityCourseId:null,clubId:null,clubTrack:null,councilId:null,councilTrack:null,
    flags:{},subscriptions:{},career:{language:{track:null},certificate:{track:null},contest:{mode:null}}
  },
  currentEvent:{id:'money_week',name:'돈 문제'},
  window:windowMock
};
windowMock.window=windowMock;

windowMock.chooseOT=function(choice){context.state.otChoice=choice};
windowMock.choosePriority=function(index){context.state.priorityCourseId=index};
windowMock.finalizeClubTrack=function(id,track){context.state.clubId=id;context.state.clubTrack=track};
windowMock.skipClubFair=function(){};
windowMock.joinCouncil=function(id,track){context.state.councilId=id;context.state.councilTrack=track};
windowMock.declineCouncil=function(){context.state.flags.COUNCIL_DECLINED=true};
windowMock.chooseEvent=function(){};
windowMock.chooseClubEvent=function(){};
windowMock.chooseCouncilEvent=function(){};
windowMock.toggleSubscription=function(id){
  if(context.state.subscriptions[id]) context.state.subscriptions[id]=false;
  else if(context.state.money>=29000){context.state.money-=29000;context.state.subscriptions[id]=true}
};
windowMock.chooseLanguageTrack=function(id){context.state.career.language.track=id};
windowMock.chooseCertificateTrack=function(id){context.state.career.certificate.track=id};
windowMock.startContest=function(mode){if(!context.state.career.contest.mode)context.state.career.contest.mode=mode};

vm.createContext(context);
vm.runInContext(code,context);
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
const decisions=()=>calls.filter(x=>x.name==='log_induck_grow_decision_v1');

(async()=>{
  await tick();

  windowMock.chooseOT('academic');await tick();
  assert.deepStrictEqual({...decisions().at(-1).args},{
    p_event_id:decisions().at(-1).args.p_event_id,
    p_session_id:decisions().at(-1).args.p_session_id,
    p_week:1,p_department:'culture',p_category:'orientation',p_decision_id:'ot',p_choice_id:'academic',
    p_acquisition_source:'everytime',p_campaign:null
  });

  windowMock.choosePriority(2);await tick();
  assert.equal(decisions().at(-1).args.p_category,'course');
  assert.equal(decisions().at(-1).args.p_choice_id,'course_2');

  windowMock.finalizeClubTrack('ingame','dev');await tick();
  assert.equal(decisions().at(-1).args.p_category,'club');
  assert.equal(decisions().at(-1).args.p_choice_id,'ingame_dev');

  windowMock.joinCouncil('department','dept');await tick();
  assert.equal(decisions().at(-1).args.p_category,'student_council');
  assert.equal(decisions().at(-1).args.p_choice_id,'department_dept');

  windowMock.chooseEvent('money_job');await tick();
  assert.equal(decisions().at(-1).args.p_category,'random_event');
  assert.equal(decisions().at(-1).args.p_decision_id,'money_week');
  assert.equal(decisions().at(-1).args.p_choice_id,'money_job');

  const beforeFail=decisions().length;
  context.state.money=1000;
  windowMock.toggleSubscription('ai');await tick();
  assert.equal(decisions().length,beforeFail,'failed subscription must not log');

  context.state.money=70000;
  windowMock.toggleSubscription('ai');await tick();
  assert.equal(decisions().at(-1).args.p_category,'subscription');
  assert.equal(decisions().at(-1).args.p_decision_id,'subscription_ai');
  assert.equal(decisions().at(-1).args.p_choice_id,'start');

  windowMock.toggleSubscription('ai');await tick();
  assert.equal(decisions().at(-1).args.p_choice_id,'cancel');

  windowMock.chooseLanguageTrack('score');await tick();
  assert.equal(decisions().at(-1).args.p_decision_id,'language_track');
  assert.equal(decisions().at(-1).args.p_choice_id,'score');

  windowMock.chooseCertificateTrack('data');await tick();
  assert.equal(decisions().at(-1).args.p_decision_id,'certificate_track');
  assert.equal(decisions().at(-1).args.p_choice_id,'data');

  windowMock.startContest('team');await tick();
  assert.equal(decisions().at(-1).args.p_decision_id,'contest_mode');
  assert.equal(decisions().at(-1).args.p_choice_id,'team');

  console.log('grow analytics P2B decision wrappers PASS');
})().catch(error=>{console.error(error);process.exitCode=1});
