import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {join,resolve} from 'node:path';
import {WorldSceneAdapter} from '../src/world-scene-adapter.mjs';
const dir=resolve(process.env.INHA_WORLD_EDITOR_DIR);
const [{WorldDocument,createEmptyWorld},{EditorCommands},{serializeWorld,parseWorld},{validateWorld}]=await Promise.all([
 'world-document.js','editor-commands.js','world-serialization.js','world-schema.js'
].map(n=>import(pathToFileURL(join(dir,n)).href)));
const transform={position:[0,1,2],rotation:[0,0,0,1],scale:[1,1,1]};
function setup(){const world=new WorldDocument(createEmptyWorld({worldId:'studio.test',name:'test'}));const state={selectedEntityId:null,select(id){this.selectedEntityId=id;},clearSelection(){this.selectedEntityId=null;}};const commands=new EditorCommands(world,state);return {world,commands,port:new WorldSceneAdapter({world,commands,serializeWorld,parseWorld,validateWorld})};}
let seq=0;
const cmd=(p,operation,payload,targetId)=>({commandId:`real.${++seq}`,expectedRevision:p.read().revisionToken,operation,payload,...(targetId?{targetId}:{})});
const en=(id,more={})=>({id,name:id,kind:'prop',transform,components:{'user.keep':{payload:42}},...more});
const add=(p,id='a',more={})=>p.dispatch(cmd(p,'node.create',en(id,more)));
test('R01 real WorldDocument roundtrip, unknown namespaced component',async()=>{const {port:p}=setup();assert.equal((await add(p)).status,'applied');assert.equal(parseWorld(p.exportWorld()).entities[0].components['user.keep'].payload,42);});
test('R02 real create transform undo redo',async()=>{const {port:p,world}=setup();await add(p);assert.equal((await p.dispatch(cmd(p,'node.transform',{transform:{...transform,position:[2,3,4]}},'a'))).status,'applied');await p.undo(p.read().revisionToken);assert.deepEqual(world.getEntity('a').transform.position,transform.position);await p.redo(p.read().revisionToken);assert.deepEqual(world.getEntity('a').transform.position,[2,3,4]);});
test('R03 real cycle, missing parent and parent delete reject atomically',async()=>{const {port:p,commands}=setup();await add(p);await add(p,'b',{parentId:'a'});const n=commands.undoStack.length;assert.equal((await p.dispatch(cmd(p,'node.reparent',{parentId:'b'},'a'))).status,'rejected');assert.equal((await p.dispatch(cmd(p,'node.reparent',{parentId:'missing'},'a'))).status,'rejected');assert.equal((await p.dispatch(cmd(p,'node.delete',{},'a'))).status,'rejected');assert.equal(commands.undoStack.length,n);});
test('R04 real scale invalid and quaternion canonical',async()=>{const {port:p,world}=setup();await add(p);assert.equal((await p.dispatch(cmd(p,'node.transform',{transform:{...transform,scale:[0,1,1]}},'a'))).status,'rejected');assert.equal((await p.dispatch(cmd(p,'node.transform',{transform:{...transform,rotation:[0,0,0,2],position:[3,1,2]}},'a'))).status,'applied');assert.deepEqual(world.getEntity('a').transform.rotation,[0,0,0,1]);});
test('R05 real preview cancel (scene token and history stable)',async()=>{const {port:p,commands,world}=setup();await add(p);const token=p.read().revisionToken,n=commands.undoStack.length;p.beginPreview('a');p.updatePreview({...transform,position:[8,2,2]});p.cancelPreview();assert.equal(p.read().revisionToken,token);assert.equal(commands.undoStack.length,n);assert.deepEqual(world.getEntity('a').transform,transform);});
test('R06 real preview commit (one history entry)',async()=>{const {port:p,commands}=setup();await add(p);const n=commands.undoStack.length;p.beginPreview('a');p.updatePreview({...transform,position:[8,2,2]});assert.equal(p.commitPreview().status,'applied');assert.equal(commands.undoStack.length,n+1);});
test('R07 real stale conflict and idempotency',async()=>{const {port:p,world}=setup();const stale=p.read().revisionToken;await add(p);const c=cmd(p,'node.create',en('b'));const one=await p.dispatch(c);assert.deepEqual(await p.dispatch(c),one);assert.equal((await p.dispatch({...cmd(p,'node.create',en('c')),expectedRevision:stale})).status,'conflict');assert.equal(world.entityCount,2);});
test('R08 real export schema, ids, metadata retain',async()=>{const {port:p,world}=setup();await add(p);await p.dispatch(cmd(p,'node.rename',{name:'Renamed'},'a'));const original=world.snapshot();const exported=parseWorld(p.exportWorld());assert.equal(exported.entities[0].id,'a');assert.deepEqual(exported.entities[0].metadata,original.entities[0].metadata);assert.deepEqual(exported.entities[0].components,original.entities[0].components);});
test.skip('C13 runs separately in browser-runtime-p12.mjs, not in this Node class suite',()=>{});
test.skip('C14 physical Android/iOS remains blocked; emulation runs separately in browser-mobile-p12.mjs',()=>{});
