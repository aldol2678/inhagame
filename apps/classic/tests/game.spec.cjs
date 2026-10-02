const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const SAVE='inhaDuckProgressV2';
const fixture={version:2,starRulesVersion:2,gradeRulesVersion:5,unlockedStage:4,totalPlays:17,bestCombo:25,
  stages:{1:{cleared:true,stars:3,bestScore:90,bestCombo:18,playCount:6,clearCount:5},2:{cleared:true,stars:3,bestScore:100,bestCombo:21,playCount:4,clearCount:4},3:{cleared:true,stars:3,bestScore:110,bestCombo:23,playCount:4,clearCount:3},4:{cleared:true,stars:3,bestScore:120,bestCombo:25,playCount:3,clearCount:2}},
  hidden:{unlocked:true,cleared:true,bestScore:800,bestCombo:50,playCount:9,titleUnlocked:false,unlockSeen:true,sessionV2:{version:5,plays:9,bestScore:800,bestContract:'A+'},customLegacyValue:'keep'}};
let errors,writes;
test.beforeEach(async({page})=>{
  errors=[];writes=[];page.on('pageerror',e=>errors.push(e.message));
  // Network isolation: no real login, profile, leaderboard or score writes during QA.
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('**/*.supabase.co/**',r=>{writes.push(r.request().method()+' '+new URL(r.request().url()).pathname);return r.abort();});
});
test.afterEach(async()=>{expect(errors).toEqual([]);expect(writes).toEqual([]);});
async function open(page,{saved=fixture,qa=false,clock=true}={}){
  if(clock){const date=new Date('2026-09-22T08:00:00Z');await page.clock.install({time:date});await page.clock.pauseAt(date);}
  await page.addInitScript(({saved,SAVE})=>{if(saved&&!localStorage.getItem(SAVE))localStorage.setItem(SAVE,JSON.stringify(saved));},{saved,SAVE});
  await page.goto(qa?'/?qa=secret':'/');
}
async function press(page,locator){
  const box=await locator.boundingBox();expect(box).not.toBeNull();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  const hit=await locator.evaluate((el,{x,y})=>el.contains(document.elementFromPoint(x,y)),{x,y});expect(hit).toBe(true);
  if(test.info().project.use.hasTouch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
}
async function startSecret(page){await press(page,page.locator('.secret-stage-card'));await press(page,page.locator('#startBtn'));await page.clock.runFor(1000);await expect(page.locator('#countdownOverlay')).toBeVisible();await expect(page.locator('#countdownText')).toHaveText('3');await page.clock.runFor(3100);await expect(page.locator('#game')).toHaveAttribute('data-run-phase','NORMAL');}
async function groundCapture(page){
  const target=page.locator('#target'),isBad=await target.evaluate(el=>el.classList.contains('annyongi'));
  if(isBad){await page.clock.runFor(850);return;}
  await press(page,target);await page.clock.runFor(160);
}
async function charge(page){
  for(let i=0;i<90&&!await page.locator('#dragonCallBtn').isEnabled();i++)await groundCapture(page);
  await expect(page.locator('#dragonCallBtn')).toBeEnabled();await expect(page.locator('#dragonCount')).toHaveText('20/20');
}
async function flightCapture(page){
  const good=page.locator('.flight-target:not(.annyongi)');
  if(await good.count())await press(page,good.first());
  await page.clock.runFor(300);
}
async function assertVisibleCTA(page,selector){
  const el=page.locator(selector),b=await el.boundingBox(),size=page.viewportSize();
  expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(size.width+1);expect(b.y+b.height).toBeLessThanOrEqual(size.height+1);
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(await el.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));})).toBe(true);
}
test('T1-T6 continuous input, 월식, 승천, 귀환, Result, Contract, reload and replay',async({page},info)=>{
  await open(page);await assertVisibleCTA(page,'#startBtn');await page.screenshot({path:info.outputPath('start.png')});
  await startSecret(page);await charge(page);
  await assertVisibleCTA(page,'#dragonCallBtn');await press(page,page.locator('#dragonCallBtn'));
  await expect(page.locator('#game')).toHaveAttribute('data-run-phase','DRAGON_CALLED');
  await expect(page.locator('#dragonCallBtn')).toBeDisabled();
  await page.clock.runFor(750);await expect(page.locator('#game')).toHaveAttribute('data-run-phase','ECLIPSE');
  await expect(page.locator('.moon-zone')).toBeVisible();await page.screenshot({path:info.outputPath('eclipse.png')});
  for(let i=0;i<7;i++)await groundCapture(page);
  expect(await page.evaluate(()=>secretRun.eclipseCaptures)).toBeGreaterThan(0);
  const eclipse=await page.evaluate(()=>({captures:secretRun.eclipseCaptures,bonus:secretRun.eclipseScore}));expect(eclipse.bonus).toBe(eclipse.captures*2);
  await page.clock.fastForward(5000);await expect(page.locator('#game')).toHaveAttribute('data-run-phase','FLIGHT');
  await expect(page.locator('#target')).toBeHidden();
  for(let i=0;i<12;i++)await flightCapture(page);
  const flight=await page.evaluate(()=>({captures:secretRun.flightCaptures,bonus:secretRun.flightScore}));
  expect(flight.captures).toBeGreaterThan(0);expect(flight.bonus).toBeGreaterThan(0);
  await page.screenshot({path:info.outputPath('flight.png')});
  await page.clock.fastForward(5000);await expect(page.locator('#game')).toHaveAttribute('data-run-phase','NORMAL');
  await expect(page.locator('#endOverlay')).toBeHidden();await expect(page.locator('#target')).toBeVisible();
  await page.clock.fastForward(31000);await expect(page.locator('#endOverlay')).toBeVisible();
  await expect(page.locator('#resultState')).toContainText('승천 1회');
  const result=await page.evaluate(()=>runResult);expect(result.completed).toBe(true);
  await expect(page.locator('#contractResult')).toContainText(result.contract.rank);
  await expect(page.locator('#scoreBreakdown')).toContainText('점수 원장');
  await expect(page.locator('#scoreBreakdown')).toContainText('승천 배율');
  expect(result.completedCalls).toBe(1);expect(result.totalScore).toBe(result.baseCapture+result.rareBonus+result.eclipseScore+result.flightScore+result.comboBonus);
  await expect(page.locator('#finalScore')).toHaveText(String(result.totalScore));
  await assertVisibleCTA(page,'#restartBtn');await assertVisibleCTA(page,'#stageSelectBtn');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath('result.png')});
  const saved=await page.evaluate(SAVE=>JSON.parse(localStorage.getItem(SAVE)),SAVE);
  expect(saved.stages).toEqual(fixture.stages);expect(saved.hidden.bestScore).toBe(800);expect(saved.hidden.customLegacyValue).toBe('keep');
  expect(saved.hidden.sessionV2.plays).toBe(fixture.hidden.sessionV2.plays+1);expect(saved.hidden.sessionV2.bestContract).toBe(fixture.hidden.sessionV2.bestContract);
  await page.clock.fastForward(60000);expect(await page.evaluate(SAVE=>JSON.parse(localStorage.getItem(SAVE)).totalPlays,SAVE)).toBe(18);
  await page.reload();expect(await page.evaluate(SAVE=>JSON.parse(localStorage.getItem(SAVE)),SAVE)).toEqual(saved);
  await press(page,page.locator('.secret-stage-card'));await press(page,page.locator('#startBtn'));await page.clock.runFor(4100);
  await expect(page.locator('#score')).toHaveText('0');await expect(page.locator('#dragonCount')).toHaveText('0/20');
  await page.clock.fastForward(31000);await expect(page.locator('#resultState')).toContainText('비룡 미호출');
  expect(await page.evaluate(()=>runResult.completed)).toBe(false);expect(await page.evaluate(()=>runResult.contract.rank)).toBe('F');
  await press(page,page.locator('#restartBtn'));await page.clock.runFor(4100);await expect(page.locator('#game')).toHaveAttribute('data-run-phase','NORMAL');
  expect(await page.evaluate(()=>secretRun.hits.normal)).toBe(0);
  await page.clock.fastForward(31000);
  expect(await page.locator('.result-modal').evaluate(el=>el.scrollTop)).toBe(0);
  await expect(page.locator('#finalScore')).toHaveText('0');
  fs.writeFileSync(info.outputPath('run-result.json'),JSON.stringify({result,saved,flight},null,2));
});
test('T5 V8 migration retains historical stars, scores and inferred unlocks',async({page})=>{
  await page.addInitScript(()=>localStorage.setItem('inhaDuckStageProgressV8',JSON.stringify({unlocked:4,stars:{1:3,2:2,3:1},best:{1:42,2:57,3:64,4:71}})));
  await open(page,{saved:null});
  const p=await page.evaluate(SAVE=>JSON.parse(localStorage.getItem(SAVE)),SAVE);
  expect(p.unlockedStage).toBe(4);expect(p.stages[1].bestScore).toBe(42);expect(p.stages[2].stars).toBe(0);expect(p.stages[3].cleared).toBe(true);
  await page.reload();await expect(page.locator('#startBtn')).toBeVisible();
});
test('T5 mid-flight refresh abandons only the active run without altering saved progress',async({page})=>{
  await open(page);await startSecret(page);await charge(page);await press(page,page.locator('#dragonCallBtn'));
  await page.clock.fastForward(6000);await expect(page.locator('#game')).toHaveAttribute('data-run-phase','FLIGHT');
  await page.reload();const saved=await page.evaluate(SAVE=>JSON.parse(localStorage.getItem(SAVE)),SAVE);
  expect(saved).toEqual(fixture);await expect(page.locator('#startBtn')).toBeVisible();
});
test('360 short viewport retains first CTA and compact Result actions',async({page},info)=>{
  await page.setViewportSize({width:360,height:640});await open(page,{saved:null,qa:true});await assertVisibleCTA(page,'#startBtn');
  await startSecret(page);await charge(page);await press(page,page.locator('#dragonCallBtn'));await page.clock.runFor(750);
  for(let i=0;i<9;i++)await groundCapture(page);
  await page.clock.fastForward(5000);
  for(let i=0;i<12;i++)await flightCapture(page);
  await page.clock.fastForward(5000);await expect(page.locator('#game')).toHaveAttribute('data-run-phase','NORMAL');
  await page.clock.fastForward(31000);await assertVisibleCTA(page,'#restartBtn');await assertVisibleCTA(page,'#stageSelectBtn');
  await expect(page.locator('#recordUpdates')).toContainText('최고 기록');
  await expect(page.locator('#recordUpdates')).toContainText('학점 뱃지');
  expect(await page.locator('.result-modal').evaluate(el=>el.scrollTop)).toBe(0);
  await page.screenshot({path:info.outputPath('result-360x640.png')});
});
test('Play UX: 3-second countdown, persistent sound toggle and safe home exit pause',async({page})=>{
  await open(page);
  await press(page,page.locator('#startBtn'));
  await expect(page.locator('#countdownOverlay')).toBeVisible();
  await expect(page.locator('#countdownText')).toHaveText('3');
  await expect(page.locator('#homeGameBtn')).toBeDisabled();
  await press(page,page.locator('#soundToggleBtn'));
  await expect(page.locator('#soundToggleBtn')).toHaveText('🔇');
  expect(await page.evaluate(()=>localStorage.getItem('inhaDuckSoundEnabled'))).toBe('false');
  await page.clock.runFor(3100);
  await expect(page.locator('#countdownOverlay')).toBeHidden();
  await expect(page.locator('#homeGameBtn')).toBeEnabled();
  const before=await page.locator('#time').textContent();
  await press(page,page.locator('#homeGameBtn'));
  await expect(page.locator('#exitConfirmOverlay')).toBeVisible();
  await page.clock.runFor(5000);
  await expect(page.locator('#time')).toHaveText(before);
  await press(page,page.locator('#resumeGameBtn'));
  await expect(page.locator('#exitConfirmOverlay')).toBeHidden();
  await page.clock.runFor(1100);
  expect(Number(await page.locator('#time').textContent())).toBe(Number(before)-1);
  await press(page,page.locator('#homeGameBtn'));
  await press(page,page.locator('#exitToHomeBtn'));
  await expect(page.locator('#startOverlay')).toBeVisible();
  await expect(page.locator('#gameUtilityControls')).toBeHidden();
  await page.reload();
  expect(await page.evaluate(()=>localStorage.getItem('inhaDuckSoundEnabled'))).toBe('false');
});

test('Account stays optional and exposes signup plus password login',async({page})=>{
  await open(page,{saved:null});
  await expect(page.locator('#startBtn')).toBeVisible();
  await press(page,page.locator('#accountOpenBtn'));
  await expect(page.locator('#accountOverlay')).toBeVisible();
  await expect(page.locator('#accountSignupTab')).toBeVisible();
  await expect(page.locator('#accountSignupEmailInput')).toBeVisible();
  await expect(page.locator('#accountSignupBtn')).toBeVisible();
  await press(page,page.locator('#accountLoginTab'));
  await expect(page.locator('#accountLoginEmailInput')).toBeVisible();
  await expect(page.locator('#accountLoginPasswordInput')).toBeVisible();
  await expect(page.locator('#accountPasswordLoginBtn')).toBeVisible();
  await press(page,page.locator('#accountCloseBtn'));
  await expect(page.locator('#accountOverlay')).toBeHidden();
  await expect(page.locator('#startBtn')).toBeVisible();
});

test('Regression: four stages, penalties, combo, difficulty, records and navigation',async({page})=>{
  await open(page);
  expect(await page.evaluate(()=>STAGE_CONFIGS.slice(0,4).map(s=>[s.seconds,s.speed,s.comboWindow]))).toEqual([[35,1.16,2600],[30,1,2300],[25,.84,2100],[23,.76,2050]]);
  for(let stage=1;stage<=4;stage++){
    await press(page,page.locator('.stage-card').nth(stage-1));await press(page,page.locator('#startBtn'));await page.clock.runFor(3100);
    await expect(page.locator('#dragonCallBtn')).toBeHidden();
    for(let i=0;i<16;i++)await groundCapture(page);
    expect(Number(await page.locator('#score').textContent())).toBeGreaterThan(0);
    // Click a naturally spawned trap and verify the stage's existing penalty.
    for(let i=0;i<80&&!await page.locator('#target').evaluate(el=>el.classList.contains('annyongi'));i++)await page.clock.runFor(180);
    if(await page.locator('#target').evaluate(el=>el.classList.contains('annyongi'))){await press(page,page.locator('#target'));expect(await page.evaluate(()=>annyongiClicked)).toBeGreaterThan(0);}
    await page.clock.runFor(40000);await expect(page.locator('#endOverlay')).toBeVisible();
    await expect(page.locator('#contractResult')).toBeHidden();await expect(page.locator('#resultMiniStats')).toBeVisible();
    const saved=await page.evaluate(SAVE=>JSON.parse(localStorage.getItem(SAVE)),SAVE);expect(saved.stages[stage].playCount).toBe(fixture.stages[stage].playCount+1);
    expect(saved.stages[stage].stars).toBe(3);expect(saved.hidden).toMatchObject(fixture.hidden);
    await page.locator('#stageSelectBtn').scrollIntoViewIfNeeded();await press(page,page.locator('#stageSelectBtn'));
  }
});
test('QA secret path still selects Secret and leaderboard failure returns to game',async({page})=>{
  await open(page,{saved:null,qa:true});await expect(page.locator('.secret-stage-card.selected')).toBeVisible();
  await press(page,page.locator('#rankingOpenBtn'));await expect(page.locator('#rankingOverlay')).toBeVisible();
  await expect(page.locator('#rankingStatus')).toContainText('불러오지 못했습니다');await press(page,page.locator('#rankingCloseBtn'));
  await press(page,page.locator('#startBtn'));await page.clock.runFor(4100);await expect(page.locator('#game')).toHaveAttribute('data-run-phase','NORMAL');await expect(page.locator('#dragonCount')).toHaveText('0/20');
  expect(await page.evaluate(()=>qaLoadRuns().length)).toBe(0);
});
