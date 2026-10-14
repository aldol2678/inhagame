// Server-only composition for an isolated Supabase Preview, not Production. Framework-neutral.
// Supply a TLS-connected, service-only PostgreSQL pool. NEVER expose it to browser runtime.
import {createSupabaseAuthVerifier} from './supabase-auth.mjs';
import {PostgresIdentityStore} from './postgres-store.mjs';
import {createSupabaseTrustedPublisher} from './supabase-trusted-publisher.mjs';
import {IdentityService} from './identity-service.mjs';
import {createIdentityHttpHandler} from './identity-http.mjs';
import {ROOM} from './crypto.mjs';
export function createIsolatedRIHandler({pool,env=process.env,fetcher=fetch}) {
 const ref=env.RI_TEST_PROJECT_REF;
 if(ref==='oosshdsthgpqabjmbkjo'||!ref||env.RI_ENABLE_ISOLATED_SERVER!=='1')throw Error('ISOLATED_ONLY_GUARD');
 const verifySession=async({authSessionId,userId})=>{
  const x=await pool.query('SELECT EXISTS(SELECT 1 FROM auth.sessions WHERE id=$1 AND user_id=$2) AS yes',[authSessionId,userId]);return x.rows[0]?.yes===true;
 };
 const profile=async userId=>{
  const x=await pool.query('SELECT nickname,is_banned FROM public.profiles WHERE user_id=$1',[userId]);return x.rows[0]??null;
 };
 const kick=async userId=>{
  const x=await pool.query('SELECT EXISTS(SELECT 1 FROM private.world_session_kick_blocks WHERE user_id=$1 AND blocked_until>now()) AS yes',[userId]);return x.rows[0]?.yes===true;
 };
 const auth=createSupabaseAuthVerifier({url:env.RI_TEST_SUPABASE_URL,publishableKey:env.RI_TEST_PUBLISHABLE_KEY,
  checkSession:verifySession,getProfile:profile,isKickBlocked:kick,fetcher});
 const publisher=createSupabaseTrustedPublisher({projectUrl:env.RI_TEST_SUPABASE_URL,projectRef:ref,secretKey:env.RI_TEST_SECRET_KEY,fetcher});
 const store=new PostgresIdentityStore(pool);
 const authorize=async({actor,topic})=>{
  if(!ROOM.test(topic))return true;
  const result=await pool.query(`SELECT private.world_room_access_v1($1::uuid, substring($2 from 12)::uuid) IN ('OWNER','VISITOR') AS allowed`,[actor.userId,topic]);
  return result.rows[0]?.allowed===true;
 };
 const service=new IdentityService({auth,store,publisher,authorize});
 return {handler:createIdentityHttpHandler(service),service,store};
}
