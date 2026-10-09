import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {startSmoke} from './harness.mjs';import {mkdir,writeFile} from 'node:fs/promises';
const out=process.env.ANNYONGI_OUTPUT||'test-results/annyongi';await mkdir(out,{recursive:true});
const smoke=await startSmoke({viewport:{width:720,height:800}});
try{const page=await smoke.context.newPage();smoke.watch(page);await page.goto(smoke.origin+'/tests/browser/annyongi-review-harness.html');await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
for(const name of ['front','side','back','ride']){await page.evaluate(name=>window.__ANNYONGI_REVIEW__.view(name,name==='ride'),name);await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:out+'/'+name+'.png'});}
const canonical=await readFile(out+'/front.png');
await page.goto(smoke.origin+'/tests/browser/annyongi-review-harness.html?optimized=1');await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const optimized=await page.screenshot({path:out+'/optimized-front.png'});
assert.deepEqual(optimized,canonical,'optimized geometry renders pixel-identically to canonical');
for(const name of ['front','side','back']) {
 await page.goto(smoke.origin+'/tests/browser/annyongi-review-harness.html?night=1');await page.waitForFunction(()=>window.__ANNYONGI_REVIEW__);
 await page.evaluate(name=>window.__ANNYONGI_REVIEW__.view(name),name);
 await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
 await page.screenshot({path:out+'/night-'+name+'.png'});
}
assert.deepEqual(smoke.problems,[]);
await writeFile(out+'/result.json',JSON.stringify({pixelIdentical:true,frontSha256:createHash('sha256').update(canonical).digest('hex'),state:await page.evaluate(()=>window.__ANNYONGI_REVIEW__.snapshot()),problems:smoke.problems},null,2));console.log(out,smoke.problems);
}finally{await smoke.close();}
