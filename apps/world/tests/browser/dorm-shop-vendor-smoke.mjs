// Production modules + real WebGL2 lobby. Synthetic accounts/read RPCs; no purchases or network authority.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const output=process.env.DORM_VENDOR_OUTPUT||'test-results/dorm-shop-vendor';await mkdir(output,{recursive:true});
const report={scope:'Offline production lobby/actor/dialogue/router/panel with synthetic account and read RPC fixtures; no purchase, backend write or full-world walking claim',result:'running',checks:[]};
let smoke,page,stage='starting';
try {
 for(const [name,width,height,touch] of [['desktop',1280,800,false],['portrait',390,844,true],['landscape',844,390,true]]) {
  smoke=await startSmoke({viewport:{width,height},contextOptions:{hasTouch:touch,isMobile:touch}});page=await smoke.context.newPage();smoke.watch(page);
  const open=async()=>{if(touch)await page.locator('#opener').tap();else {await page.locator('#opener').focus();await page.keyboard.press('f')}await page.locator('#dorm-shop-dialogue').waitFor()};
  const fresh=async()=>{await page.goto(`${smoke.origin}/tests/browser/dorm-shop-vendor-harness.html`);await page.waitForFunction(()=>window.__DORM_VENDOR__?.snapshot().frames>=2,null,{timeout:TIMEOUT_MS})};
  const snapshot=()=>page.evaluate(()=>window.__DORM_VENDOR__.snapshot());
  await fresh();
  const visual=await page.evaluate(()=>{const q=window.__DORM_VENDOR__,v=q.scene.shopVendor.visual;return{npc:v.actor?.id??q.scene.root.findByName('NPC_TEST_HUMAN_DORM-SHOP-NPC-001')?.name,meshes:v.avatar.findComponents('render').length,pos:['x','y','z'].map(axis=>v.avatar.getLocalPosition()[axis]),enabled:v.avatar.enabled,label:document.querySelector('.dorm-shop-vendor-nameplate').hidden}});
  assert.ok(visual.meshes>20);assert.equal(visual.enabled,true);assert.equal(visual.label,false);
  const face=(await snapshot()).face;
  assert.equal(face.available,true);assert.ok(face.facingCamera>.15);
  assert.equal(face.unobscured,true,`${name}: the actual eyes/mouth must not be behind the monitor: ${JSON.stringify(face)}`);
  assert.ok(face.samples.every(sample=>sample.dom==='scene'),`${name}: UI must not cover the vendor face`);
  await page.screenshot({path:`${output}/${name}-vendor.png`});
  await writeFile(`${output}/${name}-vendor.json`,JSON.stringify(await snapshot(),null,2));
  await open();assert.equal(await page.evaluate(()=>window.__DORM_VENDOR__.opened),0);
  assert.match(await page.locator('#dorm-shop-dialogue').textContent(),/윤가온/);
  const bounds=await page.locator('#dorm-shop-dialogue').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=width+1&&bounds.y>=0);
  for(const selector of ['browse','close']){const b=await page.locator(`[data-action=${selector}]`).boundingBox();assert.ok(b.height>=44)}
  await page.screenshot({path:`${output}/${name}-greeting.png`});
  await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.dataset.action),'close');
  await page.keyboard.press('Escape');assert.equal(await page.locator('#dorm-shop-dialogue').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.__DORM_VENDOR__.focus.size),0);
  await open();await page.locator('[data-action=browse]').click();await page.waitForFunction(()=>window.__DORM_VENDOR__.shop.snapshot?.shopId==='shop.dorm_furniture');
  assert.equal(await page.locator('#shop').isVisible(),true);assert.equal(await page.locator('#dorm-shop-dialogue').isVisible(),false);
  await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>window.__DORM_VENDOR__.focus.size),0);
  assert.equal(await page.evaluate(()=>document.activeElement.id),'opener');
  await open();await page.evaluate(async()=>{const q=window.__DORM_VENDOR__;window.oldButton=document.querySelector('[data-action=browse]');await q.account('fixture-b');await q.account('fixture-a');window.oldButton.click()});
  assert.equal(await page.locator('#dorm-shop-dialogue').isVisible(),false);assert.equal(await page.locator('#shop').isVisible(),false);
  for(const [gate,patch] of [['rear',{position:{x:0,z:2.7}}],['invalid',{position:{x:0,z:.85},invalid:true}],['airborne',{invalid:false,grounded:false}],['guest',{grounded:true,available:false,accountId:null}],['blocked',{available:true,accountId:'fixture-a',blocked:true}]]) {
   stage=`${name}: ${gate} gate`;const before=await snapshot();
   const revision=await page.evaluate(p=>window.__DORM_VENDOR__.set(p),patch);
   // Wait for the real app update that applied this input, not an arbitrary 50ms GPU assumption.
   await page.waitForFunction(expected=>window.__DORM_VENDOR__.snapshot().appliedRevision>=expected,revision,{timeout:TIMEOUT_MS});
   const after=await snapshot();report.checks.push({name,gate,before,after});
   assert.equal(after.openerDisabled,true,`${stage}: ${JSON.stringify(after)}`);
   const opened=after.opened;await page.keyboard.press('f');
   assert.equal((await snapshot()).dialogueOpen,false);assert.equal((await snapshot()).opened,opened);
  }
  await page.evaluate(async()=>{const q=window.__DORM_VENDOR__;q.set({grounded:true,invalid:false,blocked:false,position:{x:0,z:.85}});await q.account('fixture-a')});
  await page.waitForFunction(()=>!window.__DORM_VENDOR__.snapshot().openerDisabled,null,{timeout:TIMEOUT_MS});
  await open();await page.evaluate(()=>window.__DORM_VENDOR__.leave());assert.equal(await page.locator('#dorm-shop-dialogue').isVisible(),false);
  await page.locator('.dorm-shop-vendor-nameplate').waitFor({state:'hidden'});
  await page.evaluate(()=>window.__DORM_VENDOR__.dispose());assert.equal(await page.locator('.dorm-shop-vendor-nameplate').count(),0);assert.equal(await page.locator('#dorm-shop-dialogue').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.__DORM_VENDOR__.calls.filter(c=>c.name.startsWith('purchase_'))),[]);
  assert.deepEqual(smoke.problems,[]);report.checks.push({name,visual,result:'pass',flows:['F/touch greeting','44px targets','Tab/Escape','shop handoff and focus return','account ABA','rear/seat/air/guest gates','room exit','dispose','zero purchases']});
  await smoke.close();smoke=null;
 }
 report.result='pass';console.log('PASS: dorm vendor desktop/portrait/landscape rendering, greeting and lifecycle gates');
} catch(error) {report.result='fail';report.error=error.stack;report.stage=stage;report.failureState=await page?.evaluate(()=>window.__DORM_VENDOR__?.snapshot()).catch(()=>null);await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error}
finally {await smoke?.close();await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n')}
