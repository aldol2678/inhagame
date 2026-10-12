// Run through scripts/starter-furniture-browser-local.mjs against the disposable CI stack.
// No production endpoints, external auth, simulated balances, inventory grants, or layout saves.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSmoke, TIMEOUT_MS } from './harness.mjs';
import { canonicalFurniture } from '../../src/rooms/furniture-layout.js';
import { createStarterFurnitureBrowserDatabase } from '../../../../supabase/tests/support/starter-furniture-browser-db.mjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const privateMode=process.env.STARTER_FURNITURE_PRIVATE_GEOMETRY_ONLY==='1';
const output = path.resolve(process.env.STARTER_FURNITURE_OUTPUT || (privateMode?'test-results/starter-furniture/private-metadata':'test-results/starter-furniture'));
if(privateMode)assert.equal(path.basename(output),'private-metadata','Private metadata must stay in its isolated JSON-only artifact directory');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const modelBytes=await readFile(path.join(repo,'apps/world/assets/induck-v3.glb'));
const modelHash=sha(modelBytes),jsonLength=modelBytes.readUInt32LE(12);
const modelJson=JSON.parse(modelBytes.subarray(20,20+jsonLength).toString('utf8').trim());
const privateSha='8aede8fd595dd84fda5460e375a18df49f6a91ba813ab7a952f75e768e8964eb';
if(privateMode){
  assert.equal(process.env.STARTER_FURNITURE_PRIVATE_SHA,privateSha,'Explicit exact approved private asset identity required');
  assert.equal(modelHash,privateSha,'Private geometry mode requires the approved original bytes');
}else{
  assert.equal(modelHash,'5057f3299a9d7e902b1370d203fa93e8279a2ff27a8bc2bdf68f09fe312c58f2','Public images must use the known independent QA substitute');
  assert.equal(modelJson.asset.generator,'INHAGAME independent QA cuboids v1');
  assert.ok(modelJson.nodes.some(node=>node.name==='Public_QA_Avatar'));
}
const characterEvidence={mode:privateMode?'private-metadata':'public-proxy',sha256:modelHash,
  label:privateMode?'Actual Induck geometry only':'Public_QA_Avatar independent substitute',
  realCharacterPixels:'UNKNOWN',screenshotsAllowed:!privateMode};
const items = ['furniture.study_books_set', 'furniture.dorm_single_sofa'];
const listings = items.map(id => `offer.dorm_furniture.${id.split('.')[1]}`);
const views = [{ label: 'desktop', width: 1280, height: 800, mobile: false },
  { label: 'portrait', width: 390, height: 844, mobile: true },
  { label: 'landscape', width: 844, height: 390, mobile: true }];
await mkdir(output, { recursive: true });
async function sourceFiles(dir) {
  const entries = await readdir(path.join(repo,dir), { withFileTypes:true });
  const rows = await Promise.all(entries.sort((a,b)=>a.name.localeCompare(b.name)).map(async entry => {
    const relative = `${dir}/${entry.name}`;
    return entry.isDirectory() ? sourceFiles(relative) : [{ path:relative, sha256:sha(await readFile(path.join(repo,relative))) }];
  }));
  return rows.flat();
}
const sources = [...await sourceFiles('apps/world/src'), ...await sourceFiles('apps/world/npc-factory')];
for (const file of ['apps/world/styles.css', 'apps/world/assets/induck-v3.glb', 'apps/world/assets/annyongi-flight-v1.glb', 'apps/world/tests/browser/starter-furniture-harness.html',
  'apps/world/tests/browser/starter-furniture-fixture.mjs', 'apps/world/tests/browser/starter-furniture-smoke.mjs',
  'apps/world/tests/browser/starter-furniture-visual-probe.mjs',
  'supabase/tests/support/starter-furniture-browser-db.mjs']) sources.push({path:file,sha256:sha(await readFile(path.join(repo,file)))});
const commit = execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
if (process.env.STARTER_FURNITURE_HEAD_SHA) assert.equal(commit,process.env.STARTER_FURNITURE_HEAD_SHA,'CI must test the requested exact head');
const provenance = { commit, expectedCommit:process.env.STARTER_FURNITURE_HEAD_SHA ?? null,
  worktree:execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim(),
  sourceHash:sha(JSON.stringify(sources)), files:sources };
await writeFile(path.join(output,'source-manifest.json'),JSON.stringify(provenance,null,2));
const report = { result:'running', commit, sourceHash:provenance.sourceHash,
  scope:'Production UI, renderers, Character/SeatController and disposable PostgREST/SQL; character visual identity is explicitly scoped below',characterEvidence,
  exclusions:['Production database/deployment','Private room Realtime presence/channel','Actual Induck rendered pixels: UNKNOWN'],
  evidence:[], checks:[], db:[], transportControls:[] };
let activePage, smoke, db, releasePurchase;
function check(name, details = {}) { report.checks.push({name,...details}); }
function economicState(value) { return { balance:value.balance, items:value.items, purchases:value.purchases, debits:value.debits, grants:value.grants }; }
function stableScene(value) {
  return { space:value.space, accountId:value.accountId, seated:value.seated, seat:value.seat, position:value.position,
    objects:value.furniture.objects, revision:value.furniture.revision, wallet:value.wallet, inventory:value.inventory,
    dialogueOpen:value.dialogueOpen, shopOpen:value.shopOpen, editorOpen:value.editorOpen };
}
function assertEconomic(value, count, balance) {
  assert.equal(value.balance,balance,'SQL wallet balance');
  assert.equal(value.purchases.length,count,'exact committed receipt count');
  assert.equal(value.debits.length,count,'exact PURCHASE ledger count');
  assert.equal(value.grants,count,'exact item grant count');
  assert.equal(value.items.length,count,'exact inventory row count');
  for (const purchase of value.purchases) {
    assert.equal(purchase.shop_id,'shop.dorm_furniture');
    assert.equal(purchase.price,purchase.item_id===items[0]?120:480);
    assert.equal(purchase.quantity,1);
    const debit = value.debits.find(row=>row.transaction_id===purchase.wallet_transaction_id);
    assert.ok(debit,'receipt references its actual debit');
    assert.equal(debit.amount,-purchase.price); assert.equal(debit.balance_after,purchase.balance_after);
    assert.equal(value.items.find(row=>row.itemId===purchase.item_id)?.quantity,1);
  }
}
async function capture(page, name, { subject = null } = {}) {
  await page.waitForFunction(() => window.__STARTER_FURNITURE__.snapshot().frames > 5);
  await page.evaluate(()=>window.__STARTER_FURNITURE__.waitForRenderedFrame());
  const before = await page.evaluate(() => window.__STARTER_FURNITURE__.snapshot());
  if (subject) {
    const target = before[subject], viewport = page.viewportSize();
    assert.equal(target.exists,true,`${name}: actual rendered ${subject} is enabled`);
    assert.ok(target.meshCount>0,`${name}: actual ${subject} mesh required`);
    assert.equal(target.bounds.inFront,true,`${name}: ${subject} is in front of camera`);
    assert.ok(target.bounds.left>=0 && target.bounds.right<=viewport.width,`${name}: ${subject} horizontal framing`);
    assert.ok(target.bounds.top>=0 && target.bounds.bottom<=viewport.height,`${name}: ${subject} vertical framing`);
    assert.ok(target.bounds.right-target.bounds.left>=20 && target.bounds.bottom-target.bounds.top>=20,`${name}: subject cannot be a tiny background prop`);
    assert.equal(before.editorOpen,false); assert.equal(before.shopOpen,false);
    assert.equal(before.dialogueOpen,false);
    const center = {x:(target.bounds.left+target.bounds.right)/2,y:(target.bounds.top+target.bounds.bottom)/2};
    assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,center),'starter-stage',`${name}: subject is not covered by a DOM panel`);
    if(subject==='vendor') {
      assert.equal(before.vendorFace.available,true,`${name}: actual authored eyes and mouth are present`);
      assert.ok(before.vendorFace.facingCamera>.15,`${name}: camera sees the face rather than the back of the head`);
      assert.equal(before.vendorFace.unobscured,true,`${name}: actual eyes/mouth are not behind the monitor or desk: ${JSON.stringify(before.vendorFace)}`);
      assert.ok(before.vendorFace.samples.every(sample=>sample.dom==='starter-stage'),`${name}: no UI covers the actual face`);
    }
  }
  // This branch is the only successful capture path. Private mode never calls screenshot,
  // including screenshots returned as buffers without a path.
  const file = privateMode?null:`${name}.png`;
  const pixels = privateMode?null:await page.screenshot({path:path.join(output,file)});
  const after = await page.evaluate(() => window.__STARTER_FURNITURE__.snapshot());
  assert.deepEqual(stableScene(after),stableScene(before),`${name}: screenshot must match before/after economic/layout/seat state`);
  const evidence = {file,sha256:pixels?sha(pixels):null,characterEvidence,commit,sourceHash:provenance.sourceHash,viewport:page.viewportSize(),before,after};
  await writeFile(path.join(output,`${name}.json`),JSON.stringify(evidence,null,2)); report.evidence.push(evidence);
}
async function openShop(page, mobile) {
  const trigger = page.locator('#context-action');
  await trigger.waitFor({state:'visible'});
  if (mobile) await trigger.tap(); else { await trigger.focus(); await page.keyboard.press('KeyF'); }
  await page.locator('#dorm-shop-dialogue').waitFor({state:'visible'});
  const browse = page.locator('#dorm-shop-dialogue [data-action="browse"]');
  if (mobile) await browse.tap(); else await browse.click();
  await page.locator('#starter-shop').waitFor({state:'visible'});
  await page.locator(`[data-listing-id="${listings[0]}"]`).waitFor();
  await page.waitForFunction(()=>{const s=window.__STARTER_FURNITURE__.snapshot();return s.rpcPending===0&&s.shop.state==='READY';},null,{timeout:TIMEOUT_MS});
}
try {
  for (const view of views) {
    db = await createStarterFurnitureBrowserDatabase();
    const beforeActivation = await db.readback(); assertEconomic(beforeActivation,0,600);
    assert.ok(beforeActivation.listings.every(row=>row.status==='LOCKED'));
    await db.activate();
    smoke = await startSmoke({viewport:{width:view.width,height:view.height},contextOptions:{isMobile:view.mobile,hasTouch:view.mobile}});
    const page = activePage = await smoke.context.newPage(), fatal = smoke.watch(page);
    let held = null;
    await page.exposeFunction('__STARTER_RPC__',async (name,args) => {
      const response = await db.rpc(name,args);
      if (name.startsWith('purchase_world_shop_listing_') && held) { const waiting=held; held=null; await waiting; }
      return response;
    });
    await page.addInitScript(identity=>{window.__STARTER_IDENTITY__=identity;},{userId:db.userId,roomId:db.roomId,renderMode:characterEvidence.mode});
    await page.goto(`${smoke.origin}/tests/browser/starter-furniture-harness.html`,{waitUntil:'domcontentloaded'});
    await Promise.race([fatal,page.waitForFunction(()=>window.__STARTER_FURNITURE__?.ready||window.__STARTER_FURNITURE__?.error,null,{timeout:TIMEOUT_MS})]);
    assert.equal(await page.evaluate(()=>window.__STARTER_FURNITURE__.error??null),null);
    const state = () => page.evaluate(()=>window.__STARTER_FURNITURE__.snapshot());
    const tap = async selector => view.mobile ? page.locator(selector).tap() : page.locator(selector).click();
    await capture(page,`${view.label}-vendor`,{subject:'vendor'});
    for (const gate of ['setBlocked','setInvalid']) {
      await page.evaluate(name=>window.__STARTER_FURNITURE__[name](true),gate); await page.keyboard.press('KeyF');
      assert.equal((await state()).dialogueOpen,false); assert.equal((await state()).shopOpen,false);
      await page.evaluate(name=>window.__STARTER_FURNITURE__[name](false),gate);
    }
    await page.evaluate(()=>window.__STARTER_FURNITURE__.position(0,2.8)); await page.keyboard.press('KeyF');
    assert.equal((await state()).dialogueOpen,false); assert.equal((await state()).action,null);
    await page.evaluate(()=>window.__STARTER_FURNITURE__.position(0,.85));
    await page.evaluate(()=>window.__STARTER_FURNITURE__.guest(true)); await page.keyboard.press('KeyF');
    assert.equal((await state()).dialogueOpen,false); assert.equal((await state()).shopOpen,false);
    await page.evaluate(()=>window.__STARTER_FURNITURE__.guest(false));
    assert.equal(db.calls.filter(call=>call.name.startsWith('purchase_world_shop_listing_')).length,0);
    check(`${view.label}: guest, blocked, invalid and behind-counter F are read-only`);

    const trigger = page.locator('#context-action'); await trigger.waitFor({state:'visible'});
    if(view.mobile)await trigger.tap();else{await trigger.focus();await page.keyboard.press('KeyF');}
    const dialogue=page.locator('#dorm-shop-dialogue'); await dialogue.waitFor({state:'visible'});
    assert.match(await dialogue.textContent(),/윤가온/); assert.match(await dialogue.textContent(),/생활관 가구점/);
    for(const action of ['browse','close']) {
      await dialogue.locator(`[data-action="${action}"]`).scrollIntoViewIfNeeded();
      const box=await dialogue.locator(`[data-action="${action}"]`).boundingBox();
      assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=view.width&&box.y>=0&&box.y+box.height<=view.height);
    }
    await capture(page,`${view.label}-introduction`);
    if(view.mobile)await tap('#dorm-shop-dialogue [data-action="close"]');else await page.keyboard.press('Escape');
    assert.equal((await state()).focus,'context-action','dialogue restores actual shared action focus');
    await openShop(page,view.mobile);
    for(let index=0;index<items.length;index++) {
      const card=page.locator(`[data-listing-id="${listings[index]}"]`);
      assert.equal(await card.count(),1);assert.match(await card.textContent(),new RegExp(`${index?480:120} 인덕코인`));
      assert.match(await card.textContent(),/Lv\.1 이상/);assert.equal(await card.locator('.shop-offer-buy').isEnabled(),true);
      await card.scrollIntoViewIfNeeded();await capture(page,`${view.label}-offer-${index}`);
    }
    const layout=await page.locator('#starter-shop').evaluate(node=>({client:node.clientWidth,scroll:node.scrollWidth,bounds:node.getBoundingClientRect().toJSON()}));
    assert.ok(layout.scroll<=layout.client+1);assert.ok(layout.bounds.y>=0&&layout.bounds.bottom<=view.height);
    await tap('#starter-shop [aria-label="상점 닫기"]');assert.equal((await state()).focus,'context-action');
    await openShop(page,view.mobile);
    check(`${view.label}: actual F/touch introduction, exact prices, responsive panel and close focus`);

    for(let index=0;index<items.length;index++) {
      const button=page.locator(`[data-listing-id="${listings[index]}"] .shop-offer-buy`);
      held=new Promise(resolve=>{releasePurchase=resolve;});
      report.transportControls.push(`${view.label}/${items[index]}: delay delivery of actual DB result while testing repeated UI clicks`);
      // Locator click/tap re-resolves detached nodes and scrolls the current control itself.
      if(view.mobile)await button.tap();else await button.click();
      await page.waitForFunction(id=>document.querySelector(`[data-listing-id="${id}"] .shop-offer-buy`)?.disabled,listings[index]);
      await button.evaluate(node=>{node.click();node.click();node.dispatchEvent(new MouseEvent('click',{bubbles:true}));});
      releasePurchase();releasePurchase=null;
      await page.waitForFunction(item=>window.__STARTER_FURNITURE__.snapshot().inventory?.items.some(row=>row.itemId===item),items[index]);
      await page.waitForFunction(expected=>window.__STARTER_FURNITURE__.snapshot().wallet?.balances['currency.induck_coin']===expected,index?0:480);
      const readback=await db.readback();assertEconomic(readback,index+1,index?0:480);
      assert.equal(db.calls.filter(call=>call.name.startsWith('purchase_world_shop_listing_')&&call.args.p_listing_id===listings[index]).length,1,'repeated UI clicks cause one actual request');
      const receipt=readback.purchases.find(row=>row.item_id===items[index]);
      assert.ok((await state()).inventory.items.some(row=>row.itemId===receipt.item_id&&row.quantity===1));
      await capture(page,`${view.label}-purchased-${index}`);report.db.push({view:view.label,phase:`purchase-${index}`,readback});
    }
    const owned=await db.readback();
    const duplicateButton=page.locator(`[data-listing-id="${listings[0]}"] .shop-offer-buy`);
    if(await duplicateButton.isEnabled()) {
      if(view.mobile)await duplicateButton.tap();else await duplicateButton.click();
      await page.waitForFunction(()=>document.querySelector('#starter-shop .shop-hint')?.textContent.includes('이미 보유한 아이템'));
      assert.deepEqual(economicState(await db.readback()),economicState(owned));
    } else {
      // A future server ownership-aware offer may disable this control; the RPC test below
      // still independently proves the UNIQUE invariant instead of trusting the UI lock.
      assert.ok((await state()).inventory.items.some(row=>row.itemId===items[0]));
    }
    for(const purchase of owned.purchases) {
      const replay=await db.rpc('purchase_world_shop_listing_v2',{p_shop_id:'shop.dorm_furniture',p_listing_id:purchase.listing_id,p_idempotency_key:purchase.idempotency_key});
      assert.equal(replay.error,null);assert.equal(replay.data.status,'SUCCESS');
      const duplicate=await db.rpc('purchase_world_shop_listing_v1',{p_listing_id:purchase.listing_id,p_idempotency_key:`starter:duplicate:${randomUUID()}`});
      assert.equal(duplicate.error?.message,'ITEM_ALREADY_OWNED');
    }
    assert.deepEqual(economicState(await db.readback()),economicState(owned));
    check(`${view.label}: two real purchases, inventory readback, ledger linkage, rapid clicks, v2 receipt replay and v1 UNIQUE rejection`);

    const guidance=page.locator(`[data-listing-id="${listings[1]}"] .shop-furniture-action`);
    assert.equal(await guidance.textContent(),'내 방 위치 안내');
    if(view.mobile)await guidance.tap();else await guidance.click();
    assert.equal((await state()).shopOpen,false);assert.match((await state()).notices.at(-1),/내 방 문/);
    await tap('#starter-room');
    await page.waitForFunction(()=>window.__STARTER_FURNITURE__.snapshot().space==='ROOM_PERSONAL_BASIC');
    assert.equal((await state()).access.allowed,true);assert.equal((await state()).access.role,'owner');
    await tap('#starter-decorate');await page.locator('#furniture-editor').waitFor({state:'visible'});
    await page.waitForFunction(()=>window.__STARTER_FURNITURE__.snapshot().rpcPending===0,null,{timeout:TIMEOUT_MS});
    for(const item of items) {const add=page.locator(`#furniture-editor [data-focus="${item}"]`);if(view.mobile)await add.tap();else await add.click();}
    const draft=(await state()).furniture;
    assert.equal(draft.objects.length,2);assert.equal(draft.objects.find(row=>row.itemId===items[0]).surface,'desk');
    assert.equal(draft.objects.find(row=>row.itemId===items[1]).surface,'floor');assert.equal(draft.dirty,true);
    const save=page.locator('#furniture-editor footer button').filter({hasText:/^저장$/});
    if(view.mobile)await save.tap();else await save.click();
    await page.waitForFunction(()=>{const value=window.__STARTER_FURNITURE__.snapshot().furniture;return !value.pending&&!value.dirty&&value.revision>0;});
    assert.equal((await state()).furniture.error,null);await capture(page,`${view.label}-saved-editor`);
    const done=page.locator('#furniture-editor footer button').filter({hasText:/^완료$/});if(view.mobile)await done.tap();else await done.click();
    assert.equal(await page.evaluate(()=>window.__STARTER_FURNITURE__.refreshFurniture()),true);
    const saved=(await state()).furniture, persisted=await db.readback();
    assert.deepEqual(canonicalFurniture(persisted.layout.objects),canonicalFurniture(saved.objects));assert.equal(persisted.layout.revision,saved.revision);
    assert.deepEqual(canonicalFurniture(saved.objects),canonicalFurniture(draft.objects));assertEconomic(persisted,2,0);
    assert.equal((await state()).renderedObjects.length,2);
    report.db.push({view:view.label,phase:'saved-layout',readback:persisted});
    await page.evaluate(()=>window.__STARTER_FURNITURE__.approachSofa());
    await page.waitForFunction(()=>window.__STARTER_FURNITURE__.snapshot().action==='앉기');
    await capture(page,`${view.label}-sofa-before`,{subject:'sofa'});
    const standing=await state();
    if(view.mobile)await tap('#context-action');else await page.keyboard.press('KeyF');
    await page.waitForFunction(beforeFrames=>{const s=window.__STARTER_FURNITURE__.snapshot();return s.seated&&s.frames>beforeFrames+1;},standing.frames);
    const seated=await state();assert.equal(seated.seat,saved.objects.find(row=>row.itemId===items[1]).id);
    assert.notDeepEqual(seated.pose,standing.pose,'actual Character pose changes');
    assert.ok(Math.abs(seated.seatContact.rootHeight-seated.seatContact.expectedSeatedRootY)<1e-5,'SeatController aligns the character to the real sofa support plane');
    assert.ok(seated.seatContact.horizontalError<1e-5,'Character is horizontally aligned with the saved sofa');
    assert.equal(seated.seatContact.supportWithinAvatarBounds,true,'The actual avatar geometry spans the sofa support envelope');
    assert.deepEqual(seated.pose.legs,[70,70],'The actual Character has applied both seated leg pivots');
    await capture(page,`${view.label}-sofa-seated`,{subject:'sofa'});
    if(view.mobile)await tap('#context-action');else await page.keyboard.press('KeyF');
    await page.waitForFunction(()=>!window.__STARTER_FURNITURE__.snapshot().seated);
    assert.equal((await state()).safe,true);assert.deepEqual((await state()).position,standing.position);
    await capture(page,`${view.label}-sofa-standing`,{subject:'sofa'});
    assert.deepEqual(economicState(await db.readback()),economicState(persisted));
    check(`${view.label}: actual editor save/reload, SQL layout equality, sofa and Character/SeatController sit and safe stand`,{characterEvidence,seatContact:seated.seatContact});
    assert.deepEqual(smoke.problems,[]);

    // Real refusal/concurrency coverage does not rely on disabled UI controls.
    const poor=await db.createAccount({balance:0}), anonymous=await db.createAccount({anonymous:true});
    for(const listing of listings) {
      const args={p_listing_id:listing,p_idempotency_key:`starter:poor:${randomUUID()}`};
      assert.equal((await poor.rpc('purchase_world_shop_listing_v1',args)).error?.message,'INSUFFICIENT_FUNDS');
      assert.equal((await anonymous.rpc('purchase_world_shop_listing_v1',args)).error?.message,'PERMANENT_ACCOUNT_REQUIRED');
      assert.ok((await db.guestRpc('purchase_world_shop_listing_v1',args)).error,'unauthenticated RPC is rejected');
    }
    assertEconomic(await poor.readback(),0,0);assertEconomic(await anonymous.readback(),0,0);
    const concurrent=await db.createAccount({balance:600}), sameKey=`starter:concurrent:${randomUUID()}`;
    const receipts=await Promise.all([1,2,3].map(()=>concurrent.rpc('purchase_world_shop_listing_v1',{p_listing_id:listings[0],p_idempotency_key:sameKey})));
    assert.ok(receipts.every(row=>row.error===null&&row.data.status==='SUCCESS'));assertEconomic(await concurrent.readback(),1,480);
    const foreign=await poor.rpc('purchase_world_shop_listing_v1',{p_listing_id:listings[0],p_idempotency_key:sameKey});
    assert.equal(foreign.error?.message,'IDEMPOTENCY_CONFLICT');assertEconomic(await poor.readback(),0,0);
    report.db.push({view:view.label,phase:'refusals-concurrency',poor:await poor.readback(),anonymous:await anonymous.readback(),concurrent:await concurrent.readback()});
    check(`${view.label}: real v1 insufficient funds, anonymous/guest refusals, concurrent same-key debit-once and foreign-key refusal`);

    // Only preflight capability discovery is fault-injected. Legacy reads, purchases,
    // wallet and inventory still execute the actual server v1 functions and are read back in SQL.
    const legacy=await db.createAccount({balance:600});
    const legacyPage=activePage=await smoke.context.newPage(),legacyFatal=smoke.watch(legacyPage);
    await legacyPage.exposeFunction('__STARTER_RPC__',(name,args)=>name==='get_world_shop_capabilities_v1'
      ? {data:null,error:{code:'PGRST202',message:'Could not find the function public.get_world_shop_capabilities_v1() in the schema cache'}}
      : legacy.rpc(name,args));
    report.transportControls.push(`${view.label}: exact missing-capability response selects legacy UI; every economic RPC remains real v1`);
    await legacyPage.addInitScript(identity=>{window.__STARTER_IDENTITY__=identity;},{userId:legacy.userId,roomId:legacy.roomId,renderMode:characterEvidence.mode});
    await legacyPage.goto(`${smoke.origin}/tests/browser/starter-furniture-harness.html`,{waitUntil:'domcontentloaded'});
    await Promise.race([legacyFatal,legacyPage.waitForFunction(()=>window.__STARTER_FURNITURE__?.ready||window.__STARTER_FURNITURE__?.error,null,{timeout:TIMEOUT_MS})]);
    assert.equal(await legacyPage.evaluate(()=>window.__STARTER_FURNITURE__.error??null),null);
    assert.equal(await legacyPage.evaluate(()=>window.__STARTER_FURNITURE__.snapshot().shop.mode),'legacy');
    await openShop(legacyPage,view.mobile);
    for(let index=0;index<items.length;index++) {
      const buy=legacyPage.locator(`[data-listing-id="${listings[index]}"] .shop-offer-buy`);
      if(view.mobile)await buy.tap();else await buy.click();
      await legacyPage.waitForFunction(item=>window.__STARTER_FURNITURE__.snapshot().inventory?.items.some(row=>row.itemId===item),items[index]);
    }
    await legacyPage.waitForFunction(()=>window.__STARTER_FURNITURE__.snapshot().wallet?.balances['currency.induck_coin']===0);
    assertEconomic(await legacy.readback(),2,0);
    assert.equal(legacy.calls.filter(call=>call.name==='purchase_world_shop_listing_v1').length,2);
    assert.equal(legacy.calls.filter(call=>call.name==='purchase_world_shop_listing_v2').length,0);
    await capture(legacyPage,`${view.label}-legacy-v1-purchases`);
    report.db.push({view:view.label,phase:'legacy-v1-browser',readback:await legacy.readback()});
    check(`${view.label}: exact missing-capability legacy UI still purchases two products through real v1 server authority`);
    assert.deepEqual(smoke.problems,[]);
    await writeFile(path.join(output,`${view.label}-rpc.json`),JSON.stringify({calls:db.calls,guestCalls:db.guestCalls,poor:poor.calls,anonymous:anonymous.calls,concurrent:concurrent.calls,legacy:legacy.calls},null,2));
    await smoke.close();smoke=null;activePage=null;
    await db.close();const restored=await db.readback();assert.ok(restored.listings.every(row=>row.status==='LOCKED'));
    report.db.push({view:view.label,phase:'restored-locked-listings',readback:restored});db=null;
  }
  report.result='pass';console.log(`PASS: ${report.checks.length} starter furniture acceptance checks; ${privateMode?'private geometry metadata only, zero screenshots':`${report.evidence.length} public QA substitute screenshots`}; actual character pixels UNKNOWN`);
} catch(error) {
  report.result='fail';report.error=error.stack;
  if(!privateMode)await activePage?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  report.failureState=await activePage?.evaluate(()=>window.__STARTER_FURNITURE__?.snapshot()).catch(()=>null);
  throw error;
} finally {
  releasePurchase?.();await smoke?.close();await db?.close();
  await writeFile(path.join(output,'result.json'),JSON.stringify(report,null,2));
}
