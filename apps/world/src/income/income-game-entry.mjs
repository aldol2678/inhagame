import { createIncomeScenePanelAdapter } from './income-scene-panel-adapter.mjs';
import { INCOME_CONVENIENCE_LOCATION as shop } from './income-convenience-location.mjs';
import { CONVENIENCE_EMPLOYER as employer } from './convenience-employer.mjs';
import { roadviewGroundHeight } from '../roadview-layout.js';

// Normal-game authored discovery. Only a local test host can access read-only records; payment stays CLOSED.
export function createIncomeGameEntry({campusRoot,contextActions,readScene,getLocalAuthHost,createAvatar,
  acquireInput,doc=globalThis.document,navigation=globalThis.window}) {
  const local = ['localhost','127.0.0.1'].includes(navigation?.location?.hostname);
  const appearance={outfit_color:'#447b6c',accent_color:'#e4c073',hair_color:'#302b27',skin_tone:1,
    presentation:'female',outfit_style:'shirt',hair_style:'short',accessory:'badge',height:1};
  const visual=createAvatar(campusRoot,{id:employer.id},appearance);visual.marker.enabled=false;visual.identityMarker.enabled=false;visual.avatar.enabled=false;
  visual.avatar.name=employer.id;visual.avatar.setLocalPosition(shop.position.x,roadviewGroundHeight(shop.position.x,shop.position.z),shop.position.z);
  visual.avatar.setLocalEulerAngles(0,180,0);
  const dialog=doc.createElement('section');dialog.className='furniture-editor';dialog.hidden=true;
  dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',employer.name);
  const heading=doc.createElement('h2');heading.textContent=`${employer.name} · ${employer.role}`;
  const text=doc.createElement('p');text.textContent=`${employer.greeting} ${employer.briefing}`;
  const note=doc.createElement('p');note.textContent='가상 인물 · 게임 내 편의점 · 테스트 후보 기본급 30 / 공통 한도 60 코인. 실제 재화 지급 없음.';
  const closeButton=doc.createElement('button');closeButton.textContent='대화 마치기';closeButton.type='button';const practice=doc.createElement('div');
  const task=doc.createElement('p'),feedback=doc.createElement('p');feedback.setAttribute('role','status');
  const correct=doc.createElement('button'),retry=doc.createElement('button');correct.type=retry.type='button';
  const lessons=[['유통기한이 빠른 우유는 어디에 둘까요?','앞쪽에 진열','뒤에 숨기기'],['계산 금액이 다르면 어떻게 할까요?','품목과 수량 다시 확인','그대로 결제'],['통로에 상자가 남았다면?','정리하고 마무리 확인','그냥 퇴근']];
  let lesson=0;
  const drawLesson=()=>{const l=lessons[lesson];task.textContent=l?`급여 없는 연습 ${lesson+1}/3 · ${l[0]}`:'연습을 마쳤어요. 출근·정산·보상은 발생하지 않았어요.';correct.hidden=retry.hidden=!l;if(l){correct.textContent=l[1];retry.textContent=l[2];}else closeButton.focus();};
  correct.addEventListener('click',()=>{if(dialog.hidden||dialogKind!=='employer'||lesson>=3)return;lesson++;feedback.textContent='좋아요. 확인한 순서대로 천천히 이어 가면 돼요.';drawLesson();});
  retry.addEventListener('click',()=>{if(dialog.hidden||dialogKind!=='employer'||lesson>=3)return;feedback.textContent='괜찮아요. 빠르게 끝내기보다 한 번 더 살펴볼까요? 다시 골라도 불이익은 없어요.';});
  practice.append(task,correct,retry,feedback);dialog.append(heading,text,note,practice,closeButton);doc.body.append(dialog);
  let release=null,opener=null,account=null,worldOwner=null,disposed=false,dialogKind=null;
  const panel=local ? createIncomeScenePanelAdapter({enabled:true,location:navigation.location,getAuthorization:async()=>{const host=getLocalAuthHost(),owner=account;const token=await host?.getAuthorization?.();
      if(owner!==account||host!==getLocalAuthHost()||host?.accountId!==owner||readScene({ownsInput:true})?.accountId!==owner) throw new Error('AUTH_CHANGED');return token??null;},
    doc,navigation,acquireInput}) : {open:false,close(){},setAccount(){},dispose(){}};
  const close=({restoreFocus=true}={})=>{if(dialog.hidden)return;dialog.hidden=true;dialogKind=null;release?.();release=null;if(restoreFocus&&doc.body.contains(opener))opener.focus?.();opener=null;};
  closeButton.addEventListener('click',close);
  dialog.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}if(event.key==='Tab'){const controls=[correct,retry,closeButton].filter(b=>!b.hidden&&!practice.hidden||b===closeButton);const i=controls.indexOf(doc.activeElement);if(event.shiftKey&&i<=0){event.preventDefault();controls.at(-1).focus();}else if(!event.shiftKey&&(i<0||i===controls.length-1)){event.preventDefault();controls[0].focus();}}});
  navigation.addEventListener('popstate',close);
  const allowed=s=>s&&s.sceneId==='campus'&&!s.blocked&&!s.mounted&&!s.seated&&!s.inside;
  const near=(s,p)=>p&&s.position&&Math.abs(s.position.y-p.y)<1.8&&Math.hypot(s.position.x-p.x,s.position.z-p.z)<=2.5;
  const read=()=>readScene({ownsInput:!dialog.hidden||panel.open});
  function update(){if(disposed)return;const s=read(),host=local?getLocalAuthHost():null;const next=host?.accountId && host.accountId===s?.accountId ? host.accountId : null;
    if(next!==account || (s?.accountId??null)!==worldOwner){account=next;worldOwner=s?.accountId??null;close({restoreFocus:false});panel.close({restoreFocus:false});void panel.setAccount(next);}
    const active=allowed(s);visual.avatar.enabled=s?.sceneId==='campus' && !s.inside;
    if(!active||s.conversationOpen||!near(s,dialogKind==='delivery'?s.npc?.position:shop.position))close();
    if(panel.open&&(!active||!near(s,s.npc?.position)))panel.close({restoreFocus:false});
    contextActions.set('income-convenience-employer',active&&!s.conversationOpen&&!s.mainQuestPending&&dialog.hidden&&!panel.open&&near(s,shop.position)?{
      id:'income-convenience-employer',icon:'💬',label:`${employer.name} · 편의점 근무 안내`,compactLabel:'근무 안내',priority:300,shortcut:'F',
      trigger(){const live=read();if(disposed||!allowed(live)||live.mainQuestPending||live.conversationOpen||!near(live,shop.position))return false;
        opener=doc.activeElement;dialogKind='employer';dialog.setAttribute('aria-label',`${employer.name} · ${employer.role}`);practice.hidden=false;lesson=0;feedback.textContent='';drawLesson();heading.textContent=`${employer.name} · ${employer.role}`;text.textContent=`${employer.greeting} ${employer.briefing}`;note.hidden=false;dialog.hidden=false;release=acquireInput('income-employer');closeButton.focus();return true;}
    }:null);
  }
  return {update,suspend(){close({restoreFocus:false});panel.close({restoreFocus:false});visual.avatar.enabled=false;contextActions.set('income-convenience-employer',null);},incomeChoice(id){if(disposed)return null;const s=read();if(id!=='INKYUNG-NPC-013'||!allowed(s)||!near(s,s.npc?.position))return null;
      return {label:'📦 작은 요리 준비 · 납품 후보',trigger(){const live=read();if(disposed||!allowed(live)||live.conversationOpen||!near(live,live.npc?.position))return false;
        if(account && (live.accountId!==account || !local || getLocalAuthHost()?.accountId!==account)){panel.close({restoreFocus:false});void panel.setAccount(null);account=null;return false;}
        if(!account){opener=doc.activeElement;text.textContent='가태린의 작은 요리 준비: 잉어 1개 제한 납품 후보예요. 후보 보상 20 코인. 현장 확인과 정산 준비가 끝나기 전에는 수락·제출·지급하지 않아요.';heading.textContent='가태린 · 납품 후보';dialog.setAttribute('aria-label',heading.textContent);note.hidden=true;practice.hidden=true;dialogKind='delivery';dialog.hidden=false;release=acquireInput('income-delivery-info');closeButton.focus();return true;}
        void panel.openPanel();return true;}};},
    get employerEntity(){return visual.avatar;}, get dialog(){return dialog;},
    dispose(){if(disposed)return;disposed=true;close({restoreFocus:false});panel.dispose();visual.avatar.destroy();dialog.remove?.();navigation.removeEventListener('popstate',close);contextActions.set('income-convenience-employer',null);}
  };
}

// BFCache keeps the same runtime alive; returning must not lose the authored NPC.
export function bindIncomeGameLifecycle({ navigation, getRuntime }) {
  const hide = event => event.persisted ? getRuntime()?.suspend() : getRuntime()?.dispose();
  const show = event => { if (event.persisted) getRuntime()?.update(); };
  navigation.addEventListener('pagehide', hide);
  navigation.addEventListener('pageshow', show);
  return () => { navigation.removeEventListener('pagehide', hide); navigation.removeEventListener('pageshow', show); };
}
