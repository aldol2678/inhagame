import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
import { extractDailyComposition, isClientBlockedError } from './world-stability-daily-reward-fixture.mjs';
const output=process.env.WORLD_STABILITY_OUTPUT||'test-results/world-stability';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,process.env.EXPECTED_STABILITY_HEAD,'browser evidence must match the requested PR head');
await mkdir(output,{recursive:true});
const sourcePaths=['styles.css','src/main.js','src/attendance/attendance-client.js','src/attendance/attendance-panel.js','src/daily-quiz/daily-quiz-client.js','src/daily-quiz/daily-quiz-panel.js','src/wallet/wallet-client.js','src/progression/progression-client.js','src/progression/progression-hud.js','tests/browser/world-stability-daily-reward-fixture.mjs','tests/browser/world-stability-smoke.mjs','tests/browser/world-stability-fixture.mjs','tests/browser/world-stability-harness.html','tests/browser/harness.mjs','tests/browser/package-lock.json'];
const sourceHashes=Object.fromEntries(await Promise.all(sourcePaths.map(async path=>[path,createHash('sha256').update(await readFile(new URL(`../../${path}`,import.meta.url))).digest('hex')])));
const mainComposition=extractDailyComposition(await readFile(new URL('../../src/main.js',import.meta.url),'utf8'));

const report={head,sourceHashes,environment:{node:process.version,platform:process.platform,browserChannel:process.env.WORLD_SMOKE_BROWSER||'chromium',viewportProfiles:['1280x800 desktop','390x844 mobile']},networkIsolation:[],scope:'Actual Chromium, extracted production main.js daily composition and production panels/read-models/HUD/DOM/pointer capture; synthetic accounts/RPC only; no real purchases, login, DB or full-campus rendering',cases:[],screenshots:[],status:'RUNNING'};
const shot=async(page,name)=>{const path=`${output}/${name}.png`;await page.screenshot({path,animations:'disabled',fullPage:false});report.screenshots.push({name:`${name}.png`,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});};
async function runDailyRewardAcceptance(page, name, fatal) {
 const snapshot = () => page.evaluate(() => window.__WORLD_STABILITY__.dailyReward.snapshot());
 const wait = (predicate, arg) => Promise.race([page.waitForFunction(predicate, arg, { timeout: TIMEOUT_MS }), fatal]);
 const prepare = (kind, scenario) => page.evaluate(options => window.__WORLD_STABILITY__.prepareDailyReward(options), { kind, scenario, mainComposition });
 const receipt = text => page.evaluate(text => window.__WORLD_STABILITY__.receipt(text), text);
 const click = kind => page.getByRole('button', { name: kind === 'attendance' ? '오늘 출석하기' : '정답 선택', exact: true }).click();
 const failedNotice = kind => kind === 'attendance' ? '출석을 저장하지 못했어요. 다시 시도해 주세요.' : '답을 저장하지 못했어요. 다시 시도해 주세요.';
 const common = (r, commits = 1) => {
  assert.equal(r.writes, 1); assert.equal(r.serverCommits, commits); assert.equal(r.mutationClicks, 1);
  assert.equal(r.trustedMutationClicks, 1, 'native trusted panel click required'); assert.equal(r.rewardToasts, 0); assert.equal(r.levelToasts, 0);
 };
 // Query Chromium's actual rendered panel independently of fixture bookkeeping.
 // Retained notices are scrolled into the viewport before capturing their pixels.
 const noticeDom = async expected => {
  const selector = '#daily-reward-surface .daily-panel .shop-hint', hints = page.locator(selector);
  assert.deepEqual(await hints.allTextContents(), expected, 'actual .shop-hint DOM must match the trusted panel state');
  const boxes = [];
  for (let i = 0; i < expected.length; i++) {
   const hint = hints.nth(i); await hint.scrollIntoViewIfNeeded(); assert.equal(await hint.isVisible(), true);
   const box = await hint.boundingBox(), viewport = page.viewportSize();
   assert.ok(box && box.width > 0 && box.height > 0 && box.y >= 0 && box.y + box.height <= viewport.height, 'notice pixels must be inside the screenshot viewport');
   boxes.push(box);
  }
  return { selector, texts: await hints.allTextContents(), boxes };
 };
 const completedDom = async kind => {
  const done = page.locator(kind === 'attendance' ? '.daily-panel .attendance-done' : '.daily-panel .daily-quiz-passed');
  await done.scrollIntoViewIfNeeded(); assert.equal(await done.isVisible(), true);
  assert.equal(await page.getByRole('button', { name: kind === 'attendance' ? '오늘 출석하기' : '정답 선택', exact: true }).count(), 0, 'completed panel has no repeat-write button');
 };
 for (const kind of ['attendance', 'quiz']) {
  for (const scenario of ['lost-response', 'malformed-response', 'read-failure-retry']) {
   assert.equal((await prepare(kind, scenario)).writes, 0, 'open must never mutate'); await click(kind);
   if (scenario === 'read-failure-retry') {
    await wait(() => { const r = window.__WORLD_STABILITY__.dailyReward.snapshot(); return r.state === 'UNAVAILABLE' && r.mutationOutcome === 'FAILED'; });
    const failed = await snapshot(); assert.ok(failed.changes.some(c => c.client === 'wallet' && c.state === 'UNAVAILABLE'));
    if (kind === 'quiz') assert.ok(failed.changes.some(c => c.client === 'progression' && c.state === 'UNAVAILABLE'));
    report.cases.push({ viewport: name, type: 'daily-reward-unrecovered-notice', ...failed, noticeDom: await noticeDom([failedNotice(kind)]) });
    await receipt('검증 · 저장 응답 유실 후 조회 불가\n복구 전 실패 안내 유지 / 합성 서버 쓰기 1회');
    await shot(page, `${name}-${kind}-read-unavailable`);
    await page.getByRole('button', { name: '다시 시도', exact: true }).click();
   }
   await wait(kind => { const r = window.__WORLD_STABILITY__.dailyReward.snapshot(); return r.state === 'READY' && r.wallet === 110 && r.exp === (kind === 'quiz' ? 120 : 90) && r.mutationOutcome === 'FAILED'; }, kind);
   const r = await snapshot(); common(r); assert.equal(r.completed, kind === 'attendance' ? true : 'PASSED');
   assert.equal(r.hudVisible, true); assert.match(r.walletText, /110/); assert.match(r.hudText, kind === 'quiz' ? /Lv\.2 120 \/ 300 EXP/ : /Lv\.1 90 \/ 100 EXP/);
   const notices = await noticeDom([]); await completedDom(kind);
   if (scenario === 'read-failure-retry') { assert.equal(r.retryClicks, 1); assert.equal(r.trustedRetryClicks, 1, 'native read-only retry required'); }
   report.cases.push({ viewport: name, type: 'daily-reward-recovery', ...r, noticeDom: notices });
   await page.evaluate(() => window.__WORLD_STABILITY__.receipt('PASS · 상태·지갑·진행도 복구 및 실패 안내 제거\n합성 서버 쓰기 1회 / 보상·레벨 토스트 0회'));
   await shot(page, `${name}-${kind}-${scenario}-recovered`);
  }
  await prepare(kind, 'failed-response'); await click(kind);
  await wait(() => window.__WORLD_STABILITY__.dailyReward.snapshot().mutationOutcome === 'FAILED');
  await page.evaluate(() => window.__WORLD_STABILITY__.dailyReward.refresh());
  const failed = await snapshot(); common(failed, 0); assert.equal(failed.state, 'READY');
  assert.equal(failed.completed, kind === 'attendance' ? false : 'ACTIVE'); assert.equal(failed.wallet, 100); assert.equal(failed.exp, 90);
  report.cases.push({ viewport: name, type: 'daily-reward-genuine-failure', ...failed, noticeDom: await noticeDom([failedNotice(kind)]) });
  await receipt('PASS · 실제 저장 실패 안내 유지\n합성 서버 반영 0회 / 추가 보상 없음');
  await shot(page, `${name}-${kind}-genuine-failure`);

  for (const accounts of [['fixture-B'], ['fixture-B', 'fixture-A'], [null]]) {
   await prepare(kind, 'failed-response'); await click(kind);
   await wait(() => window.__WORLD_STABILITY__.dailyReward.snapshot().mutationOutcome === 'FAILED');
   await noticeDom([failedNotice(kind)]);
   for (const account of accounts) { await page.evaluate(id => window.__WORLD_STABILITY__.dailyReward.bind(id), account); await noticeDom([]); }
   const r = await snapshot(); common(r, 0); assert.equal(r.account, accounts.at(-1));
   report.cases.push({ viewport: name, type: 'daily-reward-account-notice-cleared', accounts, ...r, noticeDom: await noticeDom([]) });
  }
  for (const scenario of ['late-write', 'late-readback', 'late-failed-response']) for (const reopenBeforeRelease of [false, true]) {
   await prepare(kind, scenario); await click(kind);
   await wait(count => window.__WORLD_STABILITY__.dailyReward.snapshot().heldResponses === count, scenario === 'late-readback' ? kind === 'quiz' ? 3 : 2 : 1);
   await page.getByRole('button', { name: kind === 'attendance' ? '출석부 닫기' : '오늘의 퀴즈 닫기', exact: true }).click();
   assert.equal((await snapshot()).panelOpen, false); await noticeDom([]);
   if (reopenBeforeRelease) await page.getByRole('button', { name: '일일 패널 다시 열기', exact: true }).click();
   await page.evaluate(() => window.__WORLD_STABILITY__.dailyReward.releaseHeld());
   if (!reopenBeforeRelease) { await noticeDom([]); await page.getByRole('button', { name: '일일 패널 다시 열기', exact: true }).click(); }
   await wait(() => { const r = window.__WORLD_STABILITY__.dailyReward.snapshot(); return r.state === 'READY' && r.mutationOutcome === 'FAILED' && r.heldResponses === 0; });
   const r = await snapshot(), committed = scenario !== 'late-failed-response'; common(r, Number(committed));
   assert.equal(r.panelOpen, true); assert.equal(r.completed, kind === 'attendance' ? committed : committed ? 'PASSED' : 'ACTIVE');
   assert.equal(r.wallet, committed ? 110 : 100); assert.equal(r.exp, committed && kind === 'quiz' ? 120 : 90);
   assert.equal(r.reopenClicks, 1); assert.equal(r.trustedReopenClicks, 1, 'native close/reopen gesture required');
   const notices = await noticeDom([]); if (committed) await completedDom(kind);
   report.cases.push({ viewport: name, type: 'daily-reward-close-reopen', reopenBeforeRelease, ...r, noticeDom: notices });
   await receipt(`PASS · 닫기·재열기 후 이전 실패 안내 없음\n${committed ? '서버 완료 상태 복구 / 합성 서버 반영 1회' : '이전 창의 실패 응답 무시 / 합성 서버 반영 0회'}`);
   await shot(page, `${name}-${kind}-${scenario}-reopen-${reopenBeforeRelease ? 'before' : 'after'}-reply`);
  }
  for (const scenario of ['late-write', 'late-readback']) for (const accounts of [['fixture-B'], ['fixture-B', 'fixture-A'], [null]]) {
   await prepare(kind, scenario); await click(kind);
   await wait(count => window.__WORLD_STABILITY__.dailyReward.snapshot().heldResponses === count, scenario === 'late-write' ? 1 : kind === 'quiz' ? 3 : 2);
   for (const account of accounts) await page.evaluate(id => window.__WORLD_STABILITY__.dailyReward.bind(id), account);
   const before = await snapshot(); await page.evaluate(() => window.__WORLD_STABILITY__.dailyReward.releaseHeld());
   if (scenario === 'late-write') await wait(() => window.__WORLD_STABILITY__.dailyReward.snapshot().mutationOutcome === 'STALE');
   const r = await snapshot(); common(r); assert.equal(r.calls.length, before.calls.length, 'old result cannot trigger a new-account read');
   assert.equal(r.changes.length, before.changes.length, 'old read cannot publish into a newer generation');
   assert.equal(r.wallet, before.wallet); assert.equal(r.exp, before.exp); assert.equal(r.hudText, before.hudText); assert.equal(r.account, accounts.at(-1));
   report.cases.push({ viewport: name, type: 'daily-reward-generation', accounts, ...r, noticeDom: await noticeDom([]) });
  }
 }
 await prepare('quiz', 'refused-response'); await click('quiz');
 await wait(() => window.__WORLD_STABILITY__.dailyReward.snapshot().mutationOutcome === 'REFUSED');
 await page.evaluate(() => window.__WORLD_STABILITY__.dailyReward.refresh());
 const refused = await snapshot(); common(refused, 0); assert.equal(refused.completed, 'PASSED');
 assert.equal(refused.wallet, 110); assert.equal(refused.exp, 120); await completedDom('quiz');
 report.cases.push({ viewport: name, type: 'daily-reward-refused-preserved', ...refused, noticeDom: await noticeDom(['이미 처리된 답이에요. 최신 상태로 다시 불러왔어요.']) });
 await receipt('PASS · 이미 처리된 답 안내 유지\n완료 상태 재조회 / 중복 요청 반영 0회');
 await shot(page, `${name}-quiz-refused-preserved`);
 await page.evaluate(() => window.__WORLD_STABILITY__.prepareShop());
}
try{
 for(const [name,viewport,mobile] of [['desktop',{width:1280,height:800},false],['mobile',{width:390,height:844},true]]){
  const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:true,deviceScaleFactor:1}});let page;
  try{
   page=await smoke.context.newPage();const fatal=smoke.watch(page);
   report.environment.chromium=smoke.context.browser().version();
   const offOriginResponses=[],blockedProbes=[];
   page.on('response',response=>{if(new URL(response.url()).origin!==smoke.origin)offOriginResponses.push(response.url());});
   page.on('requestfailed',request=>{if(new URL(request.url()).hostname==='daily-reward-offline.invalid')blockedProbes.push({url:request.url(),error:request.failure()?.errorText});});
   await page.goto(`${smoke.origin}/tests/browser/world-stability-harness.html`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});
   await Promise.race([page.waitForFunction(()=>window.__WORLD_STABILITY__?.ready,null,{timeout:TIMEOUT_MS}),fatal]);
   for(const accounts of [['fixture-B'],['fixture-B','fixture-A'],[null]])for(const failure of [false,true]){
    await page.evaluate(()=>window.__WORLD_STABILITY__.prepareShop());await page.locator('.shop-offer-buy').click();
    await page.evaluate(()=>window.__WORLD_STABILITY__.beginReadback());await page.evaluate(a=>window.__WORLD_STABILITY__.switchShop(a),accounts);
    const result=await page.evaluate(f=>window.__WORLD_STABILITY__.finishReadback(f),failure);assert.equal(result.outcome,'STALE');assert.equal(result.writes,1);report.cases.push({viewport:name,type:'real-shop-panel-readback',accounts,failure,...result});
   }
   report.cases.push({viewport:name,type:'loadout-readback',results:await page.evaluate(()=>window.__WORLD_STABILITY__.loadoutBoundaries())});
   report.cases.push({viewport:name,type:'stale-key',result:await page.evaluate(()=>window.__WORLD_STABILITY__.staleKey())});
   report.cases.push({viewport:name,type:'daily-ordering',result:await page.evaluate(()=>window.__WORLD_STABILITY__.dailyOrdering())});
   await runDailyRewardAcceptance(page,name,fatal);
   const rejected=await page.evaluate(()=>fetch('https://daily-reward-offline.invalid/blocked-probe').then(()=>false,()=>true));
   assert.equal(rejected,true,'off-origin safety probe must be blocked');assert.equal(blockedProbes.length,1);assert.equal(isClientBlockedError(blockedProbes[0].error),true,`expected explicit Chromium client block, got ${blockedProbes[0].error}`);assert.deepEqual(offOriginResponses,[]);
   report.networkIsolation.push({viewport:name,serviceWorkers:'blocked',offOriginResponses,blockedProbes,operationalRpc:'none; synthetic in-memory transport only'});
   await page.evaluate(()=>window.__WORLD_STABILITY__.prepareShop());
   const cdp=await smoke.context.newCDPSession(page),box=await page.locator('#joystick').boundingBox();assert.ok(box);
   const first={id:11,x:Math.round(box.x+box.width*.82),y:Math.round(box.y+box.height*.5)},second={id:22,x:Math.round(box.x+box.width*.18),y:first.y};
   const touch=(type,touchPoints)=>cdp.send('Input.dispatchTouchEvent',{type,touchPoints});
   const state=()=>page.evaluate(()=>window.__WORLD_STABILITY__.touchState());
   const active=async()=>{await page.waitForFunction(()=>window.__WORLD_STABILITY__.touchState().vector.x>.8,null,{timeout:5000});};
   const stopped=async()=>{await page.waitForFunction(()=>{const v=window.__WORLD_STABILITY__.touchState().vector;return v.x===0&&v.y===0;},null,{timeout:5000});};
   await touch('touchStart',[first]);await active();
   const before=await state();const owner=before.events.findLast(e=>e.type==='pointerdown');assert.ok(owner?.trusted&&owner.pointerType==='touch','native trusted touch required');
   await touch('touchMove',[first,second]);const both=await state(),foreign=both.events.findLast(e=>e.type==='pointerdown');assert.notEqual(foreign.id,owner.id,'a real second pointer is required');assert.ok(both.vector.x>.8,'second native finger cannot take ownership');
   // Current synthetic-pointer CDP contracts shrink the active list. Legacy Chromium
   // CreateWebTouchEvents instead releases the points explicitly named in touchEnd.
   // Detect the native event, never treat an unchanged vector as proof of release.
   await touch('touchMove',[first]);let releaseProtocol='active-point-list';
   if(!(await state()).events.some(e=>e.type==='pointerup'&&e.id===foreign.id)){
    await touch('touchEnd',[second]);releaseProtocol='legacy-explicit-ended-point';
   }
   const released=await state();assert.ok(released.events.some(e=>e.type==='pointerup'&&e.id===foreign.id&&e.trusted),'foreign native pointerup required');assert.ok(released.vector.x>.8,'foreign native release cannot stop owner');
   await touch('touchMove',[{...first,x:first.x-2}]);assert.ok((await state()).events.some(e=>e.type==='gotpointercapture'&&e.id===owner.id&&e.trusted),'actual owner capture required');
   await shot(page,`${name}-native-pointer-owner`);
   await page.evaluate(id=>window.__WORLD_STABILITY__.releaseCapture(id),owner.id);await touch('touchMove',[{...first,x:first.x-3}]);await stopped();
   assert.ok((await state()).events.some(e=>e.type==='lostpointercapture'&&e.id===owner.id&&e.trusted),'native owner capture loss required');await touch('touchEnd',[]);
   report.cases.push({viewport:name,type:'native-release-protocol',releaseProtocol,ownerId:owner.id,foreignId:foreign.id});
   await touch('touchStart',[first]);await active();await page.evaluate(()=>window.__WORLD_STABILITY__.block(false));await stopped();await page.evaluate(()=>window.__WORLD_STABILITY__.block(true));await touch('touchMove',[{...first,x:first.x-4}]);await stopped();await touch('touchEnd',[]);
   for(const type of ['blur','pagehide']){await touch('touchStart',[first]);await active();await page.evaluate(t=>window.__WORLD_STABILITY__.lifecycle(t),type);await stopped();await touch('touchMove',[{...first,x:first.x-4}]);await stopped();await touch('touchEnd',[]);}
   await touch('touchStart',[first]);await active();await touch('touchEnd',[]);await stopped();
   report.cases.push({viewport:name,type:'native-fresh-gesture-recovery',movementRestored:true,endedAtZero:true});
   await page.evaluate(()=>window.__WORLD_STABILITY__.receipt('PASS · 실제 touch 포인터 소유권 / capture·lostcapture\n입력 차단·합성 blur/pagehide 이후 이동 0\n합성 계정 구매·일일 상태 회귀 통과'));
   const final=await state();report.cases.push({viewport:name,type:'native-touch',events:final.events,lifecycleCoverage:'blur/pagehide deliberately dispatched DOM events; no claim of OS-level focus/BFCache coverage',vector:final.vector});await shot(page,`${name}-stability-passed`);
   assert.deepEqual(smoke.problems,[]);assert.deepEqual(offOriginResponses,[]);await cdp.detach();
  }catch(error){if(page){report.failureTouch=await page.evaluate(()=>window.__WORLD_STABILITY__?.touchState()).catch(()=>null);await shot(page,`${name}-failure`).catch(()=>{});}throw error;}finally{await smoke.close();}
 }
 report.status='PASS';console.log(JSON.stringify(report,null,2));
}catch(error){report.status='FAIL';report.error=error.stack||String(error);throw error;}finally{await writeFile(`${output}/report.json`,JSON.stringify(report,null,2)+'\n');}
