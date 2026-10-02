// Classic · Supabase client, account/auth, cloud progress sync, telemetry, ranked runs and recovery,
// leaderboard and event ranking. Uses game.js functions only after load, never while this file runs.
// Classic script (not a module): shares one global scope with the other js/*.js files and must
// load in index.html order: dom -> online -> game -> boot.
const SUPABASE_URL=((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url);
const SUPABASE_PUBLISHABLE_KEY=((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).publishableKey);
const ONLINE_BUILD='v1.0.4-recovery1';
const ONLINE_RULESET='secret-2.2-r1';
const BALANCE_VERSION='classic-balance-1.0.2';
const CLASSIC_PRODUCTION_HOSTS=new Set(['inha-duck.example','duck.inhagame.example']);
const sb=window.supabase?.createClient
  ? window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true}})
  : null;
let onlineUser=null,onlineProfile=null,rankingMode='general',rankingTab='overall',rankingChannel=null;
let accountPermanent=false,accountCloudReady=false,cloudSyncTimer=null,accountEmailBlockedUntil=0,inhaBadgeVerified=false,eventBadgeCode=null;
let memberActivityLastAt=0,memberActivityPending=false;
const MEMBER_ACTIVITY_INTERVAL_MS=300000;
let rankedSession=null,rankedMode=false,rankedStartedPerf=0;
let generalRunId=null,generalRunStartedPerf=0;
let lastGeneralResultContext=null;
const TELEMETRY_RUN_TYPE=CLASSIC_PRODUCTION_HOSTS.has(location.hostname)?'production':'qa';
const TELEMETRY_SOURCE=(()=>{
  const raw=(new URLSearchParams(location.search).get('src')||'direct').trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(raw)?raw:'other';
})();
const TELEMETRY_DEVICE=(navigator.userAgentData?.mobile??/Mobi|Android/i.test(navigator.userAgent))?'mobile':'desktop';
function makeTelemetryRunId(){
  if(globalThis.crypto?.randomUUID)return crypto.randomUUID();
  const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const h=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
function getTelemetryId(storage,key){
  try{
    let value=storage.getItem(key);
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value||'')){
      value=makeTelemetryRunId();
      storage.setItem(key,value);
    }
    return value;
  }catch(e){
    return makeTelemetryRunId();
  }
}
const TELEMETRY_VISITOR_ID=getTelemetryId(localStorage,'inhaDuckTelemetryVisitorV1');
const TELEMETRY_SESSION_ID=getTelemetryId(sessionStorage,'inhaDuckTelemetrySessionV1');
const TELEMETRY_SESSION_MARKER='inhaDuckTelemetrySessionStartedV1';
const RANKED_RECOVERY_INCIDENT='ranked-start-v6-8-20260924';
const RANKED_RECOVERY_QUEUE_KEY='inhaDuckRankedRecoveryQueueV1';
let telemetryLastScreen='stage_select';
let telemetrySessionEndSent=false;
function setTelemetryLastScreen(screen){
  telemetryLastScreen=String(screen||'unknown');
}
async function logTelemetryUiEvent(eventType,lastScreen=null){
  if(!sb)return false;
  try{
    const {error}=await sb.rpc('log_general_ui_event_v1',{
      p_event_type:String(eventType||''),
      p_visitor_id:TELEMETRY_VISITOR_ID,
      p_session_id:TELEMETRY_SESSION_ID,
      p_last_screen:lastScreen?String(lastScreen):null,
      p_client_version:ONLINE_BUILD,
      p_balance_version:BALANCE_VERSION,
      p_run_type:TELEMETRY_RUN_TYPE,
      p_source:TELEMETRY_SOURCE,
      p_device:TELEMETRY_DEVICE
    });
    if(error)throw error;
    return true;
  }catch(e){
    console.warn('ui telemetry failed',eventType,e);
    return false;
  }
}
function logTelemetrySessionEndKeepalive(){
  if(telemetrySessionEndSent)return;
  telemetrySessionEndSent=true;
  try{
    fetch(`${SUPABASE_URL}/rest/v1/rpc/log_general_ui_event_v1`,{
      method:'POST',
      keepalive:true,
      headers:{
        'apikey':SUPABASE_PUBLISHABLE_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        p_event_type:'session_end',
        p_visitor_id:TELEMETRY_VISITOR_ID,
        p_session_id:TELEMETRY_SESSION_ID,
        p_last_screen:telemetryLastScreen||'unknown',
        p_client_version:ONLINE_BUILD,
        p_balance_version:BALANCE_VERSION,
        p_run_type:TELEMETRY_RUN_TYPE,
        p_source:TELEMETRY_SOURCE,
        p_device:TELEMETRY_DEVICE
      })
    });
  }catch(e){}
}
let rankedInputCount=0,rankedReactionSampleCount=0,rankedUltraFastReactionCount=0;
const ULTRA_FAST_REACTION_MS=80;
function resetRankedTelemetry(){
  rankedInputCount=0;rankedReactionSampleCount=0;rankedUltraFastReactionCount=0;
}
function recordRankedReaction(spawnedAt){
  if(!rankedMode||!isSecretStage())return;
  const shownAt=Number(spawnedAt);
  if(!Number.isFinite(shownAt)||shownAt<=0)return;
  const reactionMs=performance.now()-shownAt;
  if(reactionMs<0||reactionMs>5000)return;
  rankedReactionSampleCount++;
  if(reactionMs<ULTRA_FAST_REACTION_MS)rankedUltraFastReactionCount++;
}


async function touchMemberActivity(force=false){
  if(!sb?.rpc||!accountPermanent||!onlineUser?.id||memberActivityPending)return false;
  const now=Date.now();
  if(!force&&now-memberActivityLastAt<MEMBER_ACTIVITY_INTERVAL_MS)return false;
  memberActivityPending=true;
  try{
    const result=await sb.rpc('touch_inhagame_member_activity_v1',{p_surface:'classic'});
    if(result?.error)throw result.error;
    memberActivityLastAt=now;return true;
  }catch(e){console.warn('member activity touch failed',e);return false}
  finally{memberActivityPending=false}
}
async function ensureOnlineUser({create=true}={}){
  if(!sb)return null;
  try{
    const {data:{session}}=await sb.auth.getSession();
    if(session?.user){onlineUser=session.user;accountPermanent=session.user.is_anonymous===false;if(accountPermanent)void touchMemberActivity(true);return onlineUser}
    if(!create)return null;
    const {data,error}=await sb.auth.signInAnonymously();
    if(error)throw error;
    onlineUser=data.user||data.session?.user||null;
    accountPermanent=onlineUser?.is_anonymous===false;
    updateAccountTopLabel();
    return onlineUser;
  }catch(e){
    console.warn('online auth unavailable',e);
    return null;
  }
}
function updateAccountTopLabel(){
  if(!accountTopLabel)return;
  accountTopLabel.textContent=accountPermanent?(inhaBadgeVerified?'🎓 인증됨':'연결됨'):'계정';
}
function betterContract(a,b){
  const ai=SecretRun.RANKS.findIndex(r=>r.rank===a),bi=SecretRun.RANKS.findIndex(r=>r.rank===b);
  return bi>ai?b:a;
}
function mergeClassicProgress(localValue,remoteValue){
  const a=normalizeProgress(localValue),b=normalizeProgress(remoteValue);
  const merged=normalizeProgress({...a});
  merged.unlockedStage=Math.max(a.unlockedStage,b.unlockedStage);
  merged.totalPlays=Math.max(a.totalPlays,b.totalPlays);
  merged.bestCombo=Math.max(a.bestCombo,b.bestCombo);
  for(let id=1;id<=4;id++){
    const x=a.stages[id],y=b.stages[id];
    merged.stages[id]={
      cleared:x.cleared||y.cleared,
      stars:Math.max(x.stars,y.stars),
      bestScore:Math.max(x.bestScore,y.bestScore),
      bestCombo:Math.max(x.bestCombo,y.bestCombo),
      playCount:Math.max(x.playCount,y.playCount),
      clearCount:Math.max(x.clearCount,y.clearCount)
    };
  }
  const ah=SecretRun.normalizeHistory(a.hidden.sessionV2),bh=SecretRun.normalizeHistory(b.hidden.sessionV2);
  merged.hidden={...a.hidden,...b.hidden,
    unlocked:!!(a.hidden.unlocked||b.hidden.unlocked),
    cleared:!!(a.hidden.cleared||b.hidden.cleared),
    bestScore:Math.max(Number(a.hidden.bestScore||0),Number(b.hidden.bestScore||0)),
    bestCombo:Math.max(Number(a.hidden.bestCombo||0),Number(b.hidden.bestCombo||0)),
    playCount:Math.max(Number(a.hidden.playCount||0),Number(b.hidden.playCount||0)),
    unlockSeen:!!(a.hidden.unlockSeen||b.hidden.unlockSeen),
    titleUnlocked:false,
    sessionV2:{
      ...ah,
      plays:Math.max(Number(ah.plays||0),Number(bh.plays||0)),
      bestScore:Math.max(Number(ah.bestScore||0),Number(bh.bestScore||0)),
      bestContract:betterContract(ah.bestContract,bh.bestContract)
    }
  };
  return normalizeProgress(merged);
}
async function pushCloudProgress({migratedFromLocal=false,quiet=false}={}){
  if(!sb||!accountPermanent||!onlineUser)return false;
  const userId=onlineUser.id;
  try{
    const {error}=await sb.rpc('save_my_game_progress',{
      p_game_slug:'inha-duck',
      p_progress:progress,
      p_schema_version:2,
      p_migrated_from_local:!!migratedFromLocal
    });
    if(onlineUser?.id!==userId)return false;
    if(error)throw error;
    accountCloudReady=true;
    void touchMemberActivity();
    try{localStorage.removeItem('inhaDuckAccountProgressV2:'+userId)}catch(e){}
    if(!quiet&&accountStatus)accountStatus.textContent='클라우드 기록 동기화 완료';
    return true;
  }catch(e){
    console.warn('cloud progress save failed',e);
    if(!quiet&&accountStatus)accountStatus.textContent='클라우드 동기화 실패 · 잠시 후 다시 시도해 주세요.';
    return false;
  }
}
async function initializeCloudProgress(){
  if(!sb||!accountPermanent||!onlineUser)return false;
  const userId=onlineUser.id;
  try{
    const saved=localStorage.getItem('inhaDuckAccountProgressV2:'+onlineUser.id);
    if(saved){
      progress=mergeClassicProgress(progress,JSON.parse(saved));
      try{localStorage.setItem(SAVE_KEY,JSON.stringify(progress))}catch(e){}
      renderStageGrid();
    }
  }catch(e){}
  try{
    const {data,error}=await sb.rpc('get_my_game_progress',{p_game_slug:'inha-duck'});
    if(onlineUser?.id!==userId)return false;
    if(error)throw error;
    const row=Array.isArray(data)?data[0]:null;
    if(row?.progress){
      progress=mergeClassicProgress(progress,row.progress);
      try{localStorage.setItem(SAVE_KEY,JSON.stringify(progress))}catch(e){}
      accountCloudReady=true;
      renderStageGrid();
      await pushCloudProgress({quiet:true});
    }else{
      accountCloudReady=true;
      await pushCloudProgress({migratedFromLocal:true,quiet:true});
    }
    if(accountStatus)accountStatus.textContent='계정 연결됨 · Classic 기록을 클라우드에 보관합니다.';
    return true;
  }catch(e){
    console.warn('cloud progress load failed',e);
    if(accountStatus)accountStatus.textContent='계정은 연결됐지만 클라우드 기록을 불러오지 못했습니다.';
    return false;
  }
}
function scheduleCloudProgressSync(){
  if(!accountPermanent||!accountCloudReady)return;
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer=setTimeout(()=>{void pushCloudProgress({quiet:true});},900);
}
function renderAccountPanel(){
  updateAccountTopLabel();
  if(accountPermanent&&onlineUser){
    accountGuestPanel.classList.add('hidden');
    accountPermanentPanel.classList.remove('hidden');
    accountEmail.textContent=onlineUser.email||'이메일 계정';
    if(document.activeElement!==accountNicknameInput)accountNicknameInput.value=onlineProfile?.nickname||'';
    accountNicknameSaveBtn.textContent=onlineProfile?'닉네임 변경':'닉네임 등록';
    accountInhaVerified.classList.toggle('hidden',!inhaBadgeVerified);
    accountInhaForm.classList.toggle('hidden',inhaBadgeVerified);
    accountStatus.textContent=accountCloudReady?'계정 연결됨 · 클라우드 동기화 사용 중':'계정 연결됨 · 기록 동기화 준비 중...';
  }else{
    accountGuestPanel.classList.remove('hidden');
    accountPermanentPanel.classList.add('hidden');
    accountStatus.textContent='게스트 플레이 중 · 로그인 없이도 계속 플레이할 수 있어요.';
  }
}
async function refreshAccountState(){
  if(!sb)return false;
  try{
    const {data,error}=await sb.auth.refreshSession();
    if(error)throw error;
    onlineUser=data.session?.user||onlineUser;
    accountPermanent=onlineUser?.is_anonymous===false;
    if(accountPermanent)void touchMemberActivity(true);
    renderAccountPanel();
    if(accountPermanent){try{await loadOnlineProfile();renderAccountPanel()}catch(e){console.warn('profile refresh failed',e)}await loadInhaBadge();await initializeCloudProgress()}
    return accountPermanent;
  }catch(e){
    console.warn('account refresh failed',e);
    accountStatus.textContent='인증 상태를 확인하지 못했습니다. 페이지를 새로고침해 주세요.';
    return false;
  }
}
async function openAccount(){
  accountPasswordStatus.textContent='';
  accountOverlay.classList.remove('hidden');
  setAccountMode('signup');
  accountStatus.textContent='계정 상태 확인 중...';
  const user=await ensureOnlineUser({create:true});
  accountPermanent=user?.is_anonymous===false;
  renderAccountPanel();
  if(accountPermanent){
    try{await loadOnlineProfile();renderAccountPanel()}catch(e){console.warn('account profile load failed',e);accountNicknameStatus.textContent='닉네임을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.'}
    await loadInhaBadge();
    if(!accountCloudReady)await initializeCloudProgress();
  }
}
function closeAccount(){accountOverlay.classList.add('hidden')}
async function signOutAccount(){
  if(!sb||!accountPermanent||!onlineUser)return;
  accountSignOutBtn.disabled=true;
  accountStatus.textContent='로그아웃 중...';
  const oldUserId=onlineUser.id;
  const oldProgress=JSON.stringify(progress);
  try{
    const {error}=await sb.auth.signOut({scope:'local'});
    if(error)throw error;
    clearTimeout(cloudSyncTimer);
    cloudSyncTimer=null;
    try{
      localStorage.setItem('inhaDuckAccountProgressV2:'+oldUserId,oldProgress);
      localStorage.setItem(SAVE_KEY,JSON.stringify(defaultProgress()));
    }catch(e){console.warn('account progress cache update failed',e)}
    onlineUser=null;onlineProfile=null;accountPermanent=false;accountCloudReady=false;inhaBadgeVerified=false;eventBadgeCode=null;renderBadges();
    accountLoginPasswordInput.value='';
    accountNewPasswordInput.value='';
    accountNewPasswordConfirmInput.value='';
    location.reload();
  }catch(e){
    console.warn('account sign out failed',e);
    accountStatus.textContent='로그아웃에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    accountSignOutBtn.disabled=false;
  }
}
function setAccountMode(mode){
  const signup=mode!=='login';
  accountSignupPanel.classList.toggle('hidden',!signup);
  accountLoginPanel.classList.toggle('hidden',signup);
  accountSignupTab.classList.toggle('selected',signup);
  accountLoginTab.classList.toggle('selected',!signup);
}
function canRequestAccountEmail(){
  const remaining=accountEmailBlockedUntil-Date.now();
  if(remaining<=0)return true;
  accountStatus.textContent='인증 메일 재요청까지 약 '+Math.ceil(remaining/1000)+'초 기다려 주세요.';
  return false;
}
function blockAccountEmail(seconds=60){
  accountEmailBlockedUntil=Math.max(accountEmailBlockedUntil,Date.now()+seconds*1000);
}
async function loadInhaBadge(){
  if(!sb||!accountPermanent||!onlineUser){
    inhaBadgeVerified=false;
    eventBadgeCode=null;
    renderBadges();
    return;
  }
  const userId=onlineUser.id;
  const [{data,error},{data:eventRank,error:eventError}]=await Promise.all([
    sb.rpc('my_inha_mail_badge'),
    sb.rpc('get_my_rank_v4')
  ]);
  if(error||onlineUser?.id!==userId)return;
  inhaBadgeVerified=data===true;
  eventBadgeCode=null;
  if(!eventError&&onlineUser?.id===userId){
    const row=Array.isArray(eventRank)?eventRank[0]:null;
    eventBadgeCode=row?.event_badge||null;
  }
  updateAccountTopLabel();
  renderBadges();
  if(!accountOverlay.classList.contains('hidden'))renderAccountPanel();
}
async function requestInhaBadge(){
  if(!sb||!accountPermanent||!onlineUser){accountStatus.textContent='기존 계정으로 먼저 로그인해 주세요.';return}
  if(!canRequestAccountEmail())return;
  const email=accountInhaEmailInput.value.trim().toLowerCase();
  if(!/^[^@\s]+@(inha\.edu|inha\.ac\.kr)$/.test(email)){
    accountStatus.textContent='인하대 메일 주소(@inha.edu 또는 @inha.ac.kr)를 입력해 주세요.';return;
  }
  accountInhaRequestBtn.disabled=true;
  try{
    accountStatus.textContent='인하대 메일 인증 링크를 보내는 중...';
    const {error}=await sb.auth.signInWithOtp({email,options:{
      shouldCreateUser:true,emailRedirectTo:location.origin+'/verify-inha.html'
    }});
    if(error)throw error;
    blockAccountEmail();
    accountStatus.textContent='인증 메일을 보냈어요. 메일의 6자리 코드를 아래에 입력하면 기존 계정에 뱃지가 추가됩니다.';
  }catch(e){
    console.warn('inha mail verification request failed',e);
    accountStatus.textContent=/rate limit/i.test(String(e?.message||e))
      ? '인증 메일 요청이 잦아요. 잠시 후 다시 시도해 주세요.'
      : '인증 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.';
  }finally{accountInhaRequestBtn.disabled=false}
}
async function confirmInhaBadge(){
  if(!sb||!accountPermanent||!onlineUser)return;
  const email=accountInhaEmailInput.value.trim().toLowerCase();
  const code=accountInhaCodeInput.value.trim();
  if(!/^[^@\s]+@(inha\.edu|inha\.ac\.kr)$/.test(email)||!/^\d{6}$/.test(code)){
    accountStatus.textContent='인하대 메일과 6자리 인증 코드를 확인해 주세요.';return;
  }
  accountInhaConfirmBtn.disabled=true;
  try{
    accountStatus.textContent='인하대 메일 인증 중...';
    const secondary=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
      auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}
    });
    const {data:school,error:otpError}=await secondary.auth.verifyOtp({email,token:code,type:'email'});
    if(otpError||!school.session?.access_token)throw otpError||new Error('No school session');
    const {data:{session:primary}}=await sb.auth.getSession();
    if(!primary?.access_token||primary.user.id!==onlineUser.id)throw new Error('Primary session changed');
    const response=await fetch(SUPABASE_URL+'/functions/v1/verify-inha-mail',{
      method:'POST',headers:{'Content-Type':'application/json',apikey:SUPABASE_PUBLISHABLE_KEY,
        Authorization:'Bearer '+primary.access_token},
      body:JSON.stringify({school_access_token:school.session.access_token})
    });
    const result=await response.json();
    if(!response.ok){
      accountStatus.textContent=result.error==='EMAIL_ALREADY_LINKED'
        ? '이미 다른 계정에서 사용 중인 인하대 메일입니다.'
        : '인증을 완료하지 못했어요. 코드를 다시 확인해 주세요.';
      return;
    }
    await loadInhaBadge();
    accountInhaCodeInput.value='';
    accountStatus.textContent='🎓 인하 메일 인증 뱃지가 추가됐어요.';
  }catch(e){
    console.warn('inha mail confirmation failed',e);
    accountStatus.textContent='인증 코드가 만료되었거나 맞지 않아요. 새 인증 메일을 요청해 주세요.';
  }finally{accountInhaConfirmBtn.disabled=false}
}
async function beginAccountSignup(){
  if(!sb||!canRequestAccountEmail())return;
  const email=accountSignupEmailInput.value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    accountStatus.textContent='사용할 이메일 주소를 확인해 주세요.';return;
  }
  const user=await ensureOnlineUser({create:true});
  if(!user){accountStatus.textContent='게스트 계정을 준비하지 못했습니다.';return}
  if(user.is_anonymous===false){accountPermanent=true;renderAccountPanel();await initializeCloudProgress();return}
  accountSignupBtn.disabled=true;
  accountStatus.textContent='회원가입 인증 메일을 보내는 중...';
  try{
    const {error}=await sb.auth.updateUser({email});
    if(error)throw error;
    blockAccountEmail();
    accountStatus.textContent='회원가입 인증 메일을 보냈어요. 메일 인증 후 돌아와 “인증 완료 확인”을 눌러 주세요.';
  }catch(e){
    console.warn('account signup email failed',e);
    const msg=String(e?.message||e||'');
    if(/rate limit/i.test(msg)){
      blockAccountEmail();
      accountStatus.textContent='회원가입 메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.';
    }else if(/already|registered|exists|identity/i.test(msg)){
      accountStatus.textContent='이미 가입된 이메일일 수 있어요. 로그인 탭에서 로그인해 주세요.';
    }else{
      accountStatus.textContent='회원가입을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
  }finally{
    accountSignupBtn.disabled=false;
  }
}
async function captureGuestRankingProfile(){
  try{
    const {data:{session}}=await sb.auth.getSession();
    if(!session?.user?.is_anonymous)return null;
    const {data,error}=await sb.from('profiles').select('nickname,department_id').eq('user_id',session.user.id).maybeSingle();
    if(error)throw error;
    return data;
  }catch(e){console.warn('guest ranking profile read failed',e);return null}
}
async function restoreGuestRankingProfile(guestProfile){
  if(!guestProfile||!onlineUser||!accountPermanent)return false;
  try{
    const {data:existing,error:readError}=await sb.from('profiles').select('user_id,nickname,department_id,title').eq('user_id',onlineUser.id).maybeSingle();
    if(readError)throw readError;
    if(existing){onlineProfile=existing;return false}
    const {data:created,error:insertError}=await sb.from('profiles')
      .insert({user_id:onlineUser.id,nickname:guestProfile.nickname,department_id:guestProfile.department_id})
      .select('user_id,nickname,department_id,title').single();
    if(insertError)throw insertError;
    onlineProfile=created;
    await syncAllGeneralBests();
    return true;
  }catch(e){console.warn('guest ranking profile copy failed',e);return false}
}
async function signInAccountPassword(){
  if(!sb)return false;
  const email=accountLoginEmailInput.value.trim().toLowerCase();
  const password=accountLoginPasswordInput.value;
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    accountStatus.textContent='이메일 주소를 확인해 주세요.';return false;
  }
  if(password.length<8){accountStatus.textContent='비밀번호는 8자 이상 입력해 주세요.';return false}
  accountPasswordLoginBtn.disabled=true;
  accountStatus.textContent='로그인 중...';
  const guestProfile=await captureGuestRankingProfile();
  try{
    const {data,error}=await sb.auth.signInWithPassword({email,password});
    if(error)throw error;
    onlineUser=data.user||data.session?.user||null;
    accountPermanent=onlineUser?.is_anonymous===false;
    accountCloudReady=false;
    renderAccountPanel();
    if(accountPermanent){await loadInhaBadge();await initializeCloudProgress()}
    const copiedGuestProfile=await restoreGuestRankingProfile(guestProfile);
    if(accountPermanent){try{await loadOnlineProfile();renderAccountPanel()}catch(e){console.warn('profile load after login failed',e)}}
    accountStatus.textContent=copiedGuestProfile
      ? '로그인 완료 · 게스트 닉네임·학과와 일반 스테이지 기록을 계정 랭킹에 연결했어요. 이전 공식 랭킹전 기록은 별도로 남아 있습니다.'
      : '로그인 완료 · INHAGAME 계정이 연결됐습니다.';
    return true;
  }catch(e){
    console.warn('password login failed',e);
    const msg=String(e?.message||e||'');
    accountStatus.textContent=/invalid login credentials/i.test(msg)
      ? '이메일 또는 비밀번호가 맞지 않습니다.'
      : /email not confirmed/i.test(msg)
        ? '이메일 인증을 먼저 완료해 주세요.'
        : '로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.';
    return false;
  }finally{
    accountPasswordLoginBtn.disabled=false;
  }
}
async function sendAccountLoginLink(){
  if(!sb||!canRequestAccountEmail())return false;
  const email=accountLoginEmailInput.value.trim().toLowerCase();
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    accountStatus.textContent='이메일 주소를 확인해 주세요.';return false;
  }
  accountLoginLinkBtn.disabled=true;
  accountStatus.textContent='로그인 링크를 보내는 중...';
  try{
    const {error}=await sb.auth.signInWithOtp({email,options:{shouldCreateUser:false,emailRedirectTo:location.origin+'/'}});
    if(error)throw error;
    blockAccountEmail();
    accountStatus.textContent='로그인 링크를 보냈어요. 메일에서 열면 이 기기에서도 같은 계정을 사용할 수 있습니다.';
    return true;
  }catch(e){
    console.warn('login link failed',e);
    const msg=String(e?.message||e||'');
    if(/rate limit/i.test(msg)){
      blockAccountEmail();accountStatus.textContent='로그인 메일을 너무 자주 요청했어요. 잠시 후 다시 시도해 주세요.';
    }else if(/signups not allowed for otp/i.test(msg)){
      accountStatus.textContent='가입된 계정을 찾지 못했습니다. 회원가입 탭에서 먼저 가입해 주세요.';
    }else{
      accountStatus.textContent='로그인 링크를 보내지 못했습니다. 잠시 후 다시 시도해 주세요.';
    }
    return false;
  }finally{
    accountLoginLinkBtn.disabled=false;
  }
}
async function setAccountPassword(){
  const showPasswordStatus=message=>{
    accountPasswordStatus.textContent=message;
    accountStatus.textContent=message;
  };
  if(!sb||!accountPermanent){showPasswordStatus('이메일 인증을 먼저 완료해 주세요.');return false}
  const password=accountNewPasswordInput.value;
  const confirmation=accountNewPasswordConfirmInput.value;
  if(password.length<8){showPasswordStatus('비밀번호는 8자 이상 입력해 주세요.');return false}
  if(password!==confirmation){showPasswordStatus('비밀번호 확인이 일치하지 않습니다.');return false}
  accountSetPasswordBtn.disabled=true;
  showPasswordStatus('비밀번호를 저장하는 중...');
  try{
    const {error}=await sb.auth.updateUser({password});
    if(error)throw error;
    accountNewPasswordInput.value='';
    accountNewPasswordConfirmInput.value='';
    showPasswordStatus('비밀번호를 저장했어요. 이제 이메일과 비밀번호로 로그인할 수 있습니다.');
    return true;
  }catch(e){
    console.warn('password setup failed',e);
    const code=String(e?.code||'');
    const message=String(e?.message||'');
    if(code==='same_password'||/new password should be different/i.test(message)){
      showPasswordStatus('이미 설정된 비밀번호예요. 변경하려면 다른 비밀번호를 입력해 주세요.');
    }else if(code==='reauthentication_needed'){
      showPasswordStatus('보안을 위해 다시 로그인한 뒤 비밀번호를 변경해 주세요.');
    }else if(code==='weak_password'){
      showPasswordStatus('사용하기 어려운 비밀번호예요. 8자 이상으로 더 안전하게 입력해 주세요.');
    }else{
      showPasswordStatus('비밀번호 저장에 실패했어요. 연결 상태를 확인하고 다시 시도해 주세요.');
    }
    return false;
  }finally{
    accountSetPasswordBtn.disabled=false;
  }
}
async function initAccountAuth(){
  if(!sb)return;
  try{
    const {data:{session}}=await sb.auth.getSession();
    onlineUser=session?.user||onlineUser;
    accountPermanent=onlineUser?.is_anonymous===false;
    updateAccountTopLabel();
    if(accountPermanent){await loadInhaBadge();await initializeCloudProgress()}
    sb.auth.onAuthStateChange((_event,nextSession)=>{
      if(onlineUser?.id!==nextSession?.user?.id){inhaBadgeVerified=false;onlineProfile=null;}
      onlineUser=nextSession?.user||null;
      accountPermanent=onlineUser?.is_anonymous===false;
      if(!onlineUser){accountCloudReady=false;clearTimeout(cloudSyncTimer);cloudSyncTimer=null;}
      updateAccountTopLabel();
      setTimeout(()=>{
        renderAccountPanel();
        if(accountPermanent){
          if(!onlineProfile)void loadOnlineProfile().then(()=>renderAccountPanel()).catch(e=>console.warn('profile refresh failed',e));
          void loadInhaBadge();if(!accountCloudReady)void initializeCloudProgress();
        }
      },0);
    });
  }catch(e){console.warn('account init failed',e)}
}
function loadRankedRecoveryQueue(){
  try{
    const parsed=JSON.parse(localStorage.getItem(RANKED_RECOVERY_QUEUE_KEY)||'[]');
    return Array.isArray(parsed)?parsed.slice(-20):[];
  }catch(e){return []}
}
function saveRankedRecoveryQueue(queue){
  try{localStorage.setItem(RANKED_RECOVERY_QUEUE_KEY,JSON.stringify((queue||[]).slice(-20)));return true}
  catch(e){return false}
}
function buildRankedRecoveryPayload(){
  return {
    score:Math.max(0,Math.trunc(Number(score)||0)),
    maxCombo:Math.max(0,Math.trunc(Number(maxCombo)||0)),
    normalHits:Math.max(0,Math.trunc(Number(normalHits)||0)),
    speedyHits:Math.max(0,Math.trunc(Number(speedyHits)||0)),
    goldHits:Math.max(0,Math.trunc(Number(goldHits)||0)),
    indeokiHits:Math.max(0,Math.trunc(Number(indeokHits)||0)),
    annyongiHits:Math.max(0,Math.trunc(Number(annyongiClicked)||0)),
    annyongiDodges:Math.max(0,Math.trunc(Number(annyongiDodges)||0)),
    moonBonusHits:Math.max(0,Math.trunc(Number(moonBonusHits)||0)),
    dragonCalls:Math.max(0,Math.trunc(Number(dragonCalls)||0)),
    completedCalls:Math.max(0,Math.trunc(Number(secretRun?.completedCalls)||0)),
    flightHits:Math.max(0,Math.trunc(Number(secretRun?.flightCaptures)||0)),
    comboBonus:Math.max(0,Math.trunc(Number(secretRun?.comboBonus)||0)),
    flightBasePoints:Math.max(0,Math.trunc(Number(secretRun?.flightBasePoints)||0)),
    tier1Hits:Math.max(0,Math.trunc(Number(secretRun?.tier1Hits)||0)),
    tier2Hits:Math.max(0,Math.trunc(Number(secretRun?.tier2Hits)||0)),
    tier1GroundAward:Math.max(0,Math.trunc(Number(secretRun?.tier1GroundAward)||0)),
    tier2GroundAward:Math.max(0,Math.trunc(Number(secretRun?.tier2GroundAward)||0)),
    ascensionBonus:Math.max(0,Math.trunc(Number(secretRun?.ascensionBonus)||0)),
    totalHits:Math.max(0,Math.trunc(Number(normalHits+speedyHits+goldHits+indeokHits+annyongiClicked)||0)),
    inputCount:Math.max(0,Math.trunc(Number(rankedInputCount)||0)),
    reactionSampleCount:Math.max(0,Math.trunc(Number(rankedReactionSampleCount)||0)),
    ultraFastReactionCount:Math.max(0,Math.trunc(Number(rankedUltraFastReactionCount)||0)),
    durationMs:Math.max(0,Math.trunc(Number(runResult?.durationMs)||0)),
    contract:runResult?.contract?.rank||null,
    completed:Boolean(runResult?.completed),
    capturedAt:new Date().toISOString()
  };
}
async function flushRankedRecoveryQueue(){
  if(!sb)return false;
  const queue=loadRankedRecoveryQueue();
  if(!queue.length)return true;
  const remaining=[];
  for(const item of queue){
    try{
      const {data,error}=await sb.rpc('submit_ranked_recovery_snapshot_v1',{
        p_client_snapshot_id:item.snapshotId,
        p_visitor_id:TELEMETRY_VISITOR_ID,
        p_session_id:item.sessionId||TELEMETRY_SESSION_ID,
        p_reason:item.reason||'ranked_session_unavailable',
        p_ruleset_version:item.rulesetVersion||ONLINE_RULESET,
        p_client_version:item.clientVersion||ONLINE_BUILD,
        p_payload:item.payload||{}
      });
      if(error||!['recorded','already_recorded'].includes(data?.status))remaining.push(item);
    }catch(e){remaining.push(item)}
  }
  saveRankedRecoveryQueue(remaining);
  return remaining.length===0;
}
function queueRankedRecoverySnapshot(reason='ranked_session_unavailable'){
  try{
    const item={
      snapshotId:makeTelemetryRunId(),
      sessionId:TELEMETRY_SESSION_ID,
      reason:String(reason||'ranked_session_unavailable').slice(0,64),
      rulesetVersion:ONLINE_RULESET,
      clientVersion:ONLINE_BUILD,
      payload:buildRankedRecoveryPayload()
    };
    const queue=loadRankedRecoveryQueue();
    queue.push(item);
    saveRankedRecoveryQueue(queue);
    void flushRankedRecoveryQueue();
    return item.snapshotId;
  }catch(e){return null}
}
async function submitIncidentRecoveryOnce(){
  if(!sb||location.hostname!=='inha-duck.example')return false;
  const user=await ensureOnlineUser({create:false});
  if(!user)return false;
  const markerKey='inhaDuckRecoverySubmitted:'+RANKED_RECOVERY_INCIDENT+':'+user.id;
  try{if(localStorage.getItem(markerKey)==='1')return true}catch(e){}
  const history=SecretRun.normalizeHistory(progress?.hidden?.sessionV2);
  if(Number(history?.plays||0)<=0)return false;
  try{
    const {data,error}=await sb.rpc('submit_ranked_recovery_summary_v1',{
      p_incident_key:RANKED_RECOVERY_INCIDENT,
      p_best_score:Math.max(0,Math.trunc(Number(history.bestScore)||0)),
      p_best_contract:history.bestContract||null,
      p_local_plays:Math.max(0,Math.trunc(Number(history.plays)||0)),
      p_client_version:ONLINE_BUILD
    });
    if(error)throw error;
    if(['recorded','already_recorded','not_eligible'].includes(data?.status)){
      try{localStorage.setItem(markerKey,'1')}catch(e){}
    }
    return ['recorded','already_recorded'].includes(data?.status);
  }catch(e){
    console.warn('ranked incident recovery failed',e);
    return false;
  }
}

async function loadDepartments(){
  if(!sb)return [];
  const {data,error}=await sb.from('departments').select('id,name,sort_order').eq('active',true);
  if(error)throw error;
  const collator=new Intl.Collator('ko-KR',{usage:'sort',sensitivity:'base',numeric:true});
  const sorted=[...(data||[])].sort((a,b)=>{
    if(a.name==='학과 미선택')return 1;
    if(b.name==='학과 미선택')return -1;
    return collator.compare(a.name,b.name);
  });
  departmentSelect.innerHTML='';
  sorted.forEach(d=>{
    const o=document.createElement('option');o.value=d.id;o.textContent=d.name;departmentSelect.appendChild(o);
  });
  return sorted;
}
async function loadOnlineProfile(){
  const user=await ensureOnlineUser({create:false});
  if(!user)return null;
  const {data,error}=await sb.from('profiles').select('user_id,nickname,department_id,title').eq('user_id',user.id).maybeSingle();
  if(error)throw error;
  onlineProfile=data||null;
  return onlineProfile;
}
async function logTelemetrySessionStart(){
  if(!sb)return false;
  try{
    if(sessionStorage.getItem(TELEMETRY_SESSION_MARKER)===TELEMETRY_SESSION_ID)return true;
  }catch(e){}
  try{
    const {error}=await sb.rpc('log_general_session_start',{
      p_visitor_id:TELEMETRY_VISITOR_ID,
      p_session_id:TELEMETRY_SESSION_ID,
      p_client_version:ONLINE_BUILD,
      p_balance_version:BALANCE_VERSION,
      p_run_type:TELEMETRY_RUN_TYPE,
      p_source:TELEMETRY_SOURCE,
      p_device:TELEMETRY_DEVICE
    });
    if(error)throw error;
    try{sessionStorage.setItem(TELEMETRY_SESSION_MARKER,TELEMETRY_SESSION_ID)}catch(e){}
    return true;
  }catch(e){
    console.warn('session telemetry failed',e);
    return false;
  }
}
void logTelemetrySessionStart();
void logTelemetryUiEvent('stage_select_view','stage_select');

async function logGeneralStageAttempt(stageId,runId){
  if(!sb||!runId)return false;
  try{
    const {error}=await sb.rpc('log_general_stage_attempt_v3',{
      p_stage_id:Number(stageId),
      p_run_id:runId,
      p_visitor_id:TELEMETRY_VISITOR_ID,
      p_session_id:TELEMETRY_SESSION_ID,
      p_client_version:ONLINE_BUILD,
      p_balance_version:BALANCE_VERSION,
      p_run_type:TELEMETRY_RUN_TYPE,
      p_source:TELEMETRY_SOURCE,
      p_device:TELEMETRY_DEVICE
    });
    if(error)throw error;
    return true;
  }catch(e){
    console.warn('stage attempt telemetry failed',stageId,e);
    return false;
  }
}

async function logGeneralProgressionEvent(eventType,context,targetStageId=null){
  if(!sb||!context?.runId)return false;
  try{
    const {error}=await sb.rpc('log_general_progression_event_v1',{
      p_event_type:String(eventType||''),
      p_stage_id:Number(context.stageId),
      p_target_stage_id:targetStageId===null?null:Number(targetStageId),
      p_run_id:context.runId,
      p_clear:Boolean(context.clear),
      p_visitor_id:TELEMETRY_VISITOR_ID,
      p_session_id:TELEMETRY_SESSION_ID,
      p_client_version:ONLINE_BUILD,
      p_balance_version:BALANCE_VERSION,
      p_run_type:TELEMETRY_RUN_TYPE,
      p_source:TELEMETRY_SOURCE,
      p_device:TELEMETRY_DEVICE
    });
    if(error)throw error;
    return true;
  }catch(e){
    console.warn('progression telemetry failed',eventType,e);
    return false;
  }
}

async function logGeneralStageResult(stageId,runId,scoreValue,comboValue,starsValue,clearValue,durationMs,annyongiValue,indeokValue,goldValue){
  if(!sb||!runId)return false;
  try{
    const {error}=await sb.rpc('log_general_stage_result_v3',{
      p_stage_id:Number(stageId),
      p_run_id:runId,
      p_visitor_id:TELEMETRY_VISITOR_ID,
      p_session_id:TELEMETRY_SESSION_ID,
      p_score:Math.max(0,Math.trunc(Number(scoreValue)||0)),
      p_combo:Math.max(0,Math.trunc(Number(comboValue)||0)),
      p_stars:Math.max(0,Math.min(3,Math.trunc(Number(starsValue)||0))),
      p_clear:Boolean(clearValue),
      p_duration_ms:Math.max(0,Math.trunc(Number(durationMs)||0)),
      p_annyongi_clicks:Math.max(0,Math.trunc(Number(annyongiValue)||0)),
      p_indeok_hits:Math.max(0,Math.trunc(Number(indeokValue)||0)),
      p_gold_hits:Math.max(0,Math.trunc(Number(goldValue)||0)),
      p_client_version:ONLINE_BUILD,
      p_balance_version:BALANCE_VERSION,
      p_run_type:TELEMETRY_RUN_TYPE,
      p_source:TELEMETRY_SOURCE,
      p_device:TELEMETRY_DEVICE
    });
    if(error)throw error;
    return true;
  }catch(e){
    console.warn('stage result telemetry failed',stageId,e);
    return false;
  }
}
async function logGeneralStageExit(stageId,runId,durationMs,exitState,exitReason='in_game'){
  if(!sb||!runId)return false;
  try{
    const {error}=await sb.rpc('log_general_stage_exit_v3',{
      p_stage_id:Number(stageId),
      p_run_id:runId,
      p_visitor_id:TELEMETRY_VISITOR_ID,
      p_session_id:TELEMETRY_SESSION_ID,
      p_duration_ms:Math.max(0,Math.trunc(Number(durationMs)||0)),
      p_exit_state:String(exitState||'unknown'),
      p_exit_reason:String(exitReason||'in_game'),
      p_client_version:ONLINE_BUILD,
      p_balance_version:BALANCE_VERSION,
      p_run_type:TELEMETRY_RUN_TYPE,
      p_source:TELEMETRY_SOURCE,
      p_device:TELEMETRY_DEVICE
    });
    if(error)throw error;
    return true;
  }catch(e){
    console.warn('stage exit telemetry failed',stageId,e);
    return false;
  }
}
function logGeneralBrowserExitKeepalive(){
  if(!generalRunId||!generalRunStartedPerf)return;
  const cfg=stageCfg();
  if(cfg.secret)return;
  const runId=generalRunId;
  const durationMs=Math.max(0,Math.trunc(performance.now()-generalRunStartedPerf));
  generalRunId=null;generalRunStartedPerf=0;
  try{
    fetch(`${SUPABASE_URL}/rest/v1/rpc/log_general_stage_exit_v3`,{
      method:'POST',
      headers:{
        'apikey':SUPABASE_PUBLISHABLE_KEY,
        'Content-Type':'application/json'
      },
      body:JSON.stringify({
        p_stage_id:Number(cfg.id),
        p_run_id:runId,
        p_visitor_id:TELEMETRY_VISITOR_ID,
        p_session_id:TELEMETRY_SESSION_ID,
        p_duration_ms:durationMs,
        p_exit_state:String(playState||'unknown'),
        p_exit_reason:'browser_pagehide',
        p_client_version:ONLINE_BUILD,
        p_balance_version:BALANCE_VERSION,
        p_run_type:TELEMETRY_RUN_TYPE,
        p_source:TELEMETRY_SOURCE,
        p_device:TELEMETRY_DEVICE
      }),
      keepalive:true
    }).catch(()=>{});
  }catch(e){}
}

async function syncGeneralStageBest(stageId,bestScore,bestCombo,bestStars){
  if(!sb||!bestScore)return false;
  const user=await ensureOnlineUser({create:false});if(!user)return false;
  const profile=onlineProfile||await loadOnlineProfile();if(!profile)return false;
  const {error}=await sb.rpc('record_general_stage_best_v2',{
    p_stage_id:Number(stageId),p_score:Math.max(0,Math.trunc(Number(bestScore)||0)),
    p_combo:Math.max(0,Math.trunc(Number(bestCombo)||0)),p_stars:Math.max(0,Math.min(3,Math.trunc(Number(bestStars)||0)))
  });
  if(error){console.warn('general rank sync failed',stageId,error);return false}return true;
}
async function syncAllGeneralBests(){
  if(!onlineProfile)return;
  const jobs=[];for(let id=1;id<=4;id++){const sp=progress.stages[id];if(Number(sp?.bestScore||0)>0)jobs.push(syncGeneralStageBest(id,sp.bestScore,sp.bestCombo,sp.stars));}
  await Promise.all(jobs);
}
async function saveAccountNickname(){
  if(!sb||!accountPermanent||!onlineUser)return;
  const nickname=accountNicknameInput.value.trim();
  if(!/^[0-9A-Za-z가-힣_ ]{2,12}$/u.test(nickname)){
    accountNicknameStatus.textContent='한글·영문·숫자·공백·_ 조합 2~12자로 입력해 주세요.';
    return;
  }
  accountNicknameSaveBtn.disabled=true;
  accountNicknameStatus.textContent='닉네임 저장 중...';
  try{
    const userId=onlineUser.id;
    const payload={nickname,updated_at:new Date().toISOString()};
    const response=onlineProfile
      ? await sb.from('profiles').update(payload).eq('user_id',userId).select('user_id,nickname,department_id,title').single()
      : await sb.from('profiles').insert({user_id:userId,department_id:null,...payload}).select('user_id,nickname,department_id,title').single();
    if(response.error)throw response.error;
    if(onlineUser?.id!==userId)return;
    onlineProfile=response.data;
    accountNicknameStatus.textContent='닉네임을 저장했어요. 공개 랭킹에도 새 닉네임이 표시됩니다.';
    renderAccountPanel();
    eventLeaderboardUpdatedAt=0;
    void refreshEventLeaderboard({force:true});
  }catch(e){
    console.warn('account nickname save failed',e);
    accountNicknameStatus.textContent='닉네임 저장 실패 · '+(e?.message||'잠시 후 다시 시도해 주세요.');
  }finally{accountNicknameSaveBtn.disabled=false}
}
async function saveOnlineProfile(){
  const user=await ensureOnlineUser({create:true});
  if(!user){rankingStatus.textContent='익명 로그인을 활성화한 뒤 랭킹 참가가 가능합니다.';return false}
  const nickname=nicknameInput.value.trim();
  if(!/^[0-9A-Za-z가-힣_ ]{2,12}$/u.test(nickname)){
    rankingStatus.textContent='닉네임은 한글·영문·숫자·공백·_ 조합 2~12자로 입력해 주세요.';return false;
  }
  const departmentId=Number(departmentSelect.value)||null;
  const payload={
    nickname,
    department_id:departmentId,
    updated_at:new Date().toISOString()
  };
  let error=null;
  if(onlineProfile){
    ({error}=await sb.from('profiles').update(payload).eq('user_id',user.id));
  }else{
    ({error}=await sb.from('profiles').insert({user_id:user.id,...payload}));
  }
  if(error){rankingStatus.textContent='프로필 저장 실패 · '+error.message;return false}
  onlineProfile={user_id:user.id,...payload,title:onlineProfile?.title||null};
  await syncAllGeneralBests();
  rankingStatus.textContent='랭킹 참가 등록 완료';
  await renderLeaderboard();
  return true;
}
const EVENT_END_AT=Date.parse('2026-09-27T23:59:59.999+09:00');
let eventLeaderboardUpdatedAt=0,eventLeaderboardPending=null;
function updateEventCountdown(){
  const remaining=EVENT_END_AT-Date.now();
  const box=document.querySelector('.ranked-event');
  const state=document.getElementById('eventState');
  const clock=document.getElementById('eventCountdown');
  const finished=remaining<=0;
  box.classList.toggle('ended',finished);
  state.textContent=finished?'종료':'진행 중';
  const hint=document.getElementById('eventSubmissionHint');
  hint.textContent=finished?'이벤트 종료 · 최종 결과는 에타 원글을 확인해 주세요.':'참여: 랭킹 화면 캡처 → 에타 원글 작성자에게 쪽지';
  if(finished){clock.textContent='9/27(일) 23:59 종료';return}
  const minutes=Math.ceil(remaining/60000);
  const days=Math.floor(minutes/1440),hours=Math.floor((minutes%1440)/60),mins=minutes%60;
  clock.textContent='9/27(일) 23:59 마감 · '+(days?days+'일 ':'')+(days||hours?hours+'시간 ':'')+mins+'분 남음';
}
async function refreshEventLeaderboard({force=false}={}){
  updateEventCountdown();
  if(!sb){
    document.getElementById('eventTopThree').textContent='랭킹을 불러오지 못했어요.';
    document.getElementById('eventMyGoal').textContent='연결 후 내 목표를 확인해 주세요.';
    return;
  }
  if(eventLeaderboardPending)return eventLeaderboardPending;
  if(!force&&Date.now()-eventLeaderboardUpdatedAt<60000)return;
  eventLeaderboardPending=(async()=>{
    const top=document.getElementById('eventTopThree'),goal=document.getElementById('eventMyGoal');
    try{
      const {data,error}=await sb.rpc('get_leaderboard_v4',{p_department_id:null,p_limit:50});
      if(error)throw error;
      const entries=Array.isArray(data)?data:[];
      top.innerHTML=entries.length
        ? entries.slice(0,3).map((row,i)=>{
          const nick=escapeHtml(row.nickname||'익명');
          const points=Number(row.best_score)||0;
          return '<div class="ranked-event-place"><span class="name">'+['🥇','🥈','🥉'][i]+' '+nick+(row.inha_mail_verified?' <span title="인하 메일 인증 · 학교 메일 소유 확인">🎓</span>':'')+'</span><span class="points">'+points+'점</span></div>';
        }).join('')
        : '<span class="ranked-event-empty">아직 랭킹전 기록이 없어요. 첫 기록에 도전해 보세요.</span>';
      eventLeaderboardUpdatedAt=Date.now();
      if(!rankedUnlocked()){
        goal.textContent='★10개를 모으면 랭킹전이 열려요. 현재 ★'+totalStars()+'/10';
        return;
      }
      const user=await ensureOnlineUser({create:false});
      if(!user){
        goal.textContent='랭킹전 기록을 등록하면 내 순위와 목표가 표시돼요.';
        return;
      }
      const {data:mine,error:mineError}=await sb.rpc('get_my_rank_v3');
      if(mineError)throw mineError;
      const me=Array.isArray(mine)?mine[0]:null;
      if(!me){
        goal.textContent='랭킹전 첫 기록에 도전해 보세요.';
        return;
      }
      const rank=Number(me.overall_rank),score=Number(me.best_score);
      if(!Number.isFinite(rank)||!Number.isFinite(score)){goal.textContent='내 기록을 랭킹에서 확인해 보세요.';return}
      const ahead=entries.find(row=>Number(row.rank)===rank-1);
      const gap=ahead?Math.max(0,Number(ahead.best_score)-score+1):null;
      goal.textContent='내 기록 '+rank+'위 · '+score+'점'+(rank===1?' · 현재 전체 1위!':gap!==null&&Number.isFinite(gap)?' · 바로 위 기록까지 '+gap+'점 차':' · 다음 목표는 전체 랭킹에서 확인');
    }catch(e){
      top.textContent='랭킹을 불러오지 못했어요. 랭킹 화면에서 다시 확인해 주세요.';
      goal.textContent='내 기록은 랭킹 화면에서 확인해 주세요.';
      console.warn('event leaderboard refresh failed',e);
    }
  })();
  try{await eventLeaderboardPending}finally{eventLeaderboardPending=null}
}
updateEventCountdown();
function closeRanking(){
  rankingOverlay.classList.add('hidden');
  void refreshEventLeaderboard({force:true});
  setTelemetryLastScreen(playState==='RESULT'?'result':'stage_select');
  if(rankingChannel){sb?.removeChannel(rankingChannel);rankingChannel=null}
}
async function openRanking(){
  setTelemetryLastScreen('leaderboard');
  void logTelemetryUiEvent('leaderboard_view','leaderboard');
  rankingOverlay.classList.remove('hidden');
  profilePanel.classList.add('hidden');leaderboardPanel.classList.add('hidden');
  rankingStatus.textContent='온라인 랭킹 불러오는 중...';
  if(!sb){rankingStatus.textContent='랭킹을 불러오지 못했습니다. 연결을 확인해 주세요.';return;}
  try{
    await loadDepartments();
    const user=await ensureOnlineUser({create:false});
    if(user)await loadOnlineProfile();
    else onlineProfile=null;
    profileHelp.textContent=accountPermanent
      ? '스테이지 기록은 보존되어 있습니다. 프로필 저장 후 일반 스테이지 최고기록을 랭킹에 반영합니다. 이전 게스트 계정의 공식 랭킹전 기록은 자동으로 옮겨지지 않습니다.'
      : '닉네임과 학과를 등록하면 저장된 일반 스테이지 최고기록을 랭킹에 반영합니다.';

    if(!onlineProfile||!onlineProfile.department_id){
      profilePanel.classList.remove('hidden');
      rankingStatus.textContent=user
        ? '닉네임과 학과를 등록하면 기록을 랭킹에 올릴 수 있어요.'
        : '랭킹 조회는 가능하지만, 기록 등록에는 익명 로그인이 필요해요.';
      await renderLeaderboard({profileRequired:false});
    }else{
      await syncAllGeneralBests();
      await renderLeaderboard();
    }
    subscribeLeaderboard();
  }catch(e){
    rankingStatus.textContent='랭킹을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    console.warn(e);
  }
}
async function renderLeaderboard({profileRequired=true}={}){
  if(!sb)return;
  leaderboardPanel.classList.remove('hidden');
  profilePanel.classList.toggle('hidden',!!onlineProfile?.department_id);

  document.querySelectorAll('.ranking-mode-tab').forEach(b=>b.classList.toggle('selected',b.dataset.rankingMode===rankingMode));
  document.querySelectorAll('.rank-tab').forEach(b=>b.classList.toggle('selected',b.dataset.rankTab===rankingTab));

  if(onlineProfile){
    const depText=departmentSelect.querySelector(`option[value="${onlineProfile.department_id}"]`)?.textContent||'학과 미선택';
    profileSummary.innerHTML='<div>'+escapeHtml(onlineProfile.nickname)+' · '+escapeHtml(depText)+'</div><div class="profile-badges">'+badgeChip(currentGeneralBadge(),'general')+(currentGradeBadge()?badgeChip(currentGradeBadge(),'grade'):'')+eventBadgeHtml(eventBadgeCode)+inhaBadgeHtml()+'</div>';
    nicknameInput.value=onlineProfile.nickname||'';
    if(onlineProfile.department_id)departmentSelect.value=String(onlineProfile.department_id);
  }else profileSummary.textContent='랭킹 참가 등록 전';

  leaderboardList.innerHTML='';myRankCard.classList.add('hidden');
  if(rankingMode==='ranked'&&!rankedUnlocked()){
    rankingStatus.textContent='★10 달성 시 랭킹전이 해금됩니다.';
    leaderboardList.innerHTML='<div class="ranking-status">일반 스테이지에서 별 10개를 먼저 모아주세요.</div>';return;
  }

  rankingStatus.textContent=rankingMode==='general'
    ? '일반 랭킹 · Stage 1~4 BEST 합계 · 참고 기록'
    : '랭킹전 · 비룡의 밤 서버 검증 최고기록';

  let departmentId=null;
  if(rankingTab==='department'){
    departmentId=onlineProfile?.department_id||null;
    if(!departmentId){leaderboardList.innerHTML='<div class="ranking-status">학과를 등록하면 학과 랭킹을 볼 수 있어요.</div>';return;}
  }
  if(rankingTab==='me'){
    const user=await ensureOnlineUser({create:false});
    if(!user||!onlineProfile){leaderboardList.innerHTML='<div class="ranking-status">랭킹 참가 등록 후 내 순위를 확인할 수 있어요.</div>';return;}
    const rpc=rankingMode==='general'?'get_my_general_rank_v3':'get_my_rank_v4';
    const {data,error}=await sb.rpc(rpc);if(error)throw error;
    const me=Array.isArray(data)?data[0]:null;myRankCard.classList.remove('hidden');
    if(rankingMode==='general'){
      myRankCard.innerHTML=me
        ? `<div>Stage 1~4 BEST 합계</div><strong>${me.total_score}점</strong><div class="rank-badges">${badgePairHtml(me.general_badge,me.ranked_grade)}${eventBadgeHtml(me.event_badge)}${inhaBadgeHtml()}</div><div>전체 ${me.overall_rank}위 · 학과 ${me.department_rank}위 · ★${me.total_stars}/12</div>`
        : '<div>아직 일반 스테이지 기록이 없어요.</div>';
    }else{
      myRankCard.innerHTML=me
        ? `<div>비룡의 밤 최고 기록</div><strong>${me.best_score}점</strong><div class="rank-badges">${badgePairHtml(me.general_badge,me.ranked_grade)}${eventBadgeHtml(me.event_badge)}${inhaBadgeHtml()}</div><div>전체 ${me.overall_rank}위 · 학과 ${me.department_rank}위</div>`
        : '<div>아직 공식 랭킹전 기록이 없어요.</div>';
    }
    return;
  }

  const rpc=rankingMode==='general'?'get_general_leaderboard_v5':'get_leaderboard_v5';
  const {data,error}=await sb.rpc(rpc,{p_department_id:departmentId,p_limit:50});if(error)throw error;
  if(!data?.length){leaderboardList.innerHTML=rankingMode==='general'?'<div class="ranking-status">아직 일반 랭킹 기록이 없어요.</div>':'<div class="ranking-status">아직 등록된 랭킹전 기록이 없어요. 첫 기록을 노려보세요. 🐲</div>';return;}

  leaderboardList.innerHTML=data.map(r=>{
    const score=rankingMode==='general'?r.total_score:r.best_score;
    const detail=rankingMode==='general'
      ? `${escapeHtml(r.department_name||'학과 미선택')} · ★${r.total_stars}/12`
      : escapeHtml(r.department_name||'학과 미선택');
    return `
    <div class="rank-row ${r.is_me?'me':''}">
      <div class="rank-num">${r.rank}</div>
      <div class="rank-main">
        <div class="rank-nick">${escapeHtml(r.nickname||'익명')}</div>
        <div class="rank-badges">${badgePairHtml(r.general_badge,r.ranked_grade)}${eventBadgeHtml(r.event_badge)}${inhaBadgeHtml(r.inha_mail_verified)}</div>
        <div class="rank-dept">${detail}</div>
      </div>
      <div class="rank-score">${score}점</div>
    </div>`;
  }).join('');
}
function escapeHtml(v){
  return String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function subscribeLeaderboard(){
  // v1.0 hardening: leaderboard backing tables are not directly readable/subscribable.
  // Rankings refresh when the modal opens or a tab changes.
}
let rankedLoadingTimer=null;
function beginRankedLoading(){
  clearTimeout(rankedLoadingTimer);
  rankedLoadingTitle.textContent='랭킹전 준비 중...';
  rankedLoadingMessage.textContent='서버와 공식 기록 세션을 연결하고 있어요.';
  rankedLoadingTimer=setTimeout(()=>rankedLoadingOverlay.classList.remove('hidden'),250);
}
async function endRankedLoading(ok){
  clearTimeout(rankedLoadingTimer);
  rankedLoadingTimer=null;
  const visible=!rankedLoadingOverlay.classList.contains('hidden');
  if(ok){
    if(visible){
      rankedLoadingTitle.textContent='준비 완료!';
      rankedLoadingMessage.textContent='공식 기록 세션이 연결됐어요.';
      await sleepMs(220);
      rankedLoadingOverlay.classList.add('hidden');
    }
  }else{
    rankedLoadingTitle.textContent='랭킹 서버 연결 실패';
    rankedLoadingMessage.textContent='이번 판은 연습 기록으로 진행합니다.';
    rankedLoadingOverlay.classList.remove('hidden');
    await sleepMs(950);
    rankedLoadingOverlay.classList.add('hidden');
  }
  rankedLoadingTitle.textContent='랭킹전 준비 중...';
  rankedLoadingMessage.textContent='서버와 공식 기록 세션을 연결하고 있어요.';
}
async function prepareRankedRun(){
  rankedMode=false;rankedSession=null;rankedStartedPerf=0;
  if(!sb)return false;
  try{
    const user=await ensureOnlineUser({create:true});
    if(!user)return false;
    const runType=CLASSIC_PRODUCTION_HOSTS.has(location.hostname)?'ranked':'qa';
    const profile=await loadOnlineProfile();
    if(runType==='ranked'&&!profile)return false;
    const {data,error}=await sb.functions.invoke('ranked-run-start',{body:{
      clientVersion:ONLINE_BUILD,rulesetVersion:ONLINE_RULESET,runType
    }});
    if(error||!data?.runId)throw error||new Error('run start failed');
    if(!['ranked','qa'].includes(data.runType)||data.rulesetVersion!==ONLINE_RULESET)throw new Error('invalid ranked session');
    rankedSession=data;rankedMode=true;rankedStartedPerf=performance.now();
    resetRankedTelemetry();
    void submitIncidentRecoveryOnce();
    void flushRankedRecoveryQueue();
    return true;
  }catch(e){
    console.warn('ranked start fallback to practice',e);
    rankedMode=false;rankedSession=null;
    return false;
  }
}
async function abandonRankedSession(runId){
  if(!sb||!runId)return false;
  try{
    const {data,error}=await sb.rpc('abandon_ranked_session_v1',{p_run_id:runId});
    if(error)throw error;
    return data==='abandoned'||data==='expired';
  }catch(e){
    console.warn('ranked abandon telemetry failed',e);
    return false;
  }
}
async function submitRankedRun(){
  onlineRankResult.classList.remove('hidden','accepted','practice');
  if(!rankedMode||!rankedSession||!sb){
    queueRankedRecoverySnapshot(!sb?'supabase_client_unavailable':'ranked_session_unavailable');
    onlineRankResult.classList.add('practice');
    onlineRankResult.textContent='PRACTICE · 온라인 랭킹 미반영';
    return;
  }
  const session={...rankedSession};
  const startedPerf=rankedStartedPerf;
  const telemetry={
    inputCount:rankedInputCount,
    reactionSampleCount:rankedReactionSampleCount,
    ultraFastReactionCount:rankedUltraFastReactionCount
  };
  const resultSnapshot={
    score,maxCombo,normalHits,speedyHits,goldHits,indeokiHits:indeokHits,
    annyongiHits:annyongiClicked,annyongiDodges,moonBonusHits,dragonCalls,completedCalls:Number(secretRun?.completedCalls||0),
    flightHits:Number(secretRun?.flightCaptures||0),
    comboBonus:Number(secretRun?.comboBonus||0),
    flightBasePoints:Number(secretRun?.flightBasePoints||0),
    tier1Hits:Number(secretRun?.tier1Hits||0),
    tier2Hits:Number(secretRun?.tier2Hits||0),
    tier1GroundAward:Number(secretRun?.tier1GroundAward||0),
    tier2GroundAward:Number(secretRun?.tier2GroundAward||0),
    ascensionBonus:Number(secretRun?.ascensionBonus||0),
    totalHits:normalHits+speedyHits+goldHits+indeokHits+annyongiClicked
  };
  onlineRankResult.textContent='공식 기록 검증 중...';
  try{
    const durationMs=Math.round(performance.now()-startedPerf);
    const {data,error}=await sb.functions.invoke('ranked-run-finish',{body:{
      runId:session.runId,
      nonce:session.nonce,
      runType:session.runType,
      rulesetVersion:session.rulesetVersion,
      ...resultSnapshot,
      ...telemetry,
      durationMs,
      clientVersion:ONLINE_BUILD
    }});
    if(error||!data?.accepted)throw error||new Error(data?.reason||'rejected');
    onlineRankResult.classList.add('accepted');
    const ranks=[
      data.overallRank?`전체 ${data.overallRank}위`:null,
      data.departmentRank?`학과 ${data.departmentRank}위`:null
    ].filter(Boolean).join(' · ');
    onlineRankResult.textContent=data.rankEligible
      ? `🏆 공식 기록 등록 · BEST ${data.bestScore}점${ranks?' · '+ranks:''}`
      : '🧪 QA VALIDATED · 서버 검증 통과 · 공식 랭킹 미반영';
    // The finish RPC may complete after the ranking modal was opened. Refresh it
    // immediately so newly earned server-verified badges never show stale data.
    if(data.rankEligible&&!rankingOverlay.classList.contains('hidden')) await renderLeaderboard();
  }catch(e){
    console.warn('ranked finish rejected',e);
    queueRankedRecoverySnapshot('ranked_finish_failed');
    onlineRankResult.classList.add('practice');
    onlineRankResult.textContent='PRACTICE · 서버 검증 미통과/연결 실패';
  }finally{
    if(rankedSession?.runId===session.runId){
      rankedMode=false;rankedSession=null;rankedStartedPerf=0;
    }
  }
}

