import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'..');
const call=(id,method,params={})=>({jsonrpc:'2.0',id,method,params});
function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'aldol-mcp-test-'));
 writeFileSync(join(dir,'package.json'),JSON.stringify({type:'module'}));
 writeFileSync(join(dir,'world-document.js'),`
 export const createEmptyWorld=()=>({worldId:'mock.world',name:'Mock',coordinateSystem:{handedness:'right',upAxis:'Y',unit:'meter'},entities:[],assets:[],metadata:{},schemaVersion:'0.1.0'});
 export class WorldDocument {
 constructor(w=createEmptyWorld()){this.w=w;this.revision=0;}
 snapshot(){return structuredClone(this.w);}listEntities(){return structuredClone(this.w.entities);}
 getEntity(id){return structuredClone(this.w.entities.find(x=>x.id===id)??null);}
 hasEntity(id){return !!this.getEntity(id);}
 addEntity(e){if(this.hasEntity(e.id))throw Error('E_DUP_ENTITY_ID');this.w.entities.push({parentId:null,enabled:true,tags:[],components:{},metadata:{},transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},...structuredClone(e)});this.revision++;}
 replaceEntity(id,e){this.w.entities=this.w.entities.map(x=>x.id===id?structuredClone(e):x);this.revision++;}
 removeEntity(id){this.w.entities=this.w.entities.filter(x=>x.id!==id);this.revision++;}
 assertValid(){}
 }
 `);
 writeFileSync(join(dir,'editor-commands.js'),`
 export class EditorCommands{
 constructor(world,state){this.world=world;this.state=state;this.undoStack=[];this.redoStack=[];this.transformDraft=null;}
 addEntity(e){this.world.addEntity(e);this.undoStack.push({});this.state.select(e.id);}
 renameEntity(id,name){this.world.replaceEntity(id,{...this.world.getEntity(id),name});this.undoStack.push({});}
 }
 `);
 writeFileSync(join(dir,'world-serialization.js'),`export const parseWorld=x=>JSON.parse(x);export const serializeWorld=x=>JSON.stringify(x);`);
 writeFileSync(join(dir,'world-schema.js'),`export const validateWorld=()=>({valid:true,diagnostics:[],errors:[]});`);
 return dir;
}
function protocol(dir,extra=[],lines=[]){
 const res=spawnSync(process.execPath,[join(root,'bin/mcp-stdio.mjs'),'--editor-dir',dir,...extra],{input:lines.map(x=>JSON.stringify(x)).join('\n')+'\n',encoding:'utf8',timeout:5000});
 assert.equal(res.status,0,res.stderr);return res.stdout.trim().split('\n').filter(Boolean).map(JSON.parse);
}
test('MCP local stdio handshake, tools/list, read-only default, nonwrite invocation',()=>{
 const dir=fixture();try{
 const r=protocol(dir,[],[call(1,'initialize',{protocolVersion:'2025-06-18'}),{jsonrpc:'2.0',method:'notifications/initialized'},call(2,'tools/list'),call(3,'tools/call',{name:'scene_read'}),call(4,'tools/call',{name:'scene_dispatch',arguments:{}})]);
 assert.equal(r.length,4);assert.equal(r[0].result.serverInfo.name,'aldol-3d-studio-local');
 assert.equal(r[1].result.tools.length,3);assert.equal(JSON.parse(r[2].result.content[0].text).sceneId,'mock.world');assert.equal(r[3].error.code,-32602);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('MCP --allow-write executes typed command, then reads new scene',()=>{
 const dir=fixture();try{
 const first=protocol(dir,[],[call(1,'tools/call',{name:'scene_read'})]);
 const token=JSON.parse(first[0].result.content[0].text).revisionToken;
 const entity={id:'box.1',name:'Box',kind:'prop',transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]}};
 const inputs=[call(1,'tools/call',{name:'scene_dispatch',arguments:{command:{commandId:'box-create',expectedRevision:token,operation:'node.create',payload:entity}}}),call(2,'tools/call',{name:'scene_read'})];
 const response=protocol(dir,['--allow-write'],inputs);
 assert.equal(JSON.parse(response[0].result.content[0].text).status,'applied');
 assert.equal(JSON.parse(response[1].result.content[0].text).nodes[0].id,'box.1');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
