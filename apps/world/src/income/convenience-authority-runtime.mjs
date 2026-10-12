import {createConvenienceAuthorityRequest,createConvenienceAuthorityClient} from './convenience-authority-client.mjs';
import {createConvenienceIncomeTransport} from './income-client-adapter.mjs';
import {createConvenienceJobClient} from './convenience-job-client.mjs';
import {createConvenienceJobPanel} from './convenience-job-panel.mjs';
// Optional LOCAL candidate in actual game. Not a hosted/Production activation switch.
export function mountConvenienceAuthorityRuntime({controller,host,readScene,acquireInput,doc=globalThis.document,navigation=globalThis.window,fetcher=fetch}={}){
 if(!['localhost','127.0.0.1'].includes(navigation?.location?.hostname)||host?.convenienceAuthority!==true||!host?.getAuthorization)throw Error('CONVENIENCE_LOCAL_ONLY');
 let epoch=0,account=host.accountId,uiGeneration=0,desired={x:0,z:0},busy=false,release=null,disposed=false;
 const section=doc.createElement('section');section.className='convenience-authority-candidate';section.setAttribute('aria-label','로컬 편의점 검증 근무');
 const note=doc.createElement('p');note.setAttribute('role','status');note.textContent='로컬 검증 근무: 서버가 허용한 정문/후문으로 이동해 시작합니다. 테스트 코인만 정산합니다.';
 const begin=doc.createElement('button'),work=doc.createElement('button'),cancel=doc.createElement('button');
 begin.textContent='검증 이동 시작 (서버 출발점으로 이동)';work.textContent='근무·영수증';cancel.textContent='검증 근무 종료';for(const b of [begin,work,cancel])b.type='button';section.append(note,begin,work,cancel);doc.body.append(section);
 const request=createConvenienceAuthorityRequest({getAuthorization:()=>host.getAuthorization(),getEpoch:()=>epoch,fetcher,location:navigation.location});
 const authority=createConvenienceAuthorityClient({request,getEpoch:()=>epoch,onSnapshot:s=>{
   if(disposed||!validScene())throw Error('SCENE_CHANGED');
   const p=s.state.position;controller.entity.setLocalPosition(p.x,p.y,p.z);controller.velocityY=0;controller.grounded=true;
   note.textContent=s.eligible?'현장 확인됨 · 근무·영수증에서 진열→계산→정리를 진행하세요.':'서버 검증 이동 중 · 후문 편의점으로 걸어가세요.';
 },onStop:reason=>{uiGeneration++;desired={x:0,z:0};controller.authoritativeWalk=null;controller.setTransportLock('convenience-authority',false);panel?.close({restoreFocus:false});note.textContent=`검증 이동 종료: ${reason}. 미확정 지급은 영수증을 다시 확인하세요.`;}});
 const job=createConvenienceJobClient({enabled:true,transport:createConvenienceIncomeTransport({request:b=>authority.income(b)})});
 const panel=createConvenienceJobPanel({client:job,doc,navigation,onOpenChange:open=>{if(open){desired={x:0,z:0};release?.();release=acquireInput();}else{release?.();release=null;}}});
 const validScene=()=>{const s=readScene({ownsInput:release!==null});return typeof account==='string'&&account.length>0&&s?.accountId===account&&s.sceneId==='campus'&&!s.blocked&&!s.mounted&&!s.seated&&!s.inside;};
 const walker={updatePlayer(player,dt,yaw){
   if(!authority.active)return false;
   if(!validScene()||player.mounted||player.space.id!=='campus'){void authority.stop('SCENE_CHANGED');return true;}
   let x=0,z=0;if(player.inputEnabled){if(player.keys.has('KeyA')||player.keys.has('ArrowLeft'))x--;if(player.keys.has('KeyD')||player.keys.has('ArrowRight'))x++;
     if(player.keys.has('KeyW')||player.keys.has('ArrowUp'))z++;if(player.keys.has('KeyS')||player.keys.has('ArrowDown'))z--;
     x+=player.touchVector.x;z-=player.touchVector.y;}
   const length=Math.max(1,Math.hypot(x,z));x/=length;z/=length;desired={x:x*Math.cos(yaw)-z*Math.sin(yaw),z:x*Math.sin(yaw)+z*Math.cos(yaw)};
   // No independent local movement. Zero prediction is deliberate until RTT QA approves smoothing.
   const p=authority.snapshot.state.position;player.entity.setLocalPosition(p.x,p.y,p.z);player.jumpQueued=false;player.velocityY=0;player.grounded=true;player.moving=Math.hypot(x,z)>.04;
   if(player.moving)player.entity.setLocalEulerAngles(0,Math.atan2(desired.x,desired.z)*180/Math.PI,0);return true;
 }};
 begin.addEventListener('click',async()=>{if(busy||disposed||authority.active||!validScene())return;const gen=++uiGeneration;desired={x:0,z:0};busy=true;begin.disabled=true;
   try{await authority.open();if(gen!==uiGeneration||disposed||!validScene())throw Error('SCENE_CHANGED');controller.setTransportLock('convenience-authority',true);controller.authoritativeWalk=walker;}
   catch(e){await authority.stop(e.message);note.textContent=`시작하지 못했어요: ${e.message}`;}finally{busy=false;begin.disabled=false;}});
 work.addEventListener('click',()=>{if(disposed)return;const gen=uiGeneration,owner=account;void job.refresh().then(()=>{if(!disposed&&gen===uiGeneration&&owner===account&&validScene())panel.openPanel();});});cancel.addEventListener('click',()=>void authority.stop());
 const tick=async()=>{if(disposed||!authority.active||busy)return;
   if(!validScene()){void authority.stop('SCENE_CHANGED');return;}busy=true;
   try{await authority.move(desired.x,desired.z);}catch(e){if(e.message==='SCENE_CHANGED')void authority.stop('SCENE_CHANGED');note.textContent=`이동 확인 대기: ${e.message}`;}finally{busy=false;}};
 const timer=setInterval(tick,200); // 5 Hz only while this explicit approach/work session is active.
 const hide=()=>void authority.stop('PAGE_HIDDEN');navigation.addEventListener('pagehide',hide);
 const visibility=()=>{if(doc.hidden)hide();};doc.addEventListener('visibilitychange',visibility);
 const unsubscribe=host.subscribe?.(id=>{if(id===account)return;epoch++;account=id;void authority.stop('ACCOUNT_CHANGED');void job.setAccount(id);});void job.setAccount(account);
 return {authority,job,panel,update(){if(!validScene()){if(authority.active)void authority.stop('SCENE_CHANGED');else panel.close({restoreFocus:false});}},dispose(){if(disposed)return;disposed=true;clearInterval(timer);unsubscribe?.();epoch++;void authority.dispose();void job.setAccount(null);panel.dispose();section.remove();navigation.removeEventListener('pagehide',hide);doc.removeEventListener('visibilitychange',visibility);}};
}
