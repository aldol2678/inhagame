// Offline Campus smoke for the 37165 information stop: shared PC/mobile action and focus ownership.
import assert from 'node:assert/strict';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
const touch = process.env.TRANSIT_SMOKE_TOUCH === '1';
const smoke = await startSmoke(touch ? {viewport:{width:390,height:844},contextOptions:{isMobile:true,hasTouch:true}} : {});
try {
  const page = await smoke.context.newPage();
  const fatal = smoke.watch(page);
  await page.goto(`${smoke.origin}/campus/?spawn=back-gate`, {waitUntil:'domcontentloaded'});
  await Promise.race([page.waitForFunction(() => {
    const s=window.__INHAGAME_P0__?.getStatus?.();
    return s?.loading?.finished || s?.renderer==='UNAVAILABLE';
  },null,{timeout:TIMEOUT_MS}),fatal]);
  let status = await page.evaluate(()=>window.__INHAGAME_P0__.getStatus());
  assert.notEqual(status.renderer,'UNAVAILABLE',status.error);
  console.log(`Campus boot: ${status.renderer} / ${status.loading.phase}`);
  assert.equal(await page.evaluate(()=>!!window.__INHAGAME_P0__.app.root.findByName('backgate_transit_signs')?.render?.meshInstances?.length),true,'resident stop sign rendered');
  const place = async (point='wait',height=1.15) => page.evaluate(async ({point,height})=>{
    const {BACKGATE_TRANSIT}=await import('/src/transit/backgate-transit-layout.js');
    const d=window.__INHAGAME_P0__,p=BACKGATE_TRANSIT[point];
    d.player.setLocalPosition(p.x,height,p.z);d.controller.grounded=height===1.15;d.controller.velocityY=0;
    d.app.fire('update',0);
    return {context:d.getStatus().contextAction,transit:d.getStatus().backgateTransit};
  },{point,height});
  const close=page.locator('#backgate-transit-panel .profile-close');
  const panel=page.locator('#backgate-transit-panel');
  if(touch)assert.equal(await page.evaluate(()=>matchMedia('(pointer: coarse)').matches),true);
  assert.equal((await place()).context,'backgate-transit');
  await page.locator('#application').focus();
  await page.keyboard.press('f');
  await panel.waitFor({state:'visible'});
  assert.equal(await panel.locator('button:disabled').innerText(),'준비중');
  assert.match(await panel.innerText(),/511 · 주안역 방면/);
  assert.match(await panel.innerText(),/INHA WORLD 전용/);
  status=await page.evaluate(()=>window.__INHAGAME_P0__.getStatus());
  assert.equal(status.inputFocus.owners.backgateTransit,true);
  assert.equal(status.inputFocus.focusClass,'BLOCKING_UI');
  assert.equal(status.backgateTransit.boardingEnabled,false);
  assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.controller.inputEnabled),false);
  await page.keyboard.press('Tab');
  assert.equal(await close.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Escape');
  await panel.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.controller.inputEnabled),true);
  // Road-side or airborne attempts do not publish a stop candidate.
  assert.notEqual((await place('busCenter')).context,'backgate-transit');
  assert.notEqual((await place('wait',3)).context,'backgate-transit');
  await page.setViewportSize({width:390,height:844});
  assert.equal((await place()).context,'backgate-transit');
  if(touch)await page.locator('#context-action').tap();
  else await page.locator('#context-action').click();
  await panel.waitFor({state:'visible'});
  const bounds=await panel.boundingBox();
  assert.ok(bounds.x>=0 && bounds.x+bounds.width<=391);
  assert.ok(bounds.y>=0 && bounds.y+bounds.height<=845);
  await page.screenshot({path:process.env.TRANSIT_SCREENSHOT || '/tmp/backgate-transit-mobile.png'});
  await close.click();
  await panel.waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.__INHAGAME_P0__.getStatus().inputFocus.owners.backgateTransit),false);
  // Modal handoff closes this panel and keeps the new owner's lock.
  await place();
  if(touch)await page.locator('#context-action').tap();
  else await page.locator('#context-action').click();
  const handoff=await page.evaluate(()=>{
    const d=window.__INHAGAME_P0__;
    d.keyboardHelp.setOpen(true);
    const result={open:d.backgateTransitPanel.open,focus:d.getStatus().inputFocus.focusClass,enabled:d.controller.inputEnabled};
    d.keyboardHelp.setOpen(false);return result;
  });
  assert.deepEqual(handoff,{open:false,focus:'BLOCKING_UI',enabled:false});
  assert.deepEqual(smoke.problems,[]);
  console.log('Back-gate transit PC F / mobile click / disabled F1 / input handoff PASS');
} finally {await smoke.close();}
