// Real browser + production interaction/router/panel; synthetic RPC/account data only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {startSmoke} from './harness.mjs';
const output=process.env.NPC_SHOP_OUTPUT||'test-results/npc-shop-routing';
await mkdir(output,{recursive:true});
const paths=['src/shop/shop-router.js','src/shop/shop-client.js','src/shop/shop-panel.js','src/shop/student-center-vendors.js','src/shop/dorm-shop-interaction.js'];
const hashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../'+p,import.meta.url))).digest('hex')])));
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'Production modules in Chromium; synthetic RPC and accounts, no backend transactions or gameplay walking claim',hashes,checks:[],result:'running'};
let smoke,page;
try{
 if(process.env.NPC_SHOP_HEAD_SHA)assert.equal(report.head,process.env.NPC_SHOP_HEAD_SHA);
 for(const viewport of [{width:1280,height:720},{width:390,height:844}]){
  smoke=await startSmoke({viewport,contextOptions:{hasTouch:viewport.width<500}});page=await smoke.context.newPage();const errors=[];smoke.watch(page);page.on('pageerror',e=>errors.push(e.message));
  const run=async(name,fn)=>{await fn();report.checks.push(`${viewport.width}px: ${name}`);};
  const evalQA=(fn,arg)=>page.evaluate(fn,arg);
  const fresh=async()=>{await page.goto(`${smoke.origin}/tests/browser/npc-shop-routing-harness.html`);await page.waitForFunction(()=>!!window.__NPC_SHOPS__);};
  const open=async i=>{await page.locator(`#vendor-${i}`).click();await page.locator('.shop-offer-buy').waitFor();};
  const finish=async(lost=false)=>{await evalQA(lost=>window.__NPC_SHOPS__.finish('purchase',lost),lost);await page.waitForFunction(()=>!window.__NPC_SHOPS__.shop.isPending(window.__NPC_SHOPS__.shop.shopId+'.listing'));};
  const writes=()=>evalQA(()=>window.__NPC_SHOPS__.calls.filter(c=>c.name==='purchase_world_shop_listing_v2'));
  await fresh();
  await run('served exact source hashes',async()=>{assert.deepEqual(await evalQA(async paths=>Object.fromEntries(await Promise.all(paths.map(async p=>[p,[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await fetch('/'+p)).arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('')]))),paths),hashes);});
  await run('per-identity proximity, height, readiness and account gates',async()=>{
   const result=await evalQA(()=>{const q=window.__NPC_SHOPS__,a=q.place(0),label=a.label;q.place(1);const stale=a.trigger();q.setGate({available:false});const locked=q.interaction.observe();q.setGate({available:true,ready:false});const missing=q.interaction.observe();q.setGate({ready:true});const v=q.vendors[1];q.setPosition({...v.position,y:v.position.y+10});return{label,stale,locked:locked.disabled,missing,above:q.interaction.observe(),ids:q.ids};});
   assert.match(result.label,/나수현/);assert.equal(result.stale,false);assert.equal(result.locked,true);assert.equal(result.missing,null);assert.equal(result.above,null);assert.equal(new Set(result.ids).size,3);
  });
  await run('rapid vendor switching isolates late read and displayed title',async()=>{
   await evalQA(()=>window.__NPC_SHOPS__.holdRead(window.__NPC_SHOPS__.ids[0]));await page.locator('#vendor-0').click();await open(1);
   await evalQA(()=>window.__NPC_SHOPS__.finish('read'));await page.waitForFunction(()=>window.__NPC_SHOPS__.shop.state==='READY');
   assert.match(await page.locator('#shop').textContent(),/학생회관 패션점/);assert.equal(await evalQA(()=>window.__NPC_SHOPS__.shop.snapshot.shopId),'shop.student_center_fashion');
  });
  await fresh();await open(0);
  await run('late purchase reads authorities without leaking receipt to new vendor',async()=>{
   await page.locator('.shop-offer-buy').click();await open(1);await finish();await page.waitForFunction(()=>window.__NPC_SHOPS__.counts().readbacks===1);
   assert.match(await page.locator('#shop').textContent(),/학생회관 패션점/);assert.doesNotMatch(await page.locator('#shop').textContent(),/구매 완료/);assert.deepEqual(await evalQA(()=>window.__NPC_SHOPS__.counts()),{readbacks:1,walletReads:1});assert.equal((await writes()).length,1);
  });
  await fresh();await open(0);
  await run('lost response, close/reopen and cross-vendor retry retain original key',async()=>{
   await page.locator('.shop-offer-buy').click();await finish(true);await page.waitForFunction(()=>window.__NPC_SHOPS__.panel.status().hint.length>0);await page.keyboard.press('Escape');assert.equal(await page.locator('#shop').isVisible(),false);
   await open(1);await page.keyboard.press('Escape');await open(0);await page.locator('.shop-offer-buy').click();await finish();await page.waitForFunction(()=>window.__NPC_SHOPS__.counts().readbacks===1);
   const purchases=await writes();assert.equal(purchases.length,2);assert.deepEqual(purchases[0].args,purchases[1].args);assert.ok((await evalQA(()=>window.__NPC_SHOPS__.calls.filter(c=>c.name==='get_world_shop_v1'))).length>=4);
  });
  await fresh();await open(0);
  await run('closed panel stays closed when purchase completes',async()=>{
   await page.locator('.shop-offer-buy').click();await page.keyboard.press('Escape');await finish();await page.waitForFunction(()=>window.__NPC_SHOPS__.counts().readbacks===1);assert.equal(await page.locator('#shop').isVisible(),false);await open(0);assert.doesNotMatch(await page.locator('#shop').textContent(),/구매 완료/);
  });
  await fresh();await open(0);
  await run('account change invalidates hidden pending result and prior keys',async()=>{
   await page.locator('.shop-offer-buy').click();await open(1);await evalQA(()=>window.__NPC_SHOPS__.account('fixture-account-b'));await finish();await open(0);assert.deepEqual(await evalQA(()=>window.__NPC_SHOPS__.counts()),{readbacks:0,walletReads:0});await page.locator('.shop-offer-buy').click();await finish();await page.waitForFunction(()=>window.__NPC_SHOPS__.counts().readbacks===1);const p=await writes();assert.notEqual(p[0].args.p_idempotency_key,p[1].args.p_idempotency_key);
  });
  await run('dorm reception exact route and rear-of-counter exclusion',async()=>{
   await page.locator('#dorm').click();await page.waitForFunction(()=>window.__NPC_SHOPS__.shop.snapshot?.shopId==='shop.dorm_furniture');assert.match(await page.locator('#shop').textContent(),/생활관 가구점/);
   assert.equal(await evalQA(()=>{const q=window.__NPC_SHOPS__;q.setDorm({position:{x:0,z:1.8}});return q.dorm.contextAction();}),null);await page.screenshot({path:`${output}/dorm-${viewport.width}.png`});
  });
  assert.deepEqual(errors,[]);assert.deepEqual(smoke.problems,[]);await smoke.close();smoke=null;
 }
 report.result='pass';console.log(`PASS: ${report.checks.length} NPC shop routing browser checks`);
}catch(error){report.result='fail';report.error=error.stack;await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{await smoke?.close();await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n');}
