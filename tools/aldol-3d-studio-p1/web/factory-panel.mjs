// Asset Factory v5.1 offline handoff panel. No cross-origin fetch or remote upload.
const el=id=>document.getElementById(id);
const root=el('factory-assets'),file=el('factory-file'),manifest=el('factory-manifest'),button=el('factory-import');
const text=(node,value)=>{node.textContent=value;return node;};
async function json(path,options){const r=await fetch(path,{cache:'no-store',...options});const data=await r.json();if(!r.ok)throw Error(data.error||'E_FACTORY_REQUEST');return data;}
async function list(){
 try {
  const {assets}=await json('/api/assets');root.replaceChildren();
  if(!assets.length){text(root,'아직 등록된 로컬 에셋이 없습니다.');return;}
  for(const item of assets){
   const line=document.createElement('div');line.className='factory-asset';
   const name=document.createElement('span');text(name,item.file+' · '+item.structure.format.toUpperCase());
   const place=document.createElement('button');text(place,'프록시 배치');place.type='button';
   place.disabled=item.structure.format!=='glb'||!canWrite;
   place.title='이 버튼은 모델 메시가 아닌 위치·참조 노드를 배치합니다. 게임 내 GLB 렌더링은 별도 검증이 필요합니다.';
   place.addEventListener('click',async()=>{
    place.disabled=true;
    try{
     const snapshot=await json('/api/scene');
     const payload={
      id:'factory-placement.'+(globalThis.crypto?.randomUUID?.()||Math.random().toString(36).slice(2)),
      name:item.file,kind:'prop',parentId:null,
      transform:{position:[0,0,0],rotation:[0,0,0,1],scale:[1,1,1]},
      components:{'core.renderable':{assetId:item.assetId}},
      metadata:{assetFactory:{projectId:item.projectId,sha256:item.sha256,rightsQa:'UNKNOWN',engineImportQa:'UNKNOWN'}}
     };
     const r=await json('/api/command',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({commandId:'factory.place.'+Date.now()+'.'+Math.random(),expectedRevision:snapshot.revisionToken,operation:'node.create',payload})});
     if(r.status!=='applied')throw Error(r.diagnosticCode||r.status);
     text(el('status'),'Factory 참조 프록시 배치됨 · GLB 실제 렌더링은 미검증');
     window.dispatchEvent(new Event('studio:external-change'));
    }catch(e){text(el('status'),'에셋 배치 거부: '+e.message);}
    finally{place.disabled=false;}
   });
   line.append(name,place);root.append(line);
  }
 }catch(e){text(root,'에셋 목록 오류: '+e.message);}
}
let canWrite=false;
const update=()=>{button.disabled=!canWrite||!file.files?.length||!manifest.files?.length;};
file.addEventListener('change',update);manifest.addEventListener('change',update);
button.addEventListener('click',async()=>{
 if(!canWrite)return;
 button.disabled=true;
 try{
  const chosen=file.files?.[0],meta=manifest.files?.[0];
  if(!chosen||!meta)throw Error('원본 파일과 Factory JSON이 모두 필요합니다');
  if(chosen.size>20*1024*1024||meta.size>256*1024)throw Error('E_FACTORY_INPUT_TOO_LARGE');
  const raw=JSON.parse(await meta.text());
  const data=await chosen.arrayBuffer();
  const view=new Uint8Array(data);let binary='';
  // Prevent stack/argument limits when converting up to 20 MiB.
  for(let i=0;i<view.length;i+=32768)binary+=String.fromCharCode(...view.subarray(i,i+32768));
  const result=await json('/api/assets/import',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({file:chosen.name,contentsBase64:btoa(binary),manifest:raw})});
  text(el('status'),'에셋 검증·등록 완료 (SHA PASS, 실제 게임 렌더링·권리 UNKNOWN)');
  await list();window.dispatchEvent(new Event('studio:external-change'));
 }catch(e){text(el('status'),'Factory 가져오기 거부: '+e.message);}
 finally{update();}
});
(async()=>{try{const h=await json('/api/health');canWrite=h.allowWrite;update();await list();}catch(e){text(root,'에셋 서비스 연결 오류: '+e.message);}})();
