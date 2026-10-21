import { createPackedJsWalkability } from './cached-js-control.mjs';
import { readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { createWasmWalkability } from '../../npc-factory/wasm-walkability-p01.mjs';
import { createNpcNavigator } from '../../npc-factory/dev-navigation.mjs';
import { workloads, distribution } from './workloads.mjs';
import assert from 'node:assert/strict';
const {batch,navigator,geometry,metadata,cases}=await workloads();
const bytes=await readFile(new URL('../../npc-factory/wasm/walkability-p01.wasm',import.meta.url));
const kernel=await createWasmWalkability({geometry,fallback:navigator.walkable,bytes});
const packed=createPackedJsWalkability({geometry,fallback:navigator.walkable});
let checksum=0;
const consume=result=>{let sum=0;for(const value of result)sum+=value;checksum+=sum;};
const implementations={originalJS:points=>Uint8Array.from(points,p=>+navigator.walkable(p)),cachedGeometryJS:points=>packed.evaluate(points),wasmWholeCall:points=>kernel.evaluate(points)};
const results=[];
for(const {name,points} of cases){
  const expected=implementations.originalJS(points);
  assert.deepEqual(packed.evaluate(points),expected);assert.deepEqual(kernel.evaluate(points),expected);
  for(let i=0;i<20;i++)for(const fn of Object.values(implementations))consume(fn(points));
  const iterations=Math.max(1,Math.min(100,Math.floor(10000/points.length)));
  const times=Object.fromEntries(Object.keys(implementations).map(key=>[key,[]]));
  for(let sample=0;sample<31;sample++){
    // Rotate ordering to reduce monotonic thermal/JIT/order bias.
    const keys=Object.keys(implementations);keys.push(...keys.splice(0,sample%keys.length));
    for(const key of keys){const start=performance.now();let output;
      for(let i=0;i<iterations;i++)output=implementations[key](points);
      times[key].push((performance.now()-start)/iterations);consume(output);
    }
  }
  const stages={inputMs:[],kernelMs:[],outputAndFallbackMs:[],totalMs:[]};
  for(let sample=0;sample<31;sample++){const measured=kernel.measure(points);for(const key of Object.keys(stages))stages[key].push(measured[key]);consume(measured.result);}
  results.push({name,count:points.length,iterations,...Object.fromEntries(Object.entries(times).map(([key,values])=>[key,distribution(values)])),instrumentedStages:Object.fromEntries(Object.entries(stages).map(([key,values])=>[key,distribution(values)]))});
}
const full=cases.find(c=>c.name==='actual-full-grid').points;
const chunkTimes={originalJS:[],cachedGeometryJS:[],wasmWholeCall:[]};
for(let repetition=0;repetition<7;repetition++)for(let start=0;start<full.length;start+=256){
  const points=full.slice(start,start+256);
  for(const [key,fn]of Object.entries(implementations)){const a=performance.now();const result=fn(points);chunkTimes[key].push(performance.now()-a);consume(result);}
}
const actualWarmGrid={};
for(const mode of Object.keys(implementations)){
  const totals=[],slices=[];
  for(let sample=0;sample<15;sample++){
    const nav=createNpcNavigator(batch,{walkabilityBatch:mode==='originalJS'?null:implementations[mode]});
    const start=performance.now();let done=false;
    while(!done){const a=performance.now();done=nav.warmGrid(4);slices.push(performance.now()-a);}
    totals.push(performance.now()-start);
  }
  actualWarmGrid[mode]={totalCpu:distribution(totals),synchronous4msBudgetSlices:distribution(slices)};
}
const isolatedCold=[];
for(let i=0;i<7;i++){
  const modes=['originalJS','cachedGeometryJS','wasmWholeCall'];modes.push(...modes.splice(0,i%3));
  for(const mode of modes)isolatedCold.push(JSON.parse(execFileSync(process.execPath,[new URL('./cold.mjs',import.meta.url).pathname,mode],{encoding:'utf8'})));
}
const result={schema:'wasm-p01-benchmark/1',recordedAt:new Date().toISOString(),sourceBase:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,cpu:os.cpus()[0]?.model,platform:process.platform,arch:process.arch,metadata,wasmBytes:bytes.length,checksum,kernelStatus:kernel.status(),results,actualContiguousChunks:Object.fromEntries(Object.entries(chunkTimes).map(([key,values])=>[key,distribution(values)])),actualWarmGrid,isolatedCold};
const out=process.argv[2]??new URL('./results.json',import.meta.url);
await writeFile(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({...result,results:results.map(r=>({name:r.name,count:r.count,JS:r.originalJS.p50Ms,cachedJS:r.cachedGeometryJS.p50Ms,WASM:r.wasmWholeCall.p50Ms,wasmP95:r.wasmWholeCall.p95Ms,stages:Object.fromEntries(Object.entries(r.instrumentedStages).map(([k,v])=>[k,v.p50Ms]))})),actualContiguousChunks:Object.fromEntries(Object.entries(result.actualContiguousChunks).map(([k,{samplesMs,...v}])=>[k,v]))},null,2));
