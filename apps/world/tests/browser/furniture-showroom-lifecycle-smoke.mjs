// Bounded offline showroom acceptance; real GLB parser/rendering, no live account or purchase.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {startSmoke} from './harness.mjs';

const output=process.env.FURNITURE_SHOWROOM_OUTPUT||'test-results/furniture-showroom/lifecycle';
await mkdir(output,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.FURNITURE_SHOWROOM_HEAD_SHA)assert.equal(head,process.env.FURNITURE_SHOWROOM_HEAD_SHA);
const paths=['src/shop/shop-panel.js','src/shop/furniture-shop-preview.js','src/rooms/furniture-renderer.js',
 'src/rooms/furniture-glb-visual.js','src/rooms/furniture-visual-assets.js','src/campus-render-kit.js','styles.css'];
const hashes=Object.fromEntries(await Promise.all(paths.map(async p=>[p,createHash('sha256').update(await readFile(new URL('../../'+p,import.meta.url))).digest('hex')])));
const report={head,hashes,startedAtUtc:new Date().toISOString(),scope:'local working-tree offline WebGL2; no live purchase; viewport emulation, not physical device',views:[],result:'running'};
const sofa='.shop-showroom-card[data-listing-id="qa.furniture.dorm_single_sofa"]';
let smoke;
const waitGlb=page=>page.waitForFunction(()=>window.__FURNITURE_SHOWROOM_QA__.previews.at(-1)?.captures.some(c=>c.id==='furniture.dorm_single_sofa'&&c.mode==='GLB'&&c.image),null,{timeout:30000});
const summary=page=>page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.previews.map(p=>({disposed:p.disposed,renderer:p.renderer,status:p.status(),captures:p.captures.map(({image,...c})=>({...c,imageBytes:image?.length??0}))})));
try{
 for(const view of [{label:'desktop',width:1280,height:800,touch:false},{label:'portrait',width:390,height:844,touch:true},{label:'landscape',width:844,height:390,touch:true}]){
  smoke=await startSmoke({viewport:{width:view.width,height:view.height},contextOptions:{hasTouch:view.touch,isMobile:view.touch}});
  const page=await smoke.context.newPage();smoke.watch(page);
  let pendingRoute,requestCount=0;
  await page.route('**/assets/furniture/dorm-single-sofa-v1.glb',route=>{requestCount++;pendingRoute=route;});
  await page.goto(`${smoke.origin}/tests/browser/furniture-showroom-harness.html`);
  await page.waitForFunction(()=>window.__FURNITURE_SHOWROOM_QA__?.ready);
  await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.open());
  await page.waitForFunction(()=>window.__FURNITURE_SHOWROOM_QA__.previews.at(-1)?.status().objects.some(o=>o.state==='LOADING'));
  assert.equal(await page.locator(`${sofa} img`).getAttribute('src'),null,'loading fallback is never cached');
  assert.ok(pendingRoute);await pendingRoute.continue();await page.unroute('**/assets/furniture/dorm-single-sofa-v1.glb');
  await waitGlb(page);
  await page.waitForFunction(()=>{const i=document.querySelector('[data-item-id="furniture.dorm_single_sofa"]');return i&&!i.hidden&&i.complete&&i.naturalWidth===256;});
  const thumbnail=await page.locator(`${sofa} img`).evaluate(img=>{
   const c=document.createElement('canvas');c.width=256;c.height=192;const x=c.getContext('2d');x.drawImage(img,0,0);const d=x.getImageData(0,0,256,192).data;
   const colors=new Set();for(let i=0;i<d.length;i+=16)colors.add(`${d[i]},${d[i+1]},${d[i+2]}`);return {colors:colors.size,width:img.naturalWidth};
  });assert.ok(thumbnail.colors>6);
  await page.locator(sofa).scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/${view.label}-sofa-thumbnail.png`});
  await page.locator(`${sofa} .shop-showroom-view`).click();
  await page.locator('.shop-showroom-stage canvas').waitFor();
  await page.waitForFunction(()=>window.__FURNITURE_SHOWROOM_QA__.previews.at(-1)?.status().objects.some(o=>o.state==='GLB'));
  const rect=await page.locator('.shop-showroom-stage canvas').boundingBox();assert.ok(rect.width>100&&rect.height>50);
  const stageRect=await page.locator('.shop-showroom-stage').boundingBox();
  assert.ok(rect.width<=stageRect.width&&rect.height<=stageRect.height,'canvas fits the preview stage without clipping');
  await page.locator('.shop-showroom-rotate').nth(0).click();await page.locator('.shop-showroom-rotate').nth(2).click();
  await page.locator('.shop-showroom-stage').scrollIntoViewIfNeeded();
  await page.screenshot({path:`${output}/${view.label}-sofa-detail.png`});
  for(let cycle=0;cycle<3;cycle++){
   await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.panel.setOpen(false));
   assert.equal(await page.locator('canvas.shop-showroom-canvas,canvas.shop-showroom-canvas-offscreen').count(),0);
   const records=await summary(page);assert.ok(records.every(r=>r.disposed&&r.status.destroyed&&r.status.resources.length===0));
   if(cycle<2){await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.open());await waitGlb(page);}
  }
  assert.equal(await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.buyCount()),0);
  assert.deepEqual(smoke.problems,[]);
  report.views.push({view,thumbnail,canvasRect:rect,stageRect,initialRequests:requestCount,cycles:3,previews:await summary(page)});
  await smoke.close();smoke=null;
 }
 // Transport failure is distinct from WebGL unavailability: populated optional fallback,
 // then close/reopen with working transport must recapture the real GLB.
 smoke=await startSmoke({viewport:{width:390,height:844},contextOptions:{hasTouch:true,isMobile:true}});
 const page=await smoke.context.newPage();smoke.watch(page);
 await page.route('**/assets/furniture/dorm-single-sofa-v1.glb',route=>route.fulfill({status:503,body:'QA_INTENTIONAL_SOFA_UNAVAILABLE'}));
 await page.goto(`${smoke.origin}/tests/browser/furniture-showroom-harness.html`);await page.waitForFunction(()=>window.__FURNITURE_SHOWROOM_QA__?.ready);
 await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.open());
 await page.waitForFunction(()=>window.__FURNITURE_SHOWROOM_QA__.previews.at(-1)?.captures.some(c=>c.id==='furniture.dorm_single_sofa'&&c.mode==='FALLBACK'&&c.image),null,{timeout:30000});
 report.fallback=await summary(page);
 await page.locator(sofa).scrollIntoViewIfNeeded();await page.screenshot({path:`${output}/transport-fallback.png`});
 const fallbackImage=await page.locator(`${sofa} img`).getAttribute('src');assert.ok(fallbackImage?.startsWith('data:image/png'));
 const expected=smoke.problems.filter(p=>p.includes('HTTP 503:')||p.includes('console.error: Failed to load resource: the server responded with a status of 503'));
 assert.ok(expected.some(p=>p.includes('dorm-single-sofa-v1.glb')));assert.deepEqual(smoke.problems.filter(p=>!expected.includes(p)),[]);report.expectedFailureEvidence=expected;
 await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.panel.setOpen(false));
 await page.unroute('**/assets/furniture/dorm-single-sofa-v1.glb');
 await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.open());await waitGlb(page);
 assert.notEqual(await page.locator(`${sofa} img`).getAttribute('src'),fallbackImage,'reopen must replace fallback thumbnail with real GLB');
 report.recovered=await summary(page);assert.equal(await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.buyCount()),0);
 await page.screenshot({path:`${output}/transport-recovered.png`});
 await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.panel.setOpen(false));
 await smoke.close();smoke=null;report.result='pass';console.log('PASS: real GLB delay, thumbnail recapture, 3 viewports, 3 cycles each, HTTP fallback/recovery, zero purchases');
}catch(error){report.result='fail';report.error=error.stack;throw error;}
finally{if(smoke)await smoke.close();report.finishedAtUtc=new Date().toISOString();await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n');}
