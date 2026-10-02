// Production-only analytics stays separate from gameplay/ranking rules.
if (typeof window !== 'undefined' && location.hostname === 'grow.inhagame.example') {
  const analyticsScript = document.createElement('script');
  analyticsScript.src = './analytics.js';
  document.head.append(analyticsScript);

  // Attribute Grow visits that originated from an explicit INHAGAME hub click.
  const entryScript = document.createElement('script');
  entryScript.src = 'https://inhagame.example/game-entry.js';
  entryScript.dataset.game = 'induck-grow';
  document.head.append(entryScript);
}

// INHAGAME account saves for Grow. The original guest key stays untouched.
(() => {
  'use strict';
  const guestKey='induck-grow-p0', slug='induck-grow';
  const client=window.supabase?.createClient?.(
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).url),
    ((globalThis.__INHAGAME_PUBLIC_SUPABASE__||{}).publishableKey),
    {auth:{persistSession:true,autoRefreshToken:true}}
  );
  const $=id=>document.getElementById(id);
  let user=null, revision=null, pending=null, epoch=0, conflict=null;
  let saving=Promise.resolve(), dirty=false, migrated=false;
  let memberActivityLastAt=0,memberActivityPending=false;
  const key=id=>`${guestKey}-account-${id}`;
  const permanent=p=>!!p?.id && p.is_anonymous!==true && !!p.email;
  const read=name=>{try{const value=JSON.parse(localStorage.getItem(name));return value&&typeof value==='object'&&!Array.isArray(value)?value:null}catch{return null}};
  async function touchMemberActivity(person=user,force=false){
    if(!client?.rpc||!permanent(person)||memberActivityPending)return false;
    const now=Date.now();
    if(!force&&now-memberActivityLastAt<300000)return false;
    memberActivityPending=true;
    try{
      const result=await client.rpc('touch_inhagame_member_activity_v1',{p_surface:'induck-grow'});
      if(result?.error)throw result.error;
      memberActivityLastAt=now;return true;
    }catch(error){console.warn('Grow member activity touch failed',error);return false}
    finally{memberActivityPending=false}
  }
  // JSONB changes key order; compare canonical game data across reloads.
  function canonical(value){
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    if(value&&typeof value==='object')return '{'+Object.keys(value).sort()
      .filter(k=>value[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
    return JSON.stringify(value);
  }
  const same=(a,b)=>canonical(a)===canonical(b);
  function status(message){$('grow-account-status').textContent=message}
  function render(){
    $('grow-account-heading').textContent=user?'INHAGAME 계정 · '+user.email:'INHAGAME 계정 연결';
    $('grow-account-login').hidden=!!user || !client;
    $('grow-account-actions').hidden=!user;
    $('grow-account-conflict').hidden=!conflict;
    $('grow-use-cloud').textContent=conflict?.remote?'계정 기록 사용':'계정의 삭제 적용';
    $('grow-import-guest').hidden=!user || !read(guestKey) || !!conflict;
    $('grow-retry-sync').hidden=!user || !!conflict;
    $('savePill').textContent=user?($('continueBtn').disabled?'☁️ 계정 연결':'☁️ 계정 세이브'):
      ($('continueBtn').disabled?'💾 새 게임':'💾 이어하기 가능');
  }
  function leave(note='게스트 플레이 · 기록은 이 기기에 저장됩니다.'){
    epoch++;user=null;revision=null;pending=null;conflict=null;dirty=false;migrated=false;
    if(growSaveKey!==guestKey)switchGrowSaveKey(guestKey);
    status(note);render();
  }
  async function fetchCloud(){
    const {data,error}=await client.rpc('get_my_game_progress',{p_game_slug:slug});
    if(error)throw error;
    return Array.isArray(data)?data[0]||null:null;
  }
  function activateScope(person,local){
    user=person;conflict=null;switchGrowSaveKey(key(person.id));
    status(local?'계정 세이브 연결됨 · 자동 동기화':'계정 연결됨 · 새 게임을 시작하거나 게스트 세이브를 가져오세요.');
    render();
  }
  async function activate(person){
    if(!permanent(person)){leave();return}
    void touchMemberActivity(person,true);
    if(user?.id===person.id || pending===person.id)return;
    const token=++epoch;pending=person.id;status('계정 세이브를 불러오는 중…');
    try{
      const row=await fetchCloud();
      if(token!==epoch)return;
      const accountKey=key(person.id), local=read(accountKey), remote=row?.progress||null;
      const marker=read(accountKey+'-sync');
      revision=row?.updated_at||null;
      pending=null;
      if(local&&!remote){
        user=person;conflict={local,remote:null};
        status(marker?.revision?'계정에서 세이브가 삭제됐습니다. 이 기기 기록을 복원하거나 삭제를 적용하세요.':
          '계정에는 세이브가 없습니다. 이 기기 기록을 올리거나 계정의 빈 기록을 적용하세요.');
        $('grow-account-panel').open=true;render();return;
      }
      if(local&&remote&&!same(local,remote)){
        if(marker?.revision===revision){
          activateScope(person,true);dirty=true;void queueSave();return;
        }
        if(marker?.snapshot&&same(marker.snapshot,local)){
          localStorage.setItem(accountKey,JSON.stringify(remote));
          activateScope(person,true);markSynced(remote);return;
        }
        user=person;conflict={local,remote};
        status('두 기록이 달라 선택이 필요합니다. 어느 기록도 삭제하지 않았습니다.');
        $('grow-account-panel').open=true;render();return;
      }
      if(remote&&!local)localStorage.setItem(accountKey,JSON.stringify(remote));
      activateScope(person,!!(local||remote));
      if(remote)markSynced(remote);
    }catch(error){
      if(token!==epoch)return;
      console.warn('Grow account load failed',error);
      pending=null;status('계정 기록을 불러오지 못했습니다. 이 기기의 기록은 그대로 있습니다.');
      $('grow-account-panel').open=true;
    }
  }
  function markSynced(snapshot){
    if(!user)return;
    localStorage.setItem(key(user.id)+'-sync',JSON.stringify({revision,snapshot}));
  }
  function queueSave(){
    if(!user||conflict)return saving;
    dirty=true;
    const id=user.id, token=epoch;
    saving=saving.catch(()=>false).then(async()=>{
      while(dirty&&user?.id===id&&epoch===token&&!conflict){
        dirty=false;
        const snapshot=read(key(id));
        if(!snapshot)continue;
        const {data,error}=await client.rpc('save_my_grow_progress',{
          p_progress:snapshot,p_expected_updated_at:revision,p_migrated_from_local:migrated
        });
        if(epoch!==token||user?.id!==id)return false;
        if(error){
          if(error.message?.includes('GROW_SAVE_CONFLICT')){
            const latest=await fetchCloud();
            if(epoch!==token)return false;
            revision=latest?.updated_at||null;
            conflict={local:read(key(id)),remote:latest?.progress||null};
            status('다른 기기의 기록이 변경되었습니다. 사용할 기록을 선택하세요.');
            $('grow-account-panel').open=true;render();return false;
          }
          dirty=true;throw error;
        }
        revision=data;migrated=false;markSynced(snapshot);
        void touchMemberActivity(user);
        window.InduckGrowAnalytics?.accountSave?.();
        status('계정 기록 동기화 완료');
      }
      return !dirty;
    }).catch(error=>{
      if(epoch===token){console.warn('Grow save failed',error);status('기기에는 저장됐지만 계정 동기화에 실패했습니다. 재시도해 주세요.');render()}
      return false;
    });
    return saving;
  }
  async function choose(which){
    if(!user||!conflict)return;
    const id=user.id;
    if(which==='local'&&!confirm('이 기기 세이브를 계정 기록으로 사용하시겠습니까? 기존 계정 기록이 교체됩니다.'))return;
    const choice=which==='local'?conflict.local:conflict.remote;
    if(which==='local'&&!choice){status('이 기기의 계정 세이브가 없습니다.');return}
    if(which==='cloud'&&!choice){
      localStorage.removeItem(key(id));localStorage.removeItem(key(id)+'-sync');
      activateScope(user,false);
      status('계정의 세이브 삭제를 이 기기에 적용했습니다.');return;
    }
    if(which==='cloud'){
      localStorage.setItem(key(id),JSON.stringify(choice));
      activateScope(user,true);markSynced(choice);return;
    }
    conflict=null;activateScope(user,true);
    dirty=true;await queueSave();
  }
  async function importGuest(){
    if(!user||conflict)return;
    const guest=read(guestKey);
    if(!guest)return;
    if(!confirm('이 기기의 게스트 세이브를 계정 세이브로 복사하시겠습니까? 게스트 원본은 유지됩니다.'))return;
    if(read(key(user.id))&&!confirm('현재 계정 세이브가 교체됩니다. 계속하시겠습니까?'))return;
    localStorage.setItem(key(user.id),JSON.stringify(guest));
    migrated=true;switchGrowSaveKey(key(user.id));render();
    await queueSave();
  }
  async function deleteSave(){
    if(!user||conflict)return;
    if(!confirm('이 계정의 인덕이 키우기 세이브를 삭제하시겠습니까? 이 기기의 게스트 세이브는 유지됩니다.'))return;
    const token=epoch,id=user.id;
    await saving;
    if(epoch!==token||user?.id!==id)return;
    try{
      if(revision){
        const {error}=await client.rpc('delete_my_grow_progress',{p_expected_updated_at:revision});
        if(error)throw error;
      }
      localStorage.removeItem(key(id));localStorage.removeItem(key(id)+'-sync');
      revision=null;dirty=false;state=null;show('title');updateSavePill();render();status('계정 세이브를 삭제했습니다.');
    }catch(error){status('계정 세이브를 삭제하지 못했습니다. 기록은 유지됩니다. 다시 시도해 주세요.');console.warn('Grow delete failed',error)}
  }
  $('grow-password-form').addEventListener('submit',async event=>{
    event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;
    const {data,error}=await client.auth.signInWithPassword({email:form.elements.email.value.trim().toLowerCase(),password:form.elements.password.value});
    form.elements.password.value='';button.disabled=false;
    if(error){status('로그인에 실패했습니다. 계정 정보를 확인해 주세요.');return}
    await activate(data.user||data.session?.user);
  });
  $('grow-send-code').addEventListener('click',async()=>{
    const form=$('grow-otp-form');if(!form.elements.email.reportValidity())return;
    const {error}=await client.auth.signInWithOtp({email:form.elements.email.value.trim().toLowerCase(),options:{shouldCreateUser:false,emailRedirectTo:location.origin+'/'}});
    status(error?'인증 메일을 보내지 못했습니다.':'기존 계정의 이메일로 인증 코드를 보냈습니다.');
  });
  $('grow-otp-form').addEventListener('submit',async event=>{
    event.preventDefault();const f=event.currentTarget;
    const {data,error}=await client.auth.verifyOtp({email:f.elements.email.value.trim().toLowerCase(),token:f.elements.code.value.trim(),type:'email'});
    if(error){status('인증 코드가 유효하지 않습니다.');return}
    await activate(data.user||data.session?.user);
  });
  $('grow-sign-out').addEventListener('click',async()=>{
    await saving;const {error}=await client.auth.signOut({scope:'local'});
    if(error){status('로그아웃하지 못했습니다. 다시 시도해 주세요.');return}
    leave();
  });
  $('grow-import-guest').addEventListener('click',()=>void importGuest());
  $('grow-use-cloud').addEventListener('click',()=>void choose('cloud'));
  $('grow-use-local').addEventListener('click',()=>void choose('local'));
  $('grow-retry-sync').addEventListener('click',async()=>{
    if(!user)return;
    if(read(key(user.id))){dirty=true;await queueSave()}
    else status('계정 세이브가 없습니다. 새 게임을 시작할 수 있습니다.');
  });
  window.InduckGrowAccount=Object.freeze({queueSave,connected:()=>!!user&&!conflict,deleteSave});
  if(!client){status('계정 서비스를 불러오지 못했습니다. 게스트 플레이는 가능합니다.');render();return}
  client.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){leave();return}
    if(session?.user&&user?.id!==session.user.id)setTimeout(()=>void verify(),0);
  });
  async function verify(){
    const {data,error}=await client.auth.getUser();
    if(error?.name==='AuthSessionMissingError'){if(!user)leave();return}
    if(error){status('로그인 상태를 확인하지 못했습니다. 게스트 기록은 유지됩니다.');return}
    if(permanent(data?.user))await activate(data.user);
    else if(!user)leave();
  }
  void verify();
})();
