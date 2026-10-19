// Same project/default Supabase storage key as hub-account.js. No signup/profile,
// anonymous-login, OAuth redirect, activity RPC, service key or new Auth authority.
export function createLearningWebClient({win=globalThis.window}={}) {
  const config=win?.__INHAGAME_PUBLIC_SUPABASE__;
  // The existing public-config API validates the browser-safe publishable key.
  if(typeof config?.url!=='string'||!config.url||typeof config.publishableKey!=='string'||!config.publishableKey)return null;
  try{return win.supabase?.createClient(config.url,config.publishableKey,{auth:{
    persistSession:true,autoRefreshToken:true,detectSessionInUrl:false
  }})??null;}catch{return null;}
}

export function createLearningWebAuth({client,onState=()=>{},schedule=queueMicrotask}={}) {
  let epoch=0,disposed=false,abort=null,subscription=null,state={status:'checking',user:null,candidateId:null};
  const emit=value=>{if(!disposed){state=value;onState(value);}};
  function begin(candidateId=null){abort?.abort();abort=new AbortController();const current=++epoch;emit({status:'checking',user:null,candidateId});return {current,signal:abort.signal};}
  const live=token=>!disposed&&token.current===epoch&&!token.signal.aborted;
  async function verify(token){
    if(!client){if(live(token))emit({status:'unavailable',user:null,candidateId:null});return;}
    try{
      const sessionResult=await client.auth.getSession();if(!live(token))return;
      if(sessionResult.error)throw Error('SESSION_UNAVAILABLE');
      const session=sessionResult.data?.session;
      if(!session||session.user?.is_anonymous===true){emit({status:'guest',user:null,candidateId:null});return;}
      emit({status:'checking',user:null,candidateId:session.user?.id??null});
      // Pin the JWT. SDK Auth requests are not abortable; epoch/abort fences their
      // responses, while controller disposal aborts the actual learning RPCs.
      const result=await client.auth.getUser(session.access_token);if(!live(token))return;
      const user=result.data?.user;
      if(result.error||!user?.id||user.is_anonymous!==false||user.id!==session.user?.id)throw Error('USER_UNVERIFIED');
      const latest=await client.auth.getSession();if(!live(token))return;
      if(latest.error||latest.data?.session?.access_token!==session.access_token||latest.data?.session?.user?.id!==user.id)throw Error('SESSION_CHANGED');
      emit({status:'member',user:{id:user.id,email:typeof user.email==='string'?user.email:''},candidateId:user.id});
    }catch{if(live(token))emit({status:'error',user:null,candidateId:state.candidateId});}
  }
  function refresh(){if(disposed)return Promise.resolve();if(client&&!subscription)return start();return verify(begin(state.user?.id??state.candidateId));}
  function start(){
    if(disposed)return Promise.resolve();if(subscription)return refresh();
    try{if(client)subscription=client.auth.onAuthStateChange((event,session)=>{
      if(disposed)return;
      const token=begin(event==='SIGNED_OUT'?null:session?.user?.id??null);
      if(event==='SIGNED_OUT')emit({status:'guest',user:null,candidateId:null});
      // Supabase callbacks must return before invoking another Auth operation.
      else schedule(()=>{if(live(token))void verify(token);});
    }).data?.subscription;if(client&&!subscription)throw Error('AUTH_LISTENER_UNAVAILABLE');}catch{emit({status:'error',user:null,candidateId:null});return Promise.resolve();}
    return refresh();
  }
  return Object.freeze({start,refresh,snapshot:()=>({...state}),
    async signIn(email,password){
      if(disposed||!client)throw Error('AUTH_UNAVAILABLE');const token=begin();
      try{
        const result=await client.auth.signInWithPassword({email,password});
        if(disposed)return;
        if(result.error)throw Error('LOGIN_FAILED');
        await refresh();
      }catch{if(live(token))emit({status:'error',user:null,candidateId:null});throw Error('LOGIN_FAILED');}
    },
    async signOut(){
      if(disposed)return;const token=begin(); // Immediately clear personal UI/outbox before the network.
      try{const result=await client?.auth.signOut({scope:'local'});if(result?.error)throw Error();if(live(token))emit({status:'guest',user:null,candidateId:null});}
      catch{if(live(token))emit({status:'error',user:null,candidateId:null});throw Error('LOGOUT_FAILED');}
    },
    dispose(){if(disposed)return;disposed=true;epoch++;abort?.abort();subscription?.unsubscribe();subscription=null;}
  });
}
