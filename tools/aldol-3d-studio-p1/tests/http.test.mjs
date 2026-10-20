import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
async function runServer(args,fn){
 const child=spawn(process.execPath,['bin/dev-server.mjs','--port','0','--demo',...args],{cwd:root,stdio:['ignore','pipe','pipe']});
 let log=''; let err=''; child.stderr.on('data',x=>err+=x); const port=await Promise.race([
  new Promise((ok,fail)=>{child.stdout.on('data',data=>{log+=data.toString();const found=log.match(/http:\/\/127\.0\.0\.1:(\d+)/);if(found)ok(Number(found[1]));});child.on('exit',code=>fail(Error(`server exited ${code}: ${err}`)));}),
  new Promise((_,fail)=>setTimeout(()=>fail(Error('server ready timeout: '+err)),2500))]);
 try{await fn(`http://127.0.0.1:${port}`);}finally{child.kill('SIGTERM');}
}
const post=(url,data,headers={})=>fetch(url,{method:'POST',headers:{'content-type':'application/json',...headers},body:JSON.stringify(data)});
test('HTTP studio demo create/rename/undo/redo/export',async()=>{
 await runServer(['--allow-write'],async base=>{
  assert.equal((await(await fetch(base+'/api/health')).json()).mode,'demo-mock');
  const start=await(await fetch(base+'/api/scene')).json();
  const payload={commandId:'create',expectedRevision:start.revisionToken,operation:'node.create',payload:{id:'box.1',name:'Box 1',kind:'prop',transform:{position:[0,.5,0],rotation:[0,0,0,1],scale:[1,1,1]}}};
  assert.equal((await(await post(base+'/api/command',payload)).json()).status,'applied');
  let current=await(await fetch(base+'/api/scene')).json();assert.equal(current.nodes.length,1);
  assert.equal((await(await post(base+'/api/command',{commandId:'rename',expectedRevision:current.revisionToken,operation:'node.rename',targetId:'box.1',payload:{name:'Retitled'}})).json()).status,'applied');
  current=await(await fetch(base+'/api/scene')).json();assert.equal(current.nodes[0].name,'Retitled');
  assert.equal((await(await post(base+'/api/undo',{expectedRevision:current.revisionToken})).json()).status,'applied');
  current=await(await fetch(base+'/api/scene')).json();assert.equal(current.nodes[0].name,'Box 1');
  assert.equal((await(await post(base+'/api/redo',{expectedRevision:current.revisionToken})).json()).status,'applied');
  const exp=await(await fetch(base+'/api/export')).json();assert.equal(exp.entities[0].name,'Retitled');
 });
});
test('HTTP origin restricted and default is readonly',async()=>{
 await runServer([],async base=>{
  const r=await post(base+'/api/command',{});assert.equal(r.status,403);assert.equal((await r.json()).error,'E_WRITE_DISABLED');
 });
 await runServer(['--allow-write'],async base=>{
  const r=await post(base+'/api/command',{}, {origin:'https://attacker.invalid'});
  assert.equal(r.status,403);assert.equal((await r.json()).error,'E_ORIGIN_DENIED');
 });
});

test('ES module .mjs is served with JavaScript MIME, never HTML',async()=>{
 await runServer(['--allow-write'],async base=>{
  const r=await fetch(base+'/interaction.mjs');
  assert.equal(r.status,200);
  assert.match(r.headers.get('content-type'),/^text\/javascript/);
  assert.match(await r.text(),/export (const|function)/);
 });
});
