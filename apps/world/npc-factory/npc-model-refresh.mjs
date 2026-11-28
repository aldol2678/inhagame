import * as pc from 'playcanvas';
const settings=new URLSearchParams(globalThis.location?.search??'');
// Generated silhouettes are normal; the explicit legacy switch is useful for visual QA.
export const NPC_MODELS_GENERATED=settings.get('npcModels')!=='legacy';
const ENABLED=NPC_MODELS_GENERATED;
const paths='/assets/npcs/refresh-72/';
const count=5, radius=11, releaseRadius=16;
let runtime=null;
const entries=new Map();
export function registerNpcRefresh(visual){
 if(!ENABLED)return visual;
 const {avatar,actor,marker,identityMarker}=visual;
 const primitives=avatar.findComponents('render').filter(c=>c.entity!==marker&&c.entity!==identityMarker);
 const record={id:actor.id,visual,primitives,asset:null,node:null,clip:null,pending:false,fallback:false,failed:false,last:null};
 entries.set(avatar,record);
 avatar.once('destroy',()=>{entries.delete(avatar);restore(record);});
 visual.refreshPose=(moving,legacyPose=false)=>{record.moving=moving;record.fallback=legacyPose;};
 return visual;
}
function deleteAsset(app,asset){if(asset){asset.unload();app.assets.remove(asset);}}
function hide(record,active){
 if(active&&!record.original){record.original=record.primitives.map(c=>c.enabled);record.primitives.forEach(c=>{c.enabled=false;});}
 if(!active&&record.original){record.primitives.forEach((c,i)=>{c.enabled=record.original[i];});record.original=null;}
 if(record.node)record.node.enabled=active;
}
function restore(record){
 hide(record,false);
 record.node?.destroy();record.node=null;record.clip=null;
 if(record.asset){deleteAsset(runtime.app,record.asset);record.asset=null;}
}
async function load(record,file){
 const {app}=runtime;record.pending=true;let newNode=null;
 const asset=new pc.Asset('NPC refresh '+record.id,'container',{url:paths+file});app.assets.add(asset);
 try{
  await new Promise((res,rej)=>{asset.once('load',res);asset.once('error',rej);app.assets.load(asset);});
  if(!entries.has(record.visual.avatar)||!record.keep){deleteAsset(app,asset);return;}
  const node=newNode=asset.resource.instantiateRenderEntity();
  const names=['Idle_Breathe','Walk_In_Place'];
  const tracks=Object.fromEntries(asset.resource.animations.map(a=>[a.resource.name,a.resource]));
  if(names.some(k=>!tracks[k]))throw Error('missing idle/walk');
  node.name='REFRESH_'+record.id;node.setLocalScale(1.37,1.37,1.37);
  node.setLocalEulerAngles(0,record.mirror?180:0,0);
  node.enabled=false;record.visual.avatar.addChild(node);
  node.addComponent('anim',{activate:true});
  node.anim.loadStateGraph(new pc.AnimStateGraph({layers:[{name:'Base',states:[{name:'START'},...names.map(name=>({name,speed:1,loop:true}))],transitions:[{from:'START',to:'Idle_Breathe'}]}],parameters:{}}));
  for(const name of names)node.anim.assignAnimation(name,tracks[name],'Base',1,true);
  record.asset=asset;record.node=node;
 }catch{record.failed=true;newNode?.destroy();deleteAsset(app,asset);}
 finally{record.pending=false;}
}
export function startNpcRefresh(app,player){
 if(!ENABLED||runtime)return;
 runtime={app,manifest:new Map(),ready:false,error:null};let elapsed=0;
 void fetch(paths+'manifest.json').then(r=>{if(!r.ok)throw Error(r.status);return r.json();}).then(rows=>{
  if(!Array.isArray(rows)||rows.length!==63)throw Error('invalid generated roster');
  // The retired event is not in the roster; Jeongseok uses its own room-local loader.
  runtime.manifest=new Map(rows.filter(r=>r.kind!=='daily'&&r.kind!=='event'&&r.id!=='JEONGSEOK_LOBBY_GUIDE_01'&&
   typeof r.id==='string'&&/^[A-Za-z0-9_-]+[.]glb$/.test(r.file)).map(r=>[r.id,r.file]));runtime.ready=true;
 }).catch(e=>runtime.error=String(e));
 app.on('update',dt=>{
  if(!runtime.ready)return;
  elapsed+=dt;
  if(elapsed<.12)return;const interval=elapsed;elapsed=0;
  const p=player.getPosition(),rank=[];
  for(const r of entries.values()){
   const a=r.visual.avatar;
   const q=a.getPosition(),dist=Math.hypot(p.x-q.x,p.y-q.y,p.z-q.z);
   const step=r.last?Math.hypot(q.x-r.last[0],q.z-r.last[1]):0;r.last=[q.x,q.z];
   r.inferredWalk=step>interval*.1&&step<1.0;
   if(runtime.manifest.has(r.id)&&a.enabled&&!r.failed&&dist<(r.node?releaseRadius:radius))rank.push([dist,r]);
   r.keep=false;
  }
  rank.sort((x,y)=>x[0]-y[0]);rank.slice(0,count).forEach(([,r])=>{r.keep=true;});
  for(const r of entries.values())if(!r.keep&&r.node)restore(r);
  let occupied=[...entries.values()].filter(r=>r.node||r.pending).length;
  for(const r of entries.values()){
   if(!r.keep)continue;
   if(!r.node&&!r.pending&&occupied<count){occupied++;void load(r,runtime.manifest.get(r.id));}
   if(!r.node)continue;
   hide(r,!r.fallback);
   if(r.fallback)continue;
   const clip=(r.moving??r.inferredWalk)?'Walk_In_Place':'Idle_Breathe';
   if(r.clip!==clip){r.node.anim.baseLayer.transition(clip,.15);r.clip=clip;}
  }
 });
 globalThis.__INHA_NPC_REFRESH_QA__=Object.freeze({status:()=>({
  manifests:runtime.manifest.size,ready:runtime.ready,error:runtime.error,
  registered:[...entries.values()].map(r=>({id:r.id,visible:!!r.node?.enabled,ready:!!r.node,failed:r.failed,legacy:r.fallback,clip:r.clip})),maxResident:count
 })});
}
