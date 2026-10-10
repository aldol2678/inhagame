// Experimental opt-in batch-only kernel. Original walkable() remains the fallback and
// canonical owner of corridor overrides. No WASM is loaded on the default runtime path.
const MAX_POINTS = 1_000_000;
const MAX_BYTES = 64 * 1024 * 1024;
const finiteCoordinate = x => Number.isFinite(x) && Math.abs(x) <= 1e6;

export function packWalkabilityGeometry(geometry) {
  const { bounds:b, clearance, obstacles, pond } = geometry;
  if (![b.minX,b.maxX,b.minZ,b.maxZ,clearance].every(finiteCoordinate) ||
      b.minX>b.maxX || b.minZ>b.maxZ || clearance<0 || !Array.isArray(obstacles) || !pond?.length) throw Error('WASM_GEOMETRY');
  const columns=Math.ceil((b.maxX-b.minX)/8)+1,rows=Math.ceil((b.maxZ-b.minZ)/8)+1;
  if(columns*rows>1_000_000)throw Error('WASM_GEOMETRY_LIMIT');
  const bounds = ring => [Math.min(...ring.map(p=>p.x)),Math.max(...ring.map(p=>p.x)),Math.min(...ring.map(p=>p.z)),Math.max(...ring.map(p=>p.z))];
  const records=[],edges=[],buckets=Array.from({length:columns*rows},()=>[]);
  const add=(box,index)=>{
    const ring=box.polygon;
    if(ring?.some(p=>!finiteCoordinate(p.x)||!finiteCoordinate(p.z)))throw Error('WASM_GEOMETRY');
    const boxBounds=ring ? bounds(ring) : [box.minX,box.maxX,box.minZ,box.maxZ];
    if(!boxBounds.every(finiteCoordinate))throw Error('WASM_GEOMETRY');
    records.push(...boxBounds,edges.length/7,ring?.length??0);
    if(ring)for(let i=0;i<ring.length;i++){
      const a=ring[i],c=ring[(i+1)%ring.length],dx=c.x-a.x,dz=c.z-a.z,length=Math.hypot(dx,dz);
      edges.push(a.x,a.z,c.x,c.z,dx/length,dz/length,length);
    }
    if(index===0)return;
    const [minX,maxX,minZ,maxZ]=boxBounds;
    for(let row=Math.max(0,Math.floor((minZ-clearance-b.minZ)/8));row<=Math.min(rows-1,Math.floor((maxZ+clearance-b.minZ)/8));row++)
      for(let column=Math.max(0,Math.floor((minX-clearance-b.minX)/8));column<=Math.min(columns-1,Math.floor((maxX+clearance-b.minX)/8));column++)buckets[row*columns+column].push(index);
  };
  add({polygon:pond},0);obstacles.forEach((box,i)=>add(box,i+1));
  const indices=[],offsets=[0];for(const bucket of buckets){indices.push(...bucket);offsets.push(indices.length);}
  return {config:new Float64Array([b.minX,b.maxX,b.minZ,b.maxZ,clearance,columns,rows]),records:new Float64Array(records),edges:new Float64Array(edges),offsets:new Uint32Array(offsets),indices:new Uint32Array(indices)};
}

export async function createWasmWalkability({geometry,fallback,bytes,fetcher=globalThis.fetch}) {
  if(typeof fallback!=='function')throw Error('WASM_FALLBACK_REQUIRED');
  if(!bytes){const response=await fetcher(new URL('./wasm/walkability-p01.wasm',import.meta.url));if(!response.ok)throw Error(`WASM_HTTP_${response.status}`);bytes=await response.arrayBuffer();}
  const {instance}=await WebAssembly.instantiate(bytes);
  const {memory,classify,abi_version}=instance.exports;
  if(!(memory instanceof WebAssembly.Memory)||typeof classify!=='function'||abi_version?.()!==1)throw Error('WASM_ABI');
  const packed=packWalkabilityGeometry(geometry);let cursor=Number(instance.exports.__heap_base.value);
  const allocate=(length)=>{cursor=Math.ceil(cursor/8)*8;const ptr=cursor;cursor+=length;if(cursor>MAX_BYTES)throw Error('WASM_MEMORY_LIMIT');return ptr;};
  const pointers=Object.values(packed).map(array=>allocate(array.byteLength));
  const ensure=needed=>{if(needed>MAX_BYTES)throw Error('WASM_MEMORY_LIMIT');if(needed>memory.buffer.byteLength)memory.grow(Math.ceil((needed-memory.buffer.byteLength)/65536));};
  ensure(cursor);
  Object.values(packed).forEach((array,i)=>new Uint8Array(memory.buffer,pointers[i],array.byteLength).set(new Uint8Array(array.buffer)));
  const scratch=Math.ceil(cursor/8)*8;let fallbackPoints=0,calls=0;
  const prepare=points=>{
    if(!Array.isArray(points)||points.length>MAX_POINTS)throw Error('WASM_INPUT_LIMIT');
    const count=points.length,output=scratch+count*16;ensure(output+count);
    const input=new Float64Array(memory.buffer,scratch,count*2);
    for(let i=0;i<count;i++){input[2*i]=Number.isFinite(points[i].x)?points[i].x:NaN;input[2*i+1]=Number.isFinite(points[i].z)?points[i].z:NaN;}
    return {count,output};
  };
  const execute=({count,output})=>classify(...pointers,scratch,count,output);
  const read=(points,{count,output})=>{
    const result=new Uint8Array(memory.buffer,output,count).slice();
    for(let i=0;i<count;i++)if(result[i]>1){fallbackPoints++;result[i]=+fallback(points[i]);}
    return result;
  };
  return {
    evaluate(points){const input=prepare(points);execute(input);calls++;return read(points,input);},
    // Benchmark stages are explicit and include copying plus canonical exception handling.
    measure(points){const a=performance.now(),input=prepare(points),b=performance.now();execute(input);const c=performance.now();const result=read(points,input),d=performance.now();return {inputMs:b-a,kernelMs:c-b,outputAndFallbackMs:d-c,totalMs:d-a,result};},
    status:()=>({calls,fallbackPoints,memoryBytes:memory.buffer.byteLength,geometryBytes:scratch-Number(instance.exports.__heap_base.value)})
  };
}

export function createWalkabilityExperiment({enabled=false,navigator,loader=createWasmWalkability}) {
  let state=enabled?'LOADING':'DISABLED',kernel=null,error=null;
  const ready=enabled ? Promise.resolve().then(()=>loader({geometry:navigator.navigationGeometry(),fallback:point=>navigator.walkable(point)})).then(value=>{if(state==='LOADING'){kernel=value;state='READY';}}).catch(e=>{if(state==='LOADING'){state='FALLBACK';error=String(e.message??e);}}) : Promise.resolve();
  return {ready,batch(points){if(state!=='READY')return null;try{return kernel.evaluate(points);}catch(e){state='FALLBACK';error=String(e.message??e);kernel=null;return null;}},
    status:()=>({state,error,...kernel?.status()}),destroy(){state='DESTROYED';kernel=null;}};
}
