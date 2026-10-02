// Characterization of Classic behavior that game.spec.cjs does not pin down, written against the
// pre-modularization build so the refactor can be checked against it: hub entry attribution,
// event/ranking/badge modals, restart, the storage key contract, and that every sprite, style
// and script the page references actually loads.
const {test,expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const SAVE='inhaDuckProgressV2';
const ENTRY='1a2b3c4d-5e6f-4a7b-9c8d-0e1f2a3b4c5d';
let errors,writes,failed;
test.beforeEach(async({page})=>{
  errors=[];writes=[];failed=[];
  page.on('pageerror',e=>errors.push(e.message));
  page.on('response',r=>{if(r.status()>=400)failed.push(r.status()+' '+r.url());});
  page.on('requestfailed',r=>{
    const u=r.url(),reason=r.failure()?.errorText;
    if(/supabase\.co|cdn\.jsdelivr\.net/.test(u))return;
    // Chromium reports a routed keepalive fetch as aborted even though the page gets the reply;
    // the hub test proves delivery through game-entry's own confirmation record instead.
    if(u==='https://inhagame.example/api/hub-entry'&&reason==='net::ERR_ABORTED')return;
    failed.push('failed '+r.method()+' '+u+' '+reason);
  });
  // Network isolation, as in game.spec.cjs: no Supabase client, no real reads or writes.
  await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:''}));
  await page.route('**/*.supabase.co/**',r=>{writes.push(r.request().method()+' '+new URL(r.request().url()).pathname);return r.abort();});
});
test.afterEach(async()=>{expect(errors).toEqual([]);expect(writes).toEqual([]);expect(failed).toEqual([]);});
async function open(page,{url='/',saved=null}={}){
  const date=new Date('2026-09-22T08:00:00Z');await page.clock.install({time:date});await page.clock.pauseAt(date);
  if(saved)await page.addInitScript(({saved,SAVE})=>{if(!localStorage.getItem(SAVE))localStorage.setItem(SAVE,JSON.stringify(saved));},{saved,SAVE});
  await page.goto(url);
}
async function press(page,locator){
  const box=await locator.boundingBox();expect(box).not.toBeNull();
  const x=box.x+box.width/2,y=box.y+box.height/2;
  if(test.info().project.use.hasTouch)await page.touchscreen.tap(x,y);else await page.mouse.click(x,y);
}
async function inViewport(page,selector){
  const b=await page.locator(selector).boundingBox(),size=page.viewportSize();
  expect(b).not.toBeNull();
  expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(size.width+1);
  expect(b.y).toBeGreaterThanOrEqual(0);expect(b.y+b.height).toBeLessThanOrEqual(size.height+1);
}

test('Page assets: stylesheets apply, sprites decode, scripts define the game globals',async({page})=>{
  await open(page);
  await expect(page.locator('#startBtn')).toBeVisible();
  const state=await page.evaluate(()=>({
    sprites:['annyongiImg','indeokiImg'].map(id=>{const i=document.getElementById(id);return [id,i.complete,i.naturalWidth,i.naturalHeight];}),
    styled:getComputedStyle(document.getElementById('startOverlay')).position,
    sheets:[...document.styleSheets].length,
    globals:[typeof startGame,typeof openRanking,typeof initAccountAuth,typeof STAGE_CONFIGS,typeof progress,typeof SecretRun,typeof BadgeSystem],
  }));
  expect(state.sprites).toEqual([['annyongiImg',true,944,1258],['indeokiImg',true,429,754]]);
  expect(state.styled).not.toBe('static');
  expect(state.sheets).toBeGreaterThanOrEqual(2);
  expect(state.globals).toEqual(['function','function','function','object','object','object','object']);
});

test('Hub entry: landing and play start are reported once with only the entry fields',async({page})=>{
  const hub=[];
  // Serve the local build as duck.inhagame.example so badge-system.js loads the hub entry script.
  await page.route('https://duck.inhagame.example/**',async r=>{
    const u=new URL(r.request().url());
    await r.fulfill({response:await r.fetch({url:'http://127.0.0.1:4173'+u.pathname})});
  });
  await page.route('https://inhagame.example/game-entry.js',r=>r.fulfill({contentType:'text/javascript',
    body:fs.readFileSync(path.join(__dirname,'../../world/game-entry.js'),'utf8')}));
  await page.route('https://inhagame.example/api/hub-entry',r=>{
    if(r.request().method()==='POST')hub.push(JSON.parse(r.request().postData()));
    // Same CORS answer as apps/world/api/hub-entry.js, preflight included.
    return r.fulfill({status:204,headers:{'access-control-allow-origin':'https://duck.inhagame.example',vary:'Origin',
      'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type'}});
  });
  await open(page,{url:`https://duck.inhagame.example/?ih_entry=${ENTRY}`});
  await expect(page.locator('#startBtn')).toBeVisible();
  await expect.poll(()=>hub.map(e=>e.event_type)).toEqual(['game_landing']);
  expect(Object.keys(hub[0]).sort()).toEqual(['entry_id','event_id','event_type','target']);
  expect(hub[0]).toMatchObject({entry_id:ENTRY,target:'classic'});
  expect(new URL(page.url()).searchParams.has('ih_entry')).toBe(false);
  await press(page,page.locator('#startBtn'));
  await page.clock.runFor(3100);
  await expect(page.locator('#homeGameBtn')).toBeEnabled();
  await expect.poll(()=>hub.map(e=>e.event_type)).toEqual(['game_landing','game_play_start']);
  expect(new Set(hub.map(e=>e.entry_id))).toEqual(new Set([ENTRY]));
  // game-entry marks a stage as sent only after a 2xx reply reached the page.
  await expect.poll(()=>page.evaluate(()=>JSON.parse(sessionStorage.getItem('inhagame-hub-entry-v1')||'{}')))
    .toMatchObject({entry:ENTRY,game:'classic',sent:['game_landing','game_play_start']});
});

test('Event, ranking and badge modals open, fit the viewport and close',async({page})=>{
  await open(page);
  await expect(page.locator('#eventState')).toHaveText('진행 중');
  await expect(page.locator('#eventCountdown')).toHaveText('9/27(일) 23:59 마감 · 5일 7시간 0분 남음');
  for(const opener of ['#rankingOpenBtn','#eventRankingBtn']){
    await page.locator(opener).scrollIntoViewIfNeeded();await press(page,page.locator(opener));
    await expect(page.locator('#rankingOverlay')).toBeVisible();
    await expect(page.locator('#rankingStatus')).toHaveText('랭킹을 불러오지 못했습니다. 연결을 확인해 주세요.');
    await inViewport(page,'#rankingCloseBtn');
    await press(page,page.locator('#rankingCloseBtn'));
    await expect(page.locator('#rankingOverlay')).toBeHidden();
  }
  await page.locator('#badgeCollectionBtn').scrollIntoViewIfNeeded();await press(page,page.locator('#badgeCollectionBtn'));
  await expect(page.locator('#badgeOverlay')).toBeVisible();
  expect(await page.locator('#generalBadgeCollection').evaluate(el=>el.children.length)).toBeGreaterThan(0);
  expect(await page.locator('#gradeBadgeCollection').evaluate(el=>el.children.length)).toBeGreaterThan(0);
  await inViewport(page,'#badgeCloseBtn');
  await press(page,page.locator('#badgeCloseBtn'));
  await expect(page.locator('#badgeOverlay')).toBeHidden();
  await page.locator('#accountOpenBtn').scrollIntoViewIfNeeded();await press(page,page.locator('#accountOpenBtn'));
  await expect(page.locator('#accountOverlay')).toBeVisible();
  await inViewport(page,'#accountCloseBtn');
  await press(page,page.locator('#accountCloseBtn'));
  await expect(page.locator('#accountOverlay')).toBeHidden();
});

test('Result restart starts a fresh countdown and a fresh run of the same stage',async({page})=>{
  await open(page);
  await press(page,page.locator('#startBtn'));await page.clock.runFor(3100);
  await expect(page.locator('#homeGameBtn')).toBeEnabled();
  await expect(page.locator('#time')).toHaveText('35');
  await page.clock.runFor(40000);
  await expect(page.locator('#endOverlay')).toBeVisible();
  await page.locator('#restartBtn').scrollIntoViewIfNeeded();await press(page,page.locator('#restartBtn'));
  await expect(page.locator('#endOverlay')).toBeHidden();
  await expect(page.locator('#countdownOverlay')).toBeVisible();
  await page.clock.runFor(3100);
  await expect(page.locator('#countdownOverlay')).toBeHidden();
  await expect(page.locator('#score')).toHaveText('0');
  await expect(page.locator('#time')).toHaveText('35');
  const saved=await page.evaluate(SAVE=>JSON.parse(localStorage.getItem(SAVE)),SAVE);
  expect(saved.stages[1].playCount).toBe(1);expect(saved.totalPlays).toBe(1);
});

test('Storage contract: a fresh visit and one play write exactly the known keys and shapes',async({page})=>{
  await open(page);
  await expect(page.locator('#startBtn')).toBeVisible();
  const keys=()=>page.evaluate(()=>({local:Object.keys(localStorage).sort(),session:Object.keys(sessionStorage).sort()}));
  expect(await keys()).toEqual({
    local:['inhaDuckProgressV2','inhaDuckTelemetryVisitorV1'],
    // The session-start marker is written only after a successful Supabase log (offline here).
    session:['inhaDuckTelemetrySessionV1'],
  });
  const fresh=await page.evaluate(SAVE=>JSON.parse(localStorage.getItem(SAVE)),SAVE);
  expect(Object.keys(fresh).sort()).toEqual(['bestCombo','gradeRulesVersion','hidden','stages','starRulesVersion','totalPlays','unlockedStage','version']);
  expect(fresh).toMatchObject({version:2,unlockedStage:1,totalPlays:0});
  await press(page,page.locator('#startBtn'));await page.clock.runFor(3100);
  await press(page,page.locator('#soundToggleBtn'));
  await page.clock.runFor(40000);await expect(page.locator('#endOverlay')).toBeVisible();
  expect((await keys()).local).toEqual(['inhaDuckProgressV2','inhaDuckSoundEnabled','inhaDuckTelemetryVisitorV1']);
  expect(await page.evaluate(()=>localStorage.getItem('inhaDuckSoundEnabled'))).toBe('false');
  const after=await page.evaluate(SAVE=>JSON.parse(localStorage.getItem(SAVE)),SAVE);
  expect(Object.keys(after).sort()).toEqual(Object.keys(fresh).sort());
  expect(after.totalPlays).toBe(1);expect(after.stages[1].playCount).toBe(1);
  expect(await page.evaluate(()=>localStorage.getItem('inhaDuckTelemetryVisitorV1'))).toMatch(/^[0-9a-f-]{36}$/);
});
