-- INHA WORLD Life Skill Tree mutation authority v1.
--
-- Player-facing RPCs never accept user ids, point amounts or target ranks.
-- The server derives account, cost, gates, prerequisites and refunds from authoritative state.

alter table private.world_life_skill_point_transactions
  add column if not exists tree_id text references private.world_life_skill_tree_catalog(tree_id);

alter table private.world_life_skill_point_transactions
  drop constraint if exists world_life_skill_point_transactions_node_context;
alter table private.world_life_skill_point_transactions
  add constraint world_life_skill_point_transactions_node_context check (
    (reason_type = 'NODE_RANK_UP' and node_id is not null and tree_id is not null)
    or (reason_type = 'NODE_RESET' and node_id is null and tree_id is not null)
    or (reason_type not in ('NODE_RANK_UP','NODE_RESET'))
  );

-- Point economics and prerequisite semantics are immutable after publication.
-- Status alone may change so a later migration can activate or disable a node.
create or replace function private.world_life_skill_node_definition_guard_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'LIFE_SKILL_NODE_DEFINITION_IMMUTABLE' using errcode = '42501';
  end if;
  if (new.tree_id,new.max_rank,new.point_cost,new.required_life_level,
      new.required_skill_id,new.required_skill_level,new.effect_key,new.definition_version)
     is distinct from
     (old.tree_id,old.max_rank,old.point_cost,old.required_life_level,
      old.required_skill_id,old.required_skill_level,old.effect_key,old.definition_version) then
    raise exception 'LIFE_SKILL_NODE_DEFINITION_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.world_life_skill_node_definition_guard_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_skill_node_definition_guard
  on private.world_life_skill_nodes;
create trigger world_life_skill_node_definition_guard
  before update or delete on private.world_life_skill_nodes
  for each row execute function private.world_life_skill_node_definition_guard_v1();

create or replace function private.world_life_skill_prerequisite_immutable_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LIFE_SKILL_PREREQUISITE_IMMUTABLE' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_skill_prerequisite_immutable_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_skill_prerequisite_immutable
  on private.world_life_skill_node_prerequisites;
create trigger world_life_skill_prerequisite_immutable
  before update or delete on private.world_life_skill_node_prerequisites
  for each row execute function private.world_life_skill_prerequisite_immutable_v1();

create table if not exists private.world_life_skill_tree_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.world_player_life_progression(user_id) on delete cascade,
  action text not null check (action in ('RANK_UP','RESET_TREE')),
  tree_id text not null references private.world_life_skill_tree_catalog(tree_id),
  node_id text references private.world_life_skill_nodes(node_id),
  rank_before integer check (rank_before is null or rank_before >= 0),
  rank_after integer check (rank_after is null or rank_after >= 0),
  points_delta integer not null,
  balance_before integer not null check (balance_before >= 0),
  balance_after integer not null check (balance_after >= 0),
  reset_snapshot jsonb,
  sp_transaction_id uuid unique references private.world_life_skill_point_transactions(transaction_id),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$'),
  created_at timestamptz not null default now(),
  constraint world_life_skill_tree_transactions_balance_math
    check (balance_after = balance_before + points_delta),
  constraint world_life_skill_tree_transactions_shape check (
    (action = 'RANK_UP'
      and node_id is not null
      and rank_before is not null
      and rank_after = rank_before + 1
      and points_delta < 0
      and reset_snapshot is null
      and sp_transaction_id is not null)
    or
    (action = 'RESET_TREE'
      and node_id is null
      and rank_before is null
      and rank_after is null
      and points_delta >= 0
      and reset_snapshot is not null
      and ((points_delta = 0 and sp_transaction_id is null)
           or (points_delta > 0 and sp_transaction_id is not null)))
  )
);
comment on table private.world_life_skill_tree_transactions is
  'Append-only exact-result ledger for Life Skill rank-up and tree-reset mutations.';

alter table private.world_life_skill_tree_transactions enable row level security;
revoke all on table private.world_life_skill_tree_transactions
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_tree_transaction_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LIFE_SKILL_TREE_TRANSACTION_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_skill_tree_transaction_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_skill_tree_transaction_append_only
  on private.world_life_skill_tree_transactions;
create trigger world_life_skill_tree_transaction_append_only
  before update or delete on private.world_life_skill_tree_transactions
  for each row execute function private.world_life_skill_tree_transaction_append_only_v1();

create or replace function private.world_life_progression_caller_v1()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null
     or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_life_skill_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function private.world_life_progression_caller_v1()
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_tree_transaction_result_v1(
  p_tx private.world_life_skill_tree_transactions,
  p_replayed boolean)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status',case when p_replayed then 'ALREADY_PROCESSED' else 'SUCCESS' end,
    'transactionId',p_tx.transaction_id,
    'action',p_tx.action,
    'treeId',p_tx.tree_id,
    'nodeId',p_tx.node_id,
    'rankBefore',p_tx.rank_before,
    'rankAfter',p_tx.rank_after,
    'pointsDelta',p_tx.points_delta,
    'balanceBefore',p_tx.balance_before,
    'balanceAfter',p_tx.balance_after,
    'resetNodes',p_tx.reset_snapshot,
    'idempotencyKey',p_tx.idempotency_key,
    'createdAt',p_tx.created_at
  );
$$;
revoke all on function private.world_life_skill_tree_transaction_result_v1(
  private.world_life_skill_tree_transactions,boolean)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_node_rank_up_apply_v1(
  p_user uuid,
  p_node_id text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_node private.world_life_skill_nodes%rowtype;
  v_tree_status text;
  v_progress private.world_player_life_progression%rowtype;
  v_existing private.world_life_skill_tree_transactions%rowtype;
  v_tx private.world_life_skill_tree_transactions%rowtype;
  v_rank_before integer := 0;
  v_rank_after integer;
  v_life_level integer;
  v_skill_level integer;
  v_balance_before integer;
  v_balance_after integer;
  v_sp_tx_id uuid;
begin
  if p_node_id is null
     or p_node_id !~ '^life_node\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
     or char_length(p_node_id) > 140 then
    raise exception 'INVALID_LIFE_SKILL_NODE' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_life_tree:key:' || p_idempotency_key,0));
  perform pg_advisory_xact_lock(hashtextextended('world_life_tree:user:' || p_user::text,0));

  select * into v_existing
    from private.world_life_skill_tree_transactions t
   where t.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.user_id,v_existing.action,v_existing.node_id)
       is distinct from (p_user,'RANK_UP',p_node_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_life_skill_tree_transaction_result_v1(v_existing,true);
  end if;

  select n.*, t.status into v_node, v_tree_status
    from private.world_life_skill_nodes n
    join private.world_life_skill_tree_catalog t on t.tree_id=n.tree_id
   where n.node_id=p_node_id;
  if not found or v_node.status='HIDDEN' or v_tree_status='HIDDEN' then
    raise exception 'LIFE_SKILL_NODE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_node.status <> 'ACTIVE' or v_tree_status <> 'ACTIVE' then
    raise exception 'LIFE_SKILL_NODE_INACTIVE' using errcode = 'P0001';
  end if;

  insert into private.world_player_life_progression(user_id)
  values (p_user)
  on conflict (user_id) do nothing;

  select * into strict v_progress
    from private.world_player_life_progression p
   where p.user_id=p_user
   for update;

  v_life_level := private.world_life_progression_level_for_xp_v1(
    'life.progression.v1',v_progress.total_xp);
  if v_life_level < v_node.required_life_level then
    raise exception 'LIFE_LEVEL_REQUIRED' using errcode = 'P0001';
  end if;

  if v_node.required_skill_id is not null then
    v_skill_level := (private.world_life_skill_snapshot_v1(
      p_user,v_node.required_skill_id)->>'level')::integer;
    if v_skill_level < v_node.required_skill_level then
      raise exception 'LIFE_SKILL_LEVEL_REQUIRED' using errcode = 'P0001';
    end if;
  end if;

  select p.rank into v_rank_before
    from private.world_player_life_skill_nodes p
   where p.user_id=p_user and p.node_id=p_node_id;
  v_rank_before := coalesce(v_rank_before,0);
  if v_rank_before >= v_node.max_rank then
    raise exception 'LIFE_SKILL_NODE_MAX_RANK' using errcode = 'P0001';
  end if;

  if exists (
    select 1
      from private.world_life_skill_node_prerequisites e
      left join private.world_player_life_skill_nodes p
        on p.user_id=p_user and p.node_id=e.prerequisite_node_id
     where e.node_id=p_node_id
       and coalesce(p.rank,0) < e.required_rank
  ) then
    raise exception 'LIFE_SKILL_PREREQUISITE_REQUIRED' using errcode = 'P0001';
  end if;

  v_balance_before := v_progress.skill_points_balance;
  if v_balance_before < v_node.point_cost then
    raise exception 'INSUFFICIENT_LIFE_SKILL_POINTS' using errcode = 'P0001';
  end if;
  v_balance_after := v_balance_before - v_node.point_cost;
  v_rank_after := v_rank_before + 1;

  insert into private.world_player_life_skill_nodes(user_id,node_id,rank,version,unlocked_at,updated_at)
  values (p_user,p_node_id,v_rank_after,1,now(),now())
  on conflict (user_id,node_id) do update
    set rank=excluded.rank,
        version=private.world_player_life_skill_nodes.version+1,
        updated_at=now();

  update private.world_player_life_progression p
     set skill_points_spent=p.skill_points_spent+v_node.point_cost,
         version=p.version+1,
         updated_at=now()
   where p.user_id=p_user;

  insert into private.world_life_skill_point_transactions(
    user_id,delta,balance_before,balance_after,reason_type,source_id,node_id,tree_id,idempotency_key
  ) values (
    p_user,-v_node.point_cost,v_balance_before,v_balance_after,'NODE_RANK_UP',
    p_node_id || ':rank:' || v_rank_after::text,p_node_id,v_node.tree_id,
    'life-tree/' || p_idempotency_key || '/sp'
  ) returning transaction_id into v_sp_tx_id;

  insert into private.world_life_skill_tree_transactions(
    user_id,action,tree_id,node_id,rank_before,rank_after,points_delta,
    balance_before,balance_after,reset_snapshot,sp_transaction_id,idempotency_key
  ) values (
    p_user,'RANK_UP',v_node.tree_id,p_node_id,v_rank_before,v_rank_after,-v_node.point_cost,
    v_balance_before,v_balance_after,null,v_sp_tx_id,p_idempotency_key
  ) returning * into v_tx;

  return private.world_life_skill_tree_transaction_result_v1(v_tx,false);
end;
$$;
revoke all on function private.world_life_skill_node_rank_up_apply_v1(uuid,text,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_tree_reset_apply_v1(
  p_user uuid,
  p_tree_id text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing private.world_life_skill_tree_transactions%rowtype;
  v_tx private.world_life_skill_tree_transactions%rowtype;
  v_progress private.world_player_life_progression%rowtype;
  v_reset_nodes jsonb := '[]'::jsonb;
  v_refund integer := 0;
  v_balance_before integer;
  v_balance_after integer;
  v_sp_tx_id uuid;
begin
  if p_tree_id is null
     or p_tree_id !~ '^life_tree\.[a-z][a-z0-9_]*$'
     or char_length(p_tree_id) > 100 then
    raise exception 'INVALID_LIFE_SKILL_TREE' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_life_tree:key:' || p_idempotency_key,0));
  perform pg_advisory_xact_lock(hashtextextended('world_life_tree:user:' || p_user::text,0));

  select * into v_existing
    from private.world_life_skill_tree_transactions t
   where t.idempotency_key=p_idempotency_key;
  if found then
    if (v_existing.user_id,v_existing.action,v_existing.tree_id)
       is distinct from (p_user,'RESET_TREE',p_tree_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_life_skill_tree_transaction_result_v1(v_existing,true);
  end if;

  if not exists (select 1 from private.world_life_skill_tree_catalog t where t.tree_id=p_tree_id) then
    raise exception 'LIFE_SKILL_TREE_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into private.world_player_life_progression(user_id)
  values (p_user)
  on conflict (user_id) do nothing;

  select * into strict v_progress
    from private.world_player_life_progression p
   where p.user_id=p_user
   for update;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'nodeId',p.node_id,'rank',p.rank,'pointCost',n.point_cost)
      order by p.node_id),'[]'::jsonb),
    coalesce(sum(p.rank*n.point_cost),0)::integer
    into v_reset_nodes,v_refund
    from private.world_player_life_skill_nodes p
    join private.world_life_skill_nodes n on n.node_id=p.node_id
   where p.user_id=p_user and n.tree_id=p_tree_id;

  if v_refund > v_progress.skill_points_spent then
    raise exception 'LIFE_SKILL_POINT_STATE_INVALID' using errcode = 'P0001';
  end if;

  v_balance_before := v_progress.skill_points_balance;
  v_balance_after := v_balance_before + v_refund;

  if v_refund > 0 then
    delete from private.world_player_life_skill_nodes p
     using private.world_life_skill_nodes n
     where p.user_id=p_user
       and p.node_id=n.node_id
       and n.tree_id=p_tree_id;

    update private.world_player_life_progression p
       set skill_points_spent=p.skill_points_spent-v_refund,
           version=p.version+1,
           updated_at=now()
     where p.user_id=p_user;

    insert into private.world_life_skill_point_transactions(
      user_id,delta,balance_before,balance_after,reason_type,source_id,node_id,tree_id,idempotency_key
    ) values (
      p_user,v_refund,v_balance_before,v_balance_after,'NODE_RESET',
      p_tree_id || ':reset',null,p_tree_id,'life-tree/' || p_idempotency_key || '/sp'
    ) returning transaction_id into v_sp_tx_id;
  end if;

  insert into private.world_life_skill_tree_transactions(
    user_id,action,tree_id,node_id,rank_before,rank_after,points_delta,
    balance_before,balance_after,reset_snapshot,sp_transaction_id,idempotency_key
  ) values (
    p_user,'RESET_TREE',p_tree_id,null,null,null,v_refund,
    v_balance_before,v_balance_after,v_reset_nodes,v_sp_tx_id,p_idempotency_key
  ) returning * into v_tx;

  return private.world_life_skill_tree_transaction_result_v1(v_tx,false);
end;
$$;
revoke all on function private.world_life_skill_tree_reset_apply_v1(uuid,text,text)
  from public, anon, authenticated, service_role;

create or replace function public.rank_up_my_world_life_skill_node_v1(
  p_node_id text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.world_life_progression_caller_v1();
begin
  return private.world_life_skill_node_rank_up_apply_v1(v_uid,p_node_id,p_idempotency_key);
end;
$$;
comment on function public.rank_up_my_world_life_skill_node_v1(text,text) is
  'Authenticated self-only Life Skill rank-up. Cost, gates, prerequisites and target rank are server-derived.';

create or replace function public.reset_my_world_life_skill_tree_v1(
  p_tree_id text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.world_life_progression_caller_v1();
begin
  return private.world_life_skill_tree_reset_apply_v1(v_uid,p_tree_id,p_idempotency_key);
end;
$$;
comment on function public.reset_my_world_life_skill_tree_v1(text,text) is
  'Authenticated self-only Life Skill tree reset. Refund is derived from immutable server node costs.';

revoke all on function public.rank_up_my_world_life_skill_node_v1(text,text)
  from public, anon, authenticated, service_role;
revoke all on function public.reset_my_world_life_skill_tree_v1(text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.rank_up_my_world_life_skill_node_v1(text,text) to authenticated;
grant execute on function public.reset_my_world_life_skill_tree_v1(text,text) to authenticated;
