// Native desktop/touch acceptance for the real editor + client using an offline in-memory authority.
// FURNITURE_HISTORY_BROWSER=/usr/bin/chromium node apps/world/tests/browser/furniture-history-smoke.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const output = process.env.FURNITURE_HISTORY_OUTPUT || 'test-results/furniture-history';
await mkdir(output,{ recursive:true });
const paths = ['src/rooms/furniture-editor.js','src/rooms/furniture-client.js','src/rooms/furniture-layout.js',
  'src/rooms/personal-room-layout.js','src/player-dimensions.js','src/collection/item-catalog.js',
  'tests/browser/furniture-history-harness.html','styles.css'];
const sources = new Map(await Promise.all(paths.map(async name=>[`/${name}`,await readFile(new URL(`../../${name}`,import.meta.url))])));
const report = { status:'RUNNING', scope:'Offline source integration; synthetic RPCs only; no backend or production changes',
  sourceHashes:Object.fromEntries([...sources].map(([path,bytes])=>[path,createHash('sha256').update(bytes).digest('hex')])), viewports:[] };
let browser, server;
try {
  server=createServer((request,response)=>{
    const path=new URL(request.url,'http://localhost').pathname, body=sources.get(path);
    if (!body) { response.writeHead(404).end(); return; }
    response.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':'text/javascript; charset=utf-8'}).end(body);
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({ headless:true, ...(process.env.FURNITURE_HISTORY_BROWSER?{executablePath:process.env.FURNITURE_HISTORY_BROWSER}:{}) });
  report.browserVersion=browser.version();
  for (const [label,width,height,mobile] of [['desktop',1280,800,false],['portrait',360,800,true],['landscape',800,360,true]]) {
    const context=await browser.newContext({ viewport:{width,height},isMobile:mobile,hasTouch:mobile,serviceWorkers:'block' });
    const blocked=[],errors=[],item={label,width,height,status:'RUNNING'};report.viewports.push(item);
    await context.route('**/*',route=>{
      const url=new URL(route.request().url());
      if(url.origin===origin&&sources.has(url.pathname))return route.continue();
      blocked.push(url.href);return route.abort('blockedbyclient');
    });
    const page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
    const snap=()=>page.evaluate(()=>window.__FURNITURE_HISTORY__.snapshot());
    const editor=page.locator('#furniture-editor'),byFocus=key=>editor.locator(`[data-focus="${key}"]`);
    const action=async locator=>{await locator.scrollIntoViewIfNeeded();return mobile?locator.tap():locator.click();};
    try {
      await page.goto(`${origin}/tests/browser/furniture-history-harness.html`);await page.waitForFunction(()=>window.__FURNITURE_HISTORY__);
      await action(page.locator('#opener'));assert.equal(await byFocus('undo').isDisabled(),true);
      for(const key of ['undo','redo']) {
        const rect=await byFocus(key).boundingBox();assert.ok(rect.width>=44&&rect.height>=44,`${label}: touch target ${key}`);
      }
      await action(byFocus('furniture.induck_chair'));
      const initial=(await snap()).objects, plan=editor.locator('svg.furniture-plan');
      await plan.scrollIntoViewIfNeeded();const bounds=await plan.boundingBox();
      const position={x:bounds.width*((-2+7.14)/14.28),y:bounds.height*((4.2+1)/8.4)};
      if(mobile)await plan.tap({position});else await plan.click({position});
      const placed=(await snap()).objects;
      await action(byFocus('rotation'));assert.equal((await snap()).objects[0].yaw,45);
      if(mobile)await action(byFocus('undo'));else await page.keyboard.press('Control+z');
      assert.deepEqual((await snap()).objects,placed);
      if(mobile)await action(byFocus('redo'));else await page.keyboard.press('Control+Shift+Z');
      assert.equal((await snap()).objects[0].yaw,45);
      await action(editor.getByRole('button',{name:'회수',exact:true}));assert.equal((await snap()).objects.length,0);
      await action(byFocus('undo'));assert.equal((await snap()).objects[0].id,placed[0].id);
      await action(byFocus('undo'));await action(byFocus('undo'));await action(byFocus('undo'));assert.equal((await snap()).objects.length,0);
      assert.equal(await page.evaluate(()=>document.activeElement?.dataset.focus),'redo');
      if(mobile)await action(byFocus('redo'));else await page.keyboard.press('Control+y');
      assert.deepEqual((await snap()).objects,initial);await action(byFocus('redo'));
      assert.deepEqual((await snap()).objects,placed);
      await action(byFocus('rotation'));assert.equal(await byFocus('redo').isDisabled(),true,'new edit clears redo');
      await page.evaluate(()=>window.__FURNITURE_HISTORY__.mode('hold'));
      await action(editor.getByRole('button',{name:'저장',exact:true}));assert.equal((await snap()).pending,true);
      assert.equal(await byFocus('undo').isDisabled(),true);assert.equal(await byFocus('redo').isDisabled(),true);
      assert.equal(await editor.evaluate(node=>node.contains(document.activeElement)),true,'pending save keeps focus inside dialog');
      await page.keyboard.press('Control+z');assert.equal((await snap()).objects[0].yaw,45);
      await page.evaluate(()=>window.__FURNITURE_HISTORY__.settle(false));await page.waitForFunction(()=>!window.__FURNITURE_HISTORY__.client.state().pending);
      assert.equal(await byFocus('undo').isEnabled(),true);await action(byFocus('undo'));assert.deepEqual((await snap()).objects,placed);
      await action(byFocus('redo'));await page.evaluate(()=>window.__FURNITURE_HISTORY__.mode('success'));
      await action(editor.getByRole('button',{name:'저장',exact:true}));await page.waitForFunction(()=>!window.__FURNITURE_HISTORY__.client.state().dirty);
      assert.equal(await byFocus('undo').isDisabled(),true);assert.equal(await byFocus('redo').isDisabled(),true);
      await action(byFocus('rotation'));const beforeClose=(await snap()).objects;
      await action(editor.getByRole('button',{name:'닫기',exact:true}));assert.equal(await byFocus('undo').isDisabled(),true);
      await action(editor.getByRole('button',{name:'계속 꾸미기',exact:true}));assert.deepEqual((await snap()).objects,beforeClose);
      await action(byFocus('undo'));assert.equal((await snap()).dirty,false);
      await action(editor.getByRole('button',{name:'완료',exact:true}));assert.equal(await editor.isVisible(),false);
      await action(page.locator('#opener'));assert.equal(await byFocus('undo').isDisabled(),true);assert.equal(await byFocus('redo').isDisabled(),true);
      await action(byFocus('furniture.dorm_desk_lamp'));await action(byFocus('undo'));await action(byFocus('redo'));
      await editor.evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:`${output}/${label}.png`});
      item.layout=await editor.evaluate(node=>{const r=node.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,overflow:document.documentElement.scrollWidth>innerWidth};});
      assert.ok(item.layout.left>=0&&item.layout.right<=width&&item.layout.top>=0&&item.layout.bottom<=height);assert.equal(item.layout.overflow,false);
      const events=await page.evaluate(()=>window.__FURNITURE_HISTORY__.events);
      assert.ok(events.some(event=>event.trusted&&(mobile?event.pointerType==='touch':event.code==='KeyZ')));
      item.calls=await page.evaluate(()=>window.__FURNITURE_HISTORY__.calls);
      assert.equal(item.calls.filter(call=>call.name==='save_my_room_furniture_v1').length,2);
      assert.ok(await page.evaluate(()=>window.__FURNITURE_HISTORY__.inventory.snapshot.items.every(item=>item.quantity===1)));
      assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);item.status='PASS';
    } finally {await context.close();}
  }
  report.status='PASS';console.log('PASS: furniture undo/redo on desktop, 360px touch and landscape; failed-save retry, save checkpoint, focus and close boundaries.');
} catch(error) {report.status=browser?'FAIL':'BLOCKED';report.error=error.stack;throw error;}
finally {
  await browser?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));
  await writeFile(`${output}/report.json`,`${JSON.stringify(report,null,2)}\n`);
}
