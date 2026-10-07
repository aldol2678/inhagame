// Real Chromium decode/layout/failure tests using only synthetic read clients and exact local files.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const output=process.env.ITEM_ICONS_OUTPUT || 'test-results/item-icons';
await mkdir(output,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.EXPECTED_ITEM_ICONS_HEAD)assert.equal(head,process.env.EXPECTED_ITEM_ICONS_HEAD);
const prefix='assets/item-icons/active8-v1/';
const manifest=JSON.parse(await readFile(new URL(`../../${prefix}manifest.json`,import.meta.url)));
const assets=manifest.items.flatMap(item=>item.exports.map(file=>`${prefix}${file.path}`));
const modules=['src/inventory/inventory-panel.js','src/inventory/inventory-client.js',
  'src/inventory/inventory-category-registry.js','src/collection/item-catalog.js','src/collection/item-icon.js',
  'src/collection/collection-book-view.js','src/collection/collection-book-client.js'];
const paths=[...modules,...assets,'styles.css','tests/browser/item-icons-harness.html'];
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={head,scope:'Synthetic read-only fixture; no live account or deployed-game assertion',result:'RUNNING',
  sourceHashes:Object.fromEntries(await Promise.all(paths.map(async path=>[path,hash(await readFile(new URL(`../../${path}`,import.meta.url)))]))),
  screenshots:[],cases:[]};
async function screenshot(page,name){await page.screenshot({path:`${output}/${name}`});report.screenshots.push({file:name,sha256:hash(await readFile(`${output}/${name}`))});}
let browser,server;
try{
  browser=await chromium.launch({headless:true,...(process.env.ITEM_ICONS_BROWSER?{executablePath:process.env.ITEM_ICONS_BROWSER}:{})});
  const port=await new Promise((resolve,reject)=>{const probe=createServer().once('error',reject).listen(0,'127.0.0.1',()=>{const port=probe.address().port;probe.close(()=>resolve(port));});});
  const origin=`http://127.0.0.1:${port}`,env={...process.env,PORT:String(port)};delete env.NPC_AI_PILOT;
  server=spawn(process.execPath,[fileURLToPath(new URL('../../dev-server.mjs',import.meta.url))],{env,stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture server timeout')),15000);server.stdout.on('data',data=>{if(String(data).includes('listening')){clearTimeout(timer);resolve();}});server.once('exit',code=>{clearTimeout(timer);reject(Error(`Fixture exit ${code}`));});});
  for(const viewport of [{width:1280,height:800},{width:390,height:844},{width:360,height:800},{width:844,height:390}]){
    const mobile=viewport.width!==1280,label=`${viewport.width}x${viewport.height}`,context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,deviceScaleFactor:mobile?2:1,serviceWorkers:'block'});
    const blocked=[],errors=[],staticPaths=new Set(paths.map(p=>`/${p}`));let failFish=false,failedImageRequests=0;
    const caseReport={viewport,result:'RUNNING'};report.cases.push(caseReport);
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url()),path=url.pathname.replace(/^\/campus\//,'/');
      if(route.request().method()==='GET'&&url.origin===origin&&staticPaths.has(path)&&!url.search){
        if(failFish&&path.endsWith('/material.fish_carp.png')){failedImageRequests++;return route.fulfill({status:404,body:''});}
        // The repository dev server only serves root static paths. Emulate a mount
        // prefix in this fixture without changing production routing or the browser URL.
        if(url.pathname!==path)return route.fulfill({response:await route.fetch({url:`${origin}${path}`})});
        return route.continue();
      }
      blocked.push(url.href);return route.abort('blockedbyclient');
    });
    let page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
    try{
      // Emulated prefix coverage checks relative asset URLs, not deployed route availability.
      await page.goto(`${origin}${mobile?'/campus':''}/tests/browser/item-icons-harness.html`);
      await page.waitForFunction(()=>Boolean(window.__ITEM_ICONS__));
      await page.locator('#opener').click();
      await page.waitForFunction(()=>document.querySelectorAll('.item-icon[data-state="ready"]').length===8);
      let panel=page.locator('#inventory');const cards=panel.locator('.inventory-item');
      assert.equal(await cards.count(),9);
      assert.deepEqual(await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.itemId)),[...manifest.items.map(i=>i.itemId),'head.future_hat']);
      caseReport.images=await panel.locator('img').evaluateAll(nodes=>nodes.map(n=>({src:n.currentSrc,width:n.naturalWidth,height:n.naturalHeight,hidden:n.hidden,slot:n.parentElement.getBoundingClientRect().width,alt:n.alt,label:n.parentElement.getAttribute('aria-label')})));
      for(const img of caseReport.images){assert.equal(img.width,64);assert.equal(img.height,img.width);assert.ok(img.src.includes(`/png/${mobile?128:64}/`));assert.equal(img.slot,48);assert.equal(img.hidden,false);assert.equal(img.alt,'');assert.match(img.label,/아이콘$/);}
      caseReport.servedSourceHashes=await page.evaluate(async paths=>Object.fromEntries(await Promise.all(paths.map(async path=>{const bytes=await(await fetch(`/${path}`)).arrayBuffer();const digest=await crypto.subtle.digest('SHA-256',bytes);return[path,[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')];}))),paths);
      assert.deepEqual(caseReport.servedSourceHashes,report.sourceHashes);
      const layout=await panel.evaluate(el=>({scroll:document.documentElement.scrollWidth,width:innerWidth,cardOverflow:[...el.querySelectorAll('.inventory-item')].some(n=>n.scrollWidth>n.clientWidth),rect:{left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}}));
      assert.equal(layout.cardOverflow,false);assert.ok(layout.scroll<=layout.width);assert.ok(layout.rect.left>=0&&layout.rect.right<=viewport.width);caseReport.layout=layout;
      await screenshot(page,`${label}-inventory.png`);
      await page.locator('[data-inventory-tab="MATERIAL"]').click();
      assert.equal(await cards.count(),3);await screenshot(page,`${label}-materials.png`);
      await page.keyboard.press('Escape');assert.equal(await panel.isVisible(),false);
      assert.equal(await page.locator('#opener').evaluate(el=>el===document.activeElement),true);
      await page.locator('#opener').click();await page.waitForFunction(()=>document.querySelector('[data-item-id="material.fish_carp"] .item-icon')?.dataset.state==='ready');
      // Inject before the first image load in a fresh document: a decoded-image cache
      // must not make the expected 404 disappear during a simple same-document rerender.
      const fixtureUrl=page.url();await page.close();failFish=true;
      page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
      await page.goto(fixtureUrl);await page.waitForFunction(()=>Boolean(window.__ITEM_ICONS__));
      await page.locator('#opener').click();await page.locator('[data-inventory-tab="MATERIAL"]').click();
      panel=page.locator('#inventory');
      await panel.locator('[aria-label="붕어 이미지 없음"]').waitFor();
      assert.equal(await panel.locator('[data-item-id="material.fish_carp"] img').isVisible(),false);
      assert.equal(await panel.locator('[data-item-id="material.fish_carp"] .item-icon-fallback').isVisible(),true);
      assert.equal(await panel.locator('[data-item-id="material.fish_carp"] .inventory-item-name').innerText(),'붕어');
      assert.ok(failedImageRequests>0,'fault injection reached the actual image request');
      const requests=failedImageRequests;await page.waitForTimeout(100);assert.equal(failedImageRequests,requests,'no automatic retry loop');
      await screenshot(page,`${label}-fallback.png`);
      failFish=false;await page.reload();await page.waitForFunction(()=>Boolean(window.__ITEM_ICONS__));
      await page.locator('#opener').click();await page.waitForFunction(()=>document.querySelector('[data-item-id="material.fish_carp"] .item-icon')?.dataset.state==='ready');
      await page.getByRole('button',{name:'수집도감',exact:true}).click();await page.getByText('발견 기록 1 / 2',{exact:false}).waitFor();
      await page.waitForFunction(()=>document.querySelectorAll('.collection-book .item-icon[data-state="ready"]').length===2);
      assert.equal(await panel.locator('.collection-book-entry[data-state="UNKNOWN"] img').count(),0);
      await screenshot(page,`${label}-collection.png`);
      await page.evaluate(()=>window.__ITEM_ICONS__.switchAccount());
      assert.equal(await panel.locator('img').count(),0);assert.doesNotMatch(await panel.innerText(),/붕어|정문 첫걸음 배지/);
      await page.evaluate(()=>window.__ITEM_ICONS__.signOut());assert.equal(await panel.locator('img').count(),0);
      caseReport.calls=await page.evaluate(()=>window.__ITEM_ICONS__.calls);
      assert.ok(caseReport.calls.every(name=>['get_my_world_inventory_v1','GET /api/world-collection-book'].includes(name)));
      assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);caseReport.failedImageRequests=failedImageRequests;caseReport.result='PASS';
    }finally{await context.close();}
  }
  report.result='PASS';
}catch(error){report.result='FAIL';report.error=error.message;throw error;}
finally{server?.kill();await browser?.close();await writeFile(`${output}/report.json`,JSON.stringify(report,null,2));}
