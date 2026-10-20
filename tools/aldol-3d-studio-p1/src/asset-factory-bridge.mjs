import {createHash} from 'node:crypto';

// Asset Factory v5.1 Sites MCP 0.2.1 accepts metadata only. This bridge verifies
// caller-provided local bytes independently; it never fetches remote URLs.
export const MAX_ASSET_BYTES=20*1024*1024;
export const MAX_TOTAL_BYTES=80*1024*1024;
const err=(message)=>{throw Error(message);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const isPlain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const safeName=n=>typeof n==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,180}$/.test(n)&&!n.includes('..');
const goodId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(id)&&!id.includes('..');
const ext=name=>name.toLowerCase().split('.').at(-1);
export function parseFactoryInventory(raw){
  const data=typeof raw==='string'?JSON.parse(raw):raw;
  // Both the direct official tool arguments and its exported request envelope.
  const v=isPlain(data?.arguments)?data.arguments:isPlain(data?.inventory_preview?.arguments)?data.inventory_preview.arguments:data;
  if(!isPlain(v)||!Array.isArray(v.assets)||v.assets.length>500||!/^([A-Za-z0-9][A-Za-z0-9_-]{0,59})$/.test(v.project_id||''))err('E_FACTORY_MANIFEST_INVALID');
  const seenIds=new Set(),seenPaths=new Set();
  let declaredTotal=0;
  const assets=v.assets.map(a=>{
    if(!isPlain(a)||!goodId(a.id)||typeof a.file!=='string'||!a.file.startsWith('assets/')||!safeName(a.file.slice(7))||
      !Number.isSafeInteger(a.byte_size)||a.byte_size<0||a.byte_size>MAX_ASSET_BYTES||
      (a.sha256!==undefined&&!/^[a-f0-9]{64}$/.test(a.sha256))||
      (a.status!==undefined&&!['PASS','FAIL','UNKNOWN'].includes(a.status))||
      Object.keys(a).some(k=>!['id','file','byte_size','sha256','status'].includes(k)))err('E_FACTORY_ASSET_INVALID');
    if(seenIds.has(a.id)||seenPaths.has(a.file))err('E_FACTORY_DUPLICATE');
    seenIds.add(a.id);seenPaths.add(a.file);declaredTotal+=a.byte_size;
    if(declaredTotal>MAX_TOTAL_BYTES)err('E_FACTORY_TOO_LARGE');
    return {...a};
  });
  return {project_id:v.project_id,assets};
}
export function inspectGlb(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<20||bytes.toString('utf8',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)err('E_GLB_HEADER');
  let offset=12,json=null,bin=0;
  while(offset<bytes.length){
    if(offset+8>bytes.length)err('E_GLB_CHUNK');
    const len=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);offset+=8;
    if(len%4||offset+len>bytes.length)err('E_GLB_CHUNK');
    if(json===null){if(type!==0x4e4f534a)err('E_GLB_JSON_FIRST');try{json=JSON.parse(bytes.toString('utf8',offset,offset+len).trim());}catch{err('E_GLB_JSON_INVALID');}}
    else if(type===0x004e4942)bin+=len;
    offset+=len;
  }
  if(offset!==bytes.length||!isPlain(json)||json.asset?.version!=='2.0'||!Array.isArray(json.scenes||[])||!Array.isArray(json.nodes||[]))err('E_GLB_SCHEMA');
  for(const b of json.buffers||[])if(b.uri!==undefined)err('E_GLB_EXTERNAL_URI');
  for(const i of json.images||[])if(i.uri!==undefined&&!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(i.uri))err('E_GLB_EXTERNAL_URI');
  if((json.extensionsRequired||[]).length)err('E_GLB_UNSUPPORTED_EXTENSION');
  if(bin===0&&(json.buffers||[]).some(b=>b.byteLength>0))err('E_GLB_BIN_MISSING');
  return {format:'glb',sceneCount:json.scenes.length,nodeCount:json.nodes.length,meshCount:(json.meshes||[]).length,binBytes:bin};
}
export function inspectPng(bytes){
  if(!Buffer.isBuffer(bytes)||bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString('ascii',12,16)!=='IHDR')err('E_PNG_INVALID');
  const w=bytes.readUInt32BE(16),h=bytes.readUInt32BE(20);
  if(w<1||h<1||w>16384||h>16384)err('E_PNG_DIMENSIONS');
  return {format:'png',width:w,height:h,structuralCheck:'HEADER_ONLY'};
}
export class FactoryAssetBridge{
  constructor(port){this.port=port;this.files=new Map();this.totalBytes=0;}
  list(){return [...this.files.values()].map(({bytes,...details})=>({...details}));}
  get(assetId){return this.files.get(assetId)||null;}
  import({file,contentsBase64,manifest}){
    if(typeof file!=='string'||!safeName(file)||!['glb','png'].includes(ext(file)))err('E_IMPORT_TYPE');
    if(typeof contentsBase64!=='string'||contentsBase64.length>(MAX_ASSET_BYTES*4/3+8)||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(contentsBase64))err('E_IMPORT_BASE64');
    const bytes=Buffer.from(contentsBase64,'base64');
    if(bytes.length===0||bytes.length>MAX_ASSET_BYTES)err('E_IMPORT_SIZE');
    const inventory=parseFactoryInventory(manifest),entry=inventory.assets.find(a=>a.file==='assets/'+file);
    if(!entry)err('E_IMPORT_NOT_IN_MANIFEST');
    if(entry.status==='FAIL')err('E_IMPORT_DECLARED_FAIL');
    if(entry.byte_size!==bytes.length)err('E_IMPORT_SIZE_MISMATCH');
    const digest=hash(bytes);
    if(!entry.sha256)err('E_IMPORT_SHA_REQUIRED');
    if(entry.sha256!==digest)err('E_IMPORT_SHA_MISMATCH');
    const structure=ext(file)==='glb'?inspectGlb(bytes):inspectPng(bytes);
    const id='factory.'+digest.slice(0,24);
    if(this.files.has(id)){
      const old=this.files.get(id);
      if(old.sha256!==digest)err('E_ASSET_ID_COLLISION');
      return {...this.public(old),alreadyImported:true};
    }
    if(this.totalBytes+bytes.length>MAX_TOTAL_BYTES)err('E_FACTORY_TOO_LARGE');
    if(!this.port.commands?.addAsset||!this.port.world?.snapshot)err('E_ASSET_COMMAND_UNAVAILABLE');
    const asset={id,type:structure.format==='glb'?'model':'texture',uri:'assets/'+digest+'.'+structure.format,metadata:{sha256:digest,source:'aldol-asset-factory-v5.1-local-export',projectId:inventory.project_id,sourceFile:file,byteSize:bytes.length,rightsQa:'UNKNOWN',engineImportQa:'UNKNOWN',contentIntegrity:'PASS',structure}};
    if(this.port.world.snapshot().assets.some(a=>a.id===id||a.uri===asset.uri))err('E_ASSET_EXISTS');
    this.port.commands.addAsset(asset);
    this.port.read();
    const record={assetId:id,file,projectId:inventory.project_id,sha256:digest,byteSize:bytes.length,structure,uri:asset.uri,content_integrity:'PASS',engine_import_qa:'UNKNOWN',rights_qa:'UNKNOWN',visual_qa:'UNKNOWN',bytes};
    this.files.set(id,record);this.totalBytes+=bytes.length;
    return this.public(record);
  }
  public({bytes,...record}){return {...record};}
}
