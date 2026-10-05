// Explicit temporary mutation proof. Run serially; original bytes restored in finally.
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
const run=()=>spawnSync(process.execPath,['--test','--test-reporter=tap','apps/world/tests/spatial-architecture.test.mjs','apps/world/tests/view-distance.test.mjs'],{encoding:'utf8'});
assert.equal(run().status,0,'baseline must pass before mutation');
const cases=[
  ['Agora mapped to Gate','place-zone-registry.js',"['AREA_AGORA_6_9','아고라·6·9호관'","['AREA_MAIN_GATE','아고라·6·9호관'",'semantic landmarks'],
  ['hysteresis removed','render-chunk-streaming.js','previous===ChunkState.UNLOADED?policy.load:policy.unload','policy.load','load/unload hysteresis'],
  ['center distance substituted','render-chunk-registry.js','Math.hypot(Math.max(b.minX-p.x,0,p.x-b.maxX),Math.max(b.minZ-p.z,0,p.z-b.maxZ))','Math.hypot((b.minX+b.maxX)/2-p.x,(b.minZ+b.maxZ)/2-p.z)','chunk distance'],
  ['Place ID tied to render namespace','place-zone-registry.js','return result;','return result ? {...result,id:"RC_0_0"} : null;','place events'],
  ['compatibility mapping removed','legacy-zone-compat.js',"C01_GATE:'AREA_MAIN_GATE', ",'','legacy mapping'],
  ['MAX removes distant campus vista','view-distance.js',"MAX: preset('MAX','최대',104,128,200,232,campusSpan,campusSpan+32)","MAX: {...preset('MAX','최대',104,128,200,232,campusSpan,campusSpan+32),preserveCampus:false}",'MAX keeps distant campus vista'],
  ['preset change destroys all resident handles','render-chunk-streaming.js','this.policy=policy;\n    this.renderer.setViewPolicy',"this.policy=policy;\n    for(const r of this.runtime.values())if(r.handle){this.renderer.destroy(r.handle);r.handle=null;r.state='UNLOADED';}\n    this.renderer.setViewPolicy",'preset switches reconcile']
];
for(const [name,file,from,to,expected] of cases){
  const path=new URL(`./src/${file}`,import.meta.url),original=readFileSync(path),source=original.toString().replaceAll('\r\n','\n');
  assert.equal(source.split(from).length,2,`unique mutation target ${name}`);
  try{
    writeFileSync(path,source.replace(from,to));const result=run();
    assert.notEqual(result.status,0,`${name} escaped tests`);
    assert.match(result.stdout,new RegExp(`not ok [^\\n]*${expected}`),`${name} must fail a behavioral assertion, not syntax/import`);
    console.log(`KILLED: ${name}`);
  }finally{writeFileSync(path,original);}
  assert.deepEqual(readFileSync(path),original);
}
assert.equal(run().status,0,'restored baseline must pass');
console.log(`${cases.length}/${cases.length} mutations detected; original bytes restored; baseline PASS`);
