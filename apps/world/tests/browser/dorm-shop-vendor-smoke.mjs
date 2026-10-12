// Production modules + real WebGL2 lobby. Synthetic accounts/read RPCs; no purchases or network authority.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { startSmoke } from './harness.mjs';
const output=process.env.DORM_VENDOR_OUTPUT||'test-results/dorm-shop-vendor';await mkdir(output,{recursive:true});
const report={scope:'Offline production lobby/actor/dialogue/router/panel with synthetic account and read RPC fixtures; no purchase, backend write or full-world walking claim',result:'running',checks:[]};
let smoke,page;
try {
 for(const [name,width,height,touch] of [['desktop',1280,800,false],['portrait',390,844,true],['landscape',844,390,true]]) {
  smoke=await startSmoke({viewport:{width,height},contextOptions:{hasTouch:touch,isMobile:touch}});page=await smoke.context.newPage();smoke.watch(page);
  const open=async()=>{if(touch)await page.locator('#opener').tap();else {await page.locator('#opener').focus();await page.keyboard.press('f')}await page.locator('#dorm-shop-dialogue').waitFor()};
  const fresh=async()=>{await page.goto(`${smoke.origin}/tests/browser/dorm-shop-vendor-harness.html`);await page.waitForFunction(()=>!!window.__DORM_VENDOR__);await page.waitForTimeout(100)};
  await fresh();
  const visual=await page.evaluate(()=>{const q=window.__DORM_VENDOR__,v=q.scene.shopVendor.visual;return{npc:v.actor?.id??q.scene.root.findByName('NPC_TEST_HUMAN_DORM-SHOP-NPC-001')?.name,meshes:v.avatar.findComponents('render').length,pos:['x','y','z'].map(axis=>v.avatar.getLocalPosition()[axis]),enabled:v.avatar.enabled,label:document.querySelector('.dorm-shop-vendor-nameplate').hidden}});
  assert.ok(visual.meshes>20);assert.equal(visual.enabled,true);assert.equal(visual.label,false);
  await page.screenshot({path:`${output}/${name}-vendor.png`});
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
  for(const patch of [{position:{x:0,z:2.7}},{position:{x:0,z:.85},invalid:true},{invalid:false,grounded:false},{grounded:true,available:false,accountId:null}]) {
   await page.evaluate(p=>window.__DORM_VENDOR__.set(p),patch);await page.waitForTimeout(50);assert.equal(await page.locator('#opener').isDisabled(),true);
  }
  await page.evaluate(async()=>{const q=window.__DORM_VENDOR__;q.set({grounded:true,invalid:false,position:{x:0,z:.85}});await q.account('fixture-a')});
  await open();await page.evaluate(()=>window.__DORM_VENDOR__.leave());assert.equal(await page.locator('#dorm-shop-dialogue').isVisible(),false);
  await page.waitForTimeout(50);assert.equal(await page.locator('.dorm-shop-vendor-nameplate').isVisible(),false);
  await page.evaluate(()=>window.__DORM_VENDOR__.dispose());assert.equal(await page.locator('.dorm-shop-vendor-nameplate').count(),0);assert.equal(await page.locator('#dorm-shop-dialogue').count(),0);
  assert.deepEqual(await page.evaluate(()=>window.__DORM_VENDOR__.calls.filter(c=>c.name.startsWith('purchase_'))),[]);
  assert.deepEqual(smoke.problems,[]);report.checks.push({name,visual,result:'pass',flows:['F/touch greeting','44px targets','Tab/Escape','shop handoff and focus return','account ABA','rear/seat/air/guest gates','room exit','dispose','zero purchases']});
  await smoke.close();smoke=null;
 }
 report.result='pass';console.log('PASS: dorm vendor desktop/portrait/landscape rendering, greeting and lifecycle gates');
} catch(error) {report.result='fail';report.error=error.stack;await page?.screenshot({path:`${output}/failure.png`}).catch(()=>{});throw error}
finally {await smoke?.close();await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n')}
