// Isolated Supabase Auth adapter for the server. No browser/session JWT trust without Auth verification.
// The SQL authority (auth.sessions, kick blocks, room access) is provided by protected server-only queries.
import {RIError} from './identity-service.mjs';
import {UUID} from './crypto.mjs';
export function createSupabaseAuthVerifier({url,publishableKey,checkSession,getProfile,isKickBlocked,fetcher=fetch}){
 if(!/^https:\/\//.test(url??'')||!publishableKey||![checkSession,getProfile,isKickBlocked].every(f=>typeof f==='function'))throw Error('AUTH_CONFIG_REQUIRED');
 return {async verify(token){
  // Auth /user validates signature and current account. Decoded JWT claims alone are not trusted.
  const response=await fetcher(`${url}/auth/v1/user`,{
   headers:{apikey:publishableKey,authorization:`Bearer ${token}`},signal:AbortSignal.timeout(5000)});
  if(response.status===401||response.status===403)return null;
  if(!response.ok)throw new RIError('AUTH_UNAVAILABLE',503);
  const user=await response.json();
  let claims;
  try{const pieces=token.split('.');if(pieces.length!==3)throw 0;claims=JSON.parse(Buffer.from(pieces[1],'base64url').toString());}catch{return null;}
  if(!UUID.test(user?.id??'')||user.id!==claims.sub||!UUID.test(claims.session_id??'')||typeof user.is_anonymous!=='boolean')return null;
  if(!Number.isFinite(claims.exp)||claims.exp*1000<=Date.now())return null;
  // A valid JWT may outlive a revoked session. Revalidate against auth.sessions.
  if(!await checkSession({authSessionId:claims.session_id,userId:user.id}))return null;
  const profile=await getProfile(user.id);
  // Anonymous Auth users may intentionally have no persistent public profile.
  if((!profile&&user.is_anonymous!==true)||profile?.is_banned===true)return {userId:user.id,authSessionId:claims.session_id,guest:user.is_anonymous===true,banned:true,kicked:false,displayName:null};
  const kicked=await isKickBlocked(user.id);
  return {userId:user.id,authSessionId:claims.session_id,guest:user.is_anonymous===true,
   banned:false,kicked,displayName:typeof profile?.nickname==='string'?profile.nickname:(user.is_anonymous===true?null:'인덕이')};
 }};
}
