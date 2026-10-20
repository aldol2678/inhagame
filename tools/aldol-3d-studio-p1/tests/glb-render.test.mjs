import test from 'node:test';
import assert from 'node:assert/strict';
import {geometryFixture,packGlb} from './glb-fixture.mjs';
import {validateRenderGlb} from '../web/glb-contract.mjs';
import {inspectGlb,FactoryAssetBridge} from '../src/asset-factory-bridge.mjs';
import {makeStudioAssetZip,readStudioAssetZip} from '../src/asset-archive.mjs';
import {WorldSceneAdapter} from '../src/world-scene-adapter.mjs';
import {makeMock} from './fixture.mjs';

test('actual indexed geometry, embedded texture, materials and hierarchy satisfy render profile',()=>{
 const f=geometryFixture();assert.deepEqual(validateRenderGlb(f.bytes),{meshes:2,primitives:2,vertices:36,indices:36,materials:2,textures:1,nodes:4,instanceVertices:36,instancePrimitives:2,texturePixels:4});assert.equal(inspectGlb(f.bytes).meshCount,2);
});
test('corrupt BIN, accessor bounds, index range and nonfinite vertices rejected before engine parsing',()=>{
 const cases=[d=>d.buffers[0].byteLength+=100,d=>d.bufferViews[0].byteLength=4,d=>d.accessors[0].count=1000001,d=>d.accessors[0].byteOffset=2,d=>d.accessors[0].sparse={},(d,b)=>b.writeUInt16LE(99,d.bufferViews[3].byteOffset),(d,b)=>b.writeFloatLE(Infinity,0)];
 for(const edit of cases){const f=geometryFixture(edit);assert.throws(()=>validateRenderGlb(f.bytes),/E_GLB_/);assert.throws(()=>inspectGlb(f.bytes),/E_GLB_/);}
 const f=geometryFixture();assert.throws(()=>validateRenderGlb(f.bytes.subarray(0,-4)),/E_GLB_HEADER/);
});
test('external resources, optional extensions, animated/compressed and pathological graphs fail closed',()=>{
 const cases=[d=>d.images[0].uri='https://evil.example/a.png',d=>d.buffers[0].uri='file:///etc/passwd',d=>d.extensionsUsed=['KHR_draco_mesh_compression'],d=>d.materials[0].extensions={EXT_remote:{uri:'https://evil.example'}},d=>d.animations=[{}],d=>d.nodes[3].children=[0],d=>d.nodes[0].children=[1,1],d=>d.meshes[0].primitives[0].mode=1,d=>d.textures[0].source=99,(d,b)=>b.writeUInt32BE(65535,d.bufferViews[4].byteOffset+16)];
 for(const edit of cases)assert.throws(()=>validateRenderGlb(geometryFixture(edit).bytes),/E_GLB_/);
});
test('render rejection leaves world history and verified byte cache unchanged',()=>{
 const port=new WorldSceneAdapter(makeMock()),bridge=new FactoryAssetBridge(port),before=port.read().revisionToken;
 assert.throws(()=>bridge.import(geometryFixture(d=>d.accessors[0].count=1000000)),/E_GLB_/);assert.equal(port.read().revisionToken,before);assert.equal(bridge.list().length,0);
});
test('portable ZIP parses in memory, preserves bytes, and restores verified cache into a new world',()=>{
 const port=new WorldSceneAdapter(makeMock()),bridge=new FactoryAssetBridge(port),f=geometryFixture(),r=bridge.import(f);
 const zip=makeStudioAssetZip(port.exportWorld(),[{...r,bytes:f.bytes}]),files=readStudioAssetZip(zip);
 assert.ok(files.get(r.uri).equals(f.bytes));const mock=makeMock();mock.world.data=JSON.parse(files.get('world.json'));const next=new FactoryAssetBridge(new WorldSceneAdapter(mock));next.restore(files);assert.equal(next.get(r.assetId).sha256,f.digest);
 const tampered=new Map(files);tampered.set(r.uri,Buffer.from('broken'));assert.throws(()=>next.restore(tampered),/E_ARCHIVE_ASSET_MISMATCH/);assert.equal(next.get(r.assetId).sha256,f.digest);
});
test('ZIP CRC corruption, traversal, missing/extra entries and compressed formats rejected',()=>{
 const p=new WorldSceneAdapter(makeMock()),b=new FactoryAssetBridge(p),f=geometryFixture(),r=b.import(f);const zip=makeStudioAssetZip(p.exportWorld(),[{...r,bytes:f.bytes}]);
 const corrupt=Buffer.from(zip);corrupt[40]^=1;assert.throws(()=>readStudioAssetZip(corrupt),/E_ARCHIVE_CRC/);
 const slip=Buffer.from(zip);const dir=slip.readUInt32LE(slip.length-6);const off=slip.indexOf('assets/',dir);slip.write('../bad/',off);assert.throws(()=>readStudioAssetZip(slip),/E_ARCHIVE_PATH/);
 const compressed=Buffer.from(zip);compressed.writeUInt16LE(8,8);assert.throws(()=>readStudioAssetZip(compressed),/E_ARCHIVE_INVALID/);
 const files=readStudioAssetZip(zip);files.delete(r.uri);assert.throws(()=>b.restore(files),/E_ARCHIVE_ASSET_MISMATCH/);
 const extra=readStudioAssetZip(zip);extra.set('assets/'+'0'.repeat(64)+'.glb',f.bytes);assert.throws(()=>b.restore(extra),/E_ARCHIVE_UNRESOLVED/);
});

test('aliased accessors and repeated mesh nodes have independent resource budgets',()=>{
 const f=geometryFixture();f.doc.buffers[0].byteLength=12000;f.doc.bufferViews[0].byteLength=12000;
 f.doc.accessors=Array.from({length:4096},()=>({...f.doc.accessors[0],count:1000}));
 assert.throws(()=>validateRenderGlb(packGlb(f.doc,Buffer.alloc(12000))),/E_GLB_ACCESSOR_LIMIT/);
 const instances=geometryFixture(d=>{d.meshes[0].primitives=Array.from({length:5},()=>({...d.meshes[0].primitives[0]}));d.nodes=Array.from({length:512},()=>({mesh:0}));d.scenes[0].nodes=d.nodes.map((_,i)=>i);});
 assert.throws(()=>validateRenderGlb(instances.bytes),/E_GLB_INSTANCE_LIMIT/);
});
