/* Shared, DOM-free rules for the Secret session, Result and Ranked Contract v4. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.SecretRun=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const PHASE=Object.freeze({NORMAL:'NORMAL',READY:'DRAGON_READY',CALLED:'DRAGON_CALLED',ECLIPSE:'ECLIPSE',FLIGHT:'FLIGHT',RESULT:'RESULT'});
  const TIMING=Object.freeze({normal:30000,called:700,eclipse:5000,flight:5000,combo:2400,comboAfterAscension:1950});
  const POINTS=Object.freeze({normal:1,speedy:2,gold:3,indeoki:5});
  const GAUGE_MAX=20;
  const ASCENSION_BONUS=Object.freeze({1:.20,2:.50});
  const RANKS=Object.freeze([
    {rank:'F',label:'미부화',score:0,rare:0,eclipse:0,flight:0,calls:0},
    {rank:'D0',label:'첫 날갯짓',score:90,rare:0,eclipse:0,flight:0,calls:1},
    {rank:'D+',label:'달빛 견습',score:130,rare:1,eclipse:3,flight:3,calls:1},
    {rank:'C0',label:'월식 관측자',score:170,rare:2,eclipse:4,flight:4,calls:1},
    {rank:'C+',label:'야간 추적자',score:210,rare:4,eclipse:5,flight:5,calls:1},
    {rank:'B0',label:'비룡 호출자',score:250,rare:5,eclipse:6,flight:6,calls:1},
    {rank:'B+',label:'비룡 기수',score:290,rare:6,eclipse:8,flight:8,calls:1},
    {rank:'A0',label:'승천 지휘자',score:350,rare:8,eclipse:10,flight:10,calls:2},
    {rank:'A+',label:'비룡의 눈',score:400,rare:10,eclipse:12,flight:12,calls:2}
  ]);
  const METRICS=[['totalScore','score','총점'],['rareCaptures','rare','희귀'],['eclipseCaptures','eclipse','월식'],['flightCaptures','flight','승천'],['completedCalls','calls','승천 완료']];
  const pausedPhase=phase=>phase===PHASE.ECLIPSE||phase===PHASE.FLIGHT;
  const comboWindow=run=>(run.completedCalls||0)>=1?TIMING.comboAfterAscension:TIMING.combo;
  function create(now=0){
    return {phase:PHASE.NORMAL,deadline:now+TIMING.normal,remainingMs:TIMING.normal,lastAdvancedAt:now,phaseDeadline:null,startedAt:now,gauge:0,combo:0,maxCombo:0,lastHit:null,
      dodgeStreak:0,dragonCalls:0,completedCalls:0,eclipseCompleted:false,flightCompleted:false,
      hits:{normal:0,speedy:0,gold:0,indeoki:0},annyongiHits:0,annyongiDodges:0,
      eclipseCaptures:0,flightCaptures:0,baseCapture:0,rareBonus:0,eclipseScore:0,flightScore:0,comboBonus:0,
      flightBasePoints:0,tier1Hits:0,tier2Hits:0,tier1GroundAward:0,tier2GroundAward:0,ascensionBonus:0};
  }
  function canCapture(run){return [PHASE.NORMAL,PHASE.READY,PHASE.ECLIPSE,PHASE.FLIGHT].includes(run.phase)}
  function total(run){return run.baseCapture+run.rareBonus+run.eclipseScore+run.flightScore+run.comboBonus+run.ascensionBonus}
  function syncReady(run){
    if([PHASE.NORMAL,PHASE.READY].includes(run.phase))run.phase=run.dragonCalls<2&&run.gauge>=GAUGE_MAX?PHASE.READY:PHASE.NORMAL;
    return run;
  }
  function transitionPhase(next,at){
    if(next.phase===PHASE.CALLED){next.phase=PHASE.ECLIPSE;next.phaseDeadline=at+TIMING.eclipse;}
    else if(next.phase===PHASE.ECLIPSE){next.phase=PHASE.FLIGHT;next.eclipseCompleted=true;next.phaseDeadline=at+TIMING.flight;}
    else if(next.phase===PHASE.FLIGHT){next.flightCompleted=true;next.completedCalls=(next.completedCalls||0)+1;next.phase=PHASE.NORMAL;next.phaseDeadline=null;syncReady(next);}
  }
  function advance(run,now){
    let next={...run,hits:{...run.hits}};
    let cursor=Number.isFinite(Number(next.lastAdvancedAt))?Number(next.lastAdvancedAt):Number(next.startedAt||0);
    now=Math.max(cursor,Number(now)||cursor);
    if(next.phase===PHASE.RESULT)return next;
    if(next.lastHit!==null&&now-next.lastHit>comboWindow(next))next.combo=0;
    for(let guard=0;guard<16&&cursor<now&&next.phase!==PHASE.RESULT;guard++){
      let boundary=now;if(next.phaseDeadline!==null)boundary=Math.min(boundary,next.phaseDeadline);
      const span=Math.max(0,boundary-cursor);
      if(!pausedPhase(next.phase)){
        if(span>=next.remainingMs){const finishAt=cursor+next.remainingMs;next.remainingMs=0;next.phase=PHASE.RESULT;next.phaseDeadline=null;next.endedAt=finishAt;cursor=finishAt;break;}
        next.remainingMs-=span;
      }
      cursor=boundary;
      if(next.phaseDeadline!==null&&cursor>=next.phaseDeadline&&next.phase!==PHASE.RESULT){transitionPhase(next,cursor);continue;}
      break;
    }
    next.lastAdvancedAt=next.phase===PHASE.RESULT?next.endedAt:now;
    next.deadline=next.phase===PHASE.RESULT?next.endedAt:now+next.remainingMs;
    return next;
  }
  function reduce(run,event){
    let next=advance(run,event.now);
    if(event.type==='TICK'||next.phase===PHASE.RESULT)return next;
    if(event.type==='CALL'){
      if(next.phase!==PHASE.READY||next.dragonCalls>=2)return next;
      return {...next,phase:PHASE.CALLED,gauge:0,dragonCalls:next.dragonCalls+1,phaseDeadline:event.now+TIMING.called,lastAdvancedAt:event.now};
    }
    if(!canCapture(next))return next;
    const chargeable=[PHASE.NORMAL,PHASE.READY].includes(next.phase)&&next.dragonCalls<2;
    if(event.type==='DODGE'){
      next.annyongiDodges++;next.dodgeStreak++;
      if(next.dodgeStreak===3){next.dodgeStreak=0;if(chargeable)next.gauge=Math.min(GAUGE_MAX,next.gauge+1);}
      return syncReady(next);
    }
    if(event.type!=='CAPTURE')return next;
    if(event.key==='annyongi')return syncReady({...next,annyongiHits:next.annyongiHits+1,gauge:chargeable?Math.max(0,next.gauge-5):next.gauge,combo:0,lastHit:null,dodgeStreak:0});
    if(!Object.hasOwn(POINTS,event.key))return next;
    const points=POINTS[event.key],rare=event.key==='gold'||event.key==='indeoki';
    const eclipse=next.phase===PHASE.ECLIPSE?2:0,flight=next.phase===PHASE.FLIGHT?points:0;
    next.hits={...next.hits,[event.key]:next.hits[event.key]+1};
    const limit=comboWindow(next);
    next.combo=next.lastHit!==null&&event.now-next.lastHit<=limit?next.combo+1:1;
    next.lastHit=event.now;next.maxCombo=Math.max(next.maxCombo,next.combo);
    const mult=next.combo>=10?2:next.combo>=5?1.5:1;
    const raw=points+eclipse+flight,awarded=Math.floor(raw*mult);
    next.baseCapture+=rare?1:points;next.rareBonus+=rare?points-1:0;
    next.eclipseScore+=eclipse;next.flightScore+=flight;
    next.comboBonus+=awarded-raw;
    if(eclipse)next.eclipseCaptures++;
    if(flight){next.flightCaptures++;next.flightBasePoints+=points;}
    const groundTier=[PHASE.NORMAL,PHASE.READY].includes(next.phase)?Number(next.completedCalls||0):0;
    if(groundTier===1){
      const before=next.tier1GroundAward;next.tier1Hits++;next.tier1GroundAward+=awarded;
      next.ascensionBonus+=Math.floor(next.tier1GroundAward*ASCENSION_BONUS[1])-Math.floor(before*ASCENSION_BONUS[1]);
    }else if(groundTier>=2){
      const before=next.tier2GroundAward;next.tier2Hits++;next.tier2GroundAward+=awarded;
      next.ascensionBonus+=Math.floor(next.tier2GroundAward*ASCENSION_BONUS[2])-Math.floor(before*ASCENSION_BONUS[2]);
    }
    if(chargeable)next.gauge=Math.min(GAUGE_MAX,next.gauge+(event.key==='indeoki'?3:event.key==='gold'?2:1));
    return syncReady(next);
  }
  function phaseProgress(run,now){
    if(!run||run.phaseDeadline===null)return 0;
    const duration=run.phase===PHASE.ECLIPSE?TIMING.eclipse:run.phase===PHASE.FLIGHT?TIMING.flight:run.phase===PHASE.CALLED?TIMING.called:0;
    if(!duration)return 0;
    return Math.max(0,Math.min(1,1-(run.phaseDeadline-now)/duration));
  }
  function contract(result){
    const checks=rank=>METRICS.map(([key,limit,label])=>{const value=Number(result[key]||0);return {key,label,value,required:rank[limit],met:value>=rank[limit],missing:Math.max(0,rank[limit]-value)};});
    let index=0;if(result.completed){for(let i=1;i<RANKS.length;i++){if(checks(RANKS[i]).every(c=>c.met))index=i;}}
    const next=RANKS[index+1],nextChecks=next?checks(next):[];
    return {version:5,rank:RANKS[index].rank,label:RANKS[index].label,checks:checks(RANKS[index]),nextRank:next?.rank||null,nextChecks,
      nextGoal:!result.completed?'월식 → 승천을 1회 완료':next?nextChecks.filter(c=>!c.met).map(c=>`${c.label} +${c.missing}`).join(' · '):'최고 학점 달성'};
  }
  function result(run){
    if(run.phase!==PHASE.RESULT)throw new Error('Result requires a finished run');
    const value={version:5,completed:(run.completedCalls||0)>0,completedCalls:run.completedCalls||0,captures:Object.values(run.hits).reduce((a,b)=>a+b,0),
      rareCaptures:run.hits.gold+run.hits.indeoki,hits:{...run.hits},eclipseCaptures:run.eclipseCaptures,flightCaptures:run.flightCaptures,
      baseCapture:run.baseCapture,rareBonus:run.rareBonus,eclipseScore:run.eclipseScore,flightScore:run.flightScore,comboBonus:run.comboBonus,
      flightBasePoints:run.flightBasePoints,tier1Hits:run.tier1Hits,tier2Hits:run.tier2Hits,
      tier1GroundAward:run.tier1GroundAward,tier2GroundAward:run.tier2GroundAward,ascensionBonus:run.ascensionBonus,
      totalScore:total(run),maxCombo:run.maxCombo,dragonCalls:run.dragonCalls,annyongiHits:run.annyongiHits,annyongiDodges:run.annyongiDodges,
      durationMs:run.endedAt-run.startedAt,activeDurationMs:TIMING.normal-run.remainingMs};
    value.contract=contract(value);return Object.freeze(value);
  }
  const count=value=>Number.isFinite(Number(value))?Math.max(0,Math.trunc(Number(value))):0;
  function normalizeHistory(value){
    const saved=value&&typeof value==='object'?value:{},legacyMap={B:'B0',A:'A0',S:'A+'};
    const bestContract=RANKS.some(r=>r.rank===saved.bestContract)?saved.bestContract:(legacyMap[saved.bestContract]||null);
    return {version:5,plays:count(saved.plays),bestScore:count(saved.bestScore),bestContract};
  }
  function record(history,runResult){
    const saved=normalizeHistory(history),rank=runResult.contract.rank;
    return {...saved,plays:saved.plays+1,bestScore:Math.max(saved.bestScore,runResult.totalScore),
      bestContract:RANKS.findIndex(r=>r.rank===rank)>RANKS.findIndex(r=>r.rank===saved.bestContract)?rank:saved.bestContract};
  }
  return Object.freeze({PHASE,TIMING,RANKS,GAUGE_MAX,ASCENSION_BONUS,create,reduce,advance,canCapture,total,result,contract,phaseProgress,comboWindow,normalizeHistory,record});
});
