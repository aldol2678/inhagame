import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const output = process.env.INCOME_GAME_BROWSER_OUTPUT || 'test-results/income-game-entry-browser';
await mkdir(output, { recursive: true });
const sources = ['src/income/income-game-entry.mjs','src/income/convenience-employer.mjs','src/income/income-convenience-location.mjs',
  'src/income/income-scene-panel-adapter.mjs','src/context-action.js','npc-factory/dev-human-avatar.mjs','npc-factory/npc-dimensions.mjs',
  'src/main.js','npc-factory/dev-runtime.mjs','styles.css','tests/browser/income-game-entry-browser.html','tests/browser/income-game-entry-browser-fixture.mjs','tests/browser/income-game-entry-browser-away.html'];
const report = { kind: 'ACTUAL_MODULE_RENDER_HARNESS', fullMainBoot: false, productionPaymentEvidence: false,
  lifecycleEvidence: 'Synthetic persisted PageTransitionEvent checks are not a real back-forward cache navigation; a separate real away/back attempt reports observed eligibility',
  head: execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(), expectedHead: process.env.EXPECTED_INCOME_GAME_HEAD ?? null,
  hashes: Object.fromEntries(await Promise.all(sources.map(async p => [p, createHash('sha256').update(await readFile(new URL(`../../${p}`,import.meta.url))).digest('hex')]))),
  cases: [], result: 'running' };
let harness;
try {
  if (report.expectedHead) { assert.match(report.expectedHead,/^[0-9a-f]{40}$/); assert.equal(report.head,report.expectedHead);
    assert.equal(execFileSync('git',['status','--porcelain','--',...sources.map(p=>`apps/world/${p}`)],{encoding:'utf8'}).trim(),''); }
  const { startSmoke } = await import('./harness.mjs');
  for (const device of [{name:'desktop',viewport:{width:1280,height:800},mobile:false},{name:'touch',viewport:{width:390,height:844},mobile:true}]) {
    const item={device:device.name,result:'running',checks:[]}; report.cases.push(item);
    harness = await startSmoke({viewport:device.viewport,contextOptions:{isMobile:device.mobile,hasTouch:device.mobile}});
    const deniedApi = [];
    await harness.context.route('**/api/**', route => { deniedApi.push(route.request().url()); return route.abort('blockedbyclient'); });
    const page = await harness.context.newPage(), requests=[]; harness.watch(page); page.on('request',r=>requests.push({url:r.url(),method:r.method()}));
    const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(e.message));
    const press=async locator=>{if(device.mobile)await locator.tap();else{await locator.focus();await page.keyboard.press('Enter');}};
    const dialog=()=>page.getByRole('dialog'); const close=()=>dialog().getByRole('button',{name:'대화 마치기',exact:true});
    const stats=()=>page.evaluate(()=>window.__INCOME_GAME_QA__.stats());
    const openEmployer=async()=>{await page.locator('#interaction').focus();if(device.mobile)await page.locator('#interaction').tap();else await page.keyboard.press('f');await dialog().waitFor({state:'visible'});};
    try {
      await page.goto(`${harness.origin}/tests/browser/income-game-entry-browser.html`);
      await page.waitForFunction(()=>window.__INCOME_GAME_QA__?.ready || window.__INCOME_GAME_QA__?.error);
      assert.equal(await page.evaluate(()=>window.__INCOME_GAME_QA__.error ?? null),null);
      item.servedHashes=await page.evaluate(async sources=>Object.fromEntries(await Promise.all(sources.map(async p=>{
        const bytes=await(await fetch(`/${p}`)).arrayBuffer(),hash=await crypto.subtle.digest('SHA-256',bytes);
        return[p,[...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('')];}))),sources);
      assert.deepEqual(item.servedHashes,report.hashes);
      const avatar=await stats(); assert.equal(avatar.enabled,true);assert.ok(avatar.parts>15);assert.ok(avatar.hasHead&&avatar.hasTorso);
      item.initialPixels=await page.evaluate(()=>window.__INCOME_GAME_QA__.pixels()); assert.ok(item.initialPixels.foreground>300,'actual human mesh pixels present');
      assert.ok(item.initialPixels.drawCalls>0,'actual renderer submitted draw calls'); assert.equal(item.initialPixels.renderer,'webgl2');
      await page.screenshot({path:`${output}/${device.name}-human.png`});
      for(const mode of ['mounted','seated','blocked']){
        const value=await page.evaluate(mode=>window.__INCOME_GAME_QA__.mode({[mode]:true}),mode);
        assert.equal(value.enabled,true);assert.equal(value.action,null);assert.equal(await page.locator('#interaction').isVisible(),false);
        const pixels=await page.evaluate(()=>window.__INCOME_GAME_QA__.pixels());assert.equal(pixels.hash,item.initialPixels.hash,`${mode} must not erase/change NPC mesh`);
        await page.evaluate(mode=>window.__INCOME_GAME_QA__.mode({[mode]:false}),mode);
      } item.checks.push('actual procedural human remains rendered when mounted/seated/other UI blocks interaction');
      await openEmployer();assert.equal((await stats()).locks,1);assert.match(await dialog().innerText(),/급여 없는 연습 1\/3/);
      await press(dialog().getByRole('button',{name:'뒤에 숨기기',exact:true}));assert.match(await dialog().innerText(),/불이익은 없어요/);
      for(const label of ['앞쪽에 진열','품목과 수량 다시 확인','정리하고 마무리 확인'])await press(dialog().getByRole('button',{name:label,exact:true}));
      assert.match(await dialog().innerText(),/출근·정산·보상은 발생하지 않았어요/);
      assert.equal(await close().evaluate(el=>document.activeElement===el),true,'completion restores focus to visible close control');
      assert.equal(await dialog().getByRole('button',{includeHidden:false}).count(),1);
      await page.screenshot({path:`${output}/${device.name}-practice-complete.png`});await press(close());assert.equal((await stats()).locks,0);
      item.checks.push('trusted F/touch entry; recoverable wrong choice; unpaid practice completion and focus');
      await press(page.locator('#delivery'));assert.match(await dialog().innerText(),/수락·제출·지급하지 않아요/);
      assert.equal(await dialog().getByRole('button').count(),1);await press(close());item.checks.push('delivery remains CLOSED information only with no accept/submit controls');
      await openEmployer();await page.evaluate(()=>window.__INCOME_GAME_QA__.mode({accountId:'synthetic-account-b'}));assert.equal((await stats()).dialogOpen,false);assert.equal((await stats()).locks,0);
      item.checks.push('account switch closes dialogue and releases input');
      for(let i=0;i<2;i++){
        await openEmployer();await page.evaluate(()=>window.__INCOME_GAME_QA__.persistedHide());const hidden=await stats();assert.equal(hidden.enabled,false);assert.equal(hidden.dialogOpen,false);assert.equal(hidden.locks,0);
        assert.equal((await page.evaluate(()=>window.__INCOME_GAME_QA__.pixels())).foreground,0);
        await page.evaluate(()=>window.__INCOME_GAME_QA__.persistedShow());assert.equal((await stats()).enabled,true);assert.equal((await stats()).action,'income-convenience-employer');
        assert.equal((await page.evaluate(()=>window.__INCOME_GAME_QA__.pixels())).hash,item.initialPixels.hash);
      }item.checks.push('two synthetic persisted lifecycle cycles hide/resume the same actual avatar and restore F action');
      await page.screenshot({path:`${output}/${device.name}-resumed.png`});
      item.trustedEvents=await page.evaluate(()=>window.__INCOME_GAME_QA__.events.filter(e=>e.trusted));assert.ok(item.trustedEvents.some(e=>device.mobile?e.pointerType==='touch':e.code==='KeyF'));
      assert.equal(requests.filter(r=>r.method!=='GET'||r.url.includes('/api/world-income')).length,0,'no income API or mutating request');
      // Genuine navigation is observed separately; lack of BFCache eligibility is not a synthetic PASS.
      await page.goto(`${harness.origin}/tests/browser/income-game-entry-browser-away.html`);
      await page.goBack(); await page.waitForFunction(()=>window.__INCOME_GAME_QA__?.ready);
      const realEvents=await page.evaluate(()=>window.__INCOME_GAME_QA__.realLifecycle());
      const lastShow=realEvents.filter(e=>e.type==='pageshow').at(-1);
      item.realBFCache={attempted:true,restored:lastShow?.persisted===true,observed:realEvents,
        result:lastShow?.persisted===true?'RESTORED_AND_VERIFIED':'NOT_USED_BY_BROWSER'};
      if(item.realBFCache.restored){assert.equal((await stats()).enabled,true);assert.equal((await stats()).action,'income-convenience-employer');assert.ok((await page.evaluate(()=>window.__INCOME_GAME_QA__.pixels())).foreground>300);}
      assert.deepEqual(deniedApi,[]);assert.deepEqual(pageErrors,[]);assert.deepEqual(harness.problems,[]);item.result='pass';
    }catch(error){item.result='fail';item.error=error.stack;await page.screenshot({path:`${output}/${device.name}-failure.png`}).catch(()=>{});throw error;}
    finally{item.requests=requests;item.pageErrors=pageErrors;await harness.close();harness=null;}
  } report.result='pass'; console.log('PASS: actual income game-entry modules and procedural avatar WebGL2 evidence; not full main boot');
}catch(error){report.result=report.cases.some(c=>c.result==='fail')?'fail':'blocked';report.error=error.stack;throw error;}
finally{await harness?.close();await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n');}
