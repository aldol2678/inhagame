// Classic · Stages, save/migration, badges, QA tooling and the game itself (spawn, input, timers,
// secret run, result).
// Classic script (not a module): shares one global scope with the other js/*.js files and must
// load in index.html order: dom -> online -> game -> boot.
const TYPES=[
  {key:'normal',points:1,label:'일반',weight:.46,moveMs:900},
  {key:'gold',points:3,label:'황금',weight:.16,moveMs:620},
  {key:'speedy',points:2,label:'날쌘',weight:.14,moveMs:420},
  {key:'indeoki',points:5,label:'인덕이',weight:.09,moveMs:700},
  {key:'annyongi',points:0,label:'안뇽이',weight:.15,moveMs:760}
];


const STAGE_CONFIGS=[
{id:1,key:'lake',label:'인경호',className:'stage-lake',seconds:35,speed:1.16,comboWindow:2600,annyongi:.10,fever:7,rareBoost:.75,spawn:{xMin:.10,xMax:.90,yMin:.22,yMax:.68},clear:{score:20},stars:[['60점 이상',s=>s.score>=60],['120점 + 10콤보',s=>s.score>=120&&s.maxCombo>=10],['200점 + 20콤보 + 안뇽이 1회 이하',s=>s.score>=200&&s.maxCombo>=20&&s.annyongiClicks<=1]]},
{id:2,key:'main',label:'본관',className:'stage-main',seconds:30,speed:1,comboWindow:2300,annyongi:.15,fever:5,rareBoost:1,spawn:{xMin:.12,xMax:.88,yMin:.35,yMax:.76},clear:{score:35},stars:[['55점 이상',s=>s.score>=55],['90점 + 8콤보',s=>s.score>=90&&s.maxCombo>=8],['145점 + 15콤보 + 안뇽이 1회 이하',s=>s.score>=145&&s.maxCombo>=15&&s.annyongiClicks<=1]]},
{id:3,key:'library',label:'정석학술정보관',className:'stage-library',seconds:25,speed:.84,comboWindow:2100,annyongi:.19,fever:5,rareBoost:1.25,spawn:{xMin:.12,xMax:.88,yMin:.32,yMax:.75},clear:{score:40,maxAnnyongi:4},stars:[['45점 + 안뇽이 2회 이하',s=>s.score>=45&&s.annyongiClicks<=2],['70점 + 6콤보 + 안뇽이 1회 이하',s=>s.score>=70&&s.maxCombo>=6&&s.annyongiClicks<=1],['110점 + 10콤보 + 안뇽이 0회',s=>s.score>=110&&s.maxCombo>=10&&s.annyongiClicks===0]]},
{id:4,key:'backgate',label:'후문',className:'stage-backgate',seconds:23,speed:.76,comboWindow:2050,annyongi:.19,fever:4,rareBoost:1.55,spawn:{xMin:.15,xMax:.85,yMin:.30,yMax:.73},clear:{score:45,minCombo:5},stars:[['45점 + 5콤보',s=>s.score>=45&&s.maxCombo>=5],['70점 + 6콤보',s=>s.score>=70&&s.maxCombo>=6],['100점 + 6콤보 + 안뇽이 1회 이하',s=>s.score>=100&&s.maxCombo>=6&&s.annyongiClicks<=1]]},
{id:5,key:'secret',label:'비룡의 밤',className:'stage-secret',seconds:30,speed:.82,comboWindow:2200,annyongi:.16,fever:5,rareBoost:1.0,spawn:{xMin:.12,xMax:.88,yMin:.28,yMax:.74},secret:true,clear:{score:0},stars:[]}
];
const LEGACY_SAVE_KEY='inhaDuckStageProgressV8';
const SAVE_KEY='inhaDuckProgressV2';
const STAR_RULES_VERSION=2,GRADE_RULES_VERSION=5;

function blankStageProgress(){
  return {cleared:false,stars:0,bestScore:0,bestCombo:0,playCount:0,clearCount:0};
}
function defaultProgress(){
  return {
    version:2,starRulesVersion:STAR_RULES_VERSION,gradeRulesVersion:GRADE_RULES_VERSION,
    unlockedStage:1,totalPlays:0,bestCombo:0,
    stages:{1:blankStageProgress(),2:blankStageProgress(),3:blankStageProgress(),4:blankStageProgress()},
    hidden:{unlocked:false,cleared:false,bestScore:0,bestCombo:0,playCount:0,titleUnlocked:false,unlockSeen:false}
  };
}
function normalizeProgress(p){
  const d=defaultProgress();
  if(!p||typeof p!=='object')return d;
  const resetStars=Number(p.starRulesVersion||0)!==STAR_RULES_VERSION;
  const resetGrade=Number(p.gradeRulesVersion||0)!==GRADE_RULES_VERSION;
  d.version=2;d.starRulesVersion=STAR_RULES_VERSION;d.gradeRulesVersion=GRADE_RULES_VERSION;
  d.unlockedStage=Math.max(1,Math.min(4,Number(p.unlockedStage||1)));
  d.totalPlays=Math.max(0,Number(p.totalPlays||0));d.bestCombo=Math.max(0,Number(p.bestCombo||0));
  for(let id=1;id<=4;id++){
    const src=(p.stages&&p.stages[id])||{};
    d.stages[id]={cleared:!!src.cleared,stars:resetStars?0:Math.max(0,Math.min(3,Number(src.stars||0))),
      bestScore:Math.max(0,Number(src.bestScore||0)),bestCombo:Math.max(0,Number(src.bestCombo||0)),
      playCount:Math.max(0,Number(src.playCount||0)),clearCount:Math.max(0,Number(src.clearCount||0))};
  }
  if(p.hidden&&typeof p.hidden==='object')d.hidden={...d.hidden,...p.hidden};
  d.hidden.sessionV2=SecretRun.normalizeHistory(d.hidden.sessionV2);
  if(resetGrade){
    d.hidden.cleared=false;d.hidden.bestScore=0;d.hidden.bestCombo=0;d.hidden.playCount=0;
    d.hidden.sessionV2=SecretRun.normalizeHistory();
  }
  if(resetStars){d.hidden.unlocked=false;d.hidden.unlockSeen=false;}
  d.hidden.titleUnlocked=false;
  return d;
}
function migrateLegacyProgress(){
  const p=defaultProgress();
  let legacy=null;
  try{legacy=JSON.parse(localStorage.getItem(LEGACY_SAVE_KEY)||'null')}catch(e){}
  if(legacy){
    p.unlockedStage=Math.max(1,Math.min(4,Number(legacy.unlocked||1)));
    for(let id=1;id<=4;id++){
      const stars=Math.max(0,Math.min(3,Number((legacy.stars||{})[id]||0)));
      const inferredClear=stars>0||id<p.unlockedStage;
      p.stages[id].stars=stars;
      p.stages[id].bestScore=Math.max(0,Number((legacy.best||{})[id]||0));
      p.stages[id].cleared=inferredClear;
      if(inferredClear){p.stages[id].playCount=1;p.stages[id].clearCount=1}
    }
  }

  // Recover any recent exact counts/combos that the QA logger already knows.
  try{
    const runs=JSON.parse(localStorage.getItem('inhaDuckBalanceQARunsV93')||'[]');
    if(Array.isArray(runs)&&runs.length){
      p.totalPlays=runs.length;
      for(let id=1;id<=4;id++){
        const rs=runs.filter(r=>Number(r.stageId)===id);
        if(!rs.length)continue;
        const sp=p.stages[id];
        sp.playCount=Math.max(sp.playCount,rs.length);
        sp.clearCount=Math.max(sp.clearCount,rs.filter(r=>r.clear).length);
        sp.cleared=sp.cleared||sp.clearCount>0;
        sp.bestScore=Math.max(sp.bestScore,...rs.map(r=>Number(r.score||0)));
        sp.bestCombo=Math.max(sp.bestCombo,...rs.map(r=>Number(r.maxCombo||0)));
        sp.stars=Math.max(sp.stars,...rs.map(r=>Number(r.stars||0)));
        p.bestCombo=Math.max(p.bestCombo,sp.bestCombo);
      }
    }
  }catch(e){}
  for(let id=1;id<=4;id++)p.stages[id].stars=0;
  p.starRulesVersion=STAR_RULES_VERSION;p.gradeRulesVersion=GRADE_RULES_VERSION;p.hidden.unlocked=false;p.hidden.titleUnlocked=false;
  p.hidden.sessionV2={...SecretRun.normalizeHistory(p.hidden.sessionV2),bestContract:null};
  try{localStorage.setItem(SAVE_KEY,JSON.stringify(p))}catch(e){}
  return p;
}
function loadProgress(){
  try{
    const saved=JSON.parse(localStorage.getItem(SAVE_KEY)||'null');
    if(saved&&saved.version===2)return normalizeProgress(saved);
  }catch(e){}
  return migrateLegacyProgress();
}

let progress=loadProgress();
void submitIncidentRecoveryOnce();
void flushRankedRecoveryQueue();
const PREVIEW_RANKED_UNLOCK=!CLASSIC_PRODUCTION_HOSTS.has(location.hostname);
const QA_SECRET_BYPASS = new URLSearchParams(location.search).get('qa')==='secret' && PREVIEW_RANKED_UNLOCK;
function rankedUnlocked(){return progress.hidden.unlocked||PREVIEW_RANKED_UNLOCK}
if(QA_SECRET_BYPASS){
  for(let id=1;id<=4;id++){
    progress.stages[id].cleared=true;
    progress.stages[id].stars=3;
  }
  progress.unlockedStage=4;
  progress.hidden.unlocked=true;
  saveProgress();
}
let currentStageIndex=QA_SECRET_BYPASS?STAGE_CONFIGS.findIndex(s=>s.secret):0;
function stageCfg(){return STAGE_CONFIGS[currentStageIndex]}
function isSecretStage(){return stageCfg().id===5}
function totalStars(){return Object.values(progress.stages).reduce((sum,s)=>sum+Number(s.stars||0),0)}
function generalBestTotal(){return Object.values(progress.stages).reduce((sum,s)=>sum+Number(s.bestScore||0),0)}
function currentGeneralBadge(){return BadgeSystem.general(generalBestTotal(),totalStars())}
function currentGradeBadge(){
  const h=progress.hidden.sessionV2;
  return Number(h?.plays||0)>0?BadgeSystem.grade(h.bestContract||'F'):null;
}
function badgeChip(b,kind='general',locked=false){
  if(!b)return '';
  const text=kind==='grade'?b.code+' · '+b.label:b.label;
  const cls=String(b.code).replace('+','plus');
  return '<span class="achievement-badge '+kind+' badge-'+cls+(locked?' locked':'')+'">'+b.icon+' <strong>'+escapeHtml(text)+'</strong></span>';
}
function badgePairHtml(generalCode,gradeCode){
  return badgeChip(BadgeSystem.generalByCode(generalCode),'general')+badgeChip(BadgeSystem.grade(gradeCode||'F'),'grade');
}
function eventBadgeHtml(code){
  return code?badgeChip(BadgeSystem.eventByCode(code),'event'):'';
}
function inhaBadgeHtml(verified=inhaBadgeVerified){
  return verified?'<span class="achievement-badge inha-mail">🎓 <strong>인하 메일 인증</strong></span>':'';
}
function renderBadges(){
  const g=currentGeneralBadge(),r=currentGradeBadge();
  myBadgeRow.innerHTML=badgeChip(g,'general')+(r?badgeChip(r,'grade'):'')+eventBadgeHtml(eventBadgeCode)+inhaBadgeHtml();
  const earnedG=new Set(BadgeSystem.earnedGeneral(generalBestTotal(),totalStars()).map(b=>b.code));
  generalBadgeCollection.innerHTML=BadgeSystem.GENERAL.map(b=>'<div class="badge-card">'+badgeChip(b,'general',!earnedG.has(b.code))+'<div class="badge-req">'+(b.code==='freshman'?'기본 획득':b.score+'점 + ★'+b.stars)+'</div></div>').join('');
  const gradeCode=r?.code||null,earnedR=new Set(gradeCode?BadgeSystem.earnedGrades(gradeCode).map(b=>b.code):[]);
  inhaBadgeCollection.innerHTML='<div class="badge-card"><span class="achievement-badge inha-mail'+(inhaBadgeVerified?'':' locked')+'">🎓 <strong>인하 메일 인증</strong></span><div class="badge-req">인하대 메일(@inha.edu / @inha.ac.kr) 소유 확인 · 재학 인증 아님</div></div>';
  gradeBadgeCollection.innerHTML=BadgeSystem.GRADES.map(b=>{
    const rule=SecretRun.RANKS.find(x=>x.rank===b.code);
    const req=b.code==='F'?'비룡의 밤 첫 도전':rule.score+'점 · 승천 '+rule.calls+'회';
    return '<div class="badge-card">'+badgeChip(b,'grade',!earnedR.has(b.code))+'<div class="badge-req">'+req+'</div></div>';
  }).join('');
}
function openBadgeCollection(){renderBadges();badgeOverlay.classList.remove('hidden')}
function closeBadgeCollection(){badgeOverlay.classList.add('hidden')}
function saveProgress(){
  try{
    localStorage.setItem(SAVE_KEY,JSON.stringify(progress));
    scheduleCloudProgressSync();
    return true;
  }
  catch(e){showToast('저장 공간을 사용할 수 없어 이번 기록은 임시로 유지됩니다.');return false}
}
function checkSecretUnlock(){
  if(totalStars()>=10&&!progress.hidden.unlocked){
    progress.hidden.unlocked=true;
    saveProgress();
    return true;
  }
  return false;
}
function applyStage(){
  resetStageTransientUi();
  ['stage-lake','stage-main','stage-library','stage-backgate','stage-secret','secret-phase-1','secret-phase-2','secret-phase-3','secret-phase-4','dragon-burst'].forEach(c=>game.classList.remove(c));
  const s=stageCfg();game.classList.add(s.className);
  stageBadge.textContent=s.secret?'SECRET · 비룡의 밤':`Stage ${s.id} · ${s.label}`;
  document.getElementById('stageSummary').textContent=s.label;
  const secret=s.secret===true;
  dragonMeter.classList.toggle('hidden',!secret);
  dragonCallBtn.classList.toggle('hidden',!secret);
  secretDragon.classList.toggle('hidden',!secret);
  moonZone.classList.add('hidden');
  flightLayer.classList.add('hidden');
  if(secret)game.classList.add('secret-phase-1');
}
function renderStageGrid(){
  checkSecretUnlock();
  const grid=document.getElementById('stageGrid');grid.innerHTML='';
  STAGE_CONFIGS.filter(s=>!s.secret).forEach((s,i)=>{
    const sp=progress.stages[s.id]||blankStageProgress();
    const unlocked=s.id<=progress.unlockedStage,stars=Number(sp.stars||0);
    const b=document.createElement('button');
    b.className='stage-card '+(!unlocked?'locked ':'')+(i===currentStageIndex?'selected':'');
    const best=sp.bestScore>0?sp.bestScore:'--';
    b.innerHTML=`<div class="stage-thumb thumb-${s.key}"><div class="thumb-top"><span class="stage-chip">STAGE ${s.id}</span><span class="diff-chip diff-${s.id}">${s.id===1?'입문':s.id===2?'표준':s.id===3?'집중':'최종'}</span></div></div><div class="stage-name">${s.label}</div><div class="card-bottom"><div class="stars">${'★'.repeat(stars)}${'☆'.repeat(3-stars)}</div><div class="record-mini">BEST ${best} · C${sp.clearCount}</div></div>${!unlocked?'<div class="lock">🔒</div>':''}`;
    if(unlocked)b.onclick=()=>{currentStageIndex=i;applyStage();renderStageGrid();document.getElementById('stageSummary').textContent=s.label;};
    grid.appendChild(b);
  });

  secretStageSlot.innerHTML='';
  if(rankedUnlocked()){
    secretStageSlot.classList.remove('hidden');
    const secret=STAGE_CONFIGS.find(s=>s.secret);
    const b=document.createElement('button');
    b.className='secret-stage-card '+(stageCfg().secret?'selected':'');
    const best=Number(progress.hidden.bestScore||0);
    b.innerHTML=`<span class="secret-icon">🐲</span><span><span class="secret-name">비룡의 밤</span></span><span class="secret-best">BEST ${best||'--'}</span>`;
    b.onclick=()=>{currentStageIndex=STAGE_CONFIGS.findIndex(s=>s.secret);applyStage();renderStageGrid();document.getElementById('stageSummary').textContent='비룡의 밤';};
    secretStageSlot.appendChild(b);
  }else{
    secretStageSlot.classList.add('hidden');
  }

  const total=totalStars();
  const clears=Object.values(progress.stages).filter(s=>s.cleared).length;
  const gate=PREVIEW_RANKED_UNLOCK?'🐲 랭킹전 TEST OPEN':total>=12?'CAMPUS PERFECT':total>=10?'🐲 랭킹전 해금':`랭킹전까지 ${10-total}★`;
  document.getElementById('totalStars').textContent=`★ ${total}/12 · ${gate} · C${clears}/4`;
  playerTitleBadge.classList.add('hidden');
  const rankedTab=document.querySelector('[data-ranking-mode="ranked"]');if(rankedTab){rankedTab.disabled=!rankedUnlocked();rankedTab.textContent=rankedUnlocked()?'랭킹전':'랭킹전 🔒';}
  renderBadges();
}

const QA_RUN_KEY='inhaDuckBalanceQARunsV93';
const QA_TESTER_KEY='inhaDuckBalanceQATesterV1';
const QA_MAX_RUNS=300;
const QA_TARGETS={
  1:'설계 참고 CLEAR 80%+',
  2:'설계 참고 CLEAR 60~70%',
  3:'설계 참고 CLEAR 45~60%',
  4:'설계 참고 CLEAR 30~45%'
};
function qaTesterId(){
  let id=localStorage.getItem(QA_TESTER_KEY);
  if(!id){
    id=(crypto.randomUUID?crypto.randomUUID():'qa-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8));
    localStorage.setItem(QA_TESTER_KEY,id);
  }
  return id;
}
function qaLoadRuns(){
  try{return JSON.parse(localStorage.getItem(QA_RUN_KEY)||'[]')}catch(e){return []}
}
function qaStoreRuns(runs){
  localStorage.setItem(QA_RUN_KEY,JSON.stringify(runs.slice(-QA_MAX_RUNS)));
}
function qaAttemptIndex(stageId){
  return qaLoadRuns().filter(r=>r.stageId===stageId).length+1;
}
let qaRun=null;

let score=0,time=30,playing=false,timerId=null,moveId=null,current=TYPES[0];
let combo=0,maxCombo=0,lastGoodHit=0,comboTimeoutMs=1200;
let annyongiSpawned=0,annyongiClicked=0,indeokHits=0,goldHits=0;
let audioCtx=null;
const SOUND_PREF_KEY='inhaDuckSoundEnabled';
let soundEnabled=localStorage.getItem(SOUND_PREF_KEY)!=='false';
let playState='HOME',pauseStartedAt=0;
let waveActive=false,focusActive=false,finalRushActive=false,rushHourActive=false,campusComboActive=false;
let campusComboTriggers=0;
let waveTimer=null,focusTimer=null,campusComboTimer=null,burstTimer=null,labelTimer=null;
let lastWaveAt=-999,lastFocusAt=-999;
let hiddenPhase=1,dragonCharge=0,dragonBurstActive=false,dragonBurstTimer=null;
let moonGauge=0,annyongiDodges=0,dodgeStreak=0;
const {PHASE}=SecretRun;
const SECRET_GAUGE_MAX=SecretRun.GAUGE_MAX||20;
let secretRun=null,runResult=null,secretTickId=null;
let dragonCalls=0,moonBonusHits=0;
let normalHits=0,speedyHits=0,lastSecretSpawnKey='',flightSpawnTimer=null;
let secretFocusCycleStart=0,secretDifficultyTier=0;
let flightRider=null,flightTargetId=0,runGeneration=0;
renderStageGrid();applyStage();



function qaStartRun(){
  const s=stageCfg();
  qaRun={
    schema:1,build:'v9.3-QA',testerId:qaTesterId(),
    runId:(crypto.randomUUID?crypto.randomUUID():'run-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8)),
    startedAt:Date.now(),stageId:s.id,stageName:s.label,attempt:qaAttemptIndex(s.id),
    hits:{normal:0,gold:0,speedy:0,indeoki:0,annyongi:0},
    totalClicks:0,successfulClicks:0,
    regionalBonusHits:0,regionalBonusScore:0,
    finalRushHits:0,finalRushScore:0,
    mechanics:{waveActivations:0,focusActivations:0,campusCombos:0,rushBursts:0,finalRush:false},
    penalties:{score:0,time:0,combo:0,scorecombo:0,timecombo:0,scoreLost:0,timeLost:0,events:[]}
  };
}
function qaLogPenalty(p){
  if(!qaRun)return;
  if(qaRun.penalties[p.type]!==undefined)qaRun.penalties[p.type]++;
  if(p.type==='score'||p.type==='scorecombo')qaRun.penalties.scoreLost+=Number(p.amount||0);
  if(p.type==='time'||p.type==='timecombo')qaRun.penalties.timeLost+=Number(p.amount||0);
  qaRun.penalties.events.push({type:p.type,amount:Number(p.amount||0),label:p.label,timeRemaining:time});
}
function qaFailReasons(st){
  const c=stageCfg().clear,reasons=[];
  if(st.score<c.score)reasons.push(`점수 ${st.score}/${c.score}`);
  if(c.maxAnnyongi!==undefined&&st.annyongiClicks>c.maxAnnyongi)reasons.push(`안뇽이 ${st.annyongiClicks}/${c.maxAnnyongi}`);
  if(c.minCombo!==undefined&&st.maxCombo<c.minCombo)reasons.push(`콤보 ${st.maxCombo}/${c.minCombo}`);
  return reasons;
}
function qaFinishRun(st,clear,stars){
  if(!qaRun)return;
  qaRun.finishedAt=Date.now();
  qaRun.durationMs=qaRun.finishedAt-qaRun.startedAt;
  qaRun.score=st.score;qaRun.clear=clear;qaRun.stars=stars;
  qaRun.maxCombo=st.maxCombo;qaRun.annyongiClicks=st.annyongiClicks;
  qaRun.indeokHits=st.indeokHits;qaRun.goldHits=st.goldHits;
  qaRun.dodgedAnnyongi=Number(target.dataset.dodged)||0;
  qaRun.failReasons=clear?[]:qaFailReasons(st);
  qaRun.campusComboTriggers=campusComboTriggers;
  const runs=qaLoadRuns();runs.push(qaRun);qaStoreRuns(runs);
  qaRun=null;
}
function qaAvg(arr,key){
  if(!arr.length)return 0;
  return arr.reduce((sum,x)=>sum+Number(typeof key==='function'?key(x):x[key]||0),0)/arr.length;
}
function qaPct(n,d){return d?Math.round(n/d*100):0}
function qaSummary(){
  const runs=qaLoadRuns();
  return STAGE_CONFIGS.filter(s=>!s.secret).map(s=>{
    const rs=runs.filter(r=>r.stageId===s.id),n=rs.length;
    return {
      id:s.id,name:s.label,n,
      clearRate:qaPct(rs.filter(r=>r.clear).length,n),
      threeStarRate:qaPct(rs.filter(r=>r.stars===3).length,n),
      avgScore:qaAvg(rs,'score'),
      avgCombo:qaAvg(rs,'maxCombo'),
      avgAnnyongi:qaAvg(rs,'annyongiClicks'),
      avgFinalRush:qaAvg(rs,r=>r.finalRushScore),
      avgRegional:qaAvg(rs,r=>r.regionalBonusScore)
    };
  });
}
function qaSummaryText(){
  const lines=[`[인하 오리 잡기 Balance QA v9.3]`,`Tester ${qaTesterId().slice(0,8)}`];
  qaSummary().forEach(s=>{
    lines.push(`S${s.id} ${s.name} | N=${s.n} | CLEAR ${s.clearRate}% | 3★ ${s.threeStarRate}% | 평균 ${s.avgScore.toFixed(1)} | 콤보 ${s.avgCombo.toFixed(1)} | 안뇽이 ${s.avgAnnyongi.toFixed(1)} | Final ${s.avgFinalRush.toFixed(1)} | 지역 ${s.avgRegional.toFixed(1)}`);
  });
  return lines.join('\n');
}
function renderQAPanel(){
  const summaries=qaSummary();
  qaSummaryGrid.innerHTML='';
  summaries.forEach(s=>{
    const card=document.createElement('div');card.className='qa-stage-card';
    card.innerHTML=`<div class="qa-stage-top"><div class="qa-stage-title">Stage ${s.id} · ${s.name}</div><div class="qa-sample ${s.n<10?'low':''}">${s.n<10?'표본 부족 · ':''}${s.n}판</div></div>
      <div class="qa-metrics">
        <div class="qa-metric">CLEAR<strong>${s.clearRate}%</strong></div>
        <div class="qa-metric">3★<strong>${s.threeStarRate}%</strong></div>
        <div class="qa-metric">평균 점수<strong>${s.avgScore.toFixed(1)}</strong></div>
        <div class="qa-metric">평균 콤보<strong>${s.avgCombo.toFixed(1)}</strong></div>
        <div class="qa-metric">안뇽이 클릭<strong>${s.avgAnnyongi.toFixed(1)}</strong></div>
        <div class="qa-metric">Final 점수<strong>${s.avgFinalRush.toFixed(1)}</strong></div>
      </div><div class="qa-target">${QA_TARGETS[s.id]} · 지역 보너스 평균 ${s.avgRegional.toFixed(1)}점</div>`;
    qaSummaryGrid.appendChild(card);
  });
  const recent=qaLoadRuns().slice(-6).reverse();
  qaRecentRuns.innerHTML=recent.length?recent.map(r=>`<div class="qa-run-row"><span>S${r.stageId} ${r.clear?'CLEAR':'FAIL'} · ${r.score}점 · ${r.stars}★</span><span>콤보 ${r.maxCombo} · 안뇽이 ${r.annyongiClicks}</span></div>`).join(''):'<div class="qa-run-row"><span>아직 기록이 없습니다.</span></div>';
}
function openQAPanel(){renderQAPanel();qaOverlay.classList.remove('hidden')}
function closeQAPanel(){qaOverlay.classList.add('hidden')}


function updateMoonGauge(){
  const phase=secretRun?.phase,now=performance.now();
  let pct=Math.round((moonGauge/SECRET_GAUGE_MAX)*100),countText=moonGauge+'/'+SECRET_GAUGE_MAX,icon='🌙';
  if(phase===PHASE.ECLIPSE||phase===PHASE.FLIGHT){
    pct=Math.round(SecretRun.phaseProgress(secretRun,now)*100);countText=pct+'%';icon=phase===PHASE.ECLIPSE?'🌘':'🐲';
  }else if(phase===PHASE.CALLED){
    pct=Math.round(SecretRun.phaseProgress(secretRun,now)*100);countText='진입';icon='🐲';
  }
  dragonMeter.querySelector('span').textContent=icon;dragonFill.style.width=pct+'%';dragonCount.textContent=countText;
  dragonMeter.classList.toggle('moon-max',phase===PHASE.READY);
  const ready=isSecretStage()&&playing&&phase===PHASE.READY;
  dragonCallBtn.classList.toggle('ready',ready);dragonCallBtn.disabled=!ready;
  const label=dragonCallBtn.querySelector('.dragon-call-label'),state=dragonCallBtn.querySelector('.dragon-call-state');
  label.textContent=phase===PHASE.CALLED?'진입 중':phase===PHASE.ECLIPSE?'월식':phase===PHASE.FLIGHT?'승천 중':dragonCalls>=2?'호출 완료':`호출 ${dragonCalls+1}/2`;
  state.textContent=ready?'READY':phase===PHASE.ECLIPSE||phase===PHASE.FLIGHT?countText:phase===PHASE.CALLED?'…':dragonCalls>=2?'2/2':moonGauge+'/'+SECRET_GAUGE_MAX;
}
function setMoonGauge(value){moonGauge=Math.max(0,Math.min(SECRET_GAUGE_MAX,Math.trunc(Number(value)||0)));updateMoonGauge()}
function updateDragonMeter(){updateMoonGauge()}
function syncSecretHUD(){
  moonGauge=secretRun.gauge;combo=secretRun.combo;maxCombo=secretRun.maxCombo;lastGoodHit=secretRun.lastHit||0;
  normalHits=secretRun.hits.normal;speedyHits=secretRun.hits.speedy;goldHits=secretRun.hits.gold;indeokHits=secretRun.hits.indeoki;
  annyongiClicked=secretRun.annyongiHits;annyongiDodges=secretRun.annyongiDodges;dodgeStreak=secretRun.dodgeStreak;
  dragonCalls=secretRun.dragonCalls;moonBonusHits=secretRun.eclipseCaptures;score=SecretRun.total(secretRun);
  scoreEl.textContent=score;updateMoonGauge();updateCombo();
}
function sendSecretEvent(type,key){
  if(!playing||!secretRun)return;
  const previous=secretRun.phase;
  secretRun=SecretRun.reduce(secretRun,{type,key,now:performance.now()});
  syncSecretHUD();
  if(previous!==secretRun.phase)renderSecretPhase(previous);
}
function registerAnnyongiDodge(){
  sendSecretEvent('DODGE');
  if(playing)showToast(dodgeStreak?'👀 DODGE '+dodgeStreak+'/3':'👀 DODGE ×3 · 달빛 +1');
}
function secretComboMultiplier(){return combo>=10?2:combo>=5?1.5:1}
function handleSecretHit(type,el,x,y){
  const before=score;
  sendSecretEvent('CAPTURE',type.key);
  if(!playing)return;
  if(type.key==='annyongi'){
    flashHudCard(comboEl);badFeedback();
    const chargePenalty=[PHASE.NORMAL,PHASE.READY].includes(secretRun?.phase)&&dragonCalls<2;
    fx(x,y,chargePenalty?'🌙 -5':'함정!','bad');
    showToast(chargePenalty?'안뇽이! 승천 게이지 -5 · 콤보 초기화':'안뇽이! 콤보 초기화');
    return;
  }
  if(combo===5)comboBurst('5 COMBO · x1.5');
  if(combo===10)comboBurst('10 COMBO · x2');
  fx(x,y,'+'+(score-before),type.key==='indeoki'?'special':'good');
}
function clearFlightLayer(){
  clearTimeout(flightSpawnTimer);flightSpawnTimer=null;
  [...flightLayer.children].forEach(el=>{clearTimeout(el.expiry);el.remove()});
  flightRider=null;
}
function flightTargetContent(type){
  if(type.key==='annyongi')return '<img alt="안뇽이" src="'+annyongiImg.src+'">';
  if(type.key==='indeoki')return '<img alt="인덕이" src="'+indeokiImg.src+'">';
  return '<span class="flight-duck">🦆</span>';
}
function spawnFlightTarget(){
  if(!playing||secretRun?.phase!==PHASE.FLIGHT||flightLayer.querySelectorAll('.flight-target').length>=2)return;
  const type=choose(),el=document.createElement('button');
  const slots=[{x:22,y:32},{x:50,y:32},{x:78,y:32},{x:22,y:54},{x:50,y:54},{x:78,y:54}];
  const used=[...flightLayer.querySelectorAll('.flight-target')].map(el=>Number(el.dataset.slot));
  const free=slots.map((_,i)=>i).filter(i=>!used.includes(i)),slot=free[Math.floor(Math.random()*free.length)],pos=slots[slot];
  el.type='button';el.className='flight-target '+type.key;el.innerHTML=flightTargetContent(type);
  el.dataset.slot=slot;el.dataset.kind=type.key;el.dataset.flightId=++flightTargetId;
  el.dataset.spawnedAt=String(performance.now());
  el.setAttribute('aria-label',type.key==='annyongi'?'안뇽이 · 피하세요':type.label+' 공중 포획');
  el.style.left=pos.x+'%';el.style.top=pos.y+'%';flightLayer.appendChild(el);
  el.onclick=()=>{
    sendSecretEvent('TICK');
    if(!playing||secretRun.phase!==PHASE.FLIGHT||el.disabled||!el.isConnected)return;
    recordRankedReaction(el.dataset.spawnedAt);
    el.disabled=true;clearTimeout(el.expiry);
    flightRider.style.left=pos.x+'%';
    const r=game.getBoundingClientRect(),er=el.getBoundingClientRect(),x=er.left+er.width/2-r.left,y=er.top+er.height/2-r.top;
    soundFor(type.key);hitRipple(x,y);spawnParticles(x,y,type.key);handleSecretHit(type,el,x,y);el.remove();
  };
  const generation=runGeneration;
  el.expiry=setTimeout(()=>{
    if(el.isConnected&&generation===runGeneration&&playing&&secretRun.phase===PHASE.FLIGHT&&type.key==='annyongi')registerAnnyongiDodge();
    el.remove();
  },type.key==='speedy'?1400:2000);
}
function scheduleFlightTargets(){
  if(!playing||secretRun?.phase!==PHASE.FLIGHT)return;
  spawnFlightTarget();flightSpawnTimer=setTimeout(scheduleFlightTargets,550);
}
function setSecretFocus(on){
  focusActive=!!on;
  game.classList.toggle('focus-mode',focusActive);
  tag.classList.toggle('hidden',focusActive);
}
function resetSecretDifficulty(){
  secretFocusCycleStart=0;secretDifficultyTier=0;
  setSecretFocus(false);game.classList.remove('dragon-peak');
}
function updateSecretDifficulty(){
  if(!isSecretStage()||!secretRun){resetSecretDifficulty();return;}
  const normalish=[PHASE.NORMAL,PHASE.READY].includes(secretRun.phase);
  const tier=Number(secretRun.completedCalls||0)>=2?2:Number(secretRun.completedCalls||0)>=1?1:0;
  if(tier!==secretDifficultyTier){
    secretDifficultyTier=tier;secretFocusCycleStart=performance.now();
  }
  if(!normalish){setSecretFocus(false);game.classList.remove('dragon-peak');return;}
  if(tier===0){
    setSecretFocus(false);game.classList.remove('dragon-peak');
    stageBadge.textContent='SECRET · 비룡의 밤';
    return;
  }
  if(tier===1){
    if(!secretFocusCycleStart)secretFocusCycleStart=performance.now();
    const cycle=(performance.now()-secretFocusCycleStart)%7000;
    setSecretFocus(cycle>=4000);
    game.classList.remove('dragon-peak');
    stageBadge.textContent=focusActive?'SECRET · 정석 집중 · SCORE ×1.2':'SECRET · 강화 · SCORE ×1.2';
    return;
  }
  setSecretFocus(true);game.classList.add('dragon-peak');
  stageBadge.textContent='🐲 DRAGON PEAK · 집중 · SCORE ×1.5';
}
function renderSecretPhase(previous=null){
  const phase=secretRun.phase;
  game.dataset.runPhase=phase;
  game.classList.toggle('eclipse-active',phase===PHASE.ECLIPSE);
  game.classList.toggle('dragon-flight',phase===PHASE.FLIGHT);
  moonZone.classList.toggle('hidden',phase!==PHASE.ECLIPSE);
  moonZone.querySelector('span').textContent='🌘 포획마다 +2';
  stageBadge.textContent=phase===PHASE.ECLIPSE?'월식 · 시간 정지 · 포획 +2':phase===PHASE.FLIGHT?'승천 · 시간 정지 · 공중 포획 ×2':secretRun.completedCalls>=1?'SECRET · 비룡의 밤 · 강화':'SECRET · 비룡의 밤';
  if(phase===PHASE.CALLED){
    clearTimeout(moveId);target.classList.add('hidden');mechanicLabel('🐲 비룡 호출 · 월식 진입',700);
  }else if(phase===PHASE.ECLIPSE){
    target.dataset.wasShown='0';target.classList.remove('hidden');move(false);showToast('🌘 월식 · 5초 · 메인 시간 정지');
  }else if(phase===PHASE.FLIGHT){
    clearTimeout(moveId);target.classList.add('hidden');clearFlightLayer();flightLayer.classList.remove('hidden');
    flightRider=document.createElement('div');flightRider.className='flight-rider';flightRider.textContent='🐲';flightRider.setAttribute('aria-hidden','true');
    const hint=document.createElement('div');hint.className='flight-hint';hint.textContent='오리를 터치해 좌우 활강 · 안뇽이는 피하세요';
    flightLayer.append(flightRider,hint);scheduleFlightTargets();showToast('🐲 승천 · 5초 · 메인 시간 정지');
  }else if((phase===PHASE.NORMAL||phase===PHASE.READY)&&previous===PHASE.FLIGHT){
    clearFlightLayer();flightLayer.classList.add('hidden');target.classList.remove('hidden');
    if(secretRun.completedCalls===1){
      secretFocusCycleStart=performance.now();secretDifficultyTier=1;
      mechanicLabel('📚 1차 승천 · SCORE ×1.2',1200);showToast('⚡ 속도 상승 · 7초 주기 집중 · 점수 ×1.2');
    }else{
      secretFocusCycleStart=performance.now();secretDifficultyTier=2;
      mechanicLabel('🐲 2차 승천 · SCORE ×1.5',1300);showToast('🔥 DRAGON PEAK · 상시 집중 · 점수 ×1.5');
    }
    updateSecretDifficulty();move(false);
  }else if(phase===PHASE.RESULT){endGame();}
}
function tickSecretRun(){
  sendSecretEvent('TICK');
  if(!playing)return;
  updateSecretDifficulty();
  time=Math.max(0,Math.ceil(Number(secretRun.remainingMs||0)/1000));timeEl.textContent=time;updateMoonGauge();
}
function activateDragonCall(){
  if(!isSecretStage()||!playing)return;
  sendSecretEvent('CALL');tickSecretRun();
}
dragonCallBtn.onclick=activateDragonCall;
function setHiddenPhase(phase,announce=true){
  if(!isSecretStage())return;
  hiddenPhase=phase;
  ['secret-phase-1','secret-phase-2','secret-phase-3','secret-phase-4'].forEach(c=>game.classList.remove(c));
  game.classList.add(`secret-phase-${phase}`);
  waveActive=false;focusActive=false;campusComboActive=false;rushHourActive=false;
  target.classList.remove('wave-bonus');
  tag.classList.remove('hidden');

  if(phase===1){
    finalRushActive=false;
    if(announce)mechanicLabel('🌙 MOON WAVE · 물결 +1',900);
    activateWave();
  }else if(phase===2){
    finalRushActive=false;
    if(announce)mechanicLabel('🏛️ CAMPUS COMBO',900);
  }else if(phase===3){
    finalRushActive=false;
    activateFocus(3800,true);
    if(announce)mechanicLabel('📚 NIGHT FOCUS · 정확성 +2',1000);
  }else if(phase===4){
    focusActive=false;game.classList.remove('focus-mode');tag.classList.remove('hidden');
    rushHourActive=true;finalRushActive=true;
    fever.classList.add('on');feverLabel.classList.add('on');feverLabel.textContent='🐲 DRAGON PEAK · x2';
    if(announce)mechanicLabel('🌆 DRAGON PEAK · x2',1000);
  }
}
function activateDragonBurst(){
  if(!isSecretStage()||dragonBurstActive)return;
  if(rankedMode)rankedDragonBursts++;
  dragonBurstActive=true;
  dragonCharge=0;updateDragonMeter();
  game.classList.add('dragon-burst');
  mechanicLabel('🐲 DRAGON BURST · 3초 x2',1100);
  tone(1080,.18,'triangle',.05);
  if(dragonBurstTimer)clearTimeout(dragonBurstTimer);
  dragonBurstTimer=setTimeout(()=>{
    dragonBurstActive=false;
    game.classList.remove('dragon-burst');
  },3000);
}
function addDragonCharge(delta){
  if(!isSecretStage())return;
  dragonCharge=Math.max(0,Math.min(10,dragonCharge+delta));
  updateDragonMeter();
  if(dragonCharge>=10)activateDragonBurst();
}

function clearMechanicTimers(){
  [waveTimer,focusTimer,campusComboTimer,burstTimer,labelTimer,dragonBurstTimer].forEach(t=>{if(t)clearTimeout(t)});
  waveTimer=focusTimer=campusComboTimer=burstTimer=labelTimer=dragonBurstTimer=null;
}
function resetStageTransientUi(){
  clearMechanicTimers();
  clearTimeout(showToast.t);showToast.t=null;
  toast.classList.remove('show');toast.textContent='';
  stageMechanicLabel.classList.remove('show');stageMechanicLabel.textContent='';
  waveActive=false;focusActive=false;finalRushActive=false;rushHourActive=false;campusComboActive=false;
  dragonBurstActive=false;
  game.classList.remove(
    'focus-mode','rush-hour','final-rush',
    'campus-step1','campus-step2','campus-combo',
    'dragon-burst','dragon-peak'
  );
  fever.classList.remove('on');feverLabel.classList.remove('on');feverLabel.textContent='';
  tag.classList.remove('hidden');
  target.classList.remove('wave-bonus');
  game.querySelectorAll('.wave-ring,.combo-burst,.penalty-pop,.bad-flash,.ripple-hit,.particle').forEach(el=>el.remove());
}
function mechanicLabel(text,ms=900){
  stageMechanicLabel.textContent=text;
  stageMechanicLabel.classList.add('show');
  if(labelTimer)clearTimeout(labelTimer);
  labelTimer=setTimeout(()=>stageMechanicLabel.classList.remove('show'),ms);
}
function setFinalRush(on){
  finalRushActive=on;if(on&&qaRun)qaRun.mechanics.finalRush=true;
  game.classList.toggle('final-rush',on);
  fever.classList.toggle('on',on);
  feverLabel.classList.toggle('on',on);
}
function activateWave(){
  if(!playing||!(stageCfg().id===1||(isSecretStage()&&hiddenPhase===1)))return;
  waveActive=true;if(qaRun)qaRun.mechanics.waveActivations++;
  const ring=document.createElement('div');ring.className='wave-ring';game.appendChild(ring);
  target.classList.add('wave-bonus');
  mechanicLabel(finalRushActive?'🌊 인경호 러시!':'🌊 WATER BONUS +1',800);
  tone(680,.10,'sine',.028);
  setTimeout(()=>ring.remove(),2250);
  waveTimer=setTimeout(()=>{waveActive=false;target.classList.remove('wave-bonus')},2200);
}
function activateCampusCombo(){
  if(!playing||!((stageCfg().id===2)||(isSecretStage()&&hiddenPhase===2))||campusComboTriggers>=2)return;
  campusComboTriggers++;
  if(qaRun)qaRun.mechanics.campusCombos++;
  campusComboActive=true;
  game.classList.add('campus-combo');
  mechanicLabel('🏛️ CAMPUS COMBO · 기본점수 +1',1100);
  tone(900,.12,'triangle',.04);
  campusComboTimer=setTimeout(()=>{campusComboActive=false;game.classList.remove('campus-combo')},3000);
}
function activateFocus(duration=3000,isFinal=false){
  if(!playing||!((stageCfg().id===3)||(isSecretStage()&&hiddenPhase===3)))return;
  focusActive=true;if(qaRun)qaRun.mechanics.focusActivations++;
  game.classList.add('focus-mode');
  tag.classList.add('hidden');
  mechanicLabel(isFinal?'📚 FINAL FOCUS':'📚 FOCUS · 정확히 골라!',1000);
  if(focusTimer)clearTimeout(focusTimer);
  focusTimer=setTimeout(()=>{
    if(finalRushActive&&stageCfg().id===3)return;
    focusActive=false;game.classList.remove('focus-mode');
    tag.classList.remove('hidden');
  },duration);
}
function updateCampusVisual(){
  if(!(stageCfg().id===2||(isSecretStage()&&hiddenPhase===2))){
    game.classList.remove('campus-step1','campus-step2','campus-combo');return;
  }
  game.classList.toggle('campus-step1',combo>=3);
  game.classList.toggle('campus-step2',combo>=6);
}
function maybeScheduleRushBurst(){
  if(!playing||!((stageCfg().id===4)||(isSecretStage()&&hiddenPhase===4))||!rushHourActive)return;
  if(stageCfg().id===4&&finalRushActive)return;
  const chance=.25;
  if(Math.random()>chance)return;
  if(burstTimer)clearTimeout(burstTimer);
  burstTimer=setTimeout(()=>{if(playing){if(qaRun)qaRun.mechanics.rushBursts++;move(true)}},280);
}

function tone(freq=440,duration=.08,type='sine',gain=.04){
  if(!soundEnabled)return;
  try{
    if(!audioCtx) audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const o=audioCtx.createOscillator(), g=audioCtx.createGain();
    o.type=type;o.frequency.value=freq;g.gain.value=gain;
    o.connect(g);g.connect(audioCtx.destination);o.start();
    g.gain.exponentialRampToValueAtTime(.001,audioCtx.currentTime+duration);
    o.stop(audioCtx.currentTime+duration);
  }catch(e){}
}

function restartCssAnimation(el,cls){el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls);setTimeout(()=>el.classList.remove(cls),340);}
function hitRipple(x,y){const r=document.createElement('div');r.className='ripple-hit';r.style.left=x+'px';r.style.top=y+'px';game.appendChild(r);setTimeout(()=>r.remove(),420);}
function spawnParticles(x,y,key){let count=4,shape='',base='#fff';if(key==='normal'){count=4;base='#dff7ff'}if(key==='gold'){count=8;shape='star';base='#ffb703'}if(key==='speedy'){count=6;shape='line';base='#7ee8ff'}if(key==='indeoki'){count=8;shape='star';base='#7cc8ff'}if(key==='annyongi'){count=7;base='#e63946'}for(let i=0;i<count;i++){const p=document.createElement('div');p.className='particle '+shape;p.style.left=x+'px';p.style.top=y+'px';p.style.background=base;const a=(Math.PI*2/count)*i+(Math.random()-.5)*.4,d=26+Math.random()*34;p.style.setProperty('--dx',(Math.cos(a)*d)+'px');p.style.setProperty('--dy',(Math.sin(a)*d)+'px');game.appendChild(p);setTimeout(()=>p.remove(),600);}}
function badFeedback(){const f=document.createElement('div');f.className='bad-flash';game.appendChild(f);setTimeout(()=>f.remove(),140);game.classList.remove('shake-bad');void game.offsetWidth;game.classList.add('shake-bad');setTimeout(()=>game.classList.remove('shake-bad'),180);}
function comboBurst(text){const e=document.createElement('div');e.className='combo-burst';e.textContent=text;game.appendChild(e);setTimeout(()=>e.remove(),600);}

function soundFor(key){
  if(key==='normal') tone(560,.07,'sine',.035);
  if(key==='gold'){tone(850,.09,'triangle',.04);setTimeout(()=>tone(1120,.11,'triangle',.035),55)}
  if(key==='speedy') tone(720,.05,'square',.025);
  if(key==='indeoki'){tone(620,.08,'sine',.035);setTimeout(()=>tone(900,.12,'sine',.035),70)}
  if(key==='annyongi'){tone(180,.14,'sawtooth',.045);setTimeout(()=>tone(130,.15,'sawtooth',.035),70)}
}
function multiplier(){
  if(isSecretStage())return secretComboMultiplier();
  return combo>=6?3:combo>=3?2:1;
}
function updateCombo(){
  comboEl.textContent=`${combo} · x${multiplier()}`;
  comboFill.style.width=Math.min(100,(combo/(isSecretStage()?10:6))*100)+'%';
  updateCampusVisual();
}
function choose(){
  const d=stageCfg(),stage=d.id;
  let adjusted=TYPES.map(t=>({...t}));
  if(stage===5){
    adjusted.find(t=>t.key==='normal').weight=.46;
    adjusted.find(t=>t.key==='speedy').weight=.18;
    adjusted.find(t=>t.key==='gold').weight=.15;
    adjusted.find(t=>t.key==='indeoki').weight=.09;
    adjusted.find(t=>t.key==='annyongi').weight=.12;
    const ascensions=Number(secretRun?.completedCalls||0);
    if(ascensions>=2&&[PHASE.NORMAL,PHASE.READY].includes(secretRun?.phase)){
      adjusted.find(t=>t.key==='speedy').weight*=1.25;adjusted.find(t=>t.key==='annyongi').weight*=1.20;
      adjusted.find(t=>t.key==='gold').weight*=1.25;adjusted.find(t=>t.key==='indeoki').weight*=1.30;
    }else if(ascensions>=1&&[PHASE.NORMAL,PHASE.READY].includes(secretRun?.phase)){
      adjusted.find(t=>t.key==='speedy').weight*=1.15;adjusted.find(t=>t.key==='annyongi').weight*=1.12;
      adjusted.find(t=>t.key==='gold').weight*=1.10;adjusted.find(t=>t.key==='indeoki').weight*=1.15;
    }
    if(secretRun?.phase===PHASE.ECLIPSE){
      adjusted.find(t=>t.key==='gold').weight*=1.15;
      adjusted.find(t=>t.key==='indeoki').weight*=1.15;
    }
    if(secretRun?.phase===PHASE.FLIGHT){
      adjusted.find(t=>t.key==='gold').weight*=1.5;
      adjusted.find(t=>t.key==='indeoki').weight*=1.7;
      adjusted.find(t=>t.key==='annyongi').weight*=.6;
    }
    if(lastSecretSpawnKey==='annyongi')adjusted.find(t=>t.key==='annyongi').weight=0;
    const total=adjusted.reduce((s,t)=>s+t.weight,0),r=Math.random()*total;
    let a=0;
    for(const t of adjusted){a+=t.weight;if(r<=a){lastSecretSpawnKey=t.key;return t}}
    lastSecretSpawnKey=adjusted[0].key;return adjusted[0];
  }
  adjusted.find(t=>t.key==='annyongi').weight=d.annyongi;

  const elapsed=d.seconds-time;
  if(elapsed>=d.seconds*.34) adjusted.find(t=>t.key==='speedy').weight+=.04*d.rareBoost;
  if(elapsed>=d.seconds*.67){
    adjusted.find(t=>t.key==='gold').weight+=.05*d.rareBoost;
    adjusted.find(t=>t.key==='indeoki').weight+=.03*d.rareBoost;
    adjusted.find(t=>t.key==='annyongi').weight+=.025*d.rareBoost;
  }

  if(stage===1&&finalRushActive){
    adjusted.find(t=>t.key==='gold').weight*=1.4;
    adjusted.find(t=>t.key==='indeoki').weight*=1.8;
    adjusted.find(t=>t.key==='annyongi').weight*=.8;
  }
  if(stage===2&&finalRushActive){
    adjusted.find(t=>t.key==='gold').weight*=1.6;
  }
  if(stage===4&&rushHourActive&&!finalRushActive){
    adjusted.find(t=>t.key==='speedy').weight*=1.25;
    adjusted.find(t=>t.key==='annyongi').weight*=1.2;
    adjusted.find(t=>t.key==='gold').weight*=1.15;
    adjusted.find(t=>t.key==='indeoki').weight*=1.15;
  }
  if(stage===4&&finalRushActive){
    adjusted.find(t=>t.key==='speedy').weight*=.90;
    adjusted.find(t=>t.key==='annyongi').weight*=.65;
    adjusted.find(t=>t.key==='gold').weight*=1.55;
    adjusted.find(t=>t.key==='indeoki').weight*=1.55;
  }



  const total=adjusted.reduce((s,t)=>s+t.weight,0),r=Math.random()*total;
  let a=0;for(const t of adjusted){a+=t.weight;if(r<=a)return t}return adjusted[0];
}
function setType(t){
  current=t;
  target.className='target '+t.key;
  const isA=t.key==='annyongi', isI=t.key==='indeoki', isD=!isA&&!isI;
  duckEmoji.classList.toggle('hidden',!isD);
  annyongiImg.classList.toggle('hidden',!isA);
  indeokiImg.classList.toggle('hidden',!isI);
  tag.textContent=t.key==='annyongi'?'안뇽이 · 누르지 마!':`${t.label} +${t.points}`;
  tag.classList.toggle('hidden',focusActive);
  target.classList.toggle('wave-bonus',waveActive&&t.key!=='annyongi');
  if(t.key==='annyongi') annyongiSpawned++;
}
function move(fromBurst=false){
  if(!playing)return;
  if(isSecretStage()&&!SecretRun.canCapture(secretRun))return;
  if(isSecretStage()&&secretRun.phase===PHASE.FLIGHT)return;
  if(current && current.key==='annyongi' && target.dataset.wasShown==='1' && target.dataset.clicked!=='1'){
    target.dataset.dodged=(Number(target.dataset.dodged)||0)+1;
    if(isSecretStage())registerAnnyongiDodge();
  }

  setType(choose());
  target.dataset.wasShown='1';target.dataset.clicked='0';
  target.dataset.spawnedAt=String(performance.now());

  const r=game.getBoundingClientRect(),sp=stageCfg().spawn;
  const minY=r.height*sp.yMin,maxY=r.height*sp.yMax;
  let x;
  if(stageCfg().id===4){
    const roll=Math.random();
    const center=roll<.30?.24:roll<.70?.50:.76;
    x=r.width*(center+(Math.random()-.5)*.11);
  }else{
    const minX=r.width*sp.xMin,maxX=r.width*sp.xMax;
    x=Math.random()*Math.max(1,maxX-minX)+minX;
  }
  let y=Math.random()*Math.max(1,maxY-minY)+minY;
  if(isSecretStage()){
    const exclusionLeft=r.width-124;
    const exclusionTop=r.height-134;
    if(x>exclusionLeft&&y>exclusionTop){
      x=Math.min(r.width*.64,exclusionLeft-26);
    }
  }
  target.style.left=x+'px';
  target.style.top=y+'px';

  clearTimeout(moveId);
  const d=stageCfg(),elapsed=d.seconds-time;
  let ms=current.moveMs*d.speed;
  if(d.id!==5&&elapsed>=d.seconds*.34)ms*=.90;
  if(d.id!==5&&elapsed>=d.seconds*.67)ms*=.80;

  if(d.id===2&&finalRushActive)ms*=.80;
  if(d.id===3&&finalRushActive)ms*=.85;
  if(d.id===4&&rushHourActive&&!finalRushActive)ms*=.90;
  // PEAK TIME is a reward window: slow slightly instead of stacking rush speed.
  if(d.id===4&&finalRushActive)ms*=1.20;
  let secretMin=390;
  if(d.id===5&&[PHASE.NORMAL,PHASE.READY].includes(secretRun?.phase)){
    const ascensions=Number(secretRun?.completedCalls||0);
    if(ascensions>=2){ms*=.78;secretMin=250;}
    else if(ascensions>=1){ms*=.88;secretMin=310;}
  }
  
  moveId=setTimeout(()=>move(false),Math.max(d.id===5?secretMin:(d.id===4?180:220),ms));
  if(!fromBurst)maybeScheduleRushBurst();
}
function fx(x,y,text,kind='good'){
  const e=document.createElement('div');e.className='float '+kind;e.textContent=text;
  e.style.left=x+'px';e.style.top=y+'px';game.appendChild(e);setTimeout(()=>e.remove(),750);
}
function showToast(text){
  toast.textContent=text;toast.classList.add('show');clearTimeout(showToast.t);
  showToast.t=setTimeout(()=>toast.classList.remove('show'),850);
}
function resetCombo(reason=''){
  combo=0;lastGoodHit=0;updateCombo();if(reason)showToast(reason);
}

function flashHudCard(el){
  const card=el.closest('.card');
  if(!card)return;
  card.classList.remove('penalty-flash');void card.offsetWidth;card.classList.add('penalty-flash');
  setTimeout(()=>card.classList.remove('penalty-flash'),460);
}
function penaltyPop(text){
  const p=document.createElement('div');p.className='penalty-pop';p.textContent=text;
  game.appendChild(p);setTimeout(()=>p.remove(),850);
}
function applyTimePenalty(amount){
  time=Math.max(0,time-amount);
  timeEl.textContent=time;
  flashHudCard(timeEl);
  penaltyPop(`-${amount}초`);
  if(time<=0) endGame();
}
function applyScorePenalty(amount){
  score=Math.max(0,score-amount);
  scoreEl.textContent=score;
  flashHudCard(scoreEl);
}

function annyongiPenalty(){
  const stage=stageCfg().id;
  const pool = stage===1 ? [
    {type:'score',amount:3,label:'점수 -3'},
    {type:'time',amount:2,label:'시간 -2초'},
    {type:'combo',label:'콤보 초기화'}
  ] : stage===2 ? [
    {type:'score',amount:4,label:'점수 -4'},
    {type:'time',amount:3,label:'시간 -3초'},
    {type:'combo',label:'콤보 초기화'},
    {type:'scorecombo',amount:2,label:'-2점 + 콤보 초기화'}
  ] : stage===3 ? [
    {type:'score',amount:5,label:'점수 -5'},
    {type:'time',amount:3,label:'시간 -3초'},
    {type:'combo',label:'콤보 초기화'},
    {type:'timecombo',amount:2,label:'-2초 + 콤보 초기화'}
  ] : stage===5 ? [
    {type:'score',amount:3,label:'점수 -3'},
    {type:'combo',label:'콤보 초기화'},
    {type:'scorecombo',amount:2,label:'-2점 + 콤보 초기화'}
  ] : [
    {type:'score',amount:6,label:'점수 -6'},
    {type:'time',amount:4,label:'시간 -4초'},
    {type:'combo',label:'콤보 초기화'},
    {type:'scorecombo',amount:4,label:'-4점 + 콤보 초기화'},
    {type:'timecombo',amount:3,label:'-3초 + 콤보 초기화'}
  ];

  const p={...pool[Math.floor(Math.random()*pool.length)]};
  if(stage===3&&focusActive){
    if(p.type==='score'||p.type==='scorecombo')p.amount=Math.ceil(p.amount*1.5);
    if(p.type==='time'||p.type==='timecombo')p.amount=Math.min(5,p.amount+1);
    p.label='집중 실패 · '+p.label;
  }
  qaLogPenalty(p);

  if(p.type==='score'){
    applyScorePenalty(p.amount);
    return [p.label,`-${p.amount}`,'bad'];
  }
  if(p.type==='time'){
    applyTimePenalty(p.amount);
    return [p.label,`-${p.amount}초`,'bad'];
  }
  if(p.type==='combo'){
    resetCombo();
    flashHudCard(comboEl);
    return [p.label,'COMBO 0','bad'];
  }
  if(p.type==='scorecombo'){
    applyScorePenalty(p.amount);
    resetCombo();
    flashHudCard(comboEl);
    return [p.label,`-${p.amount} / COMBO 0`,'bad'];
  }
  if(p.type==='timecombo'){
    applyTimePenalty(p.amount);
    resetCombo();
    flashHudCard(comboEl);
    return [p.label,`-${p.amount}초 / COMBO 0`,'bad'];
  }
}
game.addEventListener('pointerdown',()=>{
  if(playing&&rankedMode&&isSecretStage())rankedInputCount++;
},{capture:true});
target.addEventListener('pointerdown',e=>{
  if(!playing||target.dataset.clicked==='1')return;
  if(isSecretStage()){sendSecretEvent('TICK');if(!playing||!SecretRun.canCapture(secretRun)||secretRun.phase===PHASE.FLIGHT)return;}
  recordRankedReaction(target.dataset.spawnedAt);
  e.preventDefault();target.dataset.clicked='1';clearTimeout(moveId);
  if(qaRun)qaRun.totalClicks++;
  const r=game.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
  soundFor(current.key);

  hitRipple(x,y);
  restartCssAnimation(target,'hit-pop');
  spawnParticles(x,y,current.key);

  if(isSecretStage()){
    handleSecretHit(current,target,x,y);
    const generation=runGeneration;
    moveId=setTimeout(()=>{if(generation===runGeneration)move(false)},110);
    return;
  }

  if(current.key==='annyongi'){
    annyongiClicked++;
    if(qaRun)qaRun.hits.annyongi++;
    badFeedback();
    const p=annyongiPenalty();
    fx(x,y,p[1],p[2]);showToast('안뇽이! '+p[0]);
    if(!playing||time<=0)return;
    moveId=setTimeout(move,120);return;
  }

  const now=performance.now();
  if(lastGoodHit && now-lastGoodHit<=comboTimeoutMs) combo++; else combo=1;
  lastGoodHit=now; maxCombo=Math.max(maxCombo,combo);

  let regionalBonus=0;
  if(stageCfg().id===1&&waveActive)regionalBonus+=1;
  if(stageCfg().id===2&&campusComboActive)regionalBonus+=1;
  if(stageCfg().id===3&&focusActive)regionalBonus+=2;

  const comboMult=multiplier();
  let rawNoRegional=current.points*comboMult;
  let rawWithRegional=(current.points+regionalBonus)*comboMult;
  if(finalRushActive&&stageCfg().id!==1){rawNoRegional*=2;rawWithRegional*=2}
  const noRegionalGain=Math.min(15,rawNoRegional);
  let gain=Math.min(15,rawWithRegional);

  if(qaRun){
    qaRun.successfulClicks++;
    if(qaRun.hits[current.key]!==undefined)qaRun.hits[current.key]++;
    if(regionalBonus>0){
      qaRun.regionalBonusHits++;
      qaRun.regionalBonusScore+=Math.max(0,gain-noRegionalGain);
    }
    if(finalRushActive){
      qaRun.finalRushHits++;
      qaRun.finalRushScore+=gain;
    }
  }

  score+=gain;scoreEl.textContent=score;updateCombo();
  if(combo===3){comboBurst('3 COMBO · x2');tone(760,.10,'triangle',.04);}
  if(combo===6){comboBurst('6 COMBO · x3');tone(980,.14,'triangle',.045);}
  if(stageCfg().id===2&&combo===10&&campusComboTriggers<2)activateCampusCombo();
  if(current.key==='indeoki')indeokHits++;
  if(current.key==='gold')goldHits++;

  const bonusText=regionalBonus>0?` +${regionalBonus} 지역보너스`:'';
  fx(x,y,'+'+gain,current.key==='indeoki'?'special':'good');
  if(regionalBonus>0)showToast(`${stageCfg().label}${bonusText}`);
  moveId=setTimeout(()=>move(false),110);
});

function rankFor(){return currentGeneralBadge().label}

function setPlayState(next){
  playState=next;
  const active=['COUNTDOWN','PLAYING','PAUSED_CONFIRM'].includes(next);
  gameUtilityControls.classList.toggle('hidden',!active);
  homeGameBtn.disabled=next!=='PLAYING';
  exitConfirmOverlay.classList.toggle('hidden',next!=='PAUSED_CONFIRM');
}
function updateSoundButton(){
  soundToggleBtn.textContent=soundEnabled?'🔊':'🔇';
  soundToggleBtn.setAttribute('aria-label',soundEnabled?'사운드 끄기':'사운드 켜기');
}
function toggleSound(){
  soundEnabled=!soundEnabled;
  localStorage.setItem(SOUND_PREF_KEY,String(soundEnabled));
  updateSoundButton();
  if(soundEnabled)tone(660,.06,'sine',.025);
}
function sleepMs(ms){return new Promise(resolve=>setTimeout(resolve,ms))}
function startGeneralTimer(d){
  clearInterval(timerId);
  timerId=setInterval(()=>{
    if(playState!=='PLAYING'||!playing)return;
    time--;timeEl.textContent=time;
    const elapsed=d.seconds-time;
    if(combo>0&&lastGoodHit&&performance.now()-lastGoodHit>comboTimeoutMs)resetCombo();

    if(d.id===1){
      const rush=time<=7;
      if(rush&&!finalRushActive){
        setFinalRush(true);feverLabel.textContent='🌊 인경호 러시';mechanicLabel('🌊 인경호 러시!',1200);
      }
      const waveInterval=rush?3:6;
      if(elapsed>=5&&elapsed-lastWaveAt>=waveInterval){lastWaveAt=elapsed;activateWave();}
    }
    if(d.id===2&&time===5&&!finalRushActive){
      setFinalRush(true);feverLabel.textContent='✨ 광장 피버';mechanicLabel('✨ 광장 피버 · x2',1200);tone(980,.18,'triangle',.045);
    }
    if(d.id===3){
      if(elapsed>=6&&!finalRushActive&&elapsed-lastFocusAt>=8){lastFocusAt=elapsed;activateFocus(3000,false);}
      if(time===5&&!finalRushActive){setFinalRush(true);feverLabel.textContent='📚 FINAL FOCUS';activateFocus(6000,true);tone(900,.16,'triangle',.04);}
    }
    if(d.id===4){
      if(time===12&&!rushHourActive){rushHourActive=true;game.classList.add('rush-hour');mechanicLabel('🌆 러시아워 시작',1000);}
      if(time===5&&!finalRushActive){setFinalRush(true);feverLabel.textContent='🌆 PEAK TIME';mechanicLabel('🌆 PEAK TIME · x2',1200);tone(980,.18,'triangle',.045);}
    }
    if(time<=0)endGame();
  },1000);
}
function beginActivePlay(d,generation){
  if(generation!==runGeneration||playState!=='COUNTDOWN')return;
  countdownOverlay.classList.add('hidden');
  playing=true;setPlayState('PLAYING');
  if(!d.secret){
    generalRunId=makeTelemetryRunId();
    generalRunStartedPerf=performance.now();
    void logGeneralStageAttempt(d.id,generalRunId);
  }
  if(d.secret){
    secretRun=SecretRun.create(performance.now());
    if(rankedMode)rankedStartedPerf=performance.now();
  }
  target.dataset.dodged='0';target.dataset.wasShown='0';target.dataset.clicked='0';
  updateMoonGauge();target.classList.remove('hidden');
  showToast(d.secret?'🌙 비룡의 밤 2.0 · 달빛을 모아 최대 2회 호출하세요':`Stage ${d.id} · ${d.label}`);
  move(false);
  if(d.secret){renderSecretPhase();secretTickId=setInterval(tickSecretRun,50);}
  else startGeneralTimer(d);
}
async function runStartCountdown(d,generation){
  countdownOverlay.classList.remove('hidden');
  for(const value of ['3','2','1']){
    if(generation!==runGeneration||playState!=='COUNTDOWN')return;
    countdownText.textContent=value;
    countdownText.style.animation='none';void countdownText.offsetWidth;countdownText.style.animation='';
    tone(value==='1'?760:620,.08,'triangle',.035);
    await sleepMs(1000);
  }
  if(generation!==runGeneration||playState!=='COUNTDOWN')return;
  countdownText.textContent='GO!';
  countdownText.style.animation='none';void countdownText.offsetWidth;countdownText.style.animation='';
  tone(980,.12,'triangle',.045);
  beginActivePlay(d,generation);
}
function shiftSecretClockForPause(ms){
  if(!secretRun||!Number.isFinite(ms)||ms<=0)return;
  secretRun={...secretRun};
  if(Number.isFinite(secretRun.lastAdvancedAt))secretRun.lastAdvancedAt+=ms;
  if(Number.isFinite(secretRun.phaseDeadline))secretRun.phaseDeadline+=ms;
  if(Number.isFinite(secretRun.deadline))secretRun.deadline+=ms;
  if(Number.isFinite(secretRun.lastHit))secretRun.lastHit+=ms;
  if(secretFocusCycleStart)secretFocusCycleStart+=ms;
}
function openExitConfirm(){
  if(playState!=='PLAYING'||!playing)return;
  if(isSecretStage())sendSecretEvent('TICK');
  pauseStartedAt=performance.now();
  playing=false;clearInterval(timerId);clearInterval(secretTickId);clearTimeout(moveId);
  clearTimeout(flightSpawnTimer);flightSpawnTimer=null;
  setPlayState('PAUSED_CONFIRM');
}
function resumeFromExitConfirm(){
  if(playState!=='PAUSED_CONFIRM')return;
  const pausedFor=Math.max(0,performance.now()-pauseStartedAt);
  pauseStartedAt=0;
  if(lastGoodHit)lastGoodHit+=pausedFor;
  const spawned=Number(target.dataset.spawnedAt);
  if(Number.isFinite(spawned)&&spawned>0)target.dataset.spawnedAt=String(spawned+pausedFor);
  shiftSecretClockForPause(pausedFor);
  playing=true;setPlayState('PLAYING');
  if(isSecretStage()){
    if(secretRun?.phase===PHASE.FLIGHT){clearFlightLayer();renderSecretPhase();}
    else if(SecretRun.canCapture(secretRun))move(false);
    secretTickId=setInterval(tickSecretRun,50);
  }else{
    move(false);startGeneralTimer(stageCfg());
  }
}
window.addEventListener('pagehide',event=>{
  if(event.persisted)return;
  logTelemetrySessionEndKeepalive();
  if(['PLAYING','PAUSED_CONFIRM'].includes(playState)){
    logGeneralBrowserExitKeepalive();
  }
});

function exitRunToHome(){
  if(!['PLAYING','PAUSED_CONFIRM','COUNTDOWN'].includes(playState))return;
  const exitState=playState;
  const exitCfg=stageCfg();
  if(!exitCfg.secret&&generalRunId){
    const durationMs=generalRunStartedPerf?performance.now()-generalRunStartedPerf:0;
    void logGeneralStageExit(exitCfg.id,generalRunId,durationMs,exitState,'in_game');
  }
  if(exitCfg.secret&&rankedMode&&rankedSession?.runId){
    void abandonRankedSession(rankedSession.runId);
  }
  generalRunId=null;generalRunStartedPerf=0;
  runGeneration++;
  playing=false;clearInterval(timerId);clearInterval(secretTickId);clearTimeout(moveId);
  resetStageTransientUi();clearFlightLayer();
  rankedMode=false;rankedSession=null;rankedStartedPerf=0;resetRankedTelemetry();
  target.classList.add('hidden');countdownOverlay.classList.add('hidden');exitConfirmOverlay.classList.add('hidden');
  endOverlay.classList.add('hidden');startOverlay.classList.remove('hidden');
  setPlayState('HOME');setTelemetryLastScreen('stage_select');
  void logTelemetryUiEvent('stage_select_view','stage_select');
  renderStageGrid();applyStage();
}
async function startGame(){
  if(startGame.pending)return;
  startGame.pending=true;
  try{
    runGeneration++;clearInterval(secretTickId);clearInterval(timerId);clearTimeout(moveId);resetStageTransientUi();
    const generation=runGeneration,d=stageCfg();
    onlineRankResult.classList.add('hidden');
    rankedMode=false;rankedSession=null;rankedStartedPerf=0;resetRankedTelemetry();
    generalRunId=null;generalRunStartedPerf=0;lastGeneralResultContext=null;
    if(d.secret){
      setTelemetryLastScreen('ranked_game');
      void logTelemetryUiEvent('ranked_cta_click','ranked_game');
      beginRankedLoading();
      const rankedReady=await prepareRankedRun();
      await endRankedLoading(rankedReady);
    }else{
      setTelemetryLastScreen('general_game');
    }

    score=0;time=d.seconds;playing=false;combo=0;maxCombo=0;lastGoodHit=0;
    comboTimeoutMs=d.comboWindow;
    annyongiSpawned=0;annyongiClicked=0;indeokHits=0;goldHits=0;normalHits=0;speedyHits=0;
    waveActive=false;focusActive=false;finalRushActive=false;rushHourActive=false;campusComboActive=false;
    campusComboTriggers=0;lastWaveAt=-999;lastFocusAt=-999;
    hiddenPhase=1;dragonCharge=0;dragonBurstActive=false;
    moonGauge=0;annyongiDodges=0;dodgeStreak=0;moonBonusHits=0;dragonCalls=0;
    secretRun=null;runResult=null;lastSecretSpawnKey='';secretFocusCycleStart=0;secretDifficultyTier=0;
    clearFlightLayer();resetSecretDifficulty();
    moonZone.classList.add('hidden');flightLayer.classList.add('hidden');game.classList.remove('dragon-flight','eclipse-active');
    delete game.dataset.runPhase;
    target.dataset.dodged='0';target.dataset.wasShown='0';target.dataset.clicked='0';
    scoreEl.textContent=0;timeEl.textContent=time;updateCombo();applyStage();
    game.classList.remove('focus-mode','rush-hour','final-rush','campus-step1','campus-step2','campus-combo');
    fever.classList.remove('on');feverLabel.classList.remove('on');
    tag.classList.remove('hidden');target.classList.remove('wave-bonus');target.classList.add('hidden');
    startOverlay.classList.add('hidden');endOverlay.classList.add('hidden');
    setPlayState('COUNTDOWN');
    await runStartCountdown(d,generation);
  }finally{startGame.pending=false}
}

function getRunStats(){return {score,maxCombo,annyongiClicks:annyongiClicked,indeokHits,goldHits}}
function isClear(st){if(isSecretStage())return true;const c=stageCfg().clear;if(st.score<c.score)return false;if(c.maxAnnyongi!==undefined&&st.annyongiClicks>c.maxAnnyongi)return false;if(c.minCombo!==undefined&&st.maxCombo<c.minCombo)return false;return true}
function starCount(st){if(isSecretStage())return 0;return stageCfg().stars.reduce((n,[,test])=>n+(test(st)?1:0),0)}
function endGame(){
 if(!playing)return;
 if(isSecretStage()&&secretRun.phase!==PHASE.RESULT)return;
 playing=false;setPlayState('RESULT');setTelemetryLastScreen('result');clearInterval(secretTickId);clearInterval(timerId);clearTimeout(moveId);resetStageTransientUi();
 clearFlightLayer();updateMoonGauge();timeEl.textContent=0;
 moonZone.classList.add('hidden');flightLayer.classList.add('hidden');
 target.classList.add('hidden');fever.classList.remove('on');feverLabel.classList.remove('on');
 game.classList.remove('focus-mode','rush-hour','final-rush','campus-step1','campus-step2','campus-combo','dragon-burst','dragon-flight','eclipse-active');
 tag.classList.remove('hidden');target.classList.remove('wave-bonus');
 dragonBurstActive=false;

 const st=getRunStats(),clear=isClear(st),stars=starCount(st),cfg=stageCfg(),secret=isSecretStage();
 if(!secret&&generalRunId){
   const completedRunId=generalRunId;
   const durationMs=generalRunStartedPerf?performance.now()-generalRunStartedPerf:0;
   lastGeneralResultContext={
     runId:completedRunId,
     stageId:Number(cfg.id),
     clear:Boolean(clear),
     targetStageId:clear&&cfg.id<4?Number(cfg.id)+1:null
   };
   void logGeneralStageResult(cfg.id,completedRunId,score,maxCombo,stars,clear,durationMs,annyongiClicked,indeokHits,goldHits);
   generalRunId=null;generalRunStartedPerf=0;
 }

 document.getElementById('finalScore').textContent=score;
 document.getElementById('bestCombo').textContent=maxCombo;
 document.getElementById('annyongiClicksResult').textContent=annyongiClicked;
 document.getElementById('indeokHits').textContent=indeokHits;
 document.getElementById('goldHits').textContent=goldHits;
 resultMiniStats.classList.toggle('hidden',secret);
 secretResultStats.classList.toggle('hidden',!secret);
 resultRankingBtn.classList.toggle('hidden',!secret);
 const resultModal=endOverlay.querySelector('.modal');resultModal.classList.toggle('secret-result',secret);
 document.getElementById('scoreBreakdown').classList.toggle('hidden',!secret);
 document.getElementById('contractResult').classList.toggle('hidden',!secret);
 if(secret){
   runResult=SecretRun.result(secretRun);
   const r=runResult;
   secretResultStats.innerHTML='<div><span>포획</span><strong>'+r.captures+'</strong></div>'+
     '<div><span>콤보</span><strong>'+r.maxCombo+'</strong></div>'+
     '<div><span>월식</span><strong>'+r.eclipseCaptures+'</strong></div>'+
     '<div><span>승천</span><strong>'+r.flightCaptures+'</strong></div>';
   const groundBase=r.baseCapture+r.rareBonus;
   const tier1Bonus=Math.floor(r.tier1GroundAward*.2),tier2Bonus=Math.floor(r.tier2GroundAward*.5);
   document.getElementById('scoreBreakdown').innerHTML=
     '<span class="score-breakdown-title">점수 원장</span>'+
     '<span class="score-breakdown-row"><span>기본 포획</span><strong>'+groundBase+'</strong></span>'+
     '<span class="score-breakdown-row"><span>월식 보너스</span><strong>+'+r.eclipseScore+'</strong></span>'+
     '<span class="score-breakdown-row"><span>승천 보너스</span><strong>+'+r.flightScore+'</strong></span>'+
     '<span class="score-breakdown-row"><span>콤보 보너스</span><strong>+'+r.comboBonus+'</strong></span>'+
     '<span class="score-breakdown-row"><span>승천 배율</span><strong>+'+r.ascensionBonus+' (1차 '+tier1Bonus+' / 2차 '+tier2Bonus+')</strong></span>'+
     '<span class="score-breakdown-row total"><span>합계</span><strong>'+r.totalScore+'</strong></span>';
   const c=r.contract;
   const gradeBadge=BadgeSystem.grade(c.rank);
   document.getElementById('contractResult').innerHTML='<div class="rank-badges">'+badgeChip(gradeBadge,'grade')+'</div>'+
     '<p>'+(c.nextRank?'다음 '+c.nextRank+' · '+c.nextGoal:'최고 학점 달성')+'</p>';
 }else{secretResultStats.innerHTML='';}

 const state=document.getElementById('resultState');
 const resultStars=document.getElementById('resultStars');
 const list=document.getElementById('conditionList');
 const allClearText=document.getElementById('allClearText');
 const updates=[];
 let justUnlockedSecret=false;

 if(secret){
   const hp=progress.hidden;
   const prevBest=Number(hp.bestScore||0),prevCombo=Number(hp.bestCombo||0);
   const prevContract=SecretRun.normalizeHistory(hp.sessionV2).bestContract;
   progress.totalPlays++;hp.playCount=Number(hp.playCount||0)+1;hp.cleared=true;
   hp.bestScore=Math.max(prevBest,score);hp.bestCombo=Math.max(prevCombo,maxCombo);
   progress.bestCombo=Math.max(Number(progress.bestCombo||0),maxCombo);
   if(score>prevBest)updates.push(`<span class="record-badge best">🏆 최고 기록 ${score}</span>`);
   hp.sessionV2=SecretRun.record(hp.sessionV2,runResult);
   const oldIdx=SecretRun.RANKS.findIndex(r=>r.rank===prevContract),newIdx=SecretRun.RANKS.findIndex(r=>r.rank===hp.sessionV2.bestContract);
   if(newIdx>oldIdx){const b=BadgeSystem.grade(hp.sessionV2.bestContract);updates.push(`<span class="record-badge best">${b.icon} 학점 뱃지 · ${b.code} ${b.label}</span>`);}
   saveProgress();

   document.getElementById('resultStageTitle').textContent='비룡의 밤';
   state.textContent=runResult.completed?`승천 ${runResult.completedCalls}회`:runResult.dragonCalls?'승천 미완료':'비룡 미호출';
   state.className='result-state clear';
   resultStars.classList.add('hidden');
   list.classList.add('hidden');
   list.innerHTML='';
   allClearText.classList.add('hidden');
 }else{
   resultStars.classList.remove('hidden');
   list.classList.remove('hidden');
   document.getElementById('resultStageTitle').textContent=`STAGE ${cfg.id} · ${cfg.label}`;
   state.textContent=clear?'CLEAR!':'FAILED';
   state.className='result-state '+(clear?'clear':'fail');
   resultStars.textContent='★'.repeat(stars)+'☆'.repeat(3-stars);
   list.innerHTML='';
   cfg.stars.forEach(([label,test],i)=>{
     const ok=test(st),d=document.createElement('div');
     d.className='condition-item '+(ok?'ok':'no');
     d.innerHTML=`<span>${i+1}★ · ${label}</span><strong>${ok?'✓':'✕'}</strong>`;
     list.appendChild(d);
   });

   const sp=progress.stages[cfg.id]||blankStageProgress();
   const prev={stars:sp.stars,bestScore:sp.bestScore,bestCombo:sp.bestCombo};
   progress.totalPlays++;sp.playCount++;
   sp.bestScore=Math.max(Number(sp.bestScore||0),score);
   sp.bestCombo=Math.max(Number(sp.bestCombo||0),maxCombo);
   progress.bestCombo=Math.max(Number(progress.bestCombo||0),maxCombo);
   if(clear){
     sp.cleared=true;sp.clearCount++;
     sp.stars=Math.max(Number(sp.stars||0),stars);
     if(cfg.id<4)progress.unlockedStage=Math.max(progress.unlockedStage,cfg.id+1);
   }
   progress.stages[cfg.id]=sp;
   if(sp.bestScore>prev.bestScore||sp.bestCombo>prev.bestCombo||sp.stars>prev.stars){
     void syncGeneralStageBest(cfg.id,sp.bestScore,sp.bestCombo,sp.stars);
   }

   if(score>prev.bestScore)updates.push(`<span class="record-badge best">🏆 NEW BEST ${score}</span>`);
   if(maxCombo>prev.bestCombo)updates.push(`<span class="record-badge">🔥 COMBO ${maxCombo}</span>`);
   if(clear&&stars>prev.stars)updates.push(`<span class="record-badge">${'★'.repeat(prev.stars)}${'☆'.repeat(3-prev.stars)} → ${'★'.repeat(stars)}${'☆'.repeat(3-stars)}</span>`);

   if(totalStars()>=10&&!progress.hidden.unlocked){
     progress.hidden.unlocked=true;
     justUnlockedSecret=true;
     updates.push(`<span class="record-badge best">🐲 ★10 · 비룡의 밤/랭킹전 해금</span>`);
   }
   saveProgress();

   if(clear&&cfg.id===4){
     allClearText.textContent=totalStars()>=12?'CAMPUS PERFECT 🏆':justUnlockedSecret?'CAMPUS CLEAR · RANKED UNLOCKED 🐲':'CAMPUS CLEAR 🐲';
     allClearText.classList.remove('hidden');
   }else{
     allClearText.classList.add('hidden');
   }
 }

 const recordUpdates=document.getElementById('recordUpdates');
 recordUpdates.innerHTML=updates.join('');
 recordUpdates.classList.toggle('hidden',updates.length===0);

 document.getElementById('nextStageBtn').classList.toggle('hidden',secret||!(clear&&cfg.id<4));
 renderStageGrid();
 endOverlay.classList.remove('hidden');
 resultModal.scrollTop=0;endOverlay.scrollTop=0;
 if(!secret&&lastGeneralResultContext){
   void logGeneralProgressionEvent('stage_result_view',lastGeneralResultContext,lastGeneralResultContext.targetStageId);
   if(lastGeneralResultContext.clear&&lastGeneralResultContext.targetStageId){
     void logGeneralProgressionEvent('next_stage_cta_view',lastGeneralResultContext,lastGeneralResultContext.targetStageId);
   }
 }
 if(secret){
   onlineRankResult.classList.add('hidden');onlineRankResult.textContent='';
   void submitRankedRun();
 }
 tone(secret?820:(clear?620:220),.18,secret?'triangle':(clear?'triangle':'sawtooth'),.04);
}
