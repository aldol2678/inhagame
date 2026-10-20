import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createLegacyPort} from '../src/bootstrap.mjs';
import {FactoryAssetBridge} from '../src/asset-factory-bridge.mjs';
import {makeStudioAssetZip} from '../src/asset-archive.mjs';
const editorDir=process.env.INHA_WORLD_EDITOR_DIR;
if(!editorDir)throw Error('E_LEGACY_SOURCE_REQUIRED');
function fixture(){
 const raw=Buffer.from(JSON.stringify({asset:{version:'2.0'},scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[]}]}));const pad=Buffer.concat([raw,Buffer.alloc((4-raw.length%4)%4,32)]);
 const h=Buffer.alloc(20);h.write('glTF');h.writeUInt32LE(2,4);h.writeUInt32LE(20+pad.length,8);h.writeUInt32LE(pad.length,12);h.writeUInt32LE(0x4e4f534a,16);return Buffer.concat([h,pad]);
}
test('REAL Factory GLB import, entity reference, export and undo/redo',async()=>{
 const port=await createLegacyPort(editorDir),bridge=new FactoryAssetBridge(port),bytes=fixture(),sha=createHash('sha256').update(bytes).digest('hex');
 const input={file:'hanok.glb',contentsBase64:bytes.toString('base64'),manifest:{project_id:'p2_test',assets:[{id:'hanok',file:'assets/hanok.glb',byte_size:bytes.length,sha256:sha,status:'PASS'}]}};
 const registered=bridge.import(input);
 assert.equal(port.world.snapshot().assets.length,1);
 assert.equal(registered.content_integrity,'PASS');
 const node={id:'hanok.placed',name:'Hanok',kind:'prop',transform:{position:[1,2,3],rotation:[0,0,0,1],scale:[1,1,1]},components:{'core.renderable':{assetId:registered.assetId}},metadata:{source:'local-test'}};
 const command={commandId:'p2.node.place',expectedRevision:port.read().revisionToken,operation:'node.create',payload:node};
 assert.equal((await port.dispatch(command)).status,'applied');
 let world=port.parseWorld(port.exportWorld());
 assert.equal(world.entities[0].components['core.renderable'].assetId,registered.assetId);
 assert.equal(world.assets[0].uri,'assets/'+sha+'.glb');
 const zip=makeStudioAssetZip(port.exportWorld(),bridge.list().map(r=>({...r,bytes:bridge.get(r.assetId).bytes})));
 assert.ok(zip.includes(bytes));assert.ok(zip.includes(Buffer.from('world.json')));
 await port.undo(port.read().revisionToken);
 assert.equal(port.world.snapshot().entities.length,0);assert.equal(bridge.list().length,1);
 await port.undo(port.read().revisionToken);
 assert.equal(port.world.snapshot().assets.length,0);assert.equal(bridge.list().length,0);
 assert.equal(bridge.get(registered.assetId),null);
 assert.equal(bridge.import(input).recoveredAfterUndo,true);
 assert.equal(port.world.snapshot().assets.length,1);
 assert.equal(bridge.list().length,1);
 world=port.parseWorld(port.exportWorld());assert.equal(world.assets[0].metadata.rightsQa,'UNKNOWN');
});
