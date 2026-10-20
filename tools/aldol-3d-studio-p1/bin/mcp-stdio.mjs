#!/usr/bin/env node
import { createInterface } from 'node:readline';
import { createLegacyPort } from '../src/bootstrap.mjs';
const getFlag = key => { const i=process.argv.indexOf(key); return i>=0 ? process.argv[i+1] : null; };
const allowWrite = process.argv.includes('--allow-write');
const editorDir = getFlag('--editor-dir') || process.env.INHA_WORLD_EDITOR_DIR;
if (!editorDir) {console.error('E_LEGACY_SOURCE_REQUIRED: --editor-dir /path/to/inhagame/apps/world/src/editor');process.exit(2);}
let port;
try {port=await createLegacyPort(editorDir,getFlag('--world'));}
catch(e){console.error('E_LEGACY_LOAD_FAILED:',e.stack??e.message);process.exit(2);}

const readOnly=[
  {name:'scene_read',description:'Read scene nodes, revision token and capabilities.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'scene_validate',description:'Validate current scene against the unchanged INHA WORLD schema.',inputSchema:{type:'object',properties:{},additionalProperties:false}},
  {name:'scene_export_world',description:'Export canonical world.json as an in-memory string (does not write to disk).',inputSchema:{type:'object',properties:{},additionalProperties:false}},
];
const mutating=[
  {name:'scene_dispatch',description:'Apply strict typed scene command in local session. Requires explicit --allow-write.',inputSchema:{type:'object',properties:{command:{type:'object'}},required:['command'],additionalProperties:false}},
  {name:'scene_undo',description:'Undo local session command with revision check.',inputSchema:{type:'object',properties:{expectedRevision:{type:'string'}},required:['expectedRevision'],additionalProperties:false}},
  {name:'scene_redo',description:'Redo local session command with revision check.',inputSchema:{type:'object',properties:{expectedRevision:{type:'string'}},required:['expectedRevision'],additionalProperties:false}}
];
const registry = [...readOnly,...(allowWrite?mutating:[])];
const asToolResponse = (data,isError=false)=>({content:[{type:'text',text:typeof data==='string'?data:JSON.stringify(data)}],...(isError?{isError:true}:{})});
async function handle(request){
  if(request.jsonrpc!=='2.0' || typeof request.method!=='string') throw {code:-32600,message:'Invalid JSON-RPC request'};
  const args=request.params??{};
  switch(request.method){
    case 'initialize': return {protocolVersion:'2025-06-18',capabilities:{tools:{listChanged:false}},serverInfo:{name:'aldol-3d-studio-local',version:'0.2.0-dev'}};
    case 'ping': return {};
    case 'tools/list': return {tools:registry};
    case 'tools/call': {
      const name=args.name, input=args.arguments??{};
      if(!registry.some(x=>x.name===name))throw {code:-32602,message:'Unknown or disabled tool'};
      try {
        if(name==='scene_read')return asToolResponse(port.read());
        if(name==='scene_validate')return asToolResponse(port.validate());
        if(name==='scene_export_world')return asToolResponse(port.exportWorld());
        if(name==='scene_dispatch'){if(!input.command)throw new Error('E_COMMAND_REQUIRED');const x=await port.dispatch(input.command);return asToolResponse(x,x.status==='rejected'||x.status==='conflict');}
        if(name==='scene_undo'||name==='scene_redo'){
          if(typeof input.expectedRevision!=='string')throw new Error('E_REVISION_REQUIRED');
          const x=await port[name==='scene_undo'?'undo':'redo'](input.expectedRevision);
          return asToolResponse(x,x.status==='rejected'||x.status==='conflict');
        }
      }catch(e){return asToolResponse({error:e.message},true);}
    }
    default: throw {code:-32601,message:'Method not found'};
  }
}
const io=createInterface({input:process.stdin,crlfDelay:Infinity});
for await (const line of io){
  if(!line.trim())continue;
  let msg;
  try{msg=JSON.parse(line);}catch{
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}})+'\n');continue;
  }
  if(msg.id===undefined){ // Notification: never reply.
    continue;
  }
  try{const result=await handle(msg);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result})+'\n');}
  catch(e){process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,error:{code:e.code||-32603,message:e.message||'Internal error'}})+'\n');}
}
