// Real disposable HTTP -> Auth -> durable server reducer -> PostgREST -> PostgreSQL.
// Fixture users/tokens are synthetic. No Production credentials or database accepted.
import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID,createHmac} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createConfiguredConvenienceAuthorityHandler} from '../../../apps/world/server/convenience-authority-service.mjs';
import {INCOME_CONVENIENCE_LOCATION as shop} from '../../../apps/world/src/income/income-convenience-location.mjs';
const { DB_URL, PSQL_FALLBACK_CONTAINER, API_URL, ANON_KEY, JWT_SECRET } = process.env;
assert.ok(DB_URL, 'DB_URL must come from the disposable local stack');
const database = new URL(DB_URL);
assert.ok(['postgres:', 'postgresql:'].includes(database.protocol), 'PostgreSQL URL required');
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname), 'loopback DB only');
assert.ok(database.port && /^\d+$/.test(database.port), 'explicit local port required');
assert.equal(database.search, '', 'connection query overrides could redirect the DB host');
assert.equal(database.hash, '', 'no connection fragments');
const run = promisify(execFile);
const lit = value => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
async function query(sql) {
  const args = ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-c', `set statement_timeout='15s'; set lock_timeout='10s'; ${sql}`];
  const options = { encoding: 'utf8', timeout: 20000, maxBuffer: 1024 * 1024 };
  try { return (await run('psql', [DB_URL, ...args], options)).stdout.trim(); }
  catch (error) {
    if (error.code !== 'ENOENT' || !PSQL_FALLBACK_CONTAINER) throw error;
    assert.match(PSQL_FALLBACK_CONTAINER, /^supabase_db_[A-Za-z0-9_.-]+$/, 'only a named local Supabase DB container');
    assert.ok(!process.env.DOCKER_HOST || process.env.DOCKER_HOST.startsWith('unix://'), 'no remote Docker daemon');
    assert.ok(!process.env.DOCKER_CONTEXT || process.env.DOCKER_CONTEXT === 'default', 'no remote Docker context');
    return (await run('docker', ['--host', process.env.DOCKER_HOST || 'unix:///var/run/docker.sock', 'exec', PSQL_FALLBACK_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', ...args], options)).stdout.trim();
  }
}
const json = async sql => JSON.parse((await query(sql)).split('\n').at(-1));
assert.match(API_URL??'',/^http:\/\/(localhost|127\.0\.0\.1):\d+$/);
assert.ok(ANON_KEY&&JWT_SECRET,'disposable auth fixture keys required');
const jwt=claims=>{const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
 const b=Buffer.from(JSON.stringify({iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,aud:'authenticated',...claims})).toString('base64url');
 return `${h}.${b}.${createHmac('sha256',JWT_SECRET).update(`${h}.${b}`).digest('base64url')}`;};
const env={WORLD_INCOME_CANDIDATE_ENABLED:'1',WORLD_CONVENIENCE_AUTHORITY_CANDIDATE:'1',NODE_ENV:'test',
 WORLD_INCOME_CANDIDATE_SUPABASE_URL:API_URL,WORLD_INCOME_CANDIDATE_ANON_KEY:ANON_KEY,WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY:jwt({role:'service_role'})};
let server,origin,previous;const actors=[];const gateTable='convenience_it_'+randomUUID().replaceAll('-','');
before(async()=>{
 previous=await json(`select jsonb_build_object('income',(select to_jsonb(r) from private.world_income_runtime r),'convenience',(select to_jsonb(r) from private.world_convenience_runtime r),'definition',(select to_jsonb(d) from private.world_income_definitions d where kind='SHIFT'),'reward',(select to_jsonb(r) from private.world_reward_definitions r where reward_id='reward.income.convenience_help'));`);
 await query(`create table private.${gateTable}(id text primary key);`);
 assert.equal(previous.income.enabled,false);assert.equal(previous.convenience.enabled,false);assert.equal(previous.definition.status,'CLOSED');
 await query(`update private.world_income_runtime set enabled=true;update private.world_convenience_runtime set enabled=true;update private.world_income_definitions set status='ACTIVE' where kind='SHIFT';update private.world_reward_definitions set status='ACTIVE' where reward_id='reward.income.convenience_help';`);
 // Two independent worker handlers share only durable DB rows, never a JS session registry.
 const handlers=[createConfiguredConvenienceAuthorityHandler(env),createConfiguredConvenienceAuthorityHandler(env)];let worker=0;
 server=http.createServer((req,res)=>{void handlers[worker++%2](req,res);});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
});
after(async()=>{if(server)await new Promise(resolve=>server.close(resolve));
 if(previous)await query(`drop table if exists private.${gateTable};update private.world_income_runtime set enabled=${previous.income.enabled};update private.world_convenience_runtime set enabled=${previous.convenience.enabled};update private.world_income_definitions set status=${lit(previous.definition.status)} where kind='SHIFT';update private.world_reward_definitions set status=${lit(previous.reward.status)} where reward_id='reward.income.convenience_help';${actors.length?`delete from auth.users where id in (${actors.map(a=>lit(a.user)).join(',')});`:''}`);
});
async function authRequest(path, body, key=ANON_KEY) {
 const response=await fetch(`${API_URL}/auth/v1/${path}`,{method:'POST',redirect:'error',
   headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
 const value=await response.json();
 // Report only status/error code, never fixture passwords, access tokens or response bodies.
 assert.ok(response.ok,`local Auth ${path.split('?')[0]} failed: ${response.status} ${value.error_code??value.code??'unknown'}`);
 return value;
}
async function actor(){
 const email=`convenience-${randomUUID()}@example.test`,password=`Fixture-only-${randomUUID()}!`;
 // GoTrue owns the user/session/token lifecycle. Handwritten JWTs + SQL auth rows are
 // insufficient evidence that the real /auth/v1/user verifier accepts a login.
 const user=await authRequest('admin/users',{email,password,email_confirm:true},env.WORLD_INCOME_CANDIDATE_SERVICE_ROLE_KEY);
 const a={user:user.id,auth:null,connection:randomUUID(),record:null};actors.push(a);
 const login=await authRequest('token?grant_type=password',{email,password});
 a.token=login.access_token;
 const claims=JSON.parse(Buffer.from(a.token.split('.')[1],'base64url').toString());
 assert.equal(claims.sub,a.user);assert.match(claims.session_id,/^[0-9a-f-]{36}$/i);a.auth=claims.session_id;
 const verified=await fetch(`${API_URL}/auth/v1/user`,{headers:{apikey:ANON_KEY,Authorization:`Bearer ${a.token}`}});
 assert.equal(verified.status,200,'real Auth must accept the fixture session before testing authority');
 assert.equal((await verified.json()).is_anonymous,false);
 await query(`insert into public.profiles(user_id,nickname,is_banned) values(${lit(a.user)},${lit('c'+a.user.slice(0,8))},false) on conflict(user_id) do update set is_banned=false;insert into private.world_quest_progress_v1(user_id,quest_id,stage) values(${lit(a.user)},'campus_navigation_intro_v1',9);`);
 return a;
}
const scope=a=>({connectionId:a.connection,authoritySessionId:a.record?.sessionId,fence:a.record?.fence});
async function call(a,body){const response=await fetch(origin,{method:'POST',headers:{Authorization:`Bearer ${a.token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Object.assign(Error(value.error),{status:response.status});return value;}
async function open(a){a.record=await call(a,{op:'open',connectionId:a.connection});return a.record;}
async function move(a,x=0,z=0){a.record=await call(a,{op:'move',...scope(a),command:{sequence:a.record.state.sequence+1,moveX:x,moveZ:z}});return a.record;}
const income=(a,op,extra={})=>call(a,{op,...scope(a),...extra});
async function steady(a,ms){const end=Date.now()+ms;while(Date.now()<end){await move(a);await delay(Math.min(120,Math.max(1,end-Date.now())));}await move(a);}
async function finishSteps(a,session,{wait=true}={}){for(let revision=0;revision<3;revision++){
 if(wait)await steady(a,3100);else await query(`update private.world_income_sessions set available_at=clock_timestamp()-interval '1 second' where session_id=${lit(session.sessionId)};`);
 const challenge=await json(`select challenge from private.world_income_sessions where session_id=${lit(session.sessionId)};`);await move(a);
 session=await income(a,'step',{sessionId:session.sessionId,requestId:randomUUID(),revision,stepId:`${session.sessionId}:${revision}`,choiceId:challenge.answer});
 }return session;}
const accountState=a=>json(`select jsonb_build_object('balance',coalesce((select balance from private.world_wallets where user_id=${lit(a.user)} and currency_id='currency.induck_coin'),0),'rewards',(select count(*) from private.world_reward_transactions where user_id=${lit(a.user)} and reward_id='reward.income.convenience_help'),'settled',(select count(*) from private.world_income_sessions where user_id=${lit(a.user)} and state='SETTLED'));`);

// Only this helper injects synthetic on-site SERVER state, for adverse lock tests.
// The first test below reaches the site through real clocked movement and never calls it.
async function syntheticSite(a){await open(a);await query(`update private.world_convenience_authority set state=jsonb_set(state,'{position}',jsonb_build_object('x',153.18967351484042,'y',1.15,'z',111.37716454636742)),eligible=true where user_id=${lit(a.user)};`);await move(a);}

test('actual local Auth and HTTP walk across independent workers, ordered work, exactly-once pay and terminal recovery',{timeout:120000},async()=>{
 const a=await actor();await open(a);assert.equal(a.record.spawnId,'BACK_GATE');
 await assert.rejects(call(a,{op:'move',...scope(a),command:{sequence:1,moveX:1,moveZ:0,position:shop.position}}),/INPUT_SCHEMA|COMMAND_INVALID/);
 await assert.rejects(income(a,'start',{requestId:randomUUID()}),/PRESENCE_REQUIRED/);assert.equal((await accountState(a)).rewards,0);
 await assert.rejects(call(a,{op:'open',connectionId:randomUUID()}),/SESSION_ACTIVE/);
 for(const target of shop.approach){let tries=0;while(Math.hypot(target.x-a.record.state.position.x,target.z-a.record.state.position.z)>.18){
   assert.ok(tries++<300,'canonical route must converge');const dx=target.x-a.record.state.position.x,dz=target.z-a.record.state.position.z,d=Math.hypot(dx,dz),scale=Math.min(1,d/.5);
   await move(a,dx/d*scale,dz/d*scale);await delay(55);await move(a);
 }}assert.equal(a.record.eligible,true);
 let session=await income(a,'start',{requestId:randomUUID()});assert.equal(session.giverId,'BACKGATE-NPC-001');assert.equal('answer' in session.nextChallenge,false);
 await assert.rejects(income(a,'complete',{sessionId:session.sessionId,requestId:randomUUID()}),/NOT_READY/);
 session=await finishSteps(a,session);await move(a);const requestId=randomUUID();
 const replies=await Promise.all(Array.from({length:4},()=>income(a,'complete',{sessionId:session.sessionId,requestId})));
 replies.forEach(r=>assert.deepEqual(r.receipt,replies[0].receipt));assert.deepEqual(await accountState(a),{balance:30,rewards:1,settled:1});
 await call(a,{op:'revoke',...scope(a)});
 assert.deepEqual((await income(a,'complete',{sessionId:session.sessionId,requestId:randomUUID()})).receipt,replies[0].receipt);
 assert.deepEqual((await call(a,{op:'status',connectionId:a.connection,sessionId:session.sessionId})).receipt,replies[0].receipt);
});

test('two worker commits race on durable CAS; duplicate acknowledgement cannot refresh observation or lease',async()=>{
 const a=await actor();await open(a);const command={sequence:1,moveX:0,moveZ:0};
 const results=await Promise.allSettled([call(a,{op:'move',...scope(a),command}),call(a,{op:'move',...scope(a),command})]);
 const accepted=results.filter(r=>r.status==='fulfilled');assert.ok(accepted.length>=1);
 for(const rejected of results.filter(r=>r.status==='rejected'))assert.match(rejected.reason.message,/CAS_CONFLICT/);
 a.record=accepted[0].value;const old=a.record.state;await delay(20);
 const replay=await call(a,{op:'move',...scope(a),command});assert.deepEqual(replay.state,old);
 await assert.rejects(call(a,{op:'move',...scope(a),command:{...command,moveX:1}}),/SEQUENCE_CONFLICT/);
 await call(a,{op:'revoke',...scope(a)});await assert.rejects(move(a),/SESSION_EXPIRED/);
});

test('Wallet lock wait then revocation rolls back first settlement, ledger and request; no position-independent first pay',{timeout:30000},async()=>{
 const a=await actor();await syntheticSite(a);let session=await income(a,'start',{requestId:randomUUID()});session=await finishSteps(a,session,{wait:false});
 await query(`select private.world_wallet_apply_v1(${lit(a.user)},'currency.induck_coin',100,'REWARD','test','convenience.fixture',${lit(randomUUID())},null);`);await move(a);
 const lockName='convenience-'+randomUUID();const held=query(`begin;set local application_name=${lit(lockName)};select balance from private.world_wallets where user_id=${lit(a.user)} for update;select pg_sleep(2);commit;`).then(value=>({value}),error=>({error}));
 let ready=false;for(let i=0;i<100;i++){if(await query(`select exists(select 1 from pg_stat_activity where application_name=${lit(lockName)} and wait_event='PgSleep');`)==='t'){ready=true;break;}await delay(10);}assert.ok(ready);
 const pending=income(a,'complete',{sessionId:session.sessionId,requestId:randomUUID()}).then(value=>({value}),error=>({error}));
 await delay(100);await call(a,{op:'revoke',...scope(a)});const result=await pending;const holder=await held;if(holder.error)throw holder.error;
 assert.match(result.error?.message??'',/PRESENCE_REQUIRED/);assert.deepEqual(await accountState(a),{balance:100,rewards:0,settled:0});
 assert.equal(await query(`select count(*) from private.world_income_requests where user_id=${lit(a.user)} and payload->>'op'='FINISH';`),'0');
});

test('auth-session deletion and other-account scope cannot consume durable state',async()=>{
 const a=await actor(),b=await actor();await open(a);b.record=a.record;
 await assert.rejects(move(b),/SESSION_CHANGED/);await query(`delete from auth.sessions where id=${lit(a.auth)};`);
 await assert.rejects(move(a),/AUTH_REVOKED|AUTH_REQUIRED/);assert.equal((await accountState(a)).rewards,0);
});

for(const invalidation of ['auth-session','runtime-close','target-version'])test(`economic lock wait rechecks committed ${invalidation} before first payment`,{timeout:30000},async()=>{
 const a=await actor();await syntheticSite(a);let session=await income(a,'start',{requestId:randomUUID()});session=await finishSteps(a,session,{wait:false});
 await query(`select private.world_wallet_apply_v1(${lit(a.user)},'currency.induck_coin',100,'REWARD','test','convenience.fixture',${lit(randomUUID())},null);`);await move(a);
 const lockName='convenience-'+randomUUID();const held=query(`begin;set local application_name=${lit(lockName)};select balance from private.world_wallets where user_id=${lit(a.user)} for update;do $gate$ declare deadline timestamptz:=clock_timestamp()+interval '8 seconds';begin while not exists(select 1 from private.${gateTable} where id=${lit(lockName)}) loop if clock_timestamp()>deadline then raise exception 'FIXTURE_GATE_TIMEOUT';end if;perform pg_sleep(.02);end loop;end $gate$;commit;`).then(value=>({value}),error=>({error}));
 const waitFor=async predicate=>{const until=Date.now()+2500;while(Date.now()<until){if(await query(`select exists(select 1 from pg_stat_activity where ${predicate});`)==='t')return;await delay(10);}throw Error('Expected PostgreSQL lock wait not observed');};
 await waitFor(`application_name=${lit(lockName)} and wait_event='PgSleep'`);
 const pending=income(a,'complete',{sessionId:session.sessionId,requestId:randomUUID()}).then(value=>({value}),error=>({error}));
 try{
   await waitFor(`wait_event_type='Lock' and query like '%world_convenience_income_v2%'`);
   if(invalidation==='auth-session')await query(`delete from auth.sessions where id=${lit(a.auth)};`);
   if(invalidation==='runtime-close')await query(`update private.world_convenience_runtime set enabled=false;`);
   if(invalidation==='target-version'){
     // Keep the real stationary reducer/lease current, change only the target, and then
     // explicitly release the observed Wallet gate. No guessed delay or re-stamped observation.
     await move(a);await query(`update private.world_convenience_runtime set target_version='fixture-changed';`);
   }
   await query(`insert into private.${gateTable}(id) values(${lit(lockName)}) on conflict do nothing;`);
   const result=await pending;
   assert.match(result.error?.message??'',invalidation==='auth-session'?/AUTH_REVOKED/:invalidation==='runtime-close'?/CONVENIENCE_CLOSED/:/PRESENCE_REQUIRED/);
   assert.deepEqual(await accountState(a),{balance:100,rewards:0,settled:0});
 }finally{await query(`insert into private.${gateTable}(id) values(${lit(lockName)}) on conflict do nothing;`);const holder=await held;if(holder.error)throw holder.error;await pending;await query(`update private.world_convenience_runtime set enabled=true,target_version='back_street_4-v1';`);}
});

test('malformed durable observations fail closed and roll back an otherwise valid START',async()=>{
 for(const expression of ["state #- '{position,x}'","jsonb_set(state,'{position,y}','null'::jsonb)","jsonb_set(state,'{position,z}','\"NaN\"'::jsonb)","jsonb_set(state,'{observedAt}','null'::jsonb)"]){
   const a=await actor();await syntheticSite(a);
   await query(`update private.world_convenience_authority set state=${expression} where user_id=${lit(a.user)};`);
   await assert.rejects(income(a,'start',{requestId:randomUUID()}),/PRESENCE_REQUIRED/);
   assert.deepEqual(await accountState(a),{balance:0,rewards:0,settled:0});
   assert.equal(await query(`select count(*) from private.world_income_sessions where user_id=${lit(a.user)};`),'0');
 }
});
