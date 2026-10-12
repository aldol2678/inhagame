-- #366: disposable development candidate. CLOSED by default; no Production rollout.
-- Browser roles cannot invoke this boundary or write its durable authority state.
create table private.world_convenience_runtime (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 target_id text not null default 'BACKGATE-NPC-001', target_version text not null default 'back_street_4-v1',
 target_x double precision not null default 153.18967351484042,
 target_y double precision not null default 0, target_z double precision not null default 111.37716454636742
);
insert into private.world_convenience_runtime(singleton) values(true);
create table private.world_convenience_authority (
 user_id uuid primary key references auth.users(id) on delete cascade,
 auth_session_id uuid not null, connection_id uuid not null, session_id uuid not null unique,
 fence bigint not null check(fence>0), active boolean not null, spawn_id text not null,
 state jsonb, geometry_revision text not null, target_version text not null,
 eligible boolean not null default false, observed_ms bigint, lease_until timestamptz not null,
 ends_at timestamptz not null default (clock_timestamp()+interval '10 minutes'),
 check(spawn_id in ('MAIN_GATE','BACK_GATE'))
);
create table private.world_convenience_bindings (
 income_session_id uuid primary key references private.world_income_sessions(session_id) on delete cascade,
 authority_session_id uuid not null, auth_session_id uuid not null, fence bigint not null,
 geometry_revision text not null, target_version text not null
);
alter table private.world_convenience_runtime enable row level security;
alter table private.world_convenience_authority enable row level security;
alter table private.world_convenience_bindings enable row level security;
revoke all on private.world_convenience_runtime,private.world_convenience_authority,private.world_convenience_bindings from public,anon,authenticated,service_role;

create function private.world_convenience_auth_v1(p_user uuid,p_auth uuid) returns void
language plpgsql volatile security definer set search_path='' as $$
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
 if not private.world_inventory_account_ok_v1(p_user) or not exists(
   select 1 from auth.sessions s where s.id=p_auth and s.user_id=p_user and (s.not_after is null or s.not_after>clock_timestamp())
 ) then raise exception 'CONVENIENCE_AUTH_REVOKED' using errcode='42501'; end if;
end; $$;

-- JSON contracts are NULL-safe at the storage boundary, including internal worker mistakes.
create function private.world_convenience_state_ok_v1(s jsonb,g text) returns boolean
language plpgsql immutable set search_path='' as $$
declare k text; n numeric; seq bigint; rev bigint;
begin
 if jsonb_typeof(s) is distinct from 'object' or (select count(*) from jsonb_object_keys(s))<>9
   or s->>'version' is distinct from 'durable-campus-walk-v1' or s->>'geometryRevision' is distinct from g then return false; end if;
 foreach k in array array['revision','sequence','simulatedAt','observedAt'] loop
   if jsonb_typeof(s->k) is distinct from 'number' then return false; end if;
   n:=(s->>k)::numeric;if n<0 or n>8640000000000000 or trunc(n)<>n then return false; end if;
 end loop;
 seq:=(s->>'sequence')::bigint;rev:=(s->>'revision')::bigint;
 if rev<1 or seq>=rev or s->'simulatedAt' is distinct from s->'observedAt' then return false; end if;
 if jsonb_typeof(s->'position') is distinct from 'object' or (select count(*) from jsonb_object_keys(s->'position'))<>3 then return false; end if;
 foreach k in array array['x','y','z'] loop
   if jsonb_typeof(s->'position'->k) is distinct from 'number' or abs((s->'position'->>k)::numeric)>10000 then return false; end if;
 end loop;
 if seq=0 then return s->'lastCommand'='null'::jsonb and s->'intentReceivedAt'='null'::jsonb; end if;
 if jsonb_typeof(s->'intentReceivedAt') is distinct from 'number' or s->'intentReceivedAt' is distinct from s->'observedAt'
   or jsonb_typeof(s->'lastCommand') is distinct from 'object' or (select count(*) from jsonb_object_keys(s->'lastCommand'))<>3
   or s->'lastCommand'->'sequence' is distinct from s->'sequence' then return false; end if;
 foreach k in array array['moveX','moveZ'] loop
   if jsonb_typeof(s->'lastCommand'->k) is distinct from 'number' or abs((s->'lastCommand'->>k)::numeric)>1 then return false; end if;
 end loop;
 return true;
exception when others then return false;
end; $$;

-- Service-only read/initialize/CAS/revoke. p_state is an output of server geometry simulation,
-- NEVER forwarded from an HTTP client. DB time and compare-and-swap fence every worker.
create function public.world_convenience_authority_v1(p_user uuid,p_auth uuid,p_connection uuid,p_op text,
 p_session uuid default null,p_fence bigint default null,p_revision bigint default null,p_state jsonb default null,
 p_geometry text default null,p_eligible boolean default false) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a private.world_convenience_authority%rowtype; r private.world_convenience_runtime%rowtype;
 now_ms bigint; current_revision bigint; new_revision bigint; new_observed bigint; spawn text;
begin
 perform private.world_convenience_auth_v1(p_user,p_auth);
 if p_connection is null or p_op not in ('OPEN','READ','COMMIT','REVOKE') then raise exception 'CONVENIENCE_INVALID_REQUEST'; end if;
 -- All state writes take the same short row lock. No Wallet/Income locks in this path.
 perform pg_advisory_xact_lock(hashtextextended('world_convenience:'||p_user::text,0));
 select * into r from private.world_convenience_runtime where singleton;
 select * into a from private.world_convenience_authority where user_id=p_user for update;
 perform 1 from auth.sessions where id=p_auth and user_id=p_user and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise exception 'CONVENIENCE_AUTH_REVOKED' using errcode='42501'; end if;
 perform private.world_convenience_auth_v1(p_user,p_auth);
 select * into r from private.world_convenience_runtime where singleton for share;
 perform private.world_convenience_auth_v1(p_user,p_auth);
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if p_op='OPEN' then
   if not r.enabled then raise exception 'CONVENIENCE_CLOSED'; end if;
   if p_geometry is null or p_geometry !~ '^[a-f0-9]{64}$' then raise exception 'CONVENIENCE_GEOMETRY'; end if;
   if a.active and a.lease_until>clock_timestamp() and a.ends_at>clock_timestamp() then
     if a.auth_session_id<>p_auth or a.connection_id<>p_connection then raise exception 'CONVENIENCE_SESSION_ACTIVE'; end if;
     if a.geometry_revision<>p_geometry or a.target_version<>r.target_version then raise exception 'CONVENIENCE_VERSION_CHANGED'; end if;
   else
     spawn:=case when exists(select 1 from private.world_quest_progress_v1 where user_id=p_user and quest_id='campus_navigation_intro_v1' and stage>=9) then 'BACK_GATE' else 'MAIN_GATE' end;
     insert into private.world_convenience_authority(user_id,auth_session_id,connection_id,session_id,fence,active,spawn_id,geometry_revision,target_version,lease_until)
       values(p_user,p_auth,p_connection,gen_random_uuid(),coalesce(a.fence,0)+1,true,spawn,p_geometry,r.target_version,clock_timestamp()+interval '3 seconds')
       on conflict(user_id) do update set auth_session_id=excluded.auth_session_id,connection_id=excluded.connection_id,
       session_id=excluded.session_id,fence=excluded.fence,active=true,spawn_id=excluded.spawn_id,state=null,ends_at=excluded.ends_at,
       geometry_revision=excluded.geometry_revision,target_version=excluded.target_version,eligible=false,observed_ms=null,lease_until=excluded.lease_until
       returning * into a;
   end if;
 else
   if a.user_id is null or a.auth_session_id<>p_auth or a.connection_id<>p_connection or a.session_id is distinct from p_session or a.fence is distinct from p_fence then raise exception 'CONVENIENCE_SESSION_CHANGED'; end if;
   if p_op='REVOKE' then
     update private.world_convenience_authority set active=false,eligible=false,lease_until=clock_timestamp() where user_id=p_user returning * into a;
   else
     if not r.enabled or not a.active or a.lease_until<=clock_timestamp() or a.ends_at<=clock_timestamp() then raise exception 'CONVENIENCE_SESSION_EXPIRED'; end if;
     if a.target_version<>r.target_version then raise exception 'CONVENIENCE_VERSION_CHANGED'; end if;
     if p_op='COMMIT' then
       current_revision:=coalesce((a.state->>'revision')::bigint,0);
       if current_revision is distinct from p_revision then raise exception 'CONVENIENCE_CAS_CONFLICT'; end if;
       if private.world_convenience_state_ok_v1(p_state,a.geometry_revision) is distinct from true then raise exception 'CONVENIENCE_STATE_INVALID'; end if;
       if a.state is not null and (p_state->>'sequence')::bigint is distinct from (a.state->>'sequence')::bigint+1 then raise exception 'CONVENIENCE_SEQUENCE_CONFLICT'; end if;
       new_revision:=(p_state->>'revision')::bigint; new_observed:=(p_state->>'observedAt')::bigint;
       if new_revision is distinct from current_revision+1 or new_observed is null or new_observed>now_ms or now_ms-new_observed>=250
         or (a.observed_ms is not null and new_observed<a.observed_ms) then raise exception 'CONVENIENCE_STALE_COMPUTATION'; end if;
       if a.state is null and ((p_state->>'sequence')::bigint<>0 or (p_state->'position'->>'x')::double precision is distinct from case when a.spawn_id='MAIN_GATE' then 0::double precision else 144.27275881430373::double precision end
          or (p_state->'position'->>'y')::double precision is distinct from 1.15::double precision
          or (p_state->'position'->>'z')::double precision is distinct from case when a.spawn_id='MAIN_GATE' then -98::double precision else 103.77154192159459::double precision end)
         then raise exception 'CONVENIENCE_SPAWN_MISMATCH'; end if;
       update private.world_convenience_authority set state=p_state,observed_ms=new_observed,eligible=p_eligible,
         lease_until=to_timestamp(new_observed/1000.0)+interval '3 seconds' where user_id=p_user returning * into a;
     end if;
   end if;
 end if;
 return jsonb_build_object('sessionId',a.session_id,'fence',a.fence,'spawnId',a.spawn_id,'state',a.state,'active',a.active,
   'nowMs',now_ms,'targetVersion',a.target_version,'geometryRevision',a.geometry_revision,'eligible',a.eligible);
end; $$;

-- Preserve original atomic income engine; legacy public mutation entry points may no longer
-- perform a convenience shift, even when somebody accidentally enables the old runtime gate.
alter function private.world_income_command_v1(uuid,text,uuid,uuid,text,text,text,text,integer) rename to world_income_core_v1;
create function private.world_income_command_v1(p_user uuid,p_op text,p_request uuid,p_session uuid,p_quest text,p_giver text,p_action text,p_value text,p_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
begin
 if p_op<>'STATUS' and (p_quest='quest.side.convenience_help' or exists(select 1 from private.world_income_sessions where user_id=p_user and session_id=p_session and kind='SHIFT' and state<>'SETTLED')) then
   raise exception 'INCOME_USE_AUTHORITY_V2'; end if;
 return private.world_income_core_v1(p_user,p_op,p_request,p_session,p_quest,p_giver,p_action,p_value,p_revision);
end; $$;
-- Rebind SQL bodies explicitly after renaming the core implementation.
create or replace function public.world_income_start_v1(p_user uuid,p_quest_id text,p_giver_id text,p_request_id uuid) returns jsonb language sql volatile security definer set search_path='' as $$select private.world_income_command_v1(p_user,'START',p_request_id,null,p_quest_id,p_giver_id,null,null,null)$$;
create or replace function public.world_income_action_v1(p_user uuid,p_session_id uuid,p_request_id uuid,p_action text,p_value text,p_revision integer) returns jsonb language sql volatile security definer set search_path='' as $$select private.world_income_command_v1(p_user,'ACTION',p_request_id,p_session_id,null,null,p_action,p_value,p_revision)$$;
create or replace function public.world_income_finish_v1(p_user uuid,p_session_id uuid,p_request_id uuid) returns jsonb language sql volatile security definer set search_path='' as $$select private.world_income_command_v1(p_user,'FINISH',p_request_id,p_session_id,null,null,null,null,null)$$;

-- Candidate mapping is explicit and versioned; replace only the original mapping CHECK.
do $$ declare constraint_name text; begin
 select conname into constraint_name from pg_constraint where conrelid='private.world_income_definitions'::regclass and contype='c' and pg_get_constraintdef(oid) like '%npc.authored.convenience_employer%';
 if constraint_name is null then raise exception 'CONVENIENCE_MAPPING_CONSTRAINT_MISSING'; end if;
 execute format('alter table private.world_income_definitions drop constraint %I',constraint_name);
end; $$;
update private.world_income_definitions set giver_id='BACKGATE-NPC-001',definition_version=definition_version+1 where quest_id='quest.side.convenience_help';
alter table private.world_income_definitions add constraint world_income_definition_mapping_v2 check(
 (quest_id='quest.side.taerin_carp' and giver_id='INKYUNG-NPC-013' and kind='DELIVERY' and coin=20 and reward_id='reward.income.taerin_carp') or
 (quest_id='quest.side.convenience_help' and giver_id='BACKGATE-NPC-001' and kind='SHIFT' and coin=30 and reward_id='reward.income.convenience_help'));

create function public.world_convenience_income_v2(p_user uuid,p_auth uuid,p_connection uuid,p_authority_session uuid,p_fence bigint,
 p_op text,p_request uuid default null,p_session uuid default null,p_action text default null,p_value text default null,p_revision integer default null) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a private.world_convenience_authority%rowtype; b private.world_convenience_bindings%rowtype;
 r private.world_convenience_runtime%rowtype; result jsonb; settled boolean:=false; now_ms bigint;
begin
 perform private.world_convenience_auth_v1(p_user,p_auth);
 if p_op not in ('START','STATUS','ACTION','FINISH') then raise exception 'CONVENIENCE_INVALID_REQUEST'; end if;
 perform pg_advisory_xact_lock(hashtextextended('world_income:'||p_user::text,0));
 if p_session is not null then
   select state='SETTLED' into settled from private.world_income_sessions where user_id=p_user and session_id=p_session and quest_id='quest.side.convenience_help';
   if not found then raise exception 'INCOME_SESSION_NOT_FOUND'; end if;
 end if;
 -- The ledger-proven terminal state is checked BEFORE the command. Newly committed rewards
 -- never use their resulting SETTLED flag as a bypass of the post-Wallet presence check.
 if p_op='STATUS' or (p_op='FINISH' and settled) then
   result:=private.world_income_core_v1(p_user,p_op,p_request,p_session,case when p_op='STATUS' then 'quest.side.convenience_help' end,null,p_action,p_value,p_revision);
   select * into r from private.world_convenience_runtime where singleton;
   return jsonb_set(result,'{enabled}',to_jsonb(coalesce((result->>'enabled')::boolean,false) and coalesce(r.enabled,false)));
 end if;
 select * into r from private.world_convenience_runtime where singleton;
 if not r.enabled then raise exception 'CONVENIENCE_CLOSED'; end if;
 result:=private.world_income_core_v1(p_user,p_op,p_request,p_session,
   case when p_op='START' then 'quest.side.convenience_help' end,
   case when p_op='START' then 'BACKGATE-NPC-001' end,p_action,p_value,p_revision);
 -- Core has acquired all possibly-waiting Reward/Wallet locks and performed its atomic work.
 -- Lock CURRENT authority only now, so revoke/move can commit during economic waits.
 select * into a from private.world_convenience_authority where user_id=p_user for update;
 -- Acquire this only AFTER economy waits. A committed logout wins; a later logout
 -- waits until the already-authorized transaction commits (explicit linearization).
 perform 1 from auth.sessions where id=p_auth and user_id=p_user and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then raise exception 'CONVENIENCE_AUTH_REVOKED' using errcode='42501'; end if;
 perform private.world_convenience_auth_v1(p_user,p_auth);
 select * into r from private.world_convenience_runtime where singleton for share;
 if r.enabled is distinct from true then raise exception 'CONVENIENCE_CLOSED'; end if;
 perform private.world_convenience_auth_v1(p_user,p_auth);
 now_ms:=floor(extract(epoch from clock_timestamp())*1000)::bigint;
 if a.user_id is null or not a.active or a.auth_session_id<>p_auth or a.connection_id<>p_connection
   or a.session_id is distinct from p_authority_session or a.fence is distinct from p_fence
   or a.lease_until<=clock_timestamp() or a.ends_at<=clock_timestamp() or a.observed_ms is null or a.observed_ms>now_ms or now_ms-a.observed_ms>=500
   or a.eligible is distinct from true or a.target_version is distinct from r.target_version
   or private.world_convenience_state_ok_v1(a.state,a.geometry_revision) is distinct from true
   or (a.state->>'observedAt')::bigint is distinct from a.observed_ms
   or a.state->>'geometryRevision' is distinct from a.geometry_revision
   or abs((a.state->'position'->>'y')::double precision-1.15-r.target_y)>1.5
   or power((a.state->'position'->>'x')::double precision-r.target_x,2)+power((a.state->'position'->>'z')::double precision-r.target_z,2)>6.25
   then raise exception 'CONVENIENCE_PRESENCE_REQUIRED'; end if;
 select * into b from private.world_convenience_bindings where income_session_id=(result->>'sessionId')::uuid;
 if b.income_session_id is null then
   if p_op<>'START' then raise exception 'CONVENIENCE_BINDING_REQUIRED'; end if;
   insert into private.world_convenience_bindings values((result->>'sessionId')::uuid,a.session_id,a.auth_session_id,a.fence,a.geometry_revision,a.target_version);
 elsif b.authority_session_id<>a.session_id or b.auth_session_id<>a.auth_session_id or b.fence<>a.fence
   or b.geometry_revision<>a.geometry_revision or b.target_version<>a.target_version then raise exception 'CONVENIENCE_BINDING_CHANGED'; end if;
 return result;
end; $$;
revoke all on function private.world_convenience_state_ok_v1(jsonb,text),private.world_convenience_auth_v1(uuid,uuid),private.world_income_core_v1(uuid,text,uuid,uuid,text,text,text,text,integer),private.world_income_command_v1(uuid,text,uuid,uuid,text,text,text,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.world_convenience_authority_v1(uuid,uuid,uuid,text,uuid,bigint,bigint,jsonb,text,boolean),public.world_convenience_income_v2(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid,text,text,integer) from public,anon,authenticated,service_role;
grant execute on function public.world_convenience_authority_v1(uuid,uuid,uuid,text,uuid,bigint,bigint,jsonb,text,boolean),public.world_convenience_income_v2(uuid,uuid,uuid,uuid,bigint,text,uuid,uuid,text,text,integer) to service_role;
