// Local, in-memory PostgreSQL fixture only. Never accepts a database URL or production credentials.
// Uses real candidate SQL and existing access helpers; auth/Realtime tables are synthetic.
import { fileURLToPath } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE ?? '@electric-sql/pglite');
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createInboxAuthority } from '../../apps/world/src/rooms/inbox-authority.js';
import { encodeAction, validateAction, validatePresence, validatePose, EMOTE_IDS, ActionType } from '../../apps/world/src/network/protocol.js';
const root = fileURLToPath(new URL('../../', import.meta.url));
const db = new PGlite();
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const scalar=async (s,p=[]) => Object.values((await db.query(s,p)).rows[0])[0];
const q= s=>db.exec(s);
const auth=async(u,anon=false)=>{await q('reset role');await db.query(`select set_config('request.jwt.claims',$1,false)`,[JSON.stringify({sub:u,role:'authenticated',is_anonymous:anon})]);await q('set role authenticated');};
const fn=(path,name)=>{const s=readFileSync(root+path,'utf8');const i=s.toLowerCase().indexOf(`function ${name.toLowerCase()}(`);const start=s.toLowerCase().lastIndexOf('create',i);return s.slice(start,s.indexOf('$$;',i)+3);};
await q(`create schema cron;
-- Synthetic scheduler metadata only. PGlite cannot run pg_cron; real CI verifies its worker.
create table cron.job(jobname text primary key,schedule text,command text,active boolean default true);
create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin insert into cron.job(jobname,schedule,command) values($1,$2,$3); return 1; end$$;
create schema auth; create schema private; create schema realtime; create role anon; create role authenticated; create role service_role;
create table auth.users(id uuid primary key,is_anonymous boolean);
create table public.profiles(user_id uuid primary key,nickname text,is_banned boolean default false);
create table public.world_friendships(user_low uuid,user_high uuid,status text,requested_by uuid);
create table public.world_user_blocks(blocker_id uuid,blocked_id uuid);
create table public.world_player_rooms(id uuid primary key,owner_user_id uuid,visibility text);
create table private.world_room_knocks(room_id uuid,visitor_user_id uuid,status text,responded_at timestamptz,created_at timestamptz);
create table private.world_room_owner_presence(room_id uuid,seen_at timestamptz);
create table private.world_user_moderation_actions(target_id uuid,action text,starts_at timestamptz,ends_at timestamptz);
create function auth.jwt() returns jsonb language sql as $$select current_setting('request.jwt.claims',true)::jsonb$$;
create function auth.uid() returns uuid language sql as $$select (auth.jwt()->>'sub')::uuid$$;
grant usage on schema public,auth,realtime to authenticated,anon;
create table realtime.messages(id uuid default gen_random_uuid(),topic text,extension text default 'broadcast',payload jsonb);
alter table realtime.messages enable row level security;
grant select,insert on realtime.messages to authenticated,anon;
create function realtime.topic() returns text language sql as $$select current_setting('realtime.topic',true)$$;
create function realtime.send(payload jsonb,event text,topic text,private boolean default true) returns void language plpgsql as $$begin insert into realtime.messages(topic,payload) values (topic,payload); exception when insufficient_privilege then raise warning 'synthetic provider RLS rejection'; end$$;
create policy broad_existing_read on realtime.messages for select to anon,authenticated using(true);
create policy broad_existing_write on realtime.messages for insert to anon,authenticated with check(true);
insert into auth.users values('${id(1)}',false),('${id(2)}',false),('${id(3)}',false),('${id(4)}',true);
insert into public.profiles values('${id(1)}','방주인',false),('${id(2)}','친구',false),('${id(3)}','외부인',false),('${id(4)}','게스트',false);
insert into public.world_player_rooms values('${id(100)}','${id(1)}','friends');
insert into public.world_friendships values('${id(1)}','${id(2)}','accepted','${id(1)}');`);
const base='supabase/migrations/20261001213132_public_baseline.sql', h3='supabase/migrations/20261005022000_world_personal_room_knock_h3.sql';
await q(fn(base,'private.world_room_caller_v1')); await q(fn(base,'private.world_relationship'));
await q(fn(h3,'private.world_room_owner_present_v1')); await q(fn(h3,'private.world_room_access_v1'));
await q(readFileSync(root+'supabase/migrations/20261012023000_world_club_room_multiplayer.sql','utf8').replace('create extension if not exists pg_cron with schema pg_catalog;', '-- Synthetic scheduler fixture; no background worker in PGlite.'));
await q(readFileSync(root+'supabase/migrations/20261012023100_world_room_chat_candidate.sql','utf8'));
assert.deepEqual(await scalar("select proargnames from pg_proc where oid='public.join_world_room_chat_v1(text,text,uuid,uuid)'::regprocedure"),['p_kind','p_room','p_session','p_admission']);
for(const name of ['heartbeat_world_club_room_v1','leave_world_club_room_v1']) {
  assert.deepEqual(await scalar(`select proargnames from pg_proc where oid='public.${name}(text,uuid)'::regprocedure`),['p_room','p_admission']);
}
assert.deepEqual(await scalar("select proargnames from pg_proc where oid='public.publish_world_club_room_v1(text,uuid,text,jsonb)'::regprocedure"),['p_room','p_admission','p_event','p_packet']);
assert.equal(await scalar('select private.world_room_chat_personal_authority_ready_v1()'),true);
// Dependency faults touch only this synthetic disposable fixture, never hosted helpers.
await q(`alter table private.world_room_knocks rename to fixture_hidden_knocks`);
assert.equal(await scalar('select private.world_room_chat_personal_authority_ready_v1()'),false);
await q(`alter table private.fixture_hidden_knocks rename to world_room_knocks;
alter function private.world_room_owner_present_v1(uuid) rename to fixture_hidden_owner_present`);
assert.equal(await scalar('select private.world_room_chat_personal_authority_ready_v1()'),false);
await q(`alter function private.fixture_hidden_owner_present(uuid) rename to world_room_owner_present_v1;
create or replace function private.world_room_access_v1(p_viewer uuid,p_room_id uuid) returns text language plpgsql stable security definer set search_path='' as $$begin return 'VISITOR'; end$$;`);
assert.equal(await scalar('select private.world_room_chat_personal_authority_ready_v1()'),false,'weaker same-name authority is not accepted');
await q(fn(h3,'private.world_room_access_v1'));
assert.equal(await scalar('select private.world_room_chat_personal_authority_ready_v1()'),true);
await auth(id(1)); assert.equal((await scalar(`select public.join_world_room_chat_v1('personal',$1,$2)`,[id(100),id(20)])).allowed,false);
await q('reset role; update private.world_room_chat_config set enabled=true');
const join=async(u,s)=>{await auth(u);return scalar(`select public.join_world_room_chat_v1('personal',$1,$2)`,[id(100),id(s)]);};
const a=await join(id(1),20),b=await join(id(2),21),denied=await join(id(3),22);
assert.equal(a.allowed,true); assert.equal(b.allowed,true); assert.equal(denied.allowed,false);
await auth(id(4),true); await assert.rejects(()=>scalar(`select public.join_world_room_chat_v1('personal',$1,$2)`,[id(100),id(23)]),/PERMANENT_ACCOUNT_REQUIRED/);
await q(`reset role; insert into private.world_user_moderation_actions values('${id(2)}','interaction_restriction_24h',clock_timestamp()-interval '1 minute',clock_timestamp()+interval '1 day')`);
await auth(id(2)); assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[b.leaseId])).allowed,false);
await q(`reset role; update private.world_user_moderation_actions set ends_at=clock_timestamp()-interval '1 second'`);
await auth(id(2)); assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[b.leaseId])).allowed,true);
await q(`reset role; update private.world_user_moderation_actions set starts_at=clock_timestamp()+interval '1 hour',ends_at=clock_timestamp()+interval '1 day'`);
await auth(id(2)); assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[b.leaseId])).allowed,true,'future restriction not active yet');
await auth(id(1));
const send= text=>scalar(`select public.send_world_room_chat_v1($1,$2)`,[a.leaseId,text]);
assert.equal((await send('가'.repeat(121))).reason,'too_long'); assert.equal((await send(' x ')).reason,'malformed');
const first=await send('<img src=x onerror=alert(1)>'); assert.equal(first.ok,true); assert.equal(first.message.userId,id(1)); assert.equal(first.message.name,'방주인');
await q('reset role'); assert.equal(await scalar('select count(*)::int from realtime.messages'),1);
await auth(id(2)); assert.equal(await scalar('select public.can_receive_world_room_chat_v1($1)',[b.topic]),true);
assert.equal(await scalar('select public.can_receive_world_room_chat_v1($1)',[a.topic]),false);
await db.query(`select set_config('realtime.topic',$1,false)`,[b.topic]);assert.equal(await scalar('select count(*)::int from realtime.messages'),1);
await auth(id(3));await db.query(`select set_config('realtime.topic',$1,false)`,[b.topic]);assert.equal(await scalar('select count(*)::int from realtime.messages'),0);
await db.query(`select set_config('realtime.topic','world:campus:AREA_MAIN',false)`);assert.equal(await scalar('select count(*)::int from realtime.messages'),0,'broad campus policy cannot leak a chat row');
await auth(id(2));await db.query(`select set_config('realtime.topic',$1,false)`,[b.topic]);
await assert.rejects(()=>db.query('insert into realtime.messages(topic,payload) values($1,$2)',[b.topic,JSON.stringify(first.message)]),/row-level security/);
await db.query(`select realtime.send('{"forged":true}','room_chat_v1',$1,true)`,[b.topic]);
await q('reset role'); assert.equal(await scalar("select count(*)::int from realtime.messages where payload ? 'forged'"),0,'invoker response does not imply a forged insert');
await auth(id(2));
assert.equal((await scalar(`select public.send_world_room_chat_v1($1,'spoof')`,[a.leaseId])).ok,false,'cannot use another sender lease');
await q(`reset role; insert into public.world_user_blocks values('${id(2)}','${id(1)}')`);
await auth(id(1));assert.equal((await send('blocked')).ok,true);
await q('reset role');assert.equal(await scalar('select count(*)::int from realtime.messages'),1,'recipient denied at send time despite cached live topic');
await auth(id(2));assert.equal(await scalar('select public.can_receive_world_room_chat_v1($1)',[b.topic]),false);
assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[b.leaseId])).allowed,false);
await q(`reset role; delete from public.world_user_blocks; update public.world_player_rooms set visibility='private'`);
await auth(id(1));assert.equal((await send('private')).ok,true);
await q('reset role');assert.equal(await scalar('select count(*)::int from realtime.messages'),1);
await auth(id(1));assert.equal((await send('fourth')).reason,'rate_limited');
const a2=await join(id(1),25);assert.notEqual(a2.leaseId,a.leaseId);
assert.equal((await scalar(`select public.send_world_room_chat_v1($1,'rejoin bypass')`,[a2.leaseId])).reason,'rate_limited');
assert.equal((await scalar(`select public.send_world_room_chat_v1($1,'old lease')`,[a.leaseId])).ok,false);
await q(`reset role; update private.world_room_chat_sessions set lease_expires_at=clock_timestamp()-interval '1 second'`);
await auth(id(1));assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[a2.leaseId])).allowed,false);
// Actual shared-club SQL, not an always-denied club stub: chat requires the current admission.
await q('reset role');assert.equal(await scalar('select enabled from private.world_club_rooms'),false,'club candidate starts CLOSED');
await auth(id(1));assert.equal((await scalar("select public.join_world_club_room_v1('ROOM_CLUBHOUSE_01',$1)",[id(40)])).allowed,false,'room cannot open before explicit fixture activation');
await q('reset role; update private.world_club_rooms set enabled=true');
await q('reset role; delete from realtime.messages; delete from private.world_room_chat_limits; delete from private.world_user_moderation_actions');
const admissions = new Map();
const admission = n => admissions.get(n)?.admissionId ?? id(n);
const clubJoin = async(u,n) => { await auth(u); const result = await scalar("select public.join_world_club_room_v1('ROOM_CLUBHOUSE_01',$1)",[id(n)]); if(result.allowed) admissions.set(n,result); return result; };
const clubChat = async(u,n) => { await auth(u); return scalar("select public.join_world_room_chat_v1('club','ROOM_CLUBHOUSE_01',$1,$2)",[id(n),admission(n)]); };
assert.equal((await clubChat(id(1),40)).allowed,false,'chat cannot grant club admission');
assert.equal((await clubJoin(id(1),40)).allowed,true); assert.equal((await clubJoin(id(2),41)).allowed,true);
const ca = await clubChat(id(1),40), cb = await clubChat(id(2),41);
assert.equal(ca.allowed,true); assert.equal(cb.allowed,true);
await auth(id(1)); assert.equal((await scalar('select public.send_world_room_chat_v1($1,$2)',[ca.leaseId,'club hello'])).ok,true);
await q('reset role'); assert.equal(await scalar('select count(*)::int from realtime.messages'),1);
const clubTopic = `world:club:ROOM_CLUBHOUSE_01:${admission(41)}`;
await db.query('insert into realtime.messages(topic,payload) values($1,$2)',[clubTopic,JSON.stringify({kind:'pose'})]);
await auth(id(2)); await db.query("select set_config('realtime.topic',$1,false)",[cb.topic]);
assert.equal(await scalar('select count(*)::int from realtime.messages'),1,'chat policy coexists with club inbox guard');
await db.query("select set_config('realtime.topic',$1,false)",[clubTopic]);
assert.equal(await scalar('select count(*)::int from realtime.messages'),1,'club policy coexists with chat inbox guard');
// Encode with production JS, execute real SQL, decode with the production JS validators.
for (const [index, action] of [encodeAction(1,ActionType.JUMP), ...EMOTE_IDS.map((emote,i)=>encodeAction(i+2,ActionType.EMOTE,{emote}))].entries()) {
  await q("reset role; update private.world_club_room_sessions set last_action_at=null");
  await auth(id(1));
  const sent=await scalar("select public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01',$1,'action',$2)",[admission(40),JSON.stringify(action)]);
  assert.equal(sent.sent,true,`action ${index} sent`);
  await q('reset role');
  const envelope=await scalar("select payload from realtime.messages where payload->>'event'='action' order by ctid desc limit 1");
  assert.equal(validateAction(envelope.p).ok,true); assert.deepEqual(envelope.p,action);
  assert.equal(validatePresence(envelope.presence).ok,true);
}
await auth(id(1));
const pose={v:1,seq:1,x:0,y:1.15,z:0,yaw:0,vx:0,vz:0,anim:'idle'};
assert.equal((await scalar("select public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01',$1,'pose',$2)",[admission(40),JSON.stringify(pose)])).sent,true);
await q('reset role');const poseEnvelope=await scalar("select payload from realtime.messages where payload->>'event'='pose' order by ctid desc limit 1");
assert.equal(validatePose(poseEnvelope.p).ok,true);assert.equal(validatePresence(poseEnvelope.presence).ok,true);
await q("delete from realtime.messages where payload ? 'event'");
await auth(id(2));
await scalar("select public.leave_world_club_room_v1('ROOM_CLUBHOUSE_01',$1)",[admission(41)]);
assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[cb.leaseId])).allowed,false);
await auth(id(1)); await scalar('select public.send_world_room_chat_v1($1,$2)',[ca.leaseId,'after club leave']);
await q('reset role');assert.equal(await scalar('select count(*)::int from realtime.messages'),2,'stale chat lease receives nothing after club leave');
await q("reset role; update private.world_club_room_admission_limits set created_at=clock_timestamp()-interval '2 seconds'");
await clubJoin(id(2),42); const cb2=await clubChat(id(2),42); assert.equal(cb2.allowed,true);
await q("reset role; update private.world_club_room_admission_limits set created_at=clock_timestamp()-interval '2 seconds'");
await clubJoin(id(1),43);
assert.equal((await scalar('select public.send_world_room_chat_v1($1,$2)',[ca.leaseId,'replaced club sid'])).ok,false);
assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[ca.leaseId])).allowed,false);
const ca2=await clubChat(id(1),43);assert.equal(ca2.allowed,true);
await q(`reset role; update private.world_club_room_sessions set lease_expires_at=clock_timestamp()-interval '1 second' where user_id='${id(2)}'`);
await auth(id(1));await scalar('select public.send_world_room_chat_v1($1,$2)',[ca2.leaseId,'after recipient club expiry']);
await q('reset role');assert.equal(await scalar('select count(*)::int from realtime.messages'),2);
await auth(id(2));assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[cb2.leaseId])).allowed,false);
// Client pose UUID reuse after leave/expiry never recycles a server inbox or chat lease.
await q("reset role; update private.world_club_room_admission_limits set created_at=clock_timestamp()-interval '2 seconds'");
const oldAdmission = admissions.get(43);
await auth(id(1)); assert.equal((await scalar("select public.leave_world_club_room_v1('ROOM_CLUBHOUSE_01',$1)",[oldAdmission.admissionId])).allowed,true);
const reused = await clubJoin(id(1),43); assert.equal(reused.allowed,true);
assert.notEqual(reused.admissionId,oldAdmission.admissionId); assert.notEqual(reused.topic,oldAdmission.topic);
assert.equal(reused.sessionId,id(43));
assert.equal((await scalar("select public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01',$1)",[oldAdmission.admissionId])).allowed,false);
assert.equal((await scalar("select public.leave_world_club_room_v1('ROOM_CLUBHOUSE_01',$1)",[oldAdmission.admissionId])).allowed,false);
assert.equal(await scalar('select public.can_access_world_club_room_realtime_v1($1)',[oldAdmission.topic]),false);
assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[ca2.leaseId])).allowed,false);
assert.equal(await scalar('select public.can_receive_world_room_chat_v1($1)',[ca2.topic]),false);
assert.equal((await scalar('select public.send_world_room_chat_v1($1,$2)',[ca2.leaseId,'old lease after reused pose UUID'])).ok,false);
assert.equal((await scalar("select public.join_world_room_chat_v1('club','ROOM_CLUBHOUSE_01',$1,$2)",[id(43),oldAdmission.admissionId])).allowed,false);
const currentChat=await clubChat(id(1),43); assert.equal(currentChat.allowed,true);
assert.notEqual(currentChat.leaseId,ca2.leaseId);
assert.equal((await scalar("select public.join_world_room_chat_v1('club','ROOM_CLUBHOUSE_01',$1)",[id(43)])).allowed,false,'club admission capability required');
assert.equal((await scalar("select public.join_world_room_chat_v1('personal',$1,$2,$3)",[id(100),id(43),reused.admissionId])).allowed,false,'personal rejects unrelated club admission');
// Finite storage, deletion cascade, and scheduler fail-closed are real SQL assertions.
await q(`reset role; insert into private.world_club_room_admission_limits(user_id,created_at) values('${id(3)}',clock_timestamp()-interval '2 hours');
insert into private.world_room_chat_limits(user_id,sent_at) values('${id(3)}',array[clock_timestamp()-interval '6 seconds']);
select private.world_room_cleanup_v1();`);
assert.equal(await scalar('select count(*)::int from private.world_club_room_admission_limits where user_id=$1',[id(3)]),0);
assert.equal(await scalar('select count(*)::int from private.world_room_chat_limits where user_id=$1',[id(3)]),0);
assert.equal(await scalar("select to_regclass('private.world_club_room_session_ids') is null"),true,'no permanent admission ledger');
await q("update private.world_room_cleanup_state set last_succeeded_at=clock_timestamp()-interval '91 seconds'");
assert.equal((await clubJoin(id(3),46)).reason,'CLEANUP_UNAVAILABLE');
await auth(id(1));assert.equal((await scalar('select public.send_world_room_chat_v1($1,$2)',[currentChat.leaseId,'scheduler unavailable'])).ok,false);
await q('reset role; select private.world_room_cleanup_v1();');
const deletion=await clubJoin(id(3),46);assert.equal(deletion.allowed,true);
await q(`reset role; delete from auth.users where id='${id(3)}'`);
assert.equal(await scalar('select count(*)::int from private.world_club_room_admission_limits where user_id=$1',[id(3)]),0);
assert.equal(await scalar('select count(*)::int from private.world_club_room_sessions where user_id=$1',[id(3)]),0);
// Mutate only this disposable synthetic provider. The real Supabase provider schema is not
// changed. Unsafe SECURITY DEFINER closes every application authority despite cached leases.
await q('reset role; alter function realtime.send(jsonb,text,text,boolean) security definer');
assert.equal(await scalar('select private.world_room_publisher_safe_v1()'),false);
await auth(id(1));
assert.equal((await scalar('select public.renew_world_room_chat_v1($1)',[currentChat.leaseId])).allowed,false);
assert.equal((await scalar('select public.send_world_room_chat_v1($1,$2)',[currentChat.leaseId,'unsafe provider'])).ok,false);
assert.equal(await scalar('select public.can_receive_world_room_chat_v1($1)',[currentChat.topic]),false);
assert.equal((await scalar("select public.heartbeat_world_club_room_v1('ROOM_CLUBHOUSE_01',$1)",[admission(43)])).allowed,false);
assert.equal(await scalar('select public.can_access_world_club_room_realtime_v1($1)',[`world:club:ROOM_CLUBHOUSE_01:${admission(43)}`]),false);
// Demonstrate why cached channels also need an admission-only capability: a hypothetical
// changed definer CAN bypass INSERT RLS. It does not know another recipient's inbox nonce.
await db.query(`select realtime.send('{"forged":true}','room_chat_v1',$1,true)`,[currentChat.topic]);
await q('reset role'); assert.equal(await scalar("select count(*)::int from realtime.messages where payload ? 'forged'"),1);
const capability=createInboxAuthority({now:()=>1000},30000); assert.equal(capability.admit(currentChat.inboxNonce,31000),true);
const forged=await scalar("select payload from realtime.messages where payload ? 'forged'");
assert.equal(capability.accepts(forged.inboxNonce),false,'actual changed-definer forged row is rejected by production cached-channel authority');
await q("delete from realtime.messages where payload ? 'forged'; alter function realtime.send(jsonb,text,text,boolean) security invoker");
// The unsafe heartbeat prunes its sessions. Recreate a fresh authenticated admission only after
// restoring safe semantics, then exercise missing-publisher closure independently.
await q("update private.world_club_room_admission_limits set created_at=clock_timestamp()-interval '2 seconds'");
await clubJoin(id(1),44);
// Provider absence is fault-injected only into this synthetic in-memory schema, never a
// protected Supabase schema. Exercise the actual club RPC's operational fail-closed branch.
await q('reset role; alter function realtime.send(jsonb,text,text,boolean) rename to fixture_unavailable_send');
await auth(id(1));
const unavailable = await scalar("select public.publish_world_club_room_v1('ROOM_CLUBHOUSE_01',$1,'presence','{}')",[admission(44)]);
assert.equal(unavailable.allowed,false); assert.equal(unavailable.sent,false);
assert.equal(unavailable.reason,'REALTIME_UNAVAILABLE');
// Forward-only H3 hardening runs after the older-candidate compatibility assertions above.
await q(`reset role; alter function realtime.fixture_unavailable_send(jsonb,text,text,boolean) rename to send;
alter table public.world_player_rooms add foreign key(owner_user_id) references auth.users(id) on delete cascade;
alter table private.world_room_knocks add column id uuid primary key default gen_random_uuid(), add column expires_at timestamptz not null default clock_timestamp()+interval '30 seconds';
alter table private.world_room_knocks add foreign key(room_id) references public.world_player_rooms(id) on delete cascade;
alter table private.world_room_knocks add foreign key(visitor_user_id) references auth.users(id) on delete cascade;
alter table private.world_room_owner_presence add foreign key(room_id) references public.world_player_rooms(id) on delete cascade;
update public.world_player_rooms set visibility='friends';
select private.world_room_cleanup_v1();`);
await q(fn(base,'private.world_social_caller'));await q(fn(base,'private.world_social_target'));
await q(readFileSync(root+'supabase/migrations/20261012025000_world_room_h3_authority_retention_candidate.sql','utf8'));
assert.equal(await scalar('select private.world_room_chat_personal_authority_ready_v1()'),true,'clock-hardened H3 fingerprints match');
await auth(id(1));await q('reset role');
await q(`begin;insert into private.world_user_moderation_actions values('${id(1)}','interaction_restriction_24h',clock_timestamp()+interval '200 milliseconds',clock_timestamp()+interval '1 minute');`);
assert.equal(await scalar('select private.world_room_h3_writer_v1()'),id(1),'future restriction has not started');
await new Promise(resolve=>setTimeout(resolve,300));
await assert.rejects(()=>scalar('select private.world_room_h3_writer_v1()'),/SOCIAL_RESTRICTED/,'restriction starting inside old transaction is active by wall clock');
await q('rollback');
await q('alter function private.world_room_access_v1(uuid,uuid) stable');
assert.equal(await scalar('select private.world_room_chat_personal_authority_ready_v1()'),false,'volatility-only authority drift also fails closed');
await q('alter function private.world_room_access_v1(uuid,uuid) volatile');
assert.equal(await scalar("select has_function_privilege('authenticated','private.world_room_chat_plant_lease_v1(uuid,uuid,uuid,uuid)','execute')"),false);
assert.equal(await scalar("select has_function_privilege('anon','private.world_room_chat_plant_lease_v1(uuid,uuid,uuid,uuid)','execute')"),false);
// A transaction-start timestamp cannot extend presence, two-hour admission or pending expiry.
await q(`begin; insert into private.world_room_owner_presence values('${id(100)}',clock_timestamp()-interval '11.8 seconds');`);
await new Promise(resolve=>setTimeout(resolve,300));
assert.equal(await scalar('select private.world_room_owner_present_v1($1)',[id(100)]),false,'presence uses wall clock inside an older transaction');
await q('rollback');
await q(`begin; insert into private.world_room_owner_presence values('${id(100)}',clock_timestamp());
insert into private.world_room_knocks(id,room_id,visitor_user_id,status,created_at,expires_at,responded_at)
 values('${id(301)}','${id(100)}','${id(2)}','ACCEPTED',clock_timestamp()-interval '2 hours'+interval '200 milliseconds',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour');`);
await new Promise(resolve=>setTimeout(resolve,300));
assert.equal(await scalar('select private.world_room_access_v1($1,$2)',[id(2),id(100)]),'KNOCK_REQUIRED','expired admission is not extended by transaction time');
await q('rollback');
await auth(id(1));await q('reset role');
await q(`begin; insert into private.world_room_knocks(id,room_id,visitor_user_id,status,created_at,expires_at)
 values('${id(302)}','${id(100)}','${id(2)}','PENDING',clock_timestamp()-interval '29 seconds',clock_timestamp()+interval '200 milliseconds');`);
await new Promise(resolve=>setTimeout(resolve,300));
assert.equal((await scalar('select public.respond_room_knock_v1($1,true)',[id(302)])).status,'EXPIRED','response cannot accept an expiry after transaction entry');
await q('rollback');
// Cleanup preserves active authority/rate windows and physically removes every expired class.
await q(`insert into private.world_room_knocks(id,room_id,visitor_user_id,status,created_at,expires_at,responded_at) values
 ('${id(310)}','${id(100)}','${id(2)}','ACCEPTED',clock_timestamp()-interval '2 hours 1 second',clock_timestamp()-interval '1 hour',clock_timestamp()-interval '1 hour'),
 ('${id(311)}','${id(100)}','${id(2)}','OPEN',clock_timestamp()-interval '2 hours 1 second',clock_timestamp()-interval '1 second',clock_timestamp()-interval '2 hours'),
 ('${id(312)}','${id(100)}','${id(2)}','DECLINED',clock_timestamp()-interval '11 minutes',clock_timestamp()-interval '10 minutes 30 seconds',clock_timestamp()-interval '10 minutes 1 second'),
 ('${id(313)}','${id(100)}','${id(2)}','PENDING',clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '91 seconds',null),
 ('${id(314)}','${id(100)}','${id(2)}','EXPIRED',clock_timestamp()-interval '121 seconds',clock_timestamp()-interval '91 seconds',null),
 ('${id(315)}','${id(100)}','${id(2)}','EXPIRED',clock_timestamp()-interval '60 seconds',clock_timestamp()-interval '30 seconds',null);
insert into private.world_room_owner_presence values('${id(100)}',clock_timestamp()-interval '13 seconds');
select private.world_room_cleanup_v1();`);
assert.deepEqual(await scalar('select jsonb_agg(id order by id) from private.world_room_knocks'),[id(315)],'expired rows removed but two-minute rate evidence retained');
assert.equal(await scalar('select count(*)::int from private.world_room_owner_presence'),0);
await assert.rejects(()=>scalar('select public.respond_room_knock_v1($1,true)',[id(313)]),/KNOCK_NOT_FOUND/,'cleaned pending request cannot be approved later');
// No approval cancellation exists: responding false to ACCEPTED is an unchanged idempotent read.
await q(`insert into private.world_room_knocks(id,room_id,visitor_user_id,status,created_at,expires_at,responded_at)
 values('${id(320)}','${id(100)}','${id(2)}','ACCEPTED',clock_timestamp(),clock_timestamp()+interval '30 seconds',clock_timestamp());
insert into private.world_room_owner_presence values('${id(100)}',clock_timestamp());`);
assert.equal((await scalar('select public.respond_room_knock_v1($1,false)',[id(320)])).status,'ACCEPTED');
const visitSession=id(330); await auth(id(2));
let visit=await scalar("select public.join_world_room_chat_v1('personal',$1,$2)",[id(100),visitSession]);assert.equal(visit.allowed,true);
await q('reset role');
const careLease=()=>scalar('select private.world_room_chat_plant_lease_v1($1,$2,$3,$4)',[id(2),id(100),visitSession,visit.leaseId]);
await q('update private.world_club_rooms set enabled=false');
assert.equal(await careLease(),true,'current personal visitor lease authorizes CARE while club stays CLOSED');
assert.equal(await scalar('select private.world_room_chat_plant_lease_v1($1,$2,$3,$4)',[id(2),id(100),id(331),visit.leaseId]),false,'session mismatch fails closed');
assert.equal(await scalar('select private.world_room_chat_plant_lease_v1($1,$2,null,$3)',[id(2),id(100),visit.leaseId]),false);
await q('update private.world_room_chat_config set enabled=false');assert.equal(await careLease(),false);await q('update private.world_room_chat_config set enabled=true');
await q("update private.world_room_cleanup_state set last_succeeded_at=clock_timestamp()-interval '91 seconds'");assert.equal(await careLease(),false);await q('select private.world_room_cleanup_v1()');
await q(`insert into public.world_user_blocks values('${id(1)}','${id(2)}')`);assert.equal(await careLease(),false);await q('delete from public.world_user_blocks');
await q(`insert into private.world_user_moderation_actions values('${id(2)}','interaction_restriction_24h',clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 day')`);assert.equal(await careLease(),false);await q('delete from private.world_user_moderation_actions');
await q(`update private.world_room_knocks set created_at=clock_timestamp()-interval '2 hours 1 second' where id='${id(320)}'`);assert.equal(await careLease(),false);await q(`update private.world_room_knocks set created_at=clock_timestamp() where id='${id(320)}'`);
await q(`update private.world_room_chat_sessions set lease_expires_at=clock_timestamp()-interval '1 second' where id='${visit.leaseId}'`);assert.equal(await careLease(),false);await q(`update private.world_room_chat_sessions set lease_expires_at=clock_timestamp()+interval '30 seconds' where id='${visit.leaseId}'`);
await scalar('select public.leave_world_room_chat_v1($1)',[visit.leaseId]);assert.equal(await careLease(),false,'leaving removes the CARE capability');
visit=await scalar("select public.join_world_room_chat_v1('personal',$1,$2)",[id(100),visitSession]);assert.equal(visit.allowed,true);
await q(`delete from auth.users where id='${id(2)}'`);
assert.equal(await scalar('select count(*)::int from private.world_room_knocks where visitor_user_id=$1',[id(2)]),0);
assert.equal(await scalar('select count(*)::int from private.world_room_chat_sessions where user_id=$1',[id(2)]),0);
await q(`delete from auth.users where id='${id(1)}'`);
assert.equal(await scalar('select count(*)::int from private.world_room_owner_presence'),0,'owner account deletion cascades room presence');
assert.equal(await scalar('select count(*)::int from public.world_player_rooms'),0);
console.log('PASS: actual personal/club/chat candidate SQL in PGlite; synthetic auth and provider transport. Default CLOSED, sender binding, blocks/moderation/privacy, strict cross-policy RLS, rate across rejoin, club admission/leave/replacement/expiry provider invoker rejection and unsafe-definer/missing-provider fail-closed all checked. Fresh server admissions, stale chat binding, finite cleanup/account cascade, H3 wall-clock expiry/retention/no-cancel semantics and private plant visit lease gates checked. PGlite scheduler metadata is synthetic; actual pg_cron and WebSocket delivery are separate integration gates.');
await db.close();
