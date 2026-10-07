import {readFile} from 'node:fs/promises';
import {createWasmWalkability} from '../../npc-factory/wasm-walkability-p01.mjs';
import {createNpcNavigator} from '../../npc-factory/dev-navigation.mjs';
import {createPackedJsWalkability} from './cached-js-control.mjs';
import {workloads} from './workloads.mjs';
// Every implementation gets its own fresh process. Common campus context preparation
// is excluded equally. Disk cache is not flushed; network latency is not measured.
const mode=process.argv[2]??'wasmWholeCall';
const {batch,navigator,geometry}=await workloads();
let kernel=null,diskReadMs=0;
const a=performance.now();
if(mode==='wasmWholeCall'){
  const bytes=await readFile(new URL('../../npc-factory/wasm/walkability-p01.wasm',import.meta.url));
  diskReadMs=performance.now()-a;kernel=await createWasmWalkability({geometry,fallback:navigator.walkable,bytes});
}else if(mode==='cachedGeometryJS')kernel=createPackedJsWalkability({geometry,fallback:navigator.walkable});
else if(mode!=='originalJS')throw Error('unknown mode');
const b=performance.now();
const target=createNpcNavigator(batch,{walkabilityBatch:kernel?points=>kernel.evaluate(points):null});
const c=performance.now(),slices=[];let done=false;
while(!done){const start=performance.now();done=target.warmGrid(4);slices.push(performance.now()-start);}
const d=performance.now();
console.log(JSON.stringify({mode,diskReadMs,loadCompileInstantiatePackMs:b-a,navigatorSetupMs:c-b,firstGridCpuMs:d-c,totalMs:d-a,synchronous4msBudgetSlices:slices,...kernel?.status?.()}));
