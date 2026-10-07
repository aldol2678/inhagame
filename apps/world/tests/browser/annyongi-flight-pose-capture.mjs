import assert from 'node:assert/strict';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {startSmoke} from './harness.mjs';
const output=process.env.ANNYONGI_OUTPUT||'test-results/annyongi/poses';
await mkdir(output,{recursive:true});
const results=[];
for(const [device,viewport] of [['desktop',{width:1280,height:800}],['mobile',{width:390,height:844}]]) {
 const smoke=await startSmoke({viewport});
 try {
  const page=await smoke.context.newPage();smoke.watch(page);
  for(const night of [false,true])for(const state of ['hover','ascend','forward','descend','landing','ground']) {
   await page.goto(smoke.origin+'/tests/browser/annyongi-review-harness.html'+(night?'?night=1':''));
   await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
   await page.evaluate(state=>{const d=window.__ANNYONGI_REVIEW__;d.state(state);d.flightView();},state);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   await page.screenshot({path:`${output}/${device}-${night?'night':'day'}-${state}.png`});
   results.push({device,night,state,pose:await page.evaluate(()=>window.__ANNYONGI_REVIEW__.character.flightVisualState)});
  }
  if(device==='desktop')for(const state of ['hover','ascend','forward','descend']) {
   await page.goto(smoke.origin+'/tests/browser/annyongi-review-harness.html?optimized=1');await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
   await page.evaluate(state=>{const d=window.__ANNYONGI_REVIEW__;d.state(state);d.flightView();},state);
   await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
   const pixels=await page.screenshot({path:`${output}/optimized-${state}.png`});
   assert.deepEqual(pixels,await readFile(`${output}/desktop-day-${state}.png`),`${state}: optimized morphs render pixel-identically`);
  }
  assert.deepEqual(smoke.problems,[]);
 }finally{await smoke.close();}
}
await writeFile(output+'/pose-results.json',JSON.stringify(results,null,2));
console.log('Flight pose capture PASS');
