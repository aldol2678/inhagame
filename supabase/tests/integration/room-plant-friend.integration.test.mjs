// Actual #353 chat join/leave/lease authority + plant SQL, independent PG connections.
// Disposable loopback only. No live account or production transport is ever accepted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomUUID} from 'node:crypto';
const {DB_URL,PSQL_FALLBACK_CONTAINER}=process.env;
assert.match(DB_URL??'',/^postgres(?:ql)?:\/\/[^@]*@(127\.0\.0\.1|localhost):\d+\//);
const run=promisify(execFile),lit=v=>`'${String(v).replaceAll("'","''")}'`;
async function sql(query){const args=['-v','ON_ERROR_STOP=1','-Atq','-c',query];try{return(await run('psql',[DB_URL,...args],{encoding:'utf8',timeout:15000})).stdout.trim();}
catch(e){if(e.code!=='ENOENT'||!PSQL_FALLBACK_CONTAINER)throw e;return(await run('docker',['exec',PSQL_FALLBACK_CONTAINER,'psql','-U','postgres','-d','postgres',...args],{encoding:'utf8',timeout:15000})).stdout.trim();}}
const owner=randomUUID(),friend=randomUUID(),other=randomUUID(),room=randomUUID(),object=randomUUID(),session=randomUUID();
const claims=u=>lit(JSON.stringify({sub:u,role:'authenticated',is_anonymous:false}));
const asUser=(u,q,app='plant-friend')=>sql(`begin;set local application_name=${lit(app)};set local lock_timeout='8s';set local role authenticated;set local request.jwt.claims=${claims(u)};${q};commit;`);
async function call(u,q,app){try{return{ok:true,data:JSON.parse((await asUser(u,q,app)).split('\n').at(-1))};}catch(e){return{ok:false,error:/ERROR:\s+([A-Z_]+)/.exec(String(e.stderr??e.message))?.[1]??String(e.message)};}}
const read=()=>call(friend,`select public.get_world_room_plants_v1(${lit(room)})`);
const join=async()=>{await sql('select private.world_room_cleanup_v1()');const r=await call(friend,`select public.join_world_room_chat_v1('personal',${lit(room)},${lit(session)},null)`);assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.data.allowed,true,JSON.stringify(r));return r.data.leaseId;};
const care=(token,lease,request=randomUUID(),u=friend,app)=>call(u,`select public.care_visited_room_plant_v1(${lit(room)},${lit(object)},${lit(token)},${lit(request)},${lit(session)},${lit(lease)})`,app);
const mine=(rev,request=randomUUID(),app)=>call(owner,`select public.care_my_room_plant_v1(${lit(room)},${lit(object)},${rev},${lit(request)})`,app);
let previousConfig,previousStatus,lease,token,winningRequest;
// Returning {promise} avoids async return adopting the held transaction and waiting before the test.
async function lock(query){const app='hold-'+randomUUID();const promise=sql(`set application_name=${lit(app)};begin;${query};select pg_sleep(2);commit;`);
 for(let n=0;n<100;n++){if(await sql(`select exists(select 1 from pg_stat_activity where application_name=${lit(app)} and wait_event='PgSleep')`)==='t')return{promise};await new Promise(r=>setTimeout(r,20));}await promise;throw Error('lock was never observed');}
async function blocked(app){for(let n=0;n<100;n++){if(await sql(`select exists(select 1 from pg_stat_activity where application_name=${lit(app)} and wait_event_type='Lock')`)==='t')return;await new Promise(r=>setTimeout(r,10));}throw Error('CARE was not observed waiting for lock');}
test.before(async()=>{
 assert.equal(await sql('select private.world_room_plant_enabled_v1()'),'f');
 assert.equal(await sql("select to_regprocedure('private.world_room_chat_plant_lease_v1(uuid,uuid,uuid,uuid)') is not null"),'t','real #353 helper required, no contract double');
 previousConfig=await sql('select enabled from private.world_room_chat_config where singleton');previousStatus=await sql("select status from private.world_item_catalog where item_id='furniture.indoor_planter'");
 for(const u of [owner,friend,other])await sql(`insert into auth.users(id,aud,role,email,email_confirmed_at,is_anonymous) values(${lit(u)},'authenticated','authenticated',${lit('plant-friend-'+u+'@example.test')},now(),false);insert into public.profiles(user_id,nickname,is_banned) values(${lit(u)},${lit('pf'+u.slice(0,7))},false);`);
 await sql(`insert into public.world_player_rooms(id,owner_user_id) values(${lit(room)},${lit(owner)});insert into public.world_friendships(user_low,user_high,status,requested_by,accepted_at) values(least(${lit(owner)}::uuid,${lit(friend)}::uuid),greatest(${lit(owner)}::uuid,${lit(friend)}::uuid),'accepted',${lit(owner)},now());
 create or replace function private.world_room_plant_enabled_v1() returns boolean language sql stable security definer set search_path='' as $$select true$$;
 update private.world_item_catalog set status='ACTIVE' where item_id='furniture.indoor_planter';select private.world_room_cleanup_v1();update private.world_room_chat_config set enabled=true where singleton;`);
 assert.equal(await sql('select private.world_room_chat_personal_authority_ready_v1()'),'t');
 assert.equal((await call(owner,`select public.claim_my_room_planter_v1(${lit(room)})`)).ok,true);
 await asUser(owner,`select public.save_my_room_furniture_v1(${lit(room)},0,${lit(JSON.stringify([{id:object,itemId:'furniture.indoor_planter',surface:'floor',x:-6,z:0,yaw:0}]))}::jsonb)`);
 assert.equal((await call(owner,`select public.plant_my_room_plant_v1(${lit(room)},${lit(object)},${lit(randomUUID())})`)).ok,true);
 lease=await join();token=(await read()).data.plants[0].careToken;
});
test.after(async()=>{if(previousConfig!==undefined)await sql(`delete from auth.users where id in (${[owner,friend,other].map(lit)});update private.world_room_chat_config set enabled=${previousConfig==='t'} where singleton;update private.world_item_catalog set status=${lit(previousStatus)} where item_id='furniture.indoor_planter';create or replace function private.world_room_plant_enabled_v1() returns boolean language sql stable security definer set search_path='' as $$select false$$;`);});
test('actual join emits a no-message 30s lease, bound to user/room/session; owner-only paths stay protected',async()=>{
 assert.equal(await sql(`select count(*) from private.world_room_chat_limits where user_id=${lit(friend)}`),'0','no message was needed to join');
 assert.equal((await care(token,randomUUID())).error,'PLANT_ACCESS_DENIED');assert.equal((await care(token,lease,randomUUID(),other)).error,'PLANT_ACCESS_DENIED');
 assert.equal((await call(friend,`select public.claim_my_room_planter_v1(${lit(room)})`)).error,'PLANT_ACCESS_DENIED');
 assert.equal((await call(friend,`select public.plant_my_room_plant_v1(${lit(room)},${lit(object)},${lit(randomUUID())})`)).error,'PLANT_ACCESS_DENIED');
 assert.equal((await call(friend,`select public.save_my_room_furniture_v1(${lit(room)},1,'[]')`)).error,'LAYOUT_DENIED');
});
test('owner and friend concurrently water one expected state exactly once',async()=>{
 winningRequest=randomUUID();const responses=await Promise.all([mine(1),care(token,lease,winningRequest)]);
 assert.equal(responses.filter(r=>r.ok).length,1,JSON.stringify(responses));assert.equal(responses.find(r=>!r.ok).error,'PLANT_CONFLICT');
 assert.equal(await sql(`select revision from private.world_room_plants where user_id=${lit(owner)}`),'2');
 assert.equal(await sql(`select count(*) from private.world_room_plant_receipts where coalesce(owner_user_id,user_id)=${lit(owner)}`),'2');
});
test('friend second care same-key concurrency returns one redacted receipt and does not touch economy',async()=>{
 await sql(`update private.world_room_plants set planted_at=clock_timestamp()-interval '22 hours',first_cared_at=clock_timestamp()-interval '21 hours' where user_id=${lit(owner)}`);
 lease=await join();token=(await read()).data.plants[0].careToken;winningRequest=randomUUID();
 const results=await Promise.all(Array.from({length:12},()=>care(token,lease,winningRequest)));
 assert.ok(results.every(r=>r.ok),JSON.stringify(results));for(const r of results)assert.deepEqual(r.data,results[0].data);
 assert.equal(results[0].data.plantRevision,undefined);assert.equal(results[0].data.ownerUserId,undefined);
 assert.equal(await sql(`select count(*) from private.world_room_plant_receipts where coalesce(owner_user_id,user_id)=${lit(owner)}`),'3');
 assert.equal(await sql(`select count(*) from private.world_currency_transactions where user_id in (${lit(owner)},${lit(friend)})`),'0');
 assert.equal(await sql(`select count(*) from private.world_exp_transactions where user_id in (${lit(owner)},${lit(friend)})`),'0');
 assert.equal(await sql(`select count(*) from private.world_life_skill_xp_transactions where user_id in (${lit(owner)},${lit(friend)})`),'0');
});
test('same-key reply loss cannot replay after leave, expiry, disabled chat or replaced lease',async()=>{
 assert.equal((await care(token,lease,winningRequest)).ok,true);
 await asUser(friend,`select public.leave_world_room_chat_v1(${lit(lease)})`);assert.equal((await care(token,lease,winningRequest)).error,'PLANT_ACCESS_DENIED');
 lease=await join();assert.equal((await care(token,lease,winningRequest)).error,'IDEMPOTENCY_CONFLICT','lease is request-bound');
 await sql(`update private.world_room_chat_sessions set lease_expires_at=clock_timestamp()-interval '1 millisecond' where id=${lit(lease)}`);assert.equal((await care(token,lease)).error,'PLANT_ACCESS_DENIED');
 lease=await join();await sql('update private.world_room_chat_config set enabled=false where singleton');assert.equal((await care(token,lease)).error,'PLANT_ACCESS_DENIED');await sql('update private.world_room_chat_config set enabled=true where singleton');
});
test('lease wait crossing expiry is denied using post-lock clock',async()=>{
 lease=await join();const held=await lock(`update private.world_room_chat_sessions set lease_expires_at=clock_timestamp()+interval '300 milliseconds' where id=${lit(lease)}`);
 const app='care-'+randomUUID(),result=care(token,lease,randomUUID(),friend,app);await blocked(app);await held.promise;
 assert.equal((await result).error,'PLANT_ACCESS_DENIED');
});
test('owner ban during an asset lock wait is checked after all locks',async()=>{
 const held=await lock(`select 1 from private.world_room_layouts where room_id=${lit(room)} for update`),app='care-'+randomUUID(),result=mine(3,randomUUID(),app);
 await blocked(app);await sql(`update public.profiles set is_banned=true where user_id=${lit(owner)}`);await held.promise;
 assert.equal((await result).error,'ACCOUNT_UNAVAILABLE');await sql(`update public.profiles set is_banned=false where user_id=${lit(owner)}`);
});
test('block committed during asset lock wait denies friend before mutation',async()=>{
 lease=await join();const held=await lock(`select 1 from private.world_room_layouts where room_id=${lit(room)} for update`),app='care-'+randomUUID(),result=care(token,lease,randomUUID(),friend,app);
 await blocked(app);await sql(`insert into public.world_user_blocks(blocker_id,blocked_id) values(${lit(owner)},${lit(friend)})`);await held.promise;
 assert.equal((await result).error,'PLANT_ACCESS_DENIED');await sql(`delete from public.world_user_blocks where blocker_id=${lit(owner)} and blocked_id=${lit(friend)}`);
});

test('cleanup, renew and friend CARE have serial outcomes without deadlock; unhealthy cleanup closes only friend',async()=>{
 lease=await join();
 const results=await Promise.all([sql('select private.world_room_cleanup_v1()'),call(friend,`select public.renew_world_room_chat_v1(${lit(lease)})`),care(token,lease)]);
 assert.equal(results[1].ok,true);assert.equal(results[1].data.allowed,true);assert.equal(results[2].error,'PLANT_CONFLICT');
 await sql("update cron.job set active=false where jobname='world-room-social-cleanup-v1'");
 try{assert.equal((await care(token,lease)).error,'PLANT_ACCESS_DENIED');assert.equal((await mine(3)).error,'PLANT_NOT_READY','owner reaches growth rules without chat cleanup authority');}
 finally{await sql("update cron.job set active=true where jobname='world-room-social-cleanup-v1';select private.world_room_cleanup_v1()");}
});
