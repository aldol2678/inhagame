// Real browser + production interaction/router/panel; synthetic RPC/account data only.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {startSmoke} from './harness.mjs';
const output=process.env.NPC_SHOP_OUTPUT||'test-results/npc-shop-routing';
await mkdir(output,{recursive:true});
const paths=['src/shop/shop-router.js','src/shop/shop-capabilities.js','src/shop/shop-client.js','src/shop/shop-panel.js','src/shop/student-center-vendors.js','src/shop/dorm-shop-interaction.js','src/shop/dorm-shop-dialogue.js','src/shop/dorm-shop-vendor.js'];
const hashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../'+p,import.meta.url))).digest('hex')])));
const report={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'Production modules in Chromium; synthetic RPC and accounts. Compatibility cases exercise router/panel through fixture provider controls, not main-world entry/access gates; no backend transactions or gameplay walking claim',hashes,checks:[],result:'running'};
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
  const writes=()=>evalQA(()=>window.__NPC_SHOPS__.calls.filter(c=>['purchase_world_shop_listing_v1','purchase_world_shop_listing_v2'].includes(c.name)));
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
   await page.locator('#dorm').click();await page.locator('#dorm-shop-dialogue [data-action="browse"]').click();await page.waitForFunction(()=>window.__NPC_SHOPS__.shop.snapshot?.shopId==='shop.dorm_furniture');assert.match(await page.locator('#shop').textContent(),/생활관 가구점/);
   assert.equal(await evalQA(()=>{const q=window.__NPC_SHOPS__;q.setDorm({position:{x:0,z:1.8}});return q.dorm.contextAction();}),null);await page.screenshot({path:`${output}/dorm-${viewport.width}.png`});
  });
  const capability = {
   missing: {data:null,error:{code:'PGRST202',message:'Could not find the function public.get_world_shop_capabilities_v1 without parameters in the schema cache'}},
   prepared: {data:{version:1,purchaseRpc:'purchase_world_shop_listing_v2',catalogLayout:'legacy'},error:null},
   split: {data:{version:1,purchaseRpc:'purchase_world_shop_listing_v2',catalogLayout:'split'},error:null},
   mixed: {data:{version:1,purchaseRpc:'purchase_world_shop_listing_v1',catalogLayout:'split'},error:null},
   network: {data:null,error:{code:'FETCH_ERROR',message:'synthetic network loss'}}
  };
  const negotiate=async response=>{
   await evalQA(async response=>{const q=window.__NPC_SHOPS__;q.setCapability(response);await q.shop.refresh('fixture-capability');},response);
   await page.waitForFunction(()=>!window.__NPC_SHOPS__.shop.capabilityChecking);
  };
  await fresh();
  await run('exact missing capability retains student v1 and rejects the separate fashion route',async()=>{
   await negotiate(capability.missing);await open(0);
   assert.equal(await evalQA(()=>window.__NPC_SHOPS__.shop.mode),'legacy');
   assert.equal(await evalQA(()=>{const q=window.__NPC_SHOPS__;return q.panel.openShop(q.ids[1]);}),false);
   assert.equal(await evalQA(()=>window.__NPC_SHOPS__.shop.shopId),'shop.student_center');
   await page.locator('.shop-offer-buy').click();await page.locator('.shop-offer-buy').evaluate(button=>{button.click();button.click();});
   assert.equal((await writes()).length,1);await finish();await page.waitForFunction(()=>window.__NPC_SHOPS__.counts().readbacks===1);
   const [call]=await writes();assert.equal(call.name,'purchase_world_shop_listing_v1');assert.equal('p_shop_id' in call.args,false);
   await page.screenshot({path:`${output}/legacy-${viewport.width}.png`});
  });
  await fresh();
  await run('legacy dorm greeting reaches the preexisting shop and buys once through original v1',async()=>{
   await negotiate(capability.missing);await page.locator('#dorm').click();
   await page.locator('#dorm-shop-dialogue [data-action="browse"]').click();
   await page.waitForFunction(()=>window.__NPC_SHOPS__.shop.snapshot?.shopId==='shop.dorm_furniture');
   assert.match(await page.locator('#shop').textContent(),/생활관 가구점/);
   await page.locator('.shop-offer-buy').click();await finish();
   await page.waitForFunction(()=>window.__NPC_SHOPS__.counts().readbacks===1);
   const [call]=await writes();assert.equal(call.name,'purchase_world_shop_listing_v1');
   assert.equal(call.args.p_listing_id,'shop.dorm_furniture.listing');assert.equal('p_shop_id' in call.args,false);
   assert.equal(await evalQA(()=>window.__NPC_SHOPS__.shop.select('shop.student_center_fashion')),false);
   await page.screenshot({path:`${output}/legacy-dorm-${viewport.width}.png`});
  });
  await fresh();
  await run('API-prepared legacy catalog uses scoped v2 without enabling new routes',async()=>{
   await negotiate(capability.prepared);await open(0);assert.equal(await evalQA(()=>window.__NPC_SHOPS__.shop.mode),'legacy');
   assert.equal(await evalQA(()=>window.__NPC_SHOPS__.shop.select('shop.student_center_fashion')),false);
   await page.locator('.shop-offer-buy').click();await finish();await page.waitForFunction(()=>window.__NPC_SHOPS__.counts().readbacks===1);
   const calls=await writes();assert.equal(calls.length,1);assert.equal(calls[0].name,'purchase_world_shop_listing_v2');assert.equal(calls[0].args.p_shop_id,'shop.student_center');
  });
  for(const kind of ['mixed','network']){
   await fresh();await run(`${kind} capability fails closed with zero purchase RPCs`,async()=>{
    await negotiate(capability[kind]);await open(0);assert.equal(await evalQA(()=>window.__NPC_SHOPS__.shop.mode),'unavailable');
    assert.equal(await page.locator('.shop-offer-buy').isDisabled(),true);
    await page.locator('.shop-offer-buy').evaluate(button=>button.click());
    const refused=await evalQA(()=>{const q=window.__NPC_SHOPS__;return q.shop.purchase(q.ids[0]+'.listing');});assert.equal(refused.outcome,'REFUSED');
    assert.equal((await writes()).length,0);assert.equal(await evalQA(()=>window.__NPC_SHOPS__.shop.select('shop.dorm_furniture')),false);
    await page.screenshot({path:`${output}/${kind}-${viewport.width}.png`});
   });
  }
  for(const [from,to] of [['missing','split'],['split','missing']]){
   await fresh();await run(`${from} to ${to} unknown receipt retains original RPC and key`,async()=>{
    await negotiate(capability[from]);await open(0);await page.locator('.shop-offer-buy').click();await finish(true);
    await page.waitForFunction(()=>window.__NPC_SHOPS__.panel.status().hint.length>0);
    const original=(await writes())[0];await page.keyboard.press('Escape');await negotiate(capability[to]);await open(0);
    assert.equal(await evalQA(()=>window.__NPC_SHOPS__.shop.mode),to==='split'?'split':'legacy');
    assert.equal((await writes()).length,1,'Capability transition must not submit a purchase');
    await page.locator('.shop-offer-buy').click();await finish();await page.waitForFunction(()=>window.__NPC_SHOPS__.counts().readbacks===1);
    const calls=await writes();assert.equal(calls.length,2);assert.deepEqual(calls[1],original,'Receipt recovery retains exact original RPC and arguments');
   });
  }
  assert.deepEqual(errors,[]);assert.deepEqual(smoke.problems,[]);await smoke.close();smoke=null;
 }
 report.result='pass';console.log(`PASS: ${report.checks.length} NPC shop routing browser checks`);
}catch(error){report.result='fail';report.error=error.stack;await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error;}
finally{await smoke?.close();await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n');}
