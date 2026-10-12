// Native desktop/touch recommendation acceptance using the real editor and synthetic authority.
// FURNITURE_RECOMMENDATIONS_BROWSER=/usr/bin/chromium node apps/world/tests/browser/furniture-recommendations-smoke.mjs
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const output = process.env.FURNITURE_RECOMMENDATIONS_OUTPUT || 'test-results/furniture-recommendations';
await mkdir(output,{ recursive:true });
const paths = ['src/rooms/furniture-editor.js','src/rooms/furniture-client.js','src/rooms/furniture-layout.js','src/rooms/furniture-recommendations.js',
  'src/rooms/personal-room-layout.js','src/player-dimensions.js','src/collection/item-catalog.js',
  'tests/browser/furniture-history-harness.html','styles.css',
  'data/reality/campus-landmarks.json','data/reality/campus-facilities.json',
  'data/reality/campus-buildings.json','data/reality/campus-site.json'];
// Serve the exact transitive production module graph, including the editor's seat-availability
// dependency. Keep off-origin and non-source requests blocked instead of replacing seat logic.
const sources = new Map();
const sourceRoot = new URL('../../', import.meta.url);
async function addSource(name) {
  const url = new URL(name, sourceRoot);
  assert.ok(url.href.startsWith(sourceRoot.href), 'fixture source stays inside apps/world');
  const path = '/' + url.href.slice(sourceRoot.href.length);
  if (sources.has(path)) return;
  const bytes = await readFile(url); sources.set(path, bytes);
  if (!path.endsWith('.js')) return;
  for (const match of bytes.toString().matchAll(/from\s+["'](\.[^"']+)["']/g)) {
    await addSource(new URL(match[1], url).href.slice(sourceRoot.href.length));
  }
  // Layout dependencies fetch canonical JSON through import.meta.url at module startup.
  // Include only literal in-repository JSON dependencies; all other requests remain blocked.
  for (const match of bytes.toString().matchAll(/new URL\(\s*["'](\.[^"']+\.json)["']\s*,\s*import\.meta\.url\s*\)/g)) {
    await addSource(new URL(match[1], url).href.slice(sourceRoot.href.length));
  }
}
for (const path of paths) await addSource(path);
const report = { status:'RUNNING', scope:'Offline source integration; synthetic RPCs only; no backend or production changes',
  sourceHashes:Object.fromEntries([...sources].map(([path,bytes])=>[path,createHash('sha256').update(bytes).digest('hex')])), viewports:[] };
let browser, server;
try {
  server=createServer((request,response)=>{
    const path=new URL(request.url,'http://localhost').pathname, body=sources.get(path);
    if (!body) { response.writeHead(404).end(); return; }
    response.writeHead(200,{'Content-Type':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.css')?'text/css':path.endsWith('.json')?'application/json':'text/javascript; charset=utf-8'}).end(body);
  });
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({ headless:true, ...(process.env.FURNITURE_RECOMMENDATIONS_BROWSER?{executablePath:process.env.FURNITURE_RECOMMENDATIONS_BROWSER}:{}) });
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
      await action(page.locator('#opener'));
      await action(byFocus('furniture.induck_chair'));const before=(await snap()).objects;
      for(const style of ['study','relax','open']) {
        const choice=byFocus(`recommend-${style}`),rect=await choice.boundingBox();
        assert.ok(rect.width>=44&&rect.height>=44);await action(choice);
        const state=await snap();assert.ok(state.objects.length>1);assert.equal(state.dirty,true);
        assert.equal(await choice.getAttribute('aria-pressed'),'true');
      }
      await editor.evaluate(node=>{node.scrollTop=0;});await page.screenshot({path:`${output}/${label}.png`});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await action(byFocus('recommend-cancel'));assert.deepEqual((await snap()).objects,before);
      await action(byFocus('recommend-study'));await action(byFocus('recommend-study'));
      await action(byFocus('undo'));assert.deepEqual((await snap()).objects,before);
      await action(byFocus('recommend-relax'));
      const suggested=(await snap()).objects;await byFocus('selection').selectOption(suggested.find(row=>row.surface==='floor').id);
      await action(editor.getByRole('button',{name:'회수',exact:true}));assert.equal((await snap()).objects.length,suggested.length-1);
      await page.evaluate(()=>window.__FURNITURE_HISTORY__.mode('hold'));
      await action(editor.getByRole('button',{name:'저장',exact:true}));assert.equal((await snap()).pending,true);
      assert.equal(await byFocus('recommend-study').isDisabled(),true);assert.equal(await byFocus('recommend-cancel').isDisabled(),true);
      await page.evaluate(()=>window.__FURNITURE_HISTORY__.settle(false));await page.waitForFunction(()=>!window.__FURNITURE_HISTORY__.client.state().pending);
      await action(byFocus('recommend-cancel'));assert.deepEqual((await snap()).objects,before);
      await page.evaluate(()=>window.__FURNITURE_HISTORY__.mode('success'));
      await action(byFocus('recommend-open'));await action(editor.getByRole('button',{name:'저장',exact:true}));
      await page.waitForFunction(()=>!window.__FURNITURE_HISTORY__.client.state().dirty);
      assert.equal(await byFocus('recommend-cancel').count(),0);assert.equal(await byFocus('undo').isDisabled(),true);
      const saved=(await snap()).objects;await action(editor.getByRole('button',{name:'완료',exact:true}));
      await action(page.locator('#opener'));assert.deepEqual((await snap()).objects,saved);
      assert.equal(await page.evaluate(()=>window.__FURNITURE_HISTORY__.calls.filter(call=>call.name==='save_my_room_furniture_v1').length),2);
      assert.ok(await page.evaluate(()=>window.__FURNITURE_HISTORY__.inventory.snapshot.items.every(item=>item.quantity===1)));
      assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);item.status='PASS';
    } finally {item.pageErrors=errors;item.blockedRequests=blocked;await context.close();}
  }
  report.status='PASS';console.log('PASS: furniture recommendations on desktop, portrait touch and landscape; draft, cancel, undo, manual edit, failed save and persistence checkpoint.');
} catch(error) {report.status=browser?'FAIL':'BLOCKED';report.error=error.stack;throw error;}
finally {
  await browser?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));
  await writeFile(`${output}/report.json`,`${JSON.stringify(report,null,2)}\n`);
}
