// Actual campus + real PlayCanvas, isolated offline backend. Availability injection exists only
// in this test's network response; production has no query/local-storage activation switch.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
assert.equal(head,process.env.COMMISSION_HEAD_SHA,'Pin browser evidence to the tested candidate');
const output=process.env.COMMISSION_QA_OUTPUT||'test-results/commission-trials';await mkdir(output,{recursive:true});
const source=await readFile(new URL('../../src/main.js',import.meta.url),'utf8');
const sourceFiles=['src/commissions/commission-trial-feature.js','src/commissions/commission-trial.css','src/commissions/cooking-trial.js','src/commissions/cooking-trial-panel.js','src/commissions/sample-room-trial.js','src/commissions/sample-room-trial-panel.js','src/commissions/sample-room-trial-preview.js','src/commissions/sample-room-trial-preview-frame.js','src/commissions/sample-room-trial-preview-frame.html','src/quest/quest-journal.js','campus/index.html'];
const sourceHashes=Object.fromEntries(await Promise.all(sourceFiles.map(async name=>[name,createHash('sha256').update(await readFile(new URL(`../../${name}`,import.meta.url))).digest('hex')])));
const report={head,status:'RUNNING',sourceHashes,mainSourceHash:createHash('sha256').update(source).digest('hex'),cases:[],limits:[
  'Offline guest campus with synthetic account and test-only dependency injection. No live RPC/DB/reward validation.',
  'Mobile viewport/touch emulation is not physical-device acceptance. Play duration has no enforced waiting time.'
]};
const save=()=>writeFile(`${output}/report.json`,JSON.stringify(report,null,2));
const cases=[['desktop',{width:1280,height:800},false],['portrait',{width:390,height:844},true],['landscape',{width:844,height:390},true]];
for(const [name,viewport,mobile] of cases){
  const result={name,checks:[],screenshots:[]};report.cases.push(result);await save();
  const smoke=await startSmoke({viewport,contextOptions:{isMobile:mobile,hasTouch:mobile,deviceScaleFactor:1}});
  try {
    const page=await smoke.context.newPage();page.setDefaultTimeout(30000);const fatal=smoke.watch(page);
    const state=()=>page.evaluate(()=>window.__INHAGAME_P0__.commissionTrials.state());
    const screen=async suffix=>{const file=`${name}-${suffix}.png`;await page.screenshot({path:`${output}/${file}`,timeout:60000});result.screenshots.push(file);};
    const load=async()=>{await page.goto(`${smoke.origin}/campus/?envTime=day&envWeather=clear`,{waitUntil:'domcontentloaded',timeout:TIMEOUT_MS});await Promise.race([page.waitForFunction(()=>window.__INHAGAME_P0__?.getStatus().loading.finished,null,{timeout:120000}),fatal]);};
    const openJournal=async()=>{await page.keyboard.press('KeyQ');await page.locator('.quest-journal-tab[data-type="SIDE"]').click();};
    const openCooking=async()=>{await openJournal();await page.getByRole('button',{name:'늦어진 점심 · 요리 체험',exact:true}).click();};
    const panel=page.locator('#cooking-trial-panel');
    const click=key=>panel.locator(`[data-focus-key="${key}"]`).click();
    const layout=async()=>{const b=await panel.boundingBox();assert.ok(b&&b.x>=0&&b.y>=0&&b.x+b.width<=viewport.width+1&&b.y+b.height<=viewport.height+1,JSON.stringify(b));assert.equal(await panel.evaluate(n=>n.scrollWidth>n.clientWidth+1),false);};
    if(name==='desktop') {
      await load();assert.equal((await state()).available,false);assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.commissionTrials.open('cooking')),false);
      await openJournal();assert.equal(await page.locator('.commission-trial-entry').count(),0);await page.keyboard.press('Escape');
      // Finish the default page's static reads before the intentional test-only reload.
      // Do not turn an aborted navigation read into a product request-failure exemption.
      await page.waitForLoadState('networkidle',{timeout:60000});
      result.checks.push('Production source defaults CLOSED; no trial entry; direct open denied');
    }
    await smoke.context.addInitScript(() => { globalThis.__COMMISSION_ACCOUNT__ = 'fixture-a'; });
    await smoke.context.route('**/src/main.js',route=>{
      const needle='commissionTrials = createCommissionTrialFeature({\n  getAccountId: () => roomFunctionAccountId,';
      assert.equal(source.split(needle).length,2);
      return route.fulfill({status:200,contentType:'text/javascript',body:source.replace(needle,
        'commissionTrials = createCommissionTrialFeature({\n  isAvailable: () => true,\n  getAccountId: () => globalThis.__COMMISSION_ACCOUNT__ ?? null,')});
    });
    await load();await openCooking();await layout();assert.equal((await state()).active,'cooking');
    assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.controller.inputEnabled),false);
    assert.match(await panel.innerText(),/코인·EXP·SP·아이템 지급 없음/);await screen('order');
    await click('accept');await click('next');assert.match(await panel.innerText(),/세 곳의 칼집/);
    for(let i=0;i<3;i++)await click(`cut-${i}`);await click('next');await click('next');assert.match(await panel.innerText(),/양면이 모두/);
    await click('heat-high');await click('cook');await click('cook');assert.equal((await state()).cooking.phase,'FAILED');await screen('burn-feedback');
    await click('retry');await click('accept');for(let i=0;i<3;i++)await click(`cut-${i}`);await click('next');
    await click('cook');await click('cook');await click('flip');await click('cook');await click('cook');await screen('grill');
    await click('next');await click('sauce-rich');await click('submit');assert.equal((await state()).cooking.phase,'FAILED');assert.match(await panel.innerText(),/소스가 조금 많/);
    await click('retry');await click('accept');for(let i=0;i<3;i++)await click(`cut-${i}`);await click('next');
    await click('cook');await click('cook');await click('flip');await click('cook');await click('cook');await click('next');await click('sauce-light');await click('submit');
    assert.equal((await state()).cooking.phase,'DONE');await screen('delivered');await layout();
    result.checks.push('Two order conditions, cutting, both-side cooking, burn/wrong-sauce retry, successful NPC delivery, no wait padding');
    await click('close');assert.equal((await state()).active,null);
    for(const method of ['cancel','escape','back','takeover','account']){
      await openCooking();await click('accept');
      if(method==='cancel')await click('cancel');
      if(method==='escape')await page.keyboard.press('Escape');
      if(method==='back')await page.evaluate(()=>dispatchEvent(new PopStateEvent('popstate')));
      if(method==='takeover')await page.evaluate(()=>window.__INHAGAME_P0__.dailyQuizPanel.setOpen(true));
      if(method==='account')await page.evaluate(()=>{globalThis.__COMMISSION_ACCOUNT__='other';window.__INHAGAME_P0__.commissionTrials.update();});
      assert.equal((await state()).active,null,method);assert.equal(await panel.isVisible(),false,method);
      if(method==='takeover')await page.evaluate(()=>window.__INHAGAME_P0__.dailyQuizPanel.setOpen(false));
    }
    await openCooking();assert.equal((await state()).cooking.phase,'ORDER');
    await panel.locator('[data-focus-key="close"]').focus();await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.dataset.focusKey),'cancel');
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.dataset.focusKey),'close');
    await page.evaluate(()=>{globalThis.__STALE_TRIAL_BUTTON__=document.querySelector('#cooking-trial-panel [data-focus-key="accept"]');});
    await click('close');await openCooking();await page.evaluate(()=>globalThis.__STALE_TRIAL_BUTTON__.click());assert.equal((await state()).cooking.phase,'ORDER');assert.equal((await state()).active,'cooking');
    await click('close');await page.keyboard.press('KeyN');await page.getByRole('button',{name:'홈 화면으로',exact:true}).click();assert.equal((await state()).active,null);await page.getByRole('button',{name:'스마트폰 닫기',exact:true}).click();
    result.checks.push('Close/Cancel/Escape/Back, modal takeover, account switch, stale prior-session callback, repeated reopen, focus trap and Phone Home return');
    // Shared sample-room integration is exercised by its own focused harness and the same entry.
    await openJournal();await page.getByRole('button',{name:'책 펼칠 자리 · 샘플방 체험',exact:true}).click();
    assert.equal((await state()).active,'room');
    await page.waitForFunction(()=>{const p=window.__INHAGAME_P0__.commissionTrials.state().room.preview;return p?.frames>2||p?.error;});
    const preview=(await state()).room.preview;assert.ok(preview?.frames>2,JSON.stringify(preview));
    const mainFrame=await page.evaluate(()=>window.__INHAGAME_P0__.app.frame);
    await page.waitForFunction(frame=>window.__INHAGAME_P0__.app.frame>frame,mainFrame);
    assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().renderer),'WebGL2');
    await screen('sample-room-entry');
    await page.evaluate(()=>window.__INHAGAME_P0__.commissionTrials.close());assert.equal((await state()).active,null);
    assert.deepEqual(smoke.problems,[]);result.status='PASS';await save();
  }catch(error){report.status='FAIL';result.status='FAIL';result.error=error.stack;await save();throw error;}
  finally{await smoke.close();}
}
report.status='PASS';await save();console.log(JSON.stringify(report,null,2));
