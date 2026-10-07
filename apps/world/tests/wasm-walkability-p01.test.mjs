import { createPackedJsWalkability } from './wasm-p01/cached-js-control.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWasmWalkability, createWalkabilityExperiment } from '../npc-factory/wasm-walkability-p01.mjs';
import { createNpcNavigator } from '../npc-factory/dev-navigation.mjs';
import { workloads } from './wasm-p01/workloads.mjs';
const bytes = () => readFile(new URL('../npc-factory/wasm/walkability-p01.wasm', import.meta.url));
const data = await workloads();
const load = async () => createWasmWalkability({ geometry:data.geometry, fallback:point=>data.navigator.walkable(point), bytes:await bytes() });

test('real C++ WASM is equivalent across current population, all grid cells and invalid points', async()=>{
  const kernel=await load();
  for(const {name,points} of data.cases){
    assert.deepEqual(kernel.evaluate(points),Uint8Array.from(points,p=>+data.navigator.walkable(p)),name);
  }
  const invalid=[{x:NaN,z:0},{x:Infinity,z:0},{x:0,z:-Infinity},{x:1e100,z:-1e100},{x:'0',z:0},{x:null,z:0},{x:true,z:0},{x:0,z:''},{x:0,z:false},{x:0n,z:0}];
  assert.deepEqual(kernel.evaluate(invalid),new Uint8Array(invalid.length));
  assert.deepEqual(kernel.evaluate([]),new Uint8Array());
});

test('real WASM preserves strict clearance, polygon edges, bucket borders and graph overrides', async()=>{
  const kernel=await load(),points=[];
  const {bounds:b,clearance:r,obstacles,pond}=data.geometry;
  for(const ring of [pond,...obstacles.map(o=>o.polygon).filter(Boolean)]){
    for(let i=0;i<ring.length;i++){
      const a=ring[i],c=ring[(i+1)%ring.length];
      for(const t of [0,.5,1]) for(const epsilon of [-1e-8,-1e-12,0,1e-12,1e-8]){
        points.push({x:a.x+(c.x-a.x)*t+r+epsilon,z:a.z+(c.z-a.z)*t});
      }
    }
  }
  for(let x=b.minX;x<=b.maxX;x+=8)for(let z=b.minZ;z<=b.maxZ;z+=8)points.push({x,z});
  assert.deepEqual(kernel.evaluate(points),Uint8Array.from(points,p=>+data.navigator.walkable(p)));
  assert.ok(kernel.status().fallbackPoints>0,'graph/numerical fallback must actually execute');
});

test('results own memory and grow safely across repeated and large calls',async()=>{
  const kernel=await load(),small=data.cases[0].points;
  const first=kernel.evaluate(small),copy=first.slice();
  const large=Array.from({length:100000},(_,i)=>small[i%small.length]);
  const output=kernel.evaluate(large);
  assert.equal(output.length,large.length);
  for(let i=0;i<output.length;i++)assert.equal(output[i],copy[i%small.length]);
  assert.deepEqual(first,copy);
  assert.deepEqual(kernel.evaluate(small),copy);
});

test('disabled/load-failed/runtime-failed experiment keeps exact JS fallback',async()=>{
  let loads=0;
  const disabled=createWalkabilityExperiment({enabled:false,navigator:data.navigator,loader:async()=>{loads++;throw Error('unused')}});
  await disabled.ready;
  assert.equal(disabled.batch(data.cases[0].points),null);
  assert.equal(loads,0);
  const failed=createWalkabilityExperiment({enabled:true,navigator:data.navigator,loader:async()=>{throw Error('missing')}});
  await failed.ready;
  assert.equal(failed.status().state,'FALLBACK');assert.equal(failed.batch([]),null);
  const trap=createWalkabilityExperiment({enabled:true,navigator:data.navigator,loader:async()=>({evaluate:()=>{throw Error('trap')},status:()=>({})})});
  await trap.ready;assert.equal(trap.batch([{}]),null);assert.equal(trap.status().state,'FALLBACK');
});

test('destroy while loading rejects late adoption and invalid binaries fail',async()=>{
  let release;
  const experiment=createWalkabilityExperiment({enabled:true,navigator:data.navigator,loader:()=>new Promise(resolve=>{release=resolve})});
  await Promise.resolve();experiment.destroy();release({evaluate:()=>new Uint8Array([1]),status:()=>({})});
  await experiment.ready;assert.equal(experiment.status().state,'DESTROYED');assert.equal(experiment.batch([{}]),null);
  await assert.rejects(createWasmWalkability({geometry:data.geometry,fallback:data.navigator.walkable,bytes:new Uint8Array([0,1,2])}));
});

test('actual warmGrid batch hook is optional and failed batches use original JS',()=>{
  let called=0;
  const geometry=data.geometry;
  const anchors=[{x:geometry.bounds.minX+15,z:geometry.bounds.minZ+15},{x:geometry.bounds.maxX-15,z:geometry.bounds.maxZ-15}];
  const base=createNpcNavigator(null,{additionalAnchors:anchors});
  const injected=createNpcNavigator(null,{additionalAnchors:anchors,walkabilityBatch:points=>{called++;return Uint8Array.from(points,p=>+base.walkable(p));}});
  injected.warmGrid();assert.ok(called>1);
  const failed=createNpcNavigator(null,{additionalAnchors:anchors,walkabilityBatch:()=>{throw Error('unavailable')}});
  assert.equal(failed.warmGrid(),true);
  const p=data.cases[0].points[0];
  assert.deepEqual(injected.route(p,p),base.route(p,p));assert.deepEqual(failed.route(p,p),base.route(p,p));
});

test('cached JS control matches unchanged canonical JS on every workload',()=>{
  const control=createPackedJsWalkability({geometry:data.geometry,fallback:data.navigator.walkable});
  for(const {name,points} of data.cases)assert.deepEqual(control.evaluate(points),Uint8Array.from(points,p=>+data.navigator.walkable(p)),name);
});

test('runtime opt-in is lazy, non-blocking, disposable and disabled by default',async()=>{
  const source=await readFile(new URL('../npc-factory/dev-runtime.mjs',import.meta.url),'utf8');
  assert.match(source,/get\('npcWalkabilityWasm'\) === '1'/);
  assert.match(source,/import\('\.\/wasm-walkability-p01\.mjs'\)/);
  assert.match(source,/walkabilityBatch: wasmWalkabilityEnabled/);
  assert.match(source,/__NPC_WALKABILITY_WASM_P01__/);
  assert.doesNotMatch(source,/await (import\('\.\/wasm-walkability|wasmWalkabilityExperiment\.ready)/);
});

test('real WASM batches preserve eager/sliced routes and can start after partial JS warm-up',async()=>{
  const anchors=[{x:data.geometry.bounds.minX+15,z:data.geometry.bounds.minZ+15},{x:data.geometry.bounds.maxX-15,z:data.geometry.bounds.maxZ-15}];
  let kernel=null,calls=0;
  const accelerated=createNpcNavigator(null,{additionalAnchors:anchors,walkabilityBatch:points=>{calls++;return kernel?.evaluate(points)??null;}});
  assert.equal(accelerated.warmGrid(0),false);
  kernel=await createWasmWalkability({geometry:accelerated.navigationGeometry(),fallback:accelerated.walkable,bytes:await bytes()});
  while(!accelerated.warmGrid(0)){}
  assert.ok(calls>2);assert.equal(accelerated.warmGrid(0),true);
  const base=createNpcNavigator(null,{additionalAnchors:anchors});
  const points=data.cases[1].points;
  for(let i=0;i<6;i++)assert.deepEqual(accelerated.route(points[i],points[i+1]),base.route(points[i],points[i+1]),`route ${i}`);
  for(const count of [0,1,255,256,257])assert.deepEqual(kernel.evaluate(points.slice(0,1).flatMap(p=>Array.from({length:count},()=>p))),new Uint8Array(count).fill(+base.walkable(points[0])));
});

test('malformed batch outputs never enter the grid',()=>{
  const anchors=[{x:0,z:0},{x:20,z:20}];
  for(const bad of [()=>[],()=>new Uint8Array([1]),points=>new Uint8Array(points.length).fill(2)]){
    const base=createNpcNavigator(null,{additionalAnchors:anchors});
    const candidate=createNpcNavigator(null,{additionalAnchors:anchors,walkabilityBatch:bad});
    assert.equal(candidate.warmGrid(),true);
    assert.deepEqual(candidate.route(anchors[0],anchors[1]),base.route(anchors[0],anchors[1]));
  }
});

test('committed source, build script and actual WASM match the reproducible build manifest',async()=>{
  const {createHash}=await import('node:crypto');
  const root=new URL('../npc-factory/wasm/',import.meta.url),manifest=JSON.parse(await readFile(new URL('walkability-p01.build.json',root),'utf8'));
  for(const [file,expected] of Object.entries(manifest.files))assert.equal(createHash('sha256').update(await readFile(new URL(file,root))).digest('hex'),expected,file);
  assert.equal(manifest.abi,1);assert.equal(manifest.runtimeImports,0);
});

test('rotated pond clearance uses perpendicular epsilon probes and cannot be graph-overridden',async()=>{
  const pond=[{x:-2,z:0},{x:0,z:2},{x:2,z:0},{x:0,z:-2},{x:-2,z:0}];
  const {polygonOverlap}=await import('../src/polygon-collision.js');
  const geometry={bounds:{minX:-5,maxX:5,minZ:-5,maxZ:5},clearance:.6,pond,obstacles:[]};
  const fallback=({x,z})=>Number.isFinite(x)&&Number.isFinite(z)&&x>=-5&&x<=5&&z>=-5&&z<=5&&!polygonOverlap(x,z,pond,.6);
  const kernel=await createWasmWalkability({geometry,fallback,bytes:await bytes()}),points=[];
  for(let i=0;i<4;i++){
    const a=pond[i],b=pond[i+1],dx=b.x-a.x,dz=b.z-a.z,length=Math.hypot(dx,dz);
    for(const t of [0,.5,1])for(const sign of [-1,1])for(const epsilon of [-1e-8,-1e-12,0,1e-12,1e-8])points.push({x:a.x+dx*t+sign*(.6+epsilon)*dz/length,z:a.z+dz*t-sign*(.6+epsilon)*dx/length});
  }
  assert.deepEqual(kernel.evaluate(points),Uint8Array.from(points,p=>+fallback(p)));
  assert.ok(kernel.status().fallbackPoints>0,'pond boundary invokes the original strict predicate');
});
