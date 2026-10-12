-- Disposable local candidate only. No Production activation, presence proof or anti-bot claim.
create table private.world_income_runtime (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  daily_cap integer not null default 60 check(daily_cap between 1 and 60)
);
insert into private.world_income_runtime(singleton) values(true);
create table private.world_income_definitions (
  quest_id text primary key,
  definition_version integer not null default 1 check(definition_version>0),
  giver_id text not null,
  kind text not null check(kind in ('DELIVERY','SHIFT')),
  status text not null default 'CLOSED' check(status in ('CLOSED','ACTIVE')),
  reward_id text not null references private.world_reward_definitions(reward_id),
  coin integer not null check(coin in (20,30)),
  check((quest_id='quest.side.taerin_carp' and giver_id='INKYUNG-NPC-013' and kind='DELIVERY' and coin=20 and reward_id='reward.income.taerin_carp') or
    (quest_id='quest.side.convenience_help' and giver_id='npc.authored.convenience_employer' and kind='SHIFT' and coin=30 and reward_id='reward.income.convenience_help'))
);
insert into private.world_reward_definitions(reward_id,status,description) values
 ('reward.income.taerin_carp','DISABLED','CLOSED candidate: Taerin carp delivery, 20 coin'),
 ('reward.income.convenience_help','DISABLED','CLOSED candidate: convenience shift, 30 coin');
insert into private.world_reward_grants(reward_id,grant_entry_id,position,grant_type,target_id,amount) values
 ('reward.income.taerin_carp','coin',0,'CURRENCY','currency.induck_coin',20),
 ('reward.income.convenience_help','coin',0,'CURRENCY','currency.induck_coin',30);
insert into private.world_income_definitions(quest_id,giver_id,kind,reward_id,coin) values
 ('quest.side.taerin_carp','INKYUNG-NPC-013','DELIVERY','reward.income.taerin_carp',20),
 ('quest.side.convenience_help','npc.authored.convenience_employer','SHIFT','reward.income.convenience_help',30);
create table private.world_income_sessions (
  session_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quest_id text not null references private.world_income_definitions(quest_id),
  giver_id text not null,
  kind text not null check(kind in ('DELIVERY','SHIFT')),
  reward_id text not null,
  definition_version integer not null,
  reward_version integer not null,
  coin integer not null check(coin in (20,30)),
  accounting_date date not null,
  state text not null check(state in ('ACTIVE','READY_TO_SETTLE','SETTLED')),
  revision integer not null default 0 check(revision between 0 and 3),
  challenge jsonb,
  available_at timestamptz not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  receipt jsonb,
  check((state='SETTLED') = (receipt is not null))
);
create index world_income_sessions_budget on private.world_income_sessions(user_id,accounting_date,quest_id);
create table private.world_income_requests (
  user_id uuid not null references auth.users(id) on delete cascade,
  request_id uuid not null,
  payload jsonb not null,
  response jsonb not null,
  primary key(user_id,request_id)
);
alter table private.world_income_runtime enable row level security;
alter table private.world_income_definitions enable row level security;
alter table private.world_income_sessions enable row level security;
alter table private.world_income_requests enable row level security;
revoke all on private.world_income_runtime,private.world_income_definitions,private.world_income_sessions,private.world_income_requests from public,anon,authenticated,service_role;

create function private.world_income_immutable_v1() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
  if tg_op='DELETE' or old.state='SETTLED' then
    raise exception 'INCOME_RECEIPT_IMMUTABLE' using errcode='42501';
  end if;
  return new;
end; $$;
-- Separate trigger bodies avoid accessing a nonexistent record field during schema validation.
create function private.world_income_request_immutable_v1() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' and not exists(select 1 from auth.users where id=old.user_id) then return old; end if;
  raise exception 'INCOME_RECEIPT_IMMUTABLE' using errcode='42501';
end; $$;
create trigger world_income_sessions_immutable before update or delete on private.world_income_sessions
 for each row execute function private.world_income_immutable_v1();
create trigger world_income_requests_immutable before update or delete on private.world_income_requests
 for each row execute function private.world_income_request_immutable_v1();

-- Semantic local challenges: answer is private and omitted from every public projection.
-- This validates server-authored work, not world position or human presence. Remain CLOSED.
create function private.world_income_challenge_v1(p_revision integer) returns jsonb
language plpgsql volatile set search_path='' as $$
declare v_n integer := 1+floor(random()*3)::integer; v_price integer; v_count integer;
begin
  if p_revision=0 then
    return jsonb_build_object('action','stock','prompt',(array['우유','빵','삼각김밥'])[v_n] || '을 알맞은 진열대에 놓으세요.',
      'choices',jsonb_build_array(jsonb_build_object('id','milk','label','우유 진열대'),jsonb_build_object('id','bread','label','빵 진열대'),jsonb_build_object('id','rice','label','삼각김밥 진열대')),
      'answer',(array['milk','bread','rice'])[v_n]);
  elsif p_revision=1 then
    v_price := 1000+v_n*100; v_count := 2+floor(random()*3)::integer;
    return jsonb_build_object('action','checkout','prompt',v_price::text || '원 상품 ' || v_count::text || '개의 합계를 고르세요.',
      'choices',jsonb_build_array(jsonb_build_object('id',(v_price*v_count-100)::text,'label',(v_price*v_count-100)::text || '원'),jsonb_build_object('id',(v_price*v_count)::text,'label',(v_price*v_count)::text || '원'),jsonb_build_object('id',(v_price*v_count+100)::text,'label',(v_price*v_count+100)::text || '원')),
      'answer',(v_price*v_count)::text);
  elsif p_revision=2 then
    return jsonb_build_object('action','tidy','prompt',(array['빈 알루미늄 캔','빈 유리병','깨끗한 종이 상자'])[v_n] || '를 분리배출하세요.',
      'choices',jsonb_build_array(jsonb_build_object('id','metal','label','금속류'),jsonb_build_object('id','glass','label','유리류'),jsonb_build_object('id','paper','label','종이류')),
      'answer',(array['metal','glass','paper'])[v_n]);
  end if;
  return null;
end; $$;
create function private.world_income_snapshot_v1(p_session private.world_income_sessions) returns jsonb
language sql volatile set search_path='' as $$
 select jsonb_build_object('enabled',r.enabled and exists(select 1 from private.world_income_definitions d join private.world_reward_definitions rd on rd.reward_id=d.reward_id where d.quest_id=p_session.quest_id and d.status='ACTIVE' and rd.status='ACTIVE'),
  'sessionId',p_session.session_id,'questId',p_session.quest_id,'giverId',p_session.giver_id,
  'kind',p_session.kind,'state',case when p_session.state<>'SETTLED' and p_session.expires_at<=clock_timestamp() then 'EXPIRED' else p_session.state end,
  'revision',p_session.revision,'coin',p_session.coin,'definitionVersion',p_session.definition_version,'rewardVersion',p_session.reward_version,
  'accountingDate',p_session.accounting_date,'expiresAt',p_session.expires_at,
  'nextChallenge',case when p_session.challenge is null or p_session.expires_at<=clock_timestamp() then null else (p_session.challenge-'answer') ||
    jsonb_build_object('id',p_session.session_id::text || ':' || p_session.revision::text,'availableAt',p_session.available_at) end,
  'receipt',p_session.receipt,
  'inventory',case when p_session.kind='DELIVERY' then jsonb_build_object('itemId','material.fish_carp','requiredQuantity',1,
    'ownedQuantity',coalesce((select i.quantity from private.world_player_items i where i.user_id=p_session.user_id and i.item_id='material.fish_carp'),0)) else null end,
  'budget',jsonb_build_object('dailyCap',r.daily_cap,'budgetDate',(clock_timestamp() at time zone 'Asia/Seoul')::date,
    'remainingDeliveries',case when exists(select 1 from private.world_income_sessions s where s.user_id=p_session.user_id and s.kind='DELIVERY' and ((s.state='SETTLED' and s.accounting_date=(clock_timestamp() at time zone 'Asia/Seoul')::date) or (s.state<>'SETTLED' and s.expires_at>clock_timestamp()))) then 0 else 1 end,
    'remainingShifts',case when exists(select 1 from private.world_income_sessions s where s.user_id=p_session.user_id and s.kind='SHIFT' and ((s.state='SETTLED' and s.accounting_date=(clock_timestamp() at time zone 'Asia/Seoul')::date) or (s.state<>'SETTLED' and s.expires_at>clock_timestamp()))) then 0 else 1 end,
    'remainingCoin',greatest(0,r.daily_cap-coalesce((select sum(s.coin) from private.world_income_sessions s where s.user_id=p_session.user_id and s.accounting_date=(clock_timestamp() at time zone 'Asia/Seoul')::date and (s.state='SETTLED' or s.expires_at>clock_timestamp())),0)),
    'earnedCoin',coalesce((select sum(s.coin) from private.world_income_sessions s where s.user_id=p_session.user_id and s.accounting_date=(clock_timestamp() at time zone 'Asia/Seoul')::date and s.state='SETTLED'),0)))
 from private.world_income_runtime r where r.singleton;
$$;

create function private.world_income_command_v1(p_user uuid,p_op text,p_request uuid,p_session uuid,p_quest text,p_giver text,p_action text,p_value text,p_revision integer)
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare
 v_payload jsonb := jsonb_build_object('op',p_op,'session',p_session,'quest',p_quest,'giver',p_giver,'action',p_action,'value',p_value,'revision',p_revision);
 v_previous private.world_income_requests%rowtype; v_s private.world_income_sessions%rowtype;
 v_d private.world_income_definitions%rowtype; v_runtime private.world_income_runtime%rowtype;
 v_now timestamptz := clock_timestamp(); v_date date; v_result jsonb; v_reward jsonb; v_inventory jsonb;
 v_total integer; v_reward_definition private.world_reward_definitions%rowtype;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'SERVICE_ROLE_REQUIRED' using errcode='42501'; end if;
 if not private.world_inventory_account_ok_v1(p_user) then raise exception 'ACCOUNT_UNAVAILABLE' using errcode='42501'; end if;
 if p_op not in ('START','STATUS','ACTION','FINISH') or (p_op<>'STATUS' and p_request is null) then
   raise exception 'INVALID_INCOME_REQUEST' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('world_income:' || p_user::text,0));
 v_now := clock_timestamp();
 -- Common request namespace prevents an action request from becoming a settlement/start request.
 if p_request is not null then
   select * into v_previous from private.world_income_requests where user_id=p_user and request_id=p_request;
   if found then
     if v_previous.payload is distinct from v_payload then raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505'; end if;
     return v_previous.response;
   end if;
 end if;
 if p_op='STATUS' and p_session is null then
   select * into v_s from private.world_income_sessions where user_id=p_user and (p_quest is null or quest_id=p_quest) order by created_at desc,session_id desc limit 1;
   if found then return private.world_income_snapshot_v1(v_s); end if;
   v_s.user_id := p_user;
   if p_quest is not null then
     select * into v_d from private.world_income_definitions where quest_id=p_quest;
     if not found then raise exception 'INVALID_INCOME_REQUEST' using errcode='22023'; end if;
     v_s.quest_id := v_d.quest_id; v_s.giver_id := v_d.giver_id; v_s.kind := v_d.kind;
     v_s.coin := v_d.coin; v_s.definition_version := v_d.definition_version;
   end if;
   return private.world_income_snapshot_v1(v_s);
 end if;
 if p_op<>'START' then
   select * into v_s from private.world_income_sessions where user_id=p_user and session_id=p_session for update;
   if not found or (p_op='STATUS' and p_quest is not null and v_s.quest_id<>p_quest) then raise exception 'INCOME_SESSION_NOT_FOUND' using errcode='P0001'; end if;
   -- Historical receipt remains accessible when all launch switches close or session expires.
   if p_op='STATUS' then return private.world_income_snapshot_v1(v_s); end if;
   if p_op='FINISH' and v_s.state='SETTLED' then
     v_result := private.world_income_snapshot_v1(v_s);
     insert into private.world_income_requests values(p_user,p_request,v_payload,v_result);
     return v_result;
   end if;
 end if;
 select * into v_runtime from private.world_income_runtime where singleton for share;
 if v_runtime.enabled is distinct from true then raise exception 'INCOME_CLOSED' using errcode='P0001'; end if;
 select * into v_d from private.world_income_definitions where quest_id=case when p_op='START' then p_quest else v_s.quest_id end for share;
 if not found or v_d.status<>'ACTIVE' then raise exception 'INCOME_CLOSED' using errcode='P0001'; end if;
 if p_op='START' then
   if p_giver is distinct from v_d.giver_id then raise exception 'INCOME_GIVER_MISMATCH' using errcode='42501'; end if;
   select * into v_reward_definition from private.world_reward_definitions where reward_id=v_d.reward_id for share;
   perform 1 from private.world_reward_grants where reward_id=v_d.reward_id for share;
   if v_reward_definition.status is distinct from 'ACTIVE' or
     (select count(*) from private.world_reward_grants where reward_id=v_d.reward_id)<>1 or
     not exists(select 1 from private.world_reward_grants where reward_id=v_d.reward_id and grant_type='CURRENCY' and target_id='currency.induck_coin' and amount=v_d.coin) then
     raise exception 'INCOME_REWARD_UNAVAILABLE' using errcode='P0001'; end if;
   -- Catalog row locks can wait across midnight. Freeze only after all start gates lock.
   v_now := clock_timestamp();
   v_date := (v_now at time zone 'Asia/Seoul')::date;
   if exists(select 1 from private.world_income_sessions where user_id=p_user and quest_id=p_quest and accounting_date=v_date and (state='SETTLED' or expires_at>v_now)) then
     raise exception 'INCOME_DAILY_LIMIT' using errcode='P0001'; end if;
   -- Preserve one recoverable live session per quest across midnight and multiple tabs.
   if exists(select 1 from private.world_income_sessions where user_id=p_user and quest_id=p_quest and state<>'SETTLED' and expires_at>v_now) then
     raise exception 'INCOME_SESSION_ACTIVE' using errcode='P0001'; end if;
   select coalesce(sum(coin),0) into v_total from private.world_income_sessions where user_id=p_user and accounting_date=v_date and (state='SETTLED' or expires_at>v_now);
   if v_total+v_d.coin>v_runtime.daily_cap then raise exception 'INCOME_DAILY_CAP' using errcode='P0001'; end if;
   insert into private.world_income_sessions(user_id,quest_id,giver_id,kind,reward_id,definition_version,reward_version,coin,accounting_date,state,challenge,available_at,expires_at)
     values(p_user,v_d.quest_id,v_d.giver_id,v_d.kind,v_d.reward_id,v_d.definition_version,v_reward_definition.version,v_d.coin,v_date,
      case when v_d.kind='SHIFT' then 'ACTIVE' else 'READY_TO_SETTLE' end,
      case when v_d.kind='SHIFT' then private.world_income_challenge_v1(0) end,v_now+interval '3 seconds',v_now+interval '10 minutes') returning * into v_s;
 else
   v_now := clock_timestamp();
   if v_s.expires_at<=v_now then raise exception 'INCOME_SESSION_EXPIRED' using errcode='P0001'; end if;
   if p_op='ACTION' then
     if v_s.kind<>'SHIFT' or v_s.state<>'ACTIVE' or p_revision is distinct from v_s.revision or p_action is distinct from v_s.challenge->>'action' then
       raise exception 'INCOME_STEP_MISMATCH' using errcode='22023'; end if;
     if v_now<v_s.available_at then raise exception 'INCOME_STEP_TOO_EARLY' using errcode='P0001'; end if;
     if p_value is distinct from v_s.challenge->>'answer' then raise exception 'INCOME_WRONG_CHOICE' using errcode='22023'; end if;
     update private.world_income_sessions set revision=revision+1,
       state=case when revision=2 then 'READY_TO_SETTLE' else 'ACTIVE' end,
       challenge=private.world_income_challenge_v1(revision+1),available_at=v_now+interval '3 seconds'
       where session_id=v_s.session_id returning * into v_s;
   else
     if v_s.state<>'READY_TO_SETTLE' then raise exception 'INCOME_NOT_READY' using errcode='P0001'; end if;
     -- Budget always uses the immutable start KST date, even when finishing after midnight.
     select coalesce(sum(coin),0) into v_total from private.world_income_sessions where user_id=p_user and accounting_date=v_s.accounting_date and state='SETTLED';
     if v_total+v_s.coin>v_runtime.daily_cap then raise exception 'INCOME_DAILY_CAP' using errcode='P0001'; end if;
     if exists(select 1 from private.world_income_sessions where user_id=p_user and accounting_date=v_s.accounting_date and quest_id=v_s.quest_id and state='SETTLED') then
       raise exception 'INCOME_DAILY_LIMIT' using errcode='P0001'; end if;
     -- Serialize with other Reward callers. Fixed CURRENCY reward acquires Wallet before
     -- Inventory consumption, matching Shop Wallet -> Inventory order. Every failure
     -- aborts this entire statement, including earlier reward/wallet work.
     perform pg_advisory_xact_lock(hashtextextended('world_reward:' || p_user::text,0));
     select * into v_reward_definition from private.world_reward_definitions where reward_id=v_s.reward_id for share;
     perform 1 from private.world_reward_grants where reward_id=v_s.reward_id for share;
     if v_reward_definition.version is distinct from v_s.reward_version or v_d.definition_version is distinct from v_s.definition_version or
       v_reward_definition.status is distinct from 'ACTIVE' or
       (select count(*) from private.world_reward_grants where reward_id=v_s.reward_id)<>1 or
       not exists(select 1 from private.world_reward_grants where reward_id=v_s.reward_id and grant_type='CURRENCY' and target_id='currency.induck_coin' and amount=v_s.coin) then
       raise exception 'INCOME_REWARD_UNAVAILABLE' using errcode='P0001'; end if;
     v_reward := private.world_reward_grant_v1(p_user,v_s.reward_id,'QUEST',v_s.session_id::text,'income:' || v_s.session_id::text);
     if v_reward->>'status' is distinct from 'SUCCESS' then
       raise exception 'INCOME_REWARD_FAILED' using errcode='P0001'; end if;
     if v_s.kind='DELIVERY' then
       v_inventory := private.world_inventory_mutate_v1(p_user,'CONSUME','QUEST',v_s.quest_id,
         'income:' || v_s.session_id::text,'{"consumes":[{"itemId":"material.fish_carp","quantity":1}],"grants":[]}'::jsonb);
     end if;
     -- Wallet/Inventory locks may wait beyond expiry; abort all side effects if so.
     if v_s.expires_at<=clock_timestamp() then raise exception 'INCOME_SESSION_EXPIRED' using errcode='P0001'; end if;
     update private.world_income_sessions set state='SETTLED',receipt=jsonb_build_object('sessionId',v_s.session_id,
       'settlementId',v_s.session_id,'coin',v_s.coin,'committed',true,'accountingDate',v_s.accounting_date,
       'rewardLedger',v_reward,'inventory',v_inventory) where session_id=v_s.session_id returning * into v_s;
   end if;
 end if;
 v_result := private.world_income_snapshot_v1(v_s);
 insert into private.world_income_requests values(p_user,p_request,v_payload,v_result);
 return v_result;
end; $$;
create function public.world_income_start_v1(p_user uuid,p_quest_id text,p_giver_id text,p_request_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$select private.world_income_command_v1(p_user,'START',p_request_id,null,p_quest_id,p_giver_id,null,null,null)$$;
create function public.world_income_status_v1(p_user uuid,p_session_id uuid default null,p_quest_id text default null) returns jsonb
language sql volatile security definer set search_path='' as $$select private.world_income_command_v1(p_user,'STATUS',null,p_session_id,p_quest_id,null,null,null,null)$$;
create function public.world_income_action_v1(p_user uuid,p_session_id uuid,p_request_id uuid,p_action text,p_value text,p_revision integer) returns jsonb
language sql volatile security definer set search_path='' as $$select private.world_income_command_v1(p_user,'ACTION',p_request_id,p_session_id,null,null,p_action,p_value,p_revision)$$;
create function public.world_income_finish_v1(p_user uuid,p_session_id uuid,p_request_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$select private.world_income_command_v1(p_user,'FINISH',p_request_id,p_session_id,null,null,null,null,null)$$;
revoke all on function private.world_income_command_v1(uuid,text,uuid,uuid,text,text,text,text,integer),private.world_income_snapshot_v1(private.world_income_sessions),private.world_income_challenge_v1(integer),private.world_income_immutable_v1(),private.world_income_request_immutable_v1() from public,anon,authenticated,service_role;
revoke all on function public.world_income_start_v1(uuid,text,text,uuid),public.world_income_status_v1(uuid,uuid,text),public.world_income_action_v1(uuid,uuid,uuid,text,text,integer),public.world_income_finish_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.world_income_start_v1(uuid,text,text,uuid),public.world_income_status_v1(uuid,uuid,text),public.world_income_action_v1(uuid,uuid,uuid,text,text,integer),public.world_income_finish_v1(uuid,uuid,uuid) to service_role;
