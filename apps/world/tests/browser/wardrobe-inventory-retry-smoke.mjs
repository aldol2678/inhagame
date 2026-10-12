// Native keyboard/touch acceptance against the real panel and read clients, using synthetic RPCs.
// Only the local fixture origin is allowed; no login, backend or production requests.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const output = process.env.WARDROBE_RETRY_OUTPUT || 'test-results/wardrobe-inventory-retry';
await mkdir(output, { recursive: true });
const paths = ['src/appearance/wardrobe-panel.js', 'src/inventory/inventory-client.js', 'src/appearance/loadout-client.js',
  'src/inventory/inventory-panel.js', 'src/inventory/inventory-display-query.js', 'src/inventory/inventory-acquisition-client.js',
  'src/collection/item-acquisition-guide.js', 'src/collection/item-acquisition-guide-view.js', 'src/minimap/full-map-controller.js'];
const report = { head: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  sourceHashes: Object.fromEntries(await Promise.all(paths.map(async path => [path,
    createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex')]))),
  cases: [], result: 'running' };
if (process.env.WARDROBE_RETRY_HEAD) assert.equal(report.head, process.env.WARDROBE_RETRY_HEAD);
let browser, server;
try {
  browser = await chromium.launch({ headless: true,
    ...(process.env.WARDROBE_RETRY_BROWSER ? { executablePath: process.env.WARDROBE_RETRY_BROWSER } : {}) });
  const port = await new Promise((resolve, reject) => {
    const probe = createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = probe.address(); probe.close(() => resolve(port));
    });
  });
  const origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, PORT: String(port) };
  delete env.NPC_AI_PILOT;
  server = spawn(process.execPath, [fileURLToPath(new URL('../../dev-server.mjs', import.meta.url))],
    { env, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Local fixture server timeout')), 15000);
    server.stdout.on('data', data => { if (String(data).includes('listening')) { clearTimeout(timer); resolve(); } });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Local server exited ${code}`)); });
  });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 360, height: 800 } : { width: 1000, height: 800 },
      isMobile: mobile, hasTouch: mobile, serviceWorkers: 'block' });
    const blocked = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
      blocked.push(url.href);
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const item = { label: mobile ? 'mobile-360' : 'desktop', result: 'running' }; report.cases.push(item);
    const retry = () => page.locator('.wardrobe-owned button.shop-retry');
    const snapshot = () => page.evaluate(() => window.__WARDROBE_RETRY__.snapshot());
    const focusIs = async selector => assert.equal(await page.locator(selector).evaluate(el => el === document.activeElement), true, selector);
    const open = async () => {
      await page.goto(`${origin}/tests/browser/wardrobe-inventory-retry-harness.html`);
      await page.waitForFunction(() => Boolean(window.__WARDROBE_RETRY__));
      item.servedSourceHashes = await page.evaluate(async paths => Object.fromEntries(await Promise.all(paths.map(async path => {
        const bytes = await (await fetch(`/${path}`)).arrayBuffer();
        const hash = await crypto.subtle.digest('SHA-256', bytes);
        return [path, [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('')];
      }))), paths);
      assert.deepEqual(item.servedSourceHashes, report.sourceHashes);
      if (mobile) await page.locator('#opener').tap(); else await page.keyboard.press('Enter');
      await retry().waitFor();
    };
    try {
      await open();
      await page.locator('.wardrobe-owned').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${output}/${item.label}-error.png` });
      const before = await snapshot();
      await page.evaluate(() => window.__WARDROBE_RETRY__.hold());
      if (mobile) await retry().tap();
      else {
        await page.keyboard.press('Tab'); // current HEAD unequip
        await page.keyboard.press('Tab'); // owned-list retry
        await focusIs('.wardrobe-owned button.shop-retry');
        await page.keyboard.press('Enter');
      }
      assert.equal(await retry().isDisabled(), true);
      await page.screenshot({ path: `${output}/${item.label}-pending.png` });
      if (!mobile) await focusIs('.wardrobe-owned');
      await page.evaluate(() => document.querySelector('.wardrobe-owned button').click());
      assert.equal((await snapshot()).inventoryReads, before.inventoryReads + 1);
      const scroll = await page.locator('.shop-panel-body').evaluate(el => { el.scrollTop = el.scrollHeight; return el.scrollTop; });
      assert.ok(scroll > 0, 'the fixture exercises actual native scrolling');
      await page.evaluate(() => window.__WARDROBE_RETRY__.settle(0, false));
      await page.waitForFunction(() => !document.querySelector('.wardrobe-owned button')?.disabled);
      assert.equal(await page.locator('.shop-panel-body').evaluate(el => el.scrollTop), scroll);
      if (!mobile) { await focusIs('.wardrobe-owned button.shop-retry'); await page.keyboard.press('Space'); }
      else await retry().tap();
      await page.evaluate(() => window.__WARDROBE_RETRY__.settle(1, true));
      await page.locator('.wardrobe-item').waitFor();
      assert.equal(await retry().count(), 0);
      if (!mobile) await focusIs('.profile-close');
      assert.equal(await page.locator('.wardrobe-slot[data-slot="HEAD"]').getAttribute('data-item-id'), 'head.inha_cap');
      assert.equal((await snapshot()).loadoutReads, before.loadoutReads);
      assert.deepEqual((await snapshot()).writes, []);
      item.layout = await page.locator('#wardrobe').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
          width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(item.layout.left >= -1 && item.layout.right <= item.layout.width + 1, 'panel fits horizontally');
      assert.ok(item.layout.top >= -1 && item.layout.bottom <= item.layout.height + 1, 'panel fits vertically');
      assert.equal(item.layout.overflow, false, 'no horizontal page overflow');
      await page.screenshot({ path: `${output}/${item.label}-recovered.png` });
      if (mobile) await page.locator('.profile-close').tap(); else await page.keyboard.press('Escape');
      assert.equal(await page.locator('#wardrobe').isVisible(), false);
      await focusIs('#opener');
      item.trustedEvents = await page.evaluate(() => window.__WARDROBE_RETRY__.events.filter(event => event.trusted));
      if (mobile) assert.ok(item.trustedEvents.some(event => event.pointerType === 'touch'));
      else for (const code of ['Tab', 'Enter', 'Space', 'Escape']) {
        assert.ok(item.trustedEvents.some(event => event.type === 'keydown' && event.code === code), `native ${code}`);
      }
      if (!mobile) {
        await open(); await page.evaluate(() => window.__WARDROBE_RETRY__.hold()); await retry().click();
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.__WARDROBE_RETRY__.settle(0, true));
        assert.equal(await page.locator('#wardrobe').isVisible(), false); await focusIs('#opener');
        await open(); await page.evaluate(() => window.__WARDROBE_RETRY__.hold()); await retry().click();
        await page.evaluate(() => window.__WARDROBE_RETRY__.switchAccount('B'));
        assert.equal(await retry().isEnabled(), true);
        await page.evaluate(() => window.__WARDROBE_RETRY__.hold()); await retry().click();
        await page.evaluate(() => window.__WARDROBE_RETRY__.settle(0, true));
        assert.equal(await retry().isDisabled(), true);
        await page.evaluate(() => window.__WARDROBE_RETRY__.settle(1, true, 'top.inha_basic'));
        await page.locator('.wardrobe-item[data-item-id="top.inha_basic"]').waitFor();
        assert.equal(await page.locator('.wardrobe-item[data-item-id="head.inha_cap"]').count(), 0);
        assert.deepEqual((await snapshot()).writes, []);
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(blocked, [], 'the fixture attempts no backend or off-origin requests');
      item.result = 'pass';
    } finally { await context.close(); }
  }
  // The acquisition acceptance is synthetic: real rendering/read clients/map controller,
  // local RPC-shaped fixtures, no claim about production stock or deployed authority.
  for (const width of [360, 768, 1280]) {
    const context = await browser.newContext({viewport:{width,height:800},isMobile:width===360,hasTouch:width===360,serviceWorkers:'block'});
    const blocked=[],errors=[];
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin&&!url.pathname.startsWith('/api/')) return route.continue();
      blocked.push(url.href);return route.abort('blockedbyclient');
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const item={label:`inventory-${width}`,evidence:'synthetic RPCs; no production reads',result:'running'};report.cases.push(item);
    try {
      await page.goto(`${origin}/tests/browser/wardrobe-inventory-retry-harness.html?inventory=1`);
      await page.waitForFunction(()=>Boolean(window.__INVENTORY_GUIDE__));
      await page.locator('#opener').click();
      const cards=()=>page.locator('#inventory .inventory-item');
      const cap=()=>page.locator('#inventory .inventory-item[data-item-id="head.induck_cap"]');
      const search=()=>page.locator('#inventory .inventory-query-input');
      const sort=()=>page.locator('#inventory .inventory-query-select');
      const snap=()=>page.evaluate(()=>window.__INVENTORY_GUIDE__.snapshot());
      await cap().locator('[data-availability="AVAILABLE"]').waitFor();
      assert.equal(await cards().count(),5);
      assert.equal(await cap().locator('.inventory-item-source').textContent(),'획득 · 상점');
      assert.match(await cap().locator('.item-acquisition-guide-label').textContent(),/학생회관/);
      assert.equal(await page.locator('[data-item-id="memorabilia.campus_mug"] [data-availability="HIDDEN"]').count(),1);
      assert.equal(await page.locator('[data-item-id="memorabilia.campus_mug"] .item-acquisition-guide-location').count(),0);
      const initialOwned=(await snap()).owned;
      await search().fill('  HEAD.INDUCK_CAP  ');assert.equal(await cards().count(),1);
      await search().fill('does-not-exist');assert.equal(await cards().count(),0);
      assert.match(await page.locator('#inventory .shop-empty').textContent(),/검색 결과가 없어요/);
      await search().fill('');
      // Composition events simulate the browser's Korean IME event contract; they
      // are not described as OS-level/native IME input.
      await search().focus();
      await search().evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='인덕';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));});
      assert.equal(await cards().count(),5);
      await page.evaluate(()=>window.__INVENTORY_GUIDE__.acquisition.refresh());
      assert.equal(await search().evaluate(el=>el===document.activeElement),true);
      await search().evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{bubbles:true,code:'Escape',isComposing:true})));
      assert.equal((await snap()).open,true);
      await search().evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'인덕'})));
      assert.equal(await cards().count(),1);assert.equal(await search().inputValue(),'인덕');
      assert.equal(await search().evaluate(el=>el===document.activeElement),true);
      await search().fill('');await sort().selectOption('recent');
      assert.equal(await cards().first().getAttribute('data-item-id'),'memorabilia.campus_mug');
      await sort().selectOption('name');
      const expected=['material.fish_carp','furniture.dorm_single_sofa','head.induck_cap','top.inha_basic','memorabilia.campus_mug'];
      assert.deepEqual(await cards().evaluateAll(nodes=>nodes.map(n=>n.dataset.itemId)),expected);
      await page.locator('[data-inventory-tab="MATERIAL"]').click();assert.equal(await cards().count(),1);
      assert.equal(await cards().first().getAttribute('data-item-id'),'material.fish_carp');
      await search().fill('head');assert.equal(await cards().count(),0);
      await page.locator('[data-inventory-tab="ALL"]').click();assert.equal(await cards().count(),1);
      await search().fill('');assert.deepEqual((await snap()).owned,initialOwned);
      await page.screenshot({path:`${output}/${item.label}-guide.png`});
      item.layout=await page.locator('#inventory').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth};});
      assert.ok(item.layout.left>=-1&&item.layout.right<=width+1,'inventory fits width');
      assert.ok(item.layout.top>=-1&&item.layout.bottom<=801,'inventory fits height');assert.equal(item.layout.overflow,false);
      // Explicit location click opens the existing full-map controller, no destination,
      // movement or purchase command. Closing restores a usable opener.
      await cap().locator('.item-acquisition-guide-location').click();
      assert.equal((await snap()).open,false);assert.equal((await snap()).mapOpen,true);assert.equal((await snap()).mapDestination,null);
      assert.equal(await page.locator('#map-infoTitle').textContent(),'학생회관');
      await page.locator('#map-closeButton').click();
      assert.equal((await snap()).mapOpen,false);
      assert.equal(await page.locator('#opener').evaluate(el=>el===document.activeElement),true);
      await page.locator('#opener').click();await cap().locator('[data-availability="AVAILABLE"]').waitFor();
      await page.evaluate(()=>window.__INVENTORY_GUIDE__.setSpace('room'));
      assert.equal(await page.locator('#inventory .item-acquisition-guide-location').count(),0);
      await page.evaluate(()=>window.__INVENTORY_GUIDE__.setSpace('campus'));
      // Refresh failures remove prior vendor proof, while ownership stays intact.
      await page.evaluate(async()=>{window.__INVENTORY_GUIDE__.setMode('error');await window.__INVENTORY_GUIDE__.acquisition.refresh();});
      assert.equal(await cap().locator('[data-availability="UNKNOWN"]').count(),1);
      assert.equal(await cap().locator('.item-acquisition-guide-location').count(),0);
      await page.evaluate(async()=>{window.__INVENTORY_GUIDE__.setMode('ready');window.__INVENTORY_GUIDE__.setAvailability(false);await window.__INVENTORY_GUIDE__.acquisition.refresh();});
      assert.equal(await cap().locator('[data-availability="UNAVAILABLE"]').count(),1);
      assert.match(await cap().locator('.item-acquisition-guide-detail').textContent(),/레벨/);
      // A→B→A starts two generations; stale A response cannot resurrect availability.
      await page.evaluate(()=>{window.__INVENTORY_GUIDE__.setMode('hold');void window.__INVENTORY_GUIDE__.acquisition.refresh();});
      const oldEnd=(await snap()).pending;
      await search().fill('old account query');
      await page.evaluate(async()=>{const h=window.__INVENTORY_GUIDE__;await h.switchAccount('B');await h.switchAccount('A');void h.acquisition.refresh();});
      const newEnd=(await snap()).pending;assert.ok(newEnd>oldEnd);
      assert.equal(await search().inputValue(),'');assert.equal(await sort().inputValue(),'server');
      await page.evaluate(end=>window.__INVENTORY_GUIDE__.settleRange(0,end,true),oldEnd);
      assert.equal(await cap().locator('[data-availability="UNKNOWN"]').count(),1);
      await page.evaluate(({oldEnd,newEnd})=>window.__INVENTORY_GUIDE__.settleRange(oldEnd,newEnd,false),{oldEnd,newEnd});
      await cap().locator('[data-availability="UNAVAILABLE"]').waitFor();
      await page.keyboard.press('Escape');assert.equal((await snap()).open,false);
      assert.equal(await page.locator('#opener').evaluate(el=>el===document.activeElement),true);
      assert.deepEqual((await snap()).writes,[]);assert.deepEqual(blocked,[]);assert.deepEqual(errors,[]);
      item.ownedUnchanged=JSON.stringify((await snap()).owned)===JSON.stringify(initialOwned);assert.equal(item.ownedUnchanged,true);
      item.rpcCalls=(await page.evaluate(()=>window.__INVENTORY_GUIDE__.calls)).map(c=>c.fn);
      item.result='pass';
    } finally {await context.close();}
  }
  report.result = 'pass'; console.log('PASS: wardrobe retry plus inventory search/IME/sort/acquisition/map/account races at 360/768/1280; synthetic read-only fixtures');
} catch (error) {
  report.result = browser ? 'fail' : 'blocked'; report.error = error.stack; throw error;
} finally {
  await browser?.close(); server?.kill();
  await writeFile(`${output}/result.json`, `${JSON.stringify(report, null, 2)}\n`);
}
