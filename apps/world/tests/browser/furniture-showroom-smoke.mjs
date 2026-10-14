// Furniture showroom visual acceptance: exact production panel + procedural model renderer.
// Synthetic read/purchase RPCs only. No Production credentials, purchases, or mutation.
// R2: desktop, portrait, landscape; PNG content, scroll/buy, categories, fallback.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {startSmoke} from './harness.mjs';

const output=process.env.FURNITURE_SHOWROOM_OUTPUT||'test-results/furniture-showroom';
await mkdir(output,{recursive:true});
const head=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
if(process.env.FURNITURE_SHOWROOM_HEAD_SHA)assert.equal(head,process.env.FURNITURE_SHOWROOM_HEAD_SHA);
const sources=['src/shop/shop-panel.js','src/shop/furniture-shop-preview.js',
 'src/shop/furniture-shop-categories.js','src/rooms/furniture-renderer.js','styles.css'];
const hashes=Object.fromEntries(await Promise.all(sources.map(async src=>[
 src,createHash('sha256').update(await readFile(new URL('../../'+src,import.meta.url))).digest('hex')
])));
const report={head,scope:'Real PlayCanvas showroom and product UI in offline Chromium with synthetic purchases; no live economy, device hardware or Production',hashes,views:[],fallback:null,result:'running'};
const viewports=[
 {label:'desktop',width:1280,height:800,touch:false},
 {label:'portrait',width:390,height:844,touch:true},
 {label:'landscape',width:844,height:390,touch:true}
];
let smoke=null;
try{
 for(const view of viewports){
  smoke=await startSmoke({viewport:{width:view.width,height:view.height},
   contextOptions:{hasTouch:view.touch,isMobile:view.touch}});
  const page=await smoke.context.newPage();
  const errors=[], record={view:view.label,viewport:{width:view.width,height:view.height},checks:[]};
  const check=(name)=>record.checks.push(name);
  page.on('pageerror',err=>errors.push(err.message));
  await page.goto(`${smoke.origin}/tests/browser/furniture-showroom-harness.html`);
  await page.waitForFunction(()=>window.__FURNITURE_SHOWROOM_QA__?.ready);
  await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.open());
  await page.waitForSelector('.shop-showroom-card');
  const layout=await page.evaluate(()=>{
    const panel=document.querySelector('#shop'),body=panel.querySelector('.shop-panel-body');
    const cards=[...panel.querySelectorAll('.shop-showroom-card')];
    const r=panel.getBoundingClientRect();
    return{panelWidth:r.width,panelHeight:r.height,scrollHeight:body.scrollHeight,clientHeight:body.clientHeight,
      columnCount:getComputedStyle(panel.querySelector('.shop-showroom-grid')).gridTemplateColumns.split(' ').length,
      cardCount:cards.length,overflow:document.documentElement.scrollWidth>innerWidth+3};
  });
  assert.equal(layout.cardCount,8,'all eight real RPC offers are displayed');
  assert.equal(layout.columnCount,2,'two-column showroom on all target sizes');
  assert.equal(layout.overflow,false,'no horizontal viewport overflow');
  assert.ok(layout.panelWidth<=view.width+1&&layout.panelHeight<=view.height+1,JSON.stringify(layout));
  check('real shop offer grid is in viewport with two columns');
  // Require an actual rendered furniture thumbnail rather than a category emoji or blank canvas.
  await page.waitForFunction(()=>[...document.querySelectorAll('.shop-showroom-thumbnail')]
      .filter(img=>!img.hidden&&img.complete&&img.naturalWidth>=128).length>=3,null,{timeout:60000});
  const pixels=await page.locator('.shop-showroom-thumbnail:not([hidden])').first().evaluate(img=>{
    const canvas=document.createElement('canvas');canvas.width=128;canvas.height=96;
    const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,128,96);
    const data=ctx.getImageData(0,0,128,96).data;
    const colors=new Set();for(let i=0;i<data.length;i+=16)colors.add([data[i],data[i+1],data[i+2]].join(','));
    return{width:img.naturalWidth,height:img.naturalHeight,distinctColors:colors.size};
  });
  assert.ok(pixels.distinctColors>6,'real 3D geometry must differ from a flat background');
  check('procedural PlayCanvas furniture thumbnail paints real pixels');
  await page.screenshot({path:`${output}/${view.label}-catalog.png`,fullPage:false});
  const locked=page.locator('.shop-showroom-card[data-listing-id="qa.furniture.dorm_desk_lamp"] .shop-offer-buy');
  assert.equal(await locked.isDisabled(),true);
  await page.locator('.shop-showroom-tab[data-category="seating"]').click();
  assert.equal(await page.locator('.shop-showroom-card').count(),2);
  await page.locator('.shop-showroom-tab[data-category="all"]').click();
  check('category filter and authoritative level lock remain intact');

  // Item detail reuses the renderer and supports keyboard/touch-accessible rotation and zoom.
  await page.locator('.shop-showroom-card[data-listing-id="qa.furniture.induck_chair"] .shop-showroom-view').click();
  await page.locator('.shop-showroom-stage canvas').waitFor({timeout:30000});
  const detail=page.locator('.shop-showroom-detail');
  assert.match(await detail.textContent(),/놓을 곳: 바닥/);
  assert.equal(await detail.locator('.shop-showroom-rotate').count(),4);
  await detail.locator('.shop-showroom-rotate').nth(0).click();
  await detail.locator('.shop-showroom-rotate').nth(2).click();
  await page.screenshot({path:`${output}/${view.label}-detail.png`});
  check('same procedural model opens, rotates and zooms in detail');

  await detail.locator('.shop-showroom-back').click();
  // Last offer is below the fold on phones. Native Playwright click must scroll the real panel.
  const bottom=page.locator('.shop-showroom-card[data-listing-id="qa.furniture.dorm_single_sofa"] .shop-offer-buy');
  const before=await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.buyCount());
  await bottom.click({timeout:12000});
  await page.waitForFunction(n=>window.__FURNITURE_SHOWROOM_QA__.buyCount()===n+1,before,{timeout:10000});
  const after=await page.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.buyCount());
  assert.equal(after,before+1,'no second purchase event');
  check('last-card purchase is reachable and creates exactly one synthetic RPC');
  record.layout=layout;record.thumbnail=pixels;record.purchases=after;
  assert.deepEqual(errors,[]);assert.deepEqual(smoke.problems,[]);
  report.views.push(record);
  await smoke.close();smoke=null;
 }
 // Explicit WebGL2 failure: fallback text remains and buying is still independently available.
 smoke=await startSmoke({viewport:{width:390,height:844},contextOptions:{hasTouch:true,isMobile:true}});
 const fallbackPage=await smoke.context.newPage();
 await fallbackPage.route('**/src/shop/furniture-shop-preview.js',route=>route.fulfill({
   status:200,contentType:'text/javascript',
   body:'export async function createFurnitureShopPreview(){throw Error("QA_PREVIEW_UNAVAILABLE")}'
 }));
 await fallbackPage.goto(`${smoke.origin}/tests/browser/furniture-showroom-harness.html`);
 await fallbackPage.waitForFunction(()=>window.__FURNITURE_SHOWROOM_QA__?.ready);
 await fallbackPage.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.open());
 await fallbackPage.locator('.shop-showroom-card').first().waitFor();
 await fallbackPage.locator('.shop-showroom-view').first().click();
 await fallbackPage.waitForFunction(()=>document.querySelector('.shop-showroom-preview-fallback')?.textContent.includes('사용할 수 없어요'),null,{timeout:15000});
 const before=await fallbackPage.evaluate(()=>window.__FURNITURE_SHOWROOM_QA__.buyCount());
 await fallbackPage.locator('.shop-showroom-detail .shop-offer-buy').click();
 await fallbackPage.waitForFunction(n=>window.__FURNITURE_SHOWROOM_QA__.buyCount()===n+1,before);
 assert.deepEqual(smoke.problems,[]);
 await fallbackPage.screenshot({path:`${output}/fallback.png`});
 report.fallback={text:await fallbackPage.locator('.shop-showroom-preview-fallback').textContent(),
   purchasedWithoutPreview:true};
 await smoke.close();smoke=null;
 report.result='pass';
 console.log('PASS: 3 viewports, real procedural 3D pixels, responsive cards, scrolling purchases and graceful preview fallback');
}catch(e){
 report.result='fail';report.error=e.stack;
 throw e;
}finally{
 if(smoke)await smoke.close();
 await writeFile(`${output}/result.json`,JSON.stringify(report,null,2)+'\n');
}
