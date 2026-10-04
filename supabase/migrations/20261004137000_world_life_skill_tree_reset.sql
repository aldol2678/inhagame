-- INHA WORLD Life Skill Tree reset (respec), per skill, free, with an adjustable cooldown.
--
-- Model: reset epochs. Nothing is ever updated or deleted.
-- - Each (account, skill) has a current epoch: 0, or the epoch of its latest reset.
-- - SP spends and acquired ranks carry the epoch they were made in. Only rows of the current epoch
--   count: spent SP, current ranks and prerequisites all read the current epoch.
-- - A reset appends one row with epoch + 1 and a snapshot of the ranks it cleared. The refund is
--   exact by construction (the old epoch's spends simply stop counting) and still works after a node
--   or skill is disabled.
-- Policy: no cost. One reset per skill per cooldown window. The cooldown lives in
-- world_life_tree_reset_policy (default 86400 s = 24 h) and is changed by a forward migration or ops
-- DML, never by a function. A reset with nothing to refund is refused and does not start a cooldown.
-- No caller is added: like world_life_node_unlock_v1, the reset gets a player path in a later PR.

-- ---- 1. policy ----
create table if not exists private.world_life_tree_reset_policy (
  policy_id text primary key check (policy_id = 'life.tree_reset.v1'),
  cooldown_seconds integer not null check (cooldown_seconds between 0 and 31536000),
  updated_at timestamptz not null default now()
);
comment on table private.world_life_tree_reset_policy is
  'Life Skill Tree reset policy. Free reset; cooldown per (account, skill). Adjustable by migration or ops only.';
insert into private.world_life_tree_reset_policy(policy_id,cooldown_seconds)
values ('life.tree_reset.v1',86400)
on conflict (policy_id) do nothing;

-- ---- 2. epochs on existing state (rows made before this migration belong to epoch 0) ----
alter table private.world_life_sp_transactions
  add column if not exists epoch integer not null default 0 check (epoch >= 0);
alter table private.world_player_life_nodes
  add column if not exists epoch integer not null default 0 check (epoch >= 0);
alter table private.world_player_life_nodes
  drop constraint world_player_life_nodes_pkey;
alter table private.world_player_life_nodes
  add constraint world_player_life_nodes_pkey primary key (user_id,node_id,epoch,rank);

-- ---- 3. reset ledger ----
create table if not exists private.world_life_tree_resets (
  reset_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id text not null references private.world_life_skill_catalog(skill_id),
  epoch integer not null check (epoch >= 1),
  refunded_sp integer not null check (refunded_sp > 0),
  cleared_ranks jsonb not null check (jsonb_typeof(cleared_ranks) = 'array'),
  cooldown_seconds integer not null check (cooldown_seconds >= 0),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  created_at timestamptz not null default now(),
  constraint world_life_tree_resets_epoch_key unique (user_id,skill_id,epoch)
);
comment on table private.world_life_tree_resets is
  'Append-only Life Skill Tree resets. Each row opens a new epoch for (account, skill).';
create index if not exists world_life_tree_resets_user_skill_idx
  on private.world_life_tree_resets(user_id,skill_id,epoch desc);

alter table private.world_life_tree_reset_policy enable row level security;
alter table private.world_life_tree_resets enable row level security;
revoke all on table private.world_life_tree_reset_policy, private.world_life_tree_resets
  from public, anon, authenticated, service_role;

create or replace function private.world_life_tree_resets_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Account deletion cascades remove the account's whole history; nothing else may.
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'LIFE_TREE_RESET_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_tree_resets_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_tree_resets_append_only on private.world_life_tree_resets;
create trigger world_life_tree_resets_append_only
  before update or delete on private.world_life_tree_resets
  for each row execute function private.world_life_tree_resets_append_only_v1();

-- ---- 4. epoch-aware reads ----
create or replace function private.world_life_tree_epoch_v1(p_user uuid, p_skill_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(r.epoch),0)::integer
    from private.world_life_tree_resets r
   where r.user_id = p_user and r.skill_id = p_skill_id;
$$;
revoke all on function private.world_life_tree_epoch_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_node_rank_v1(p_user uuid, p_node_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(p.rank),0)::integer
    from private.world_player_life_nodes p
    join private.world_life_skill_tree_catalog n on n.node_id = p.node_id
   where p.user_id = p_user
     and p.node_id = p_node_id
     and p.epoch = private.world_life_tree_epoch_v1(p_user,n.skill_id);
$$;
revoke all on function private.world_life_node_rank_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_sp_snapshot_v1(
  p_user uuid,
  p_skill_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_skill jsonb;
  v_level integer;
  v_earned integer;
  v_next integer;
  v_spent integer;
  v_epoch integer;
begin
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  v_skill := private.world_life_skill_snapshot_v1(p_user,p_skill_id);
  v_level := (v_skill->>'level')::integer;
  v_epoch := private.world_life_tree_epoch_v1(p_user,p_skill_id);

  select t.cumulative_sp into strict v_earned
    from private.world_life_skill_thresholds t
   where t.curve_id = v_skill->>'curveId'
     and t.level = v_level;
  select t.cumulative_sp into v_next
    from private.world_life_skill_thresholds t
   where t.curve_id = v_skill->>'curveId'
     and t.level = v_level + 1;

  select coalesce(sum(s.sp_cost),0)::integer into v_spent
    from private.world_life_sp_transactions s
   where s.user_id = p_user
     and s.skill_id = p_skill_id
     and s.epoch = v_epoch;

  if v_spent > v_earned then
    raise exception 'LIFE_SP_LEDGER_INVALID' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'skillId',p_skill_id,
    'curveId',v_skill->>'curveId',
    'skillLevel',v_level,
    'earnedSp',v_earned,
    'spentSp',v_spent,
    'availableSp',v_earned - v_spent,
    'nextLevelEarnedSp',v_next
  );
end;
$$;
revoke all on function private.world_life_skill_sp_snapshot_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_tree_reset_state_v1(p_user uuid, p_skill_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cooldown integer;
  v_last timestamptz;
  v_next timestamptz;
begin
  select p.cooldown_seconds into strict v_cooldown
    from private.world_life_tree_reset_policy p
   where p.policy_id = 'life.tree_reset.v1';
  select max(r.created_at) into v_last
    from private.world_life_tree_resets r
   where r.user_id = p_user and r.skill_id = p_skill_id;
  v_next := v_last + make_interval(secs => v_cooldown);
  return jsonb_build_object(
    'epoch',private.world_life_tree_epoch_v1(p_user,p_skill_id),
    'cooldownSeconds',v_cooldown,
    'lastResetAt',v_last,
    'nextResetAt',case when v_next is null or v_next <= now() then null else v_next end,
    'cost',0
  );
end;
$$;
revoke all on function private.world_life_tree_reset_state_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_tree_snapshot_v1(
  p_user uuid,
  p_skill_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_skill private.world_life_skill_catalog%rowtype;
begin
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_skill
    from private.world_life_skill_catalog s
   where s.skill_id = p_skill_id;
  if not found then
    raise exception 'LIFE_SKILL_NOT_FOUND' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'skillId',p_skill_id,
    'sp',private.world_life_skill_sp_snapshot_v1(p_user,p_skill_id),
    'reset',private.world_life_tree_reset_state_v1(p_user,p_skill_id),
    'nodes',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'nodeId',n.node_id,
          'status',n.status,
          'spCost',n.sp_cost,
          'maxRank',n.max_rank,
          'rank',private.world_life_node_rank_v1(p_user,n.node_id),
          'requiredLifeLevel',n.required_life_level,
          'requiredSkillLevel',n.required_skill_level,
          'prerequisites',coalesce((
            select jsonb_agg(
              jsonb_build_object('nodeId',e.prerequisite_node_id,'requiredRank',e.required_rank)
              order by e.prerequisite_node_id)
              from private.world_life_skill_tree_edges e
             where e.node_id = n.node_id
          ),'[]'::jsonb)
        )
        order by n.node_id
      )
      from private.world_life_skill_tree_catalog n
      where n.skill_id = p_skill_id
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function private.world_life_skill_tree_snapshot_v1(uuid,text)
  from public, anon, authenticated, service_role;

-- ---- 5. unlock writes the current epoch ----
create or replace function private.world_life_node_unlock_v1(
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
  v_node private.world_life_skill_tree_catalog%rowtype;
  v_skill private.world_life_skill_catalog%rowtype;
  v_existing private.world_life_sp_transactions%rowtype;
  v_tx private.world_life_sp_transactions%rowtype;
  v_progress jsonb;
  v_sp jsonb;
  v_life_level integer;
  v_skill_level integer;
  v_available integer;
  v_rank_before integer;
  v_epoch integer;
begin
  if p_node_id is null
     or p_node_id !~ '^life\.node\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
     or char_length(p_node_id) > 120 then
    raise exception 'INVALID_LIFE_NODE_ID' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_life:' || p_user::text,0));

  -- Exact replay returns the committed rank, even if the node was disabled or the tree reset since.
  select * into v_existing
    from private.world_life_sp_transactions t
   where t.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.user_id,v_existing.node_id) is distinct from (p_user,p_node_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'transactionId',v_existing.transaction_id,
      'nodeId',v_existing.node_id,
      'skillId',v_existing.skill_id,
      'rankAfter',v_existing.rank,
      'epoch',v_existing.epoch,
      'sp',private.world_life_skill_sp_snapshot_v1(p_user,v_existing.skill_id)
    );
  end if;

  select * into v_node
    from private.world_life_skill_tree_catalog n
   where n.node_id = p_node_id;
  if not found then
    raise exception 'LIFE_NODE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_node.status <> 'ACTIVE' then
    raise exception 'LIFE_NODE_INACTIVE' using errcode = 'P0001';
  end if;

  select * into strict v_skill
    from private.world_life_skill_catalog s
   where s.skill_id = v_node.skill_id;
  if v_skill.status <> 'ACTIVE' then
    raise exception 'LIFE_SKILL_INACTIVE' using errcode = 'P0001';
  end if;

  v_epoch := private.world_life_tree_epoch_v1(p_user,v_node.skill_id);
  v_rank_before := private.world_life_node_rank_v1(p_user,p_node_id);
  if v_rank_before >= v_node.max_rank then
    raise exception 'LIFE_NODE_MAX_RANK' using errcode = '23505';
  end if;

  if exists (
    select 1
      from private.world_life_skill_tree_edges e
     where e.node_id = p_node_id
       and private.world_life_node_rank_v1(p_user,e.prerequisite_node_id) < e.required_rank
  ) then
    raise exception 'LIFE_NODE_PREREQUISITE_LOCKED' using errcode = 'P0001';
  end if;

  v_progress := private.world_life_progression_snapshot_v1(p_user);
  v_sp := private.world_life_skill_sp_snapshot_v1(p_user,v_node.skill_id);
  v_life_level := (v_progress->>'level')::integer;
  v_skill_level := (v_sp->>'skillLevel')::integer;
  v_available := (v_sp->>'availableSp')::integer;

  if v_life_level < v_node.required_life_level then
    raise exception 'LIFE_LEVEL_REQUIRED' using errcode = 'P0001';
  end if;
  if v_skill_level < v_node.required_skill_level then
    raise exception 'LIFE_SKILL_LEVEL_REQUIRED' using errcode = 'P0001';
  end if;
  if v_available < v_node.sp_cost then
    raise exception 'LIFE_SP_INSUFFICIENT' using errcode = 'P0001';
  end if;

  insert into private.world_life_sp_transactions(
    user_id,skill_id,node_id,rank,epoch,sp_cost,sp_before,sp_after,idempotency_key)
  values (
    p_user,v_node.skill_id,p_node_id,v_rank_before + 1,v_epoch,v_node.sp_cost,v_available,
    v_available-v_node.sp_cost,p_idempotency_key)
  returning * into v_tx;

  insert into private.world_player_life_nodes(user_id,node_id,epoch,rank,transaction_id)
  values (p_user,p_node_id,v_epoch,v_tx.rank,v_tx.transaction_id);

  return jsonb_build_object(
    'status','SUCCESS',
    'transactionId',v_tx.transaction_id,
    'nodeId',v_tx.node_id,
    'skillId',v_tx.skill_id,
    'epoch',v_epoch,
    'rankBefore',v_rank_before,
    'rankAfter',v_tx.rank,
    'maxRank',v_node.max_rank,
    'spCost',v_tx.sp_cost,
    'spBefore',v_tx.sp_before,
    'spAfter',v_tx.sp_after,
    'sp',private.world_life_skill_sp_snapshot_v1(p_user,v_node.skill_id),
    'tree',private.world_life_skill_tree_snapshot_v1(p_user,v_node.skill_id)
  );
end;
$$;
revoke all on function private.world_life_node_unlock_v1(uuid,text,text)
  from public, anon, authenticated, service_role;

-- ---- 6. reset ----
create or replace function private.world_life_tree_reset_v1(
  p_user uuid,
  p_skill_id text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_existing private.world_life_tree_resets%rowtype;
  v_reset private.world_life_tree_resets%rowtype;
  v_epoch integer;
  v_cooldown integer;
  v_last timestamptz;
  v_refund integer;
  v_cleared jsonb;
begin
  if p_skill_id is null
     or p_skill_id !~ '^life\.[a-z][a-z0-9_]*$'
     or char_length(p_skill_id) > 80 then
    raise exception 'INVALID_LIFE_SKILL_ID' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_life:' || p_user::text,0));

  select * into v_existing
    from private.world_life_tree_resets r
   where r.idempotency_key = p_idempotency_key;
  if found then
    if (v_existing.user_id,v_existing.skill_id) is distinct from (p_user,p_skill_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'resetId',v_existing.reset_id,
      'skillId',v_existing.skill_id,
      'epoch',v_existing.epoch,
      'refundedSp',v_existing.refunded_sp,
      'clearedRanks',v_existing.cleared_ranks,
      'sp',private.world_life_skill_sp_snapshot_v1(p_user,p_skill_id),
      'reset',private.world_life_tree_reset_state_v1(p_user,p_skill_id)
    );
  end if;

  -- A reset works whatever the skill's or nodes' status: a disabled tree must still refund.
  if not exists (select 1 from private.world_life_skill_catalog s where s.skill_id = p_skill_id) then
    raise exception 'LIFE_SKILL_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_epoch := private.world_life_tree_epoch_v1(p_user,p_skill_id);

  select coalesce(sum(s.sp_cost),0)::integer into v_refund
    from private.world_life_sp_transactions s
   where s.user_id = p_user and s.skill_id = p_skill_id and s.epoch = v_epoch;
  if v_refund = 0 then
    raise exception 'LIFE_TREE_RESET_EMPTY' using errcode = 'P0001';
  end if;

  select p.cooldown_seconds into strict v_cooldown
    from private.world_life_tree_reset_policy p
   where p.policy_id = 'life.tree_reset.v1';
  select max(r.created_at) into v_last
    from private.world_life_tree_resets r
   where r.user_id = p_user and r.skill_id = p_skill_id;
  if v_last is not null and now() < v_last + make_interval(secs => v_cooldown) then
    raise exception 'LIFE_TREE_RESET_COOLDOWN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('nodeId',x.node_id,'rank',x.rank) order by x.node_id),'[]'::jsonb)
    into v_cleared
    from (
      select p.node_id,max(p.rank) as rank
        from private.world_player_life_nodes p
        join private.world_life_skill_tree_catalog n on n.node_id = p.node_id
       where p.user_id = p_user and n.skill_id = p_skill_id and p.epoch = v_epoch
       group by p.node_id
    ) x;

  insert into private.world_life_tree_resets(
    user_id,skill_id,epoch,refunded_sp,cleared_ranks,cooldown_seconds,idempotency_key)
  values (
    p_user,p_skill_id,v_epoch + 1,v_refund,v_cleared,v_cooldown,p_idempotency_key)
  returning * into v_reset;

  return jsonb_build_object(
    'status','SUCCESS',
    'resetId',v_reset.reset_id,
    'skillId',p_skill_id,
    'epochBefore',v_epoch,
    'epoch',v_reset.epoch,
    'refundedSp',v_reset.refunded_sp,
    'clearedRanks',v_reset.cleared_ranks,
    'cost',0,
    'sp',private.world_life_skill_sp_snapshot_v1(p_user,p_skill_id),
    'reset',private.world_life_tree_reset_state_v1(p_user,p_skill_id)
  );
end;
$$;
revoke all on function private.world_life_tree_reset_v1(uuid,text,text)
  from public, anon, authenticated, service_role;
