// INHAGAME Auth 계정을 서바이벌의 개인 진행도에만 연결한다. 랭킹 기록은 별도 서버 검증 대상이다.
(function(root){
  'use strict';
  const progress=root.InduckSurvivalProgress;
  const client=root.supabase?.createClient?.(
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url),
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).publishableKey),
    {auth:{persistSession:true,autoRefreshToken:true}}
  )||null;
  let user=null,ready=false,pending=null,generation=0,writeQueue=Promise.resolve(),migrated=false;
  let memberActivityLastAt=0,memberActivityPending=false;
  let message=client?'계정 상태 확인 중…':'계정 서비스를 불러오지 못했습니다. 게스트 플레이는 가능합니다.';
  function permanent(person){return !!person?.id && person.is_anonymous!==true && !!person.email}
  async function touchMemberActivity(force=false){
    if(!client?.rpc||!permanent(user)||memberActivityPending)return false;
    const now=Date.now();
    if(!force&&now-memberActivityLastAt<300000)return false;
    memberActivityPending=true;
    try{
      const result=await client.rpc('touch_inhagame_member_activity_v1',{p_surface:'survival'});
      if(result?.error)throw result.error;
      memberActivityLastAt=now;return true;
    }catch(error){console.warn('Survival member activity touch failed',error);return false}
    finally{memberActivityPending=false}
  }
  function snapshot(){return {state:!client?'unavailable':ready&&permanent(user)?'connected':'guest',email:ready?user?.email||null:null,message}}
  function emit(next){if(next)message=next;root.dispatchEvent?.(new CustomEvent('survival-account-change',{detail:snapshot()}))}
  function errorText(error){return String(error?.message||error||'')}
  function deactivate(note='게스트 플레이 · 기록은 이 브라우저에 저장됩니다.'){
    generation++;pending=null;user=null;ready=false;migrated=false;progress.clearAccount();emit(note);
  }
  function enqueueSave(){
    if(!ready||!permanent(user)||!client)return writeQueue;
    const id=user.id,epoch=generation;
    writeQueue=writeQueue.catch(()=>false).then(async()=>{
      if(!ready||user?.id!==id||epoch!==generation)return false;
      const {error}=await client.rpc('save_my_game_progress',{
        p_game_slug:'inha-duck-survival',p_progress:progress.read(),
        p_schema_version:2,p_migrated_from_local:migrated
      });
      if(error)throw error;
      migrated=false;
      void touchMemberActivity();
      return true;
    }).catch(error=>{
      console.warn('Survival progress sync failed',error);
      if(user?.id===id&&epoch===generation)emit('기록은 기기에 저장됐습니다. 동기화 재시도를 눌러 주세요.');
      return false;
    });
    return writeQueue;
  }
  async function activate(person){
    if(!permanent(person)){deactivate();return}
    if(user?.id===person.id&&ready)return;
    if(pending===person.id)return;
    const epoch=++generation;
    pending=person.id;ready=false;emit('계정 기록을 불러오는 중…');
    try{
      const {data,error}=await client.rpc('get_my_game_progress',{p_game_slug:'inha-duck-survival'});
      if(error)throw error;
      if(epoch!==generation)return;
      const row=Array.isArray(data)?data[0]:null;
      const remote=progress.normalize(row?.progress);
      // 동일 계정의 이 기기 저장분만 자동 합친다. 게스트 기록은 명시적으로 가져온다.
      if(user?.id&&user.id!==person.id)progress.clearAccount();
      const combined=progress.useAccount(person.id,remote);
      user=person;ready=true;pending=null;
      void touchMemberActivity(true);
      emit(`INHAGAME 계정 연결됨 · ${person.email}`);
      if(JSON.stringify(combined)!==JSON.stringify(remote))await enqueueSave();
    }catch(error){
      if(epoch!==generation)return;
      console.warn('Survival account load failed',error);
      pending=null;ready=false;user=null;
      progress.clearAccount();emit('계정 기록을 불러오지 못했습니다. 기기 기록은 유지됩니다.');
    }
  }
  async function init(){
    if(!client){emit();return}
    client.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'){deactivate();return}
      if(session?.user && (!ready||user?.id!==session.user.id)){
        setTimeout(()=>{void verifyAndActivate()},0);
      }
    });
    await verifyAndActivate();
  }
  async function verifyAndActivate(){
    try{
      const {data,error}=await client.auth.getUser();
      // 새 방문자의 세션 부재는 정상적인 게스트 상태다.
      if(error?.name==='AuthSessionMissingError'){if(!ready)deactivate();return}
      if(error)throw error;
      if(permanent(data?.user))await activate(data.user);
      else if(!ready)deactivate();
    }catch(error){
      console.warn('Survival auth check failed',error);
      if(!ready)emit('로그인 상태를 확인하지 못했습니다. 게스트 기록은 유지됩니다.');
    }
  }
  async function signIn(email,password){
    if(!client)throw Error('계정 서비스를 사용할 수 없습니다.');
    const {data,error}=await client.auth.signInWithPassword({email:email.trim().toLowerCase(),password});
    if(error)throw error;
    await activate(data.user||data.session?.user);
    return snapshot();
  }
  async function sendCode(email){
    if(!client)throw Error('계정 서비스를 사용할 수 없습니다.');
    const {error}=await client.auth.signInWithOtp({email:email.trim().toLowerCase(),options:{shouldCreateUser:false,emailRedirectTo:`${location.origin}/`}});
    if(error)throw error;
    emit('기존 계정으로 인증 메일을 보냈습니다. 메일의 코드를 입력해 주세요.');
  }
  async function verifyCode(email,code){
    if(!client)throw Error('계정 서비스를 사용할 수 없습니다.');
    const {data,error}=await client.auth.verifyOtp({email:email.trim().toLowerCase(),token:code.trim(),type:'email'});
    if(error)throw error;
    await activate(data.user||data.session?.user);
    return snapshot();
  }
  async function signOut(){
    if(!client)return;
    await writeQueue;
    const {error}=await client.auth.signOut({scope:'local'});
    if(error)throw error;
    deactivate();
  }
  async function importGuest(){
    if(!ready)throw Error('계정에 먼저 로그인해 주세요.');
    migrated=true;
    progress.importGuest();
    if(!(await enqueueSave()))throw Error('기기 기록은 남아 있습니다. 동기화를 다시 시도해 주세요.');
    emit('이 기기의 게스트 기록을 계정 기록에 합쳤습니다.');
  }
  async function retry(){
    if(!ready)throw Error('계정에 먼저 로그인해 주세요.');
    if(!(await enqueueSave()))throw Error('동기화에 실패했습니다. 연결 상태를 확인해 주세요.');
    emit('계정 기록 동기화 완료');
  }
  root.addEventListener?.('survival-progress-changed',()=>{if(ready)void enqueueSave()});
  root.InduckSurvivalAccount=Object.freeze({init,snapshot,signIn,sendCode,verifyCode,signOut,importGuest,retry,errorText});
})(window);
