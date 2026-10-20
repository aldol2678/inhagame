#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createLegacyPort} from '../src/bootstrap.mjs';
import {WorldSceneAdapter} from '../src/world-scene-adapter.mjs';
const flag=k=>{const i=process.argv.indexOf(k);return i>=0?process.argv[i+1]:null;};
const demo=process.argv.includes('--demo');
const allowWrite=process.argv.includes('--allow-write');
const portNum=Number(flag('--port')||4173);
if(!Number.isInteger(portNum)||portNum<0||portNum>65535)throw Error('E_PORT_INVALID');
let port;
try{
 if(demo){const {makeMock}=await import('../tests/fixture.mjs');port=new WorldSceneAdapter(makeMock());}
 else {port=await createLegacyPort(flag('--editor-dir')||process.env.INHA_WORLD_EDITOR_DIR,flag('--world'));}
}catch(e){console.error(e.stack??e.message);process.exit(2);}
const staticDir=resolve(import.meta.dirname,'../web');
const allowFile={'/':'index.html','/studio.js':'studio.js','/studio.css':'studio.css','/interaction.mjs':'interaction.mjs'};
const json=(res,code,data)=>{res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
async function body(req){let s='';for await(const chunk of req){s+=chunk.toString('utf8');if(s.length>100000)throw Error('E_BODY_TOO_LARGE');}return JSON.parse(s);}
const server=createServer(async(req,res)=>{
 const url=new URL(req.url,'http://localhost');
 try{
   if(req.method==='GET'&&url.pathname in allowFile){const f=allowFile[url.pathname];const data=await readFile(join(staticDir,f));res.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'});res.end(data);return;}
   if(req.method==='GET'&&url.pathname==='/api/health')return json(res,200,{status:'ok',mode:demo?'demo-mock':'legacy',allowWrite});
   if(req.method==='GET'&&url.pathname==='/api/scene')return json(res,200,port.read());
   if(req.method==='GET'&&url.pathname==='/api/validate')return json(res,200,port.validate());
   if(req.method==='GET'&&url.pathname==='/api/export'){
     const text=port.exportWorld();res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="world.json"','Cache-Control':'no-store'});res.end(text);return;
   }
   if(req.method==='POST'&&['/api/command','/api/undo','/api/redo'].includes(url.pathname)){
     const origin=req.headers.origin;
     // Bind loopback only; cross-origin remote pages are not permitted to mutate this session.
     if(origin&&origin!==`http://127.0.0.1:${server.address().port}`&&origin!==`http://localhost:${server.address().port}`)return json(res,403,{error:'E_ORIGIN_DENIED'});
     if(!allowWrite)return json(res,403,{error:'E_WRITE_DISABLED'});
     if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'E_JSON_REQUIRED'});
     const data=await body(req);
     const result=url.pathname==='/api/command'?await port.dispatch(data):url.pathname==='/api/undo'?await port.undo(data.expectedRevision):await port.redo(data.expectedRevision);
     return json(res,200,result);
   }
   json(res,404,{error:'E_NOT_FOUND'});
 }catch(e){json(res,400,{error:String(e.message||e)});}
});
server.listen(portNum,'127.0.0.1',()=>console.log(`ALDOL Studio ${demo?'DEMO mock':'legacy'} / ${allowWrite?'editable':'read-only'}: http://127.0.0.1:${server.address().port}/`));
