-- INHA WORLD Life Progression P0.
-- Adds aggregate Life Level, SP accounting and Skill Tree authority on top of the existing
-- per-skill XP ledger. P0 intentionally seeds only Life Lv1 and no unlockable nodes.
-- Balance thresholds, node effects and skill activation remain future work.

create table if not exists private.world_life_progression_thresholds (
  curve_id text not null
    check (curve_id ~ '^life\.[a-z][a-z0-9_]*\.v[0-9]+$' and char_length(curve_id) <= 80),
  level integer not null check (level >= 1),
  min_total_skill_xp bigint not null check (min_total_skill_xp >= 0),
  cumulative_sp integer not null check (cumulative_sp >= 0),
  created_at timestamptz not null default now(),
  primary key (curve_id,level)
);
comment on table private.world_life_progression_thresholds is
  'Aggregate Life Level thresholds derived from summed per-skill XP. P0 seeds Lv1 only.';

create or replace function private.world_life_progression_threshold_validate_insert_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max_level integer;
  v_max_xp bigint;
  v_max_sp integer;
begin
  select max(t.level), max(t.min_total_skill_xp), max(t.cumulative_sp)
    into v_max_level, v_max_xp, v_max_sp
    from private.world_life_progression_thresholds t
   where t.curve_id = new.curve_id;

  if v_max_level is null then
    if new.level <> 1 or new.min_total_skill_xp <> 0 or new.cumulative_sp <> 0 then
      raise exception 'LIFE_PROGRESSION_CURVE_INVALID' using errcode = '23514';
    end if;
  elsif new.level <> v_max_level + 1
     or new.min_total_skill_xp <= v_max_xp
     or new.cumulative_sp < v_max_sp then
    raise exception 'LIFE_PROGRESSION_CURVE_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.world_life_progression_threshold_validate_insert_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_progression_threshold_validate_insert
  on private.world_life_progression_thresholds;
create trigger world_life_progression_threshold_validate_insert
  before insert on private.world_life_progression_thresholds
  for each row execute function private.world_life_progression_threshold_validate_insert_v1();

create or replace function private.world_life_progression_threshold_immutable_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LIFE_PROGRESSION_CURVE_IMMUTABLE' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_progression_threshold_immutable_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_progression_threshold_immutable
  on private.world_life_progression_thresholds;
create trigger world_life_progression_threshold_immutable
  before update or delete on private.world_life_progression_thresholds
  for each row execute function private.world_life_progression_threshold_immutable_v1();

insert into private.world_life_progression_thresholds(
  curve_id,level,min_total_skill_xp,cumulative_sp)
values ('life.progression.v1',1,0,0)
on conflict (curve_id,level) do nothing;

create table if not exists private.world_life_skill_tree_catalog (
  node_id text primary key
    check (node_id ~ '^life\.node\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$' and char_length(node_id) <= 120),
  skill_id text not null references private.world_life_skill_catalog(skill_id),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  sp_cost integer not null check (sp_cost between 1 and 99),
  required_life_level integer not null check (required_life_level >= 1),
  required_skill_level integer not null check (required_skill_level >= 1)
);
comment on table private.world_life_skill_tree_catalog is
  'Write-authority mirror for Life Skill Tree unlock requirements. P0 contains no live nodes.';

create table if not exists private.world_life_skill_tree_edges (
  node_id text not null references private.world_life_skill_tree_catalog(node_id) on delete cascade,
  prerequisite_node_id text not null references private.world_life_skill_tree_catalog(node_id) on delete restrict,
  primary key (node_id,prerequisite_node_id),
  check (node_id <> prerequisite_node_id)
);
comment on table private.world_life_skill_tree_edges is
  'Directed prerequisite edges. Product Registry owns cycle validation before catalog rollout.';

create table if not exists private.world_life_sp_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id text not null references private.world_life_skill_tree_catalog(node_id),
  sp_cost integer not null check (sp_cost > 0),
  sp_before integer not null check (sp_before >= 0),
  sp_after integer not null check (sp_after >= 0),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  created_at timestamptz not null default now(),
  constraint world_life_sp_transactions_math check (sp_after = sp_before - sp_cost)
);
comment on table private.world_life_sp_transactions is
  'Append-only SP spend ledger for Life Skill Tree node unlocks.';

create index if not exists world_life_sp_transactions_user_created_idx
  on private.world_life_sp_transactions(user_id,created_at desc);

create table if not exists private.world_player_life_nodes (
  user_id uuid not null references auth.users(id) on delete cascade,
  node_id text not null references private.world_life_skill_tree_catalog(node_id),
  transaction_id uuid not null unique references private.world_life_sp_transactions(transaction_id),
  unlocked_at timestamptz not null default now(),
  primary key (user_id,node_id)
);
comment on table private.world_player_life_nodes is
  'Append-only projection of Life Skill Tree nodes unlocked by each account.';

alter table private.world_life_progression_thresholds enable row level security;
alter table private.world_life_skill_tree_catalog enable row level security;
alter table private.world_life_skill_tree_edges enable row level security;
alter table private.world_life_sp_transactions enable row level security;
alter table private.world_player_life_nodes enable row level security;

revoke all on table private.world_life_progression_thresholds,
  private.world_life_skill_tree_catalog,
  private.world_life_skill_tree_edges,
  private.world_life_sp_transactions,
  private.world_player_life_nodes
  from public, anon, authenticated, service_role;

create or replace function private.world_life_sp_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LIFE_SP_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_sp_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_sp_append_only
  on private.world_life_sp_transactions;
create trigger world_life_sp_append_only
  before update or delete on private.world_life_sp_transactions
  for each row execute function private.world_life_sp_append_only_v1();

create or replace function private.world_life_nodes_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LIFE_NODE_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_nodes_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_nodes_append_only
  on private.world_player_life_nodes;
create trigger world_life_nodes_append_only
  before update or delete on private.world_player_life_nodes
  for each row execute function private.world_life_nodes_append_only_v1();

create or replace function private.world_life_progression_total_skill_xp_v1(p_user uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(p.total_xp),0)::bigint
    from private.world_player_life_skills p
   where p.user_id = p_user;
$$;
revoke all on function private.world_life_progression_total_skill_xp_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_progression_snapshot_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_curve constant text := 'life.progression.v1';
  v_total bigint;
  v_level integer;
  v_start bigint;
  v_next bigint;
  v_earned integer;
  v_spent integer;
  v_max integer;
begin
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  v_total := private.world_life_progression_total_skill_xp_v1(p_user);

  select t.level,t.min_total_skill_xp,t.cumulative_sp
    into v_level,v_start,v_earned
    from private.world_life_progression_thresholds t
   where t.curve_id = v_curve
     and t.min_total_skill_xp <= v_total
   order by t.level desc
   limit 1;
  if v_level is null then
    raise exception 'LIFE_PROGRESSION_CURVE_INVALID' using errcode = 'P0001';
  end if;

  select t.min_total_skill_xp into v_next
    from private.world_life_progression_thresholds t
   where t.curve_id = v_curve and t.level = v_level + 1;

  select max(t.level) into v_max
    from private.world_life_progression_thresholds t
   where t.curve_id = v_curve;

  select coalesce(sum(s.sp_cost),0)::integer into v_spent
    from private.world_life_sp_transactions s
   where s.user_id = p_user;

  if v_spent > v_earned then
    raise exception 'LIFE_SP_LEDGER_INVALID' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'curveId',v_curve,
    'totalSkillXp',v_total,
    'level',v_level,
    'earnedSp',v_earned,
    'spentSp',v_spent,
    'availableSp',v_earned-v_spent,
    'currentLevelStartXp',v_start,
    'nextLevelXp',v_next,
    'progressXp',v_total-v_start,
    'progressRequired',case when v_next is null then null else v_next-v_start end,
    'maxDefinedLevel',v_max,
    'isMaxLevel',v_next is null
  );
end;
$$;
revoke all on function private.world_life_progression_snapshot_v1(uuid)
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
    'nodes',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'nodeId',n.node_id,
          'status',n.status,
          'spCost',n.sp_cost,
          'requiredLifeLevel',n.required_life_level,
          'requiredSkillLevel',n.required_skill_level,
          'prerequisites',coalesce((
            select jsonb_agg(e.prerequisite_node_id order by e.prerequisite_node_id)
              from private.world_life_skill_tree_edges e
             where e.node_id = n.node_id
          ),'[]'::jsonb),
          'unlocked',exists(
            select 1
              from private.world_player_life_nodes p
             where p.user_id = p_user and p.node_id = n.node_id
          )
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
  v_skill_snapshot jsonb;
  v_life_level integer;
  v_skill_level integer;
  v_available integer;
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
      'progression',private.world_life_progression_snapshot_v1(p_user)
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));

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
      'progression',private.world_life_progression_snapshot_v1(p_user)
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

  if exists (
    select 1 from private.world_player_life_nodes p
     where p.user_id = p_user and p.node_id = p_node_id
  ) then
    raise exception 'LIFE_NODE_ALREADY_UNLOCKED' using errcode = '23505';
  end if;

  if exists (
    select 1
      from private.world_life_skill_tree_edges e
     where e.node_id = p_node_id
       and not exists (
         select 1 from private.world_player_life_nodes p
          where p.user_id = p_user and p.node_id = e.prerequisite_node_id
       )
  ) then
    raise exception 'LIFE_NODE_PREREQUISITE_LOCKED' using errcode = 'P0001';
  end if;

  v_progress := private.world_life_progression_snapshot_v1(p_user);
  v_skill_snapshot := private.world_life_skill_snapshot_v1(p_user,v_node.skill_id);
  v_life_level := (v_progress->>'level')::integer;
  v_skill_level := (v_skill_snapshot->>'level')::integer;
  v_available := (v_progress->>'availableSp')::integer;

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
    user_id,node_id,sp_cost,sp_before,sp_after,idempotency_key)
  values (
    p_user,p_node_id,v_node.sp_cost,v_available,v_available-v_node.sp_cost,p_idempotency_key)
  returning * into v_tx;

  insert into private.world_player_life_nodes(user_id,node_id,transaction_id)
  values (p_user,p_node_id,v_tx.transaction_id);

  return jsonb_build_object(
    'status','SUCCESS',
    'transactionId',v_tx.transaction_id,
    'nodeId',v_tx.node_id,
    'spCost',v_tx.sp_cost,
    'spBefore',v_tx.sp_before,
    'spAfter',v_tx.sp_after,
    'progression',private.world_life_progression_snapshot_v1(p_user),
    'tree',private.world_life_skill_tree_snapshot_v1(p_user,v_node.skill_id)
  );
end;
$$;
revoke all on function private.world_life_node_unlock_v1(uuid,text,text)
  from public, anon, authenticated, service_role;
