// Explicit QA-only Firebase → Tier 4 → Neon integration surface.
// This does not replace the PlayCanvas account authority or enable writes.
// It only appears on isolated Pages preview hosts with ?neon_auth_qa=1.
import { createNeonAuthReadBridge } from './read-bridge.js';

const QA_ORIGIN = /(^|\.)(?:inhagame-playcanvas-live|inha-world-playcanvas-qa)\.pages\.dev$/i;
export function neonAuthQaAllowed(host, search) {
  return QA_ORIGIN.test(host) && new URLSearchParams(search).get('neon_auth_qa') === '1';
}
function createNode(tag, attrs = {}, text = '') {
  const node = document.createElement(tag);
  for (const [k,v] of Object.entries(attrs)) node.setAttribute(k,v);
  if (text) node.textContent = text;
  return node;
}
function mountAuthQa() {
  let bridge;
  try { bridge = createNeonAuthReadBridge({
    storage: window.localStorage, fetchImpl: window.fetch.bind(window),
    baseUrl: window.location.origin
  }); } catch { return; }
  const style=createNode('style');
  style.textContent=`
  #neon-auth-qa-open{position:fixed;left:12px;bottom:12px;z-index:2147483600;background:#122b43;color:#f6fbff;border:1px solid #86e2ed;border-radius:9px;padding:9px 12px;font:600 14px system-ui;cursor:pointer}
  #neon-auth-qa-dialog{z-index:2147483601;inset:8px 8px auto auto;position:fixed;width:min(410px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;background:#0e1c2c;color:#f3f9ff;border:1px solid #86e2ed;border-radius:12px;box-shadow:0 18px 55px #0009;padding:18px;font:14px/1.45 system-ui}
  #neon-auth-qa-dialog::backdrop{background:#010d19b8}
  #neon-auth-qa-dialog label{display:block;margin:10px 0 4px}
  #neon-auth-qa-dialog input{box-sizing:border-box;width:100%;padding:10px;background:#152e44;color:white;border:1px solid #7997a7;border-radius:7px}
  #neon-auth-qa-dialog button{margin:8px 6px 0 0;padding:8px 12px;cursor:pointer;background:#164564;color:white;border:1px solid #77bbd1;border-radius:7px}
  #neon-auth-qa-dialog button:disabled{opacity:.5;cursor:not-allowed}
  #neon-auth-qa-dialog [data-role=close]{float:right}
  #neon-auth-qa-dialog h2{font-size:18px;margin:0 0 8px}
  #neon-auth-qa-dialog .neon-note{font-size:12px;color:#b6cad7}
  #neon-auth-qa-dialog pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.5 ui-monospace,monospace;background:#091523;padding:10px;border-radius:7px;max-height:135px;overflow:auto}
  `;
  document.head.appendChild(style);
  const open=createNode('button',{id:'neon-auth-qa-open',type:'button'},'Neon 계정 QA');
  const dialog=createNode('dialog',{id:'neon-auth-qa-dialog','aria-label':'인하월드 Firebase 인증 QA'});
  dialog.innerHTML=`
    <button type="button" data-role="close" aria-label="닫기">닫기</button>
    <h2>Neon 계정 연결 QA</h2>
    <p class="neon-note">Firebase가 신원을 확인하고 Tier 4 Worker가 Neon에서 사용자 정보를 읽습니다. 이 화면은 조회 전용이며 프로필 생성, 저장 쓰기, 게스트 계정 승계를 하지 않습니다.</p>
    <p data-role="status" aria-live="polite">인증 경로 확인 중…</p>
    <label for="neon-auth-qa-email">이메일</label>
    <input id="neon-auth-qa-email" type="email" autocomplete="username" maxlength="254"/>
    <label for="neon-auth-qa-password">비밀번호</label>
    <input id="neon-auth-qa-password" type="password" autocomplete="current-password"/>
    <button type="button" data-role="email">이메일 로그인</button>
    <button type="button" data-role="google">Google 로그인</button>
    <button type="button" data-role="restore">기존 세션 조회</button>
    <button type="button" data-role="snapshot">프로필·저장 조회</button>
    <button type="button" data-role="logout">로그아웃</button>
    <pre data-role="result" aria-label="API 진단 결과">조회 결과 없음</pre>
    <p class="neon-note">보안 게이트: Firebase 웹 앱 공개 설정(apiKey/authDomain/projectId)이 일치하지 않으면 로그인 불가. 운영 서버의 v2 프로필 연결 보완 전까지 저장 변경은 비활성화됩니다.</p>`;
  document.body.append(open,dialog);
  const $ = name => dialog.querySelector('[data-role="'+name+'"]');
  const setStatus=message=>{$('status').textContent=message;};
  const buttons=['email','google','restore','snapshot','logout'].map($);
  let busy=false,backend=null,authPromise=null;
  function setBusy(next) {busy=next;for(const b of buttons)b.disabled=next;}
  function message(error) {return String(error?.code||error?.message||error||'알 수 없는 오류').slice(0,150);}
  async function inspectBackend() {
    try {
      const data=await bridge.config();
      if(typeof data?.projectId!=='string'||typeof data.authDomain!=='string')throw Error('INVALID_FIREBASE_CONFIG');
      backend=data;
      setStatus('Tier 4 Firebase API 응답 정상. 세션을 조회할 수 있습니다.');
      return true;
    } catch(e) {
      setStatus('QA API 라우트 미연결: '+message(e)+'. 실제 로그인은 비활성화됩니다.');
      return false;
    }
  }
  function loadScript(url) {
    return new Promise((resolve,reject)=>{
      const s=createNode('script',{src:url});
      s.addEventListener('load',resolve,{once:true});s.addEventListener('error',()=>reject(Error('FIREBASE_SDK_LOAD_FAILED')),{once:true});
      document.head.appendChild(s);
    });
  }
  async function firebaseAuth() {
    if(!backend)throw Error('TIER4_BACKEND_REQUIRED');
    const c=window.__INHAWORLD_FIREBASE_WEB_CONFIG__;
    if(!c || typeof c.apiKey!=='string' || typeof c.projectId!=='string' ||
       typeof c.authDomain!=='string' || !c.appId)throw Error('FIREBASE_WEB_CONFIG_REQUIRED');
    if(c.projectId!==backend.projectId||c.authDomain!==backend.authDomain)throw Error('FIREBASE_PROJECT_MISMATCH');
    authPromise??=(async()=>{
      if(!window.firebase?.apps)await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
      if(!window.firebase?.auth)await loadScript('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js');
      const app=window.firebase.apps.length?window.firebase.apps[0]:window.firebase.initializeApp(c);
      if(app.options.projectId!==backend.projectId)throw Error('FIREBASE_PROJECT_MISMATCH');
      return app.auth();
    })().catch(e=>{authPromise=null;throw e;});
    return authPromise;
  }
  async function run(label,fn){
    if(busy)return;
    setBusy(true);
    try {const result=await fn();$('result').textContent=typeof result==='string'?result:JSON.stringify(result,null,2);
      setStatus(label+' 완료. 저장·쓰기 기능은 아직 연결하지 않았습니다.');}
    catch(e){$('result').textContent='Error: '+message(e);setStatus(label+' 실패: '+message(e));}
    finally{setBusy(false);}
  }
  async function exchange(firebaseUser) {
    const token=await firebaseUser.getIdToken();
    const result=await bridge.login(token,{expectedUid:firebaseUser.uid});
    return {provider:result.identity?.provider,linked:result.linked,profileUserId:result.identity?.profileUserId??null,
      message:result.linked?'Firebase 계정 확인됨. 읽기 경로만 연결':'Firebase 인증됨. 계정 프로필 연결은 v2 적용 전까지 보류'};
  }
  $('email').addEventListener('click',()=>run('이메일 로그인',async()=>{
    const auth=await firebaseAuth();
    const email=dialog.querySelector('#neon-auth-qa-email').value.trim();
    const password=dialog.querySelector('#neon-auth-qa-password').value;
    if(!email||!password)throw Error('EMAIL_PASSWORD_REQUIRED');
    const cred=await auth.signInWithEmailAndPassword(email,password);
    dialog.querySelector('#neon-auth-qa-password').value='';
    return exchange(cred.user);
  }));
  $('google').addEventListener('click',()=>run('Google 로그인',async()=>{
    const auth=await firebaseAuth();
    const cred=await auth.signInWithPopup(new window.firebase.auth.GoogleAuthProvider());
    return exchange(cred.user);
  }));
  $('restore').addEventListener('click',()=>run('기존 세션 조회',async()=>{
    const data=await bridge.me();
    return {guest:data.guest===true,provider:data.provider??null,hasLinkedProfile:!!data.profileUserId};
  }));
  $('snapshot').addEventListener('click',()=>run('서버 읽기',async()=>{
    const data=await bridge.readSnapshot();
    return {linked:data.linked,resources:data.resources};
  }));
  $('logout').addEventListener('click',()=>run('로그아웃',async()=>{
    const result=await bridge.logout();
    try{const auth=await firebaseAuth();await auth.signOut();}catch{}
    return result;
  }));
  $('close').addEventListener('click',()=>dialog.close());
  open.addEventListener('click',()=>{dialog.showModal();void inspectBackend();});
  // Do not log secrets/session IDs. Public diagnostic reports capability only.
  window.__INHAWORLD_NEON_AUTH_QA__=Object.freeze({
    state:()=>({enabled:true,backendAvailable:!!backend,hasSession:!!bridge.getSessionId()})
  });
}
if(typeof window!=='undefined'&&typeof document!=='undefined'&&
    neonAuthQaAllowed(window.location.hostname,window.location.search)){
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mountAuthQa,{once:true});
  else mountAuthQa();
}
