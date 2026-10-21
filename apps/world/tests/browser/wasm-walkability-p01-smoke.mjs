import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const root=resolve(fileURLToPath(new URL('../../',import.meta.url))),out=process.env.WASM_P01_OUTPUT??'test-results/wasm-p01';
await mkdir(out,{recursive:true});
const server=createServer(async(req,res)=>{
  try{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>WASM P01 batch probe</title>');}
    const path=resolve(root,decodeURIComponent(new URL(req.url,'http://local').pathname).slice(1));
    if(!path.startsWith(root+sep))throw Error('path');
    res.setHeader('Content-Type',({'.mjs':'text/javascript','.js':'text/javascript','.json':'application/json','.wasm':'application/wasm'})[extname(path)]??'application/octet-stream');
    res.end(await readFile(path));
  }catch{res.statusCode=404;res.end('missing');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  browser=await chromium.launch({headless:true,...(process.env.WORLD_BROWSER_EXECUTABLE?{executablePath:process.env.WORLD_BROWSER_EXECUTABLE}:{})});
  const context=await browser.newContext();
  await context.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result=await page.evaluate(async()=>{
    const {loadNpcPopulation}=await import('/npc-factory/npc-population-loader.mjs');
    const {createNpcNavigator}=await import('/npc-factory/dev-navigation.mjs');
    const {createWasmWalkability,createWalkabilityExperiment}=await import('/npc-factory/wasm-walkability-p01.mjs');
    const {createPackedJsWalkability}=await import('/tests/wasm-p01/cached-js-control.mjs');
    const {batch,expansion}=await loadNpcPopulation({retryDelays:[]}),base=createNpcNavigator(batch),geometry=base.navigationGeometry();
    const disabled=createWalkabilityExperiment({navigator:base});await disabled.ready;
    if(disabled.status().state!=='DISABLED'||performance.getEntriesByType('resource').some(r=>r.name.endsWith('.wasm')))throw Error('default unexpectedly loads WASM');
    const a=performance.now(),kernel=await createWasmWalkability({geometry,fallback:base.walkable}),loadMs=performance.now()-a;
    const {bounds:b,cellSize}=geometry,width=Math.round((b.maxX-b.minX)/cellSize)+1,height=Math.round((b.maxZ-b.minZ)/cellSize)+1;
    const points=Array.from({length:width*height},(_,i)=>({x:b.minX+i%width*cellSize,z:b.minZ+Math.floor(i/width)*cellSize}));
    const control=createPackedJsWalkability({geometry,fallback:base.walkable}),expected=Uint8Array.from(points,p=>+base.walkable(p));
    for(const actual of [kernel.evaluate(points),control.evaluate(points)])if(actual.some((v,i)=>v!==expected[i]))throw Error('whole-grid mismatch');
    let injectedCalls=0;
    const accelerated=createNpcNavigator(batch,{walkabilityBatch:batch=>{injectedCalls++;return kernel.evaluate(batch);}});
    while(!accelerated.warmGrid(0)){}if(injectedCalls<2)throw Error('runtime batch not used');
    const failed=createWalkabilityExperiment({enabled:true,navigator:base,loader:args=>createWasmWalkability({...args,fetcher:async()=>new Response('',{status:404})})});
    await failed.ready;if(failed.status().state!=='FALLBACK'||failed.batch(points)!==null)throw Error('failed load blocked JS fallback');
    const corrupt=createWalkabilityExperiment({enabled:true,navigator:base,loader:args=>createWasmWalkability({...args,bytes:new Uint8Array([0,1,2])})});
    await corrupt.ready;if(corrupt.status().state!=='FALLBACK')throw Error('corrupt module did not fall back');
    const period=await import('/npc-factory/dev-runtime-state.mjs');
    const realPoints=period.snapshotForPeriod(batch,'morning').actors.map(a=>a.position).filter(Boolean);
    const timings=[];let checksum=0;
    const summarize=samples=>{const s=[...samples].sort((a,b)=>a-b);return{samplesMs:samples,p50Ms:s[15],p95Ms:s[28]};};
    for(const [name,input]of [['current-visible-NPCs',realPoints],['contiguous-256',points.slice(28000,28256)],['full-grid',points]]){
      const fns={JS:p=>Uint8Array.from(p,x=>+base.walkable(x)),cachedJS:p=>control.evaluate(p),WASM:p=>kernel.evaluate(p)},samples={JS:[],cachedJS:[],WASM:[]};
      for(let warm=0;warm<20;warm++)for(const fn of Object.values(fns))fn(input);
      const iterations=input.length>1000?1:100;
      for(let sample=0;sample<31;sample++){
        const keys=Object.keys(fns);keys.push(...keys.splice(0,sample%3));
        for(const key of keys){const start=performance.now();let result;for(let i=0;i<iterations;i++)result=fns[key](input);samples[key].push((performance.now()-start)/iterations);checksum+=result[0]??0;}
      }
      timings.push({name,count:input.length,iterations,...Object.fromEntries(Object.entries(samples).map(([k,v])=>[k,summarize(v)]))});
    }
    return{browser:navigator.userAgent,npcCount:batch.npcs.length,expansion,gridPoints:points.length,loadMs,resource:performance.getEntriesByType('resource').filter(r=>r.name.endsWith('.wasm')).map(r=>({duration:r.duration,transferSize:r.transferSize,encodedBodySize:r.encodedBodySize})),injectedCalls,checksum,timings,kernel:kernel.status(),scope:'OFFLINE_HTTP_REAL_WASM_AND_CANONICAL_GRID; NOT_FULL_GAME_OR_DEVICE_FPS'};
  });
  if(errors.length)throw Error(errors.join('\n'));
  await writeFile(`${out}/browser-result.json`,JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
