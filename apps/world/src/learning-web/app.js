import {createLearningController} from '../learning/learning-controller.js';
import {createLearningCloudTransport} from '../learning/learning-cloud.js';
import {createLearningWebAuth} from './auth.js';
import {learningRoute,clearLearningUrl} from './navigation.js';

// The web document owns its controller. Nothing here acquires World/Phone input.
export function createLearningWeb({client=null,doc=globalThis.document,win=globalThis.window,
  createController=createLearningController}={}) {
  const root=doc.getElementById('learn-root'),preparing=doc.getElementById('learn-preparing'),loading=doc.getElementById('learn-loading');
  const status=doc.getElementById('learn-account-status'),form=doc.getElementById('learn-login'),logout=doc.getElementById('learn-logout'),retry=doc.getElementById('learn-auth-retry'),notice=doc.getElementById('learn-auth-notice');
  const email=doc.getElementById('learn-email'),password=doc.getElementById('learn-password');
  let controller=null,account=undefined,generation=0,disposed=false,hidden=false,authState={status:'checking'},busy=false;
  const events=new AbortController();
  function discard(){generation++;controller?.dispose();controller=null;account=undefined;root.replaceChildren();root.hidden=true;password.value='';}
  function error(){notice.textContent='학습 화면을 불러오지 못했어요. 기록은 유지합니다. 계정 다시 확인을 이용해 주세요.';retry.hidden=false;}
  async function show(id){
    if(disposed||hidden)return;
    if(controller&&account===id){root.hidden=!controller.available();preparing.hidden=controller.available();loading.hidden=true;if(controller.available())controller.mount(root);return;}
    discard();const current=generation;account=id;
    try{
      controller=createController({doc,win,cloudTransport:createLearningCloudTransport({getClient:()=>client}),
        onDailyQuiz:()=>{win.location.assign(learningRoute('daily'));return true;},onError:error});
      const selected=controller;selected.setAccount(id);
      const available=await selected.ready;
      if(disposed||hidden||current!==generation||selected!==controller||!['member','guest'].includes(authState.status))return;
      loading.hidden=true;preparing.hidden=available;root.hidden=!available;
      if(available&&!selected.mount(root))error();
    }catch{if(current===generation&&!disposed){discard();loading.hidden=true;preparing.hidden=false;error();}}
  }
  function changed(value){
    if(disposed)return;authState=value;
    root.hidden=true;loading.hidden=value.status!=='checking';
    form.hidden=value.status==='member'||value.status==='checking'||value.status==='unavailable';
    logout.hidden=value.status!=='member';retry.hidden=!['error','unavailable'].includes(value.status);
    if(value.status==='checking'){
      // Hide while revalidating, but retain unsaved memory for the SAME account.
      // An event for another account/signout destroys it before async work starts.
      if(value.candidateId!==account)discard();
      status.textContent='계정을 확인하고 있어요.';return;
    }
    if(value.status==='member'){
      status.textContent=`${value.user.email||'INHAGAME 회원'} · 내 학습 기록`;void show(value.user.id);
    }else if(value.status==='guest'){
      status.textContent='게스트 · 이 브라우저에 기록 보관';void show(null);
    }else{
      // Failed verification never renders a previously signed-in account's data.
      status.textContent=value.status==='unavailable'?'계정 서비스를 불러오지 못했어요.':'계정을 확인하지 못했어요. 연결을 확인하고 다시 시도하세요.';
      loading.hidden=true;preparing.hidden=false;
    }
  }
  const auth=createLearningWebAuth({client,onState:changed});
  async function submit(event){
    event.preventDefault();if(busy||disposed)return;busy=true;form.querySelector('button').disabled=true;notice.textContent='';
    const credentials={email:email.value.trim(),password:password.value};password.value='';
    try{await auth.signIn(credentials.email,credentials.password);}
    catch{if(!disposed)notice.textContent='로그인하지 못했어요. 이메일과 비밀번호, 연결 상태를 확인해 주세요.';}
    finally{credentials.password='';busy=false;if(!disposed)form.querySelector('button').disabled=false;}
  }
  async function signOut(){
    notice.textContent='';try{await auth.signOut();}catch{if(!disposed)notice.textContent='로그아웃 확인에 실패했어요. 개인 학습 화면을 잠갔습니다. 다시 확인해 주세요.';}
  }
  form.addEventListener('submit',submit,{signal:events.signal});
  logout.addEventListener('click',signOut,{signal:events.signal});
  retry.addEventListener('click',()=>{notice.textContent='';if(!client){win.location.reload();return;}void auth.refresh();},{signal:events.signal});
  const suspend=()=>{hidden=true;root.hidden=true;controller?.unmount();};
  const resume=()=>{if(disposed)return;hidden=false;void auth.refresh();};
  win.addEventListener('pagehide',suspend,{signal:events.signal});
  win.addEventListener('pageshow',event=>{if(event.persisted)resume();},{signal:events.signal});
  // A verified page can retain offline unsaved progress; no eager revalidation on
  // every focus. Auth broadcasts fence account changes, BFCache always revalidates.
  return Object.freeze({
    start(){clearLearningUrl(win);return auth.start();},
    snapshot:()=>({auth:auth.snapshot(),account,mounted:!!controller?.snapshot().mounted,learning:controller?.snapshot()??null}),
    dispose(){if(disposed)return;disposed=true;events.abort();auth.dispose();discard();}
  });
}
