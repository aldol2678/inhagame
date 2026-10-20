import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {FactoryAssetBridge,parseFactoryInventory,inspectGlb} from '../src/asset-factory-bridge.mjs';
import {makeStudioAssetZip} from '../src/asset-archive.mjs';
import {WorldSceneAdapter} from '../src/world-scene-adapter.mjs';
import {makeMock} from './fixture.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const glb=()=>{
 const json=Buffer.from(JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[0]}],nodes:[{name:'sample',mesh:0}],meshes:[{primitives:[]}]}));
 const padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
 const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(20+padded.length,8);header.writeUInt32LE(padded.length,12);header.writeUInt32LE(0x4e4f534a,16);
 return Buffer.concat([header,padded]);
};
const make=(filename='sample.glb')=>{
 const bytes=glb(),a={id:'sample-01',file:'assets/'+filename,byte_size:bytes.length,sha256:sha(bytes),status:'PASS'};
 return {bytes,file:filename,manifest:{project_id:'factory_20261021',assets:[a]},contentsBase64:bytes.toString('base64')};
};
test('v5.1 metadata path contract and duplicate rejection',()=>{
 const {manifest}=make();assert.equal(parseFactoryInventory(manifest).assets.length,1);
 assert.throws(()=>parseFactoryInventory({...manifest,assets:[manifest.assets[0],manifest.assets[0]]}),/E_FACTORY_DUPLICATE/);
 assert.throws(()=>parseFactoryInventory({...manifest,assets:[{...manifest.assets[0],file:'../escape.glb'}]}),/E_FACTORY_ASSET_INVALID/);
 assert.throws(()=>parseFactoryInventory({...manifest,assets:[{...manifest.assets[0],file:'assets/evil.svg'}]}),/E_FACTORY_ASSET_INVALID|E_IMPORT_TYPE/);
});
test('verified GLB import registers world asset and preserves exact original bytes',()=>{
 const port=new WorldSceneAdapter(makeMock()),bridge=new FactoryAssetBridge(port),m=make();
 const r=bridge.import(m);assert.equal(r.content_integrity,'PASS');assert.equal(r.engine_import_qa,'UNKNOWN');assert.equal(r.rights_qa,'UNKNOWN');
 assert.equal(r.structure.meshCount,1);assert.equal(bridge.get(r.assetId).bytes.equals(m.bytes),true);
 assert.equal(port.world.snapshot().assets[0].uri,r.uri);
 assert.equal(bridge.import(m).alreadyImported,true);
 assert.equal(bridge.list().length,1);
 const exported=JSON.parse(port.exportWorld());assert.equal(exported.assets[0].id,r.assetId);
 const zip=makeStudioAssetZip(port.exportWorld(),[{...r,bytes:m.bytes}]);assert.equal(zip.readUInt32LE(0),0x04034b50);
 assert.ok(zip.includes(Buffer.from('assets/'+sha(m.bytes)+'.glb')));
 assert.ok(zip.includes(m.bytes));
});
test('tampered hash/size, missing inventory, FAIL, unsafe SVG and external URI reject atomically',()=>{
 const port=new WorldSceneAdapter(makeMock()),bridge=new FactoryAssetBridge(port),m=make(),serial=port.read().revisionToken;
 const bad=[
 {...m,contentsBase64:Buffer.from('corrupt').toString('base64')},
 {...m,manifest:{...m.manifest,assets:[{...m.manifest.assets[0],byte_size:100}]}},
 {...m,manifest:{...m.manifest,assets:[{...m.manifest.assets[0],sha256:'0'.repeat(64)}]}},
 {...m,manifest:{...m.manifest,assets:[{...m.manifest.assets[0],status:'FAIL'}]}},
 {...m,file:'attack.svg'}];
 for(const c of bad)assert.throws(()=>bridge.import(c));
 assert.equal(port.read().revisionToken,serial);assert.equal(bridge.list().length,0);
 const bytes=glb(),json=Buffer.from(JSON.stringify({asset:{version:'2.0'},nodes:[],scenes:[],buffers:[{uri:'https://evil.example/a.bin'}]}));
 const padded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,0x20)]);
 const invalid=Buffer.alloc(20);invalid.write('glTF');invalid.writeUInt32LE(2,4);invalid.writeUInt32LE(20+padded.length,8);invalid.writeUInt32LE(padded.length,12);invalid.writeUInt32LE(0x4e4f534a,16);
 assert.throws(()=>inspectGlb(Buffer.concat([invalid,padded])),/E_GLB_EXTERNAL_URI/);
});
test('Archive rejects user path and duplicate, no path traversal',()=>{
 assert.throws(()=>makeStudioAssetZip('{}',[{uri:'../evil.glb',bytes:Buffer.from([1])}]),/E_ARCHIVE_PATH/);
 const b=Buffer.from([1]);assert.throws(()=>makeStudioAssetZip('{}',[{uri:'assets/'+('a'.repeat(64))+'.glb',bytes:b},{uri:'assets/'+('a'.repeat(64))+'.glb',bytes:b}]),/E_ARCHIVE_DUP/);
});
const launch=async(flags,fn)=>{
 const runner=spawn(process.execPath,['bin/dev-server.mjs','--demo','--port','0',...flags],{cwd:new URL('..',import.meta.url),stdio:['ignore','pipe','pipe']});
 let output='';const port=await Promise.race([
 new Promise((yes,no)=>{runner.stdout.on('data',b=>{output+=b.toString();const found=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(found)yes(found[0]);});runner.on('exit',code=>no(Error('server exited '+code+output)));}),
 new Promise((_,no)=>setTimeout(()=>no(Error('server timeout')),8000))
 ]);
 try{await fn(port);}finally{runner.kill('SIGTERM');}
};
test('Local HTTP import guards, Factory verification and portable ZIP export',async()=>{
 const m=make();
 await launch(['--allow-write'],async host=>{
  const request=(payload,headers={})=>fetch(host+'/api/assets/import',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(payload)});
  const forbidden=await request(m,{Origin:'https://other.example'});assert.equal(forbidden.status,403);
  const imported=await request(m);assert.equal(imported.status,200);const a=await imported.json();assert.equal(a.content_integrity,'PASS');
  const listings=await (await fetch(host+'/api/assets')).json();assert.equal(listings.assets.length,1);assert.equal(listings.assets[0].assetId,a.assetId);
  const dl=await fetch(host+'/api/assets/'+a.assetId);assert.equal(dl.status,200);assert.ok(Buffer.from(await dl.arrayBuffer()).equals(m.bytes));
  const bundle=await fetch(host+'/api/assets/package');assert.equal(bundle.status,200);
  const zip=Buffer.from(await bundle.arrayBuffer());assert.equal(zip.readUInt32LE(0),0x04034b50);
  assert.ok(zip.includes(m.bytes));
  const world=await (await fetch(host+'/api/export')).json();assert.equal(world.assets.length,1);
 });
 await launch([],async host=>{
  const response=await fetch(host+'/api/assets/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(m)});
  assert.equal(response.status,403);
 });
});
