-- INHA WORLD P0 Life Progression + Skill Tree foundation.
--
-- Extends the existing Life Skill authority without coupling it to Campus World EXP.
-- This migration defines:
--   * aggregate Life EXP / derived Life Level
--   * auditable Life Skill Points (SP)
--   * Life Skill Tree / node / prerequisite definitions
--   * per-account unlocked node ranks
--
-- Balance remains intentionally uncommitted beyond Life Lv1=0.
-- No skill-tree node is seeded or ACTIVE here.

-- Sailing joins the long-term Life Skill catalog. It remains unavailable until a later activation migration.
insert into private.world_life_skill_catalog(skill_id,curve_id,status)
values ('life.sailing','life.common.v1','COMING_SOON')
on conflict (skill_id) do nothing;

-- ---- aggregate Life Level curve ---------------------------------------------------------------

create table if not exists private.world_life_progression_thresholds (
  curve_id text not null
    check (curve_id ~ '^life\.[a-z][a-z0-9_]*\.v[0-9]+$' and char_length(curve_id) <= 80),
  level integer not null check (level >= 1),
  min_total_xp bigint not null check (min_total_xp >= 0),
  skill_points_reward integer not null default 0 check (skill_points_reward >= 0),
  created_at timestamptz not null default now(),
  primary key (curve_id,level)
);
comment on table private.world_life_progression_thresholds is
  'Immutable aggregate Life Level thresholds. Life Lv1=0 is committed; later levels append only after balance approval.';

create or replace function private.world_life_progression_threshold_validate_insert_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max_level integer;
  v_max_xp bigint;
begin
  select max(t.level), max(t.min_total_xp)
    into v_max_level, v_max_xp
    from private.world_life_progression_thresholds t
   where t.curve_id = new.curve_id;

  if v_max_level is null then
    if new.level <> 1 or new.min_total_xp <> 0 then
      raise exception 'LIFE_PROGRESSION_CURVE_INVALID' using errcode = '23514';
    end if;
  elsif new.level <> v_max_level + 1 or new.min_total_xp <= v_max_xp then
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
  curve_id,level,min_total_xp,skill_points_reward
) values ('life.progression.v1',1,0,0)
on conflict (curve_id,level) do nothing;

-- ---- per-account Life progression -------------------------------------------------------------

create table if not exists private.world_player_life_progression (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_xp bigint not null default 0 check (total_xp >= 0),
  skill_points_earned integer not null default 0 check (skill_points_earned >= 0),
  skill_points_spent integer not null default 0 check (skill_points_spent >= 0),
  skill_points_balance integer generated always as (skill_points_earned - skill_points_spent) stored,
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint world_player_life_progression_sp_budget
    check (skill_points_spent <= skill_points_earned)
);
comment on table private.world_player_life_progression is
  'Aggregate per-account Life XP and SP projection. Life Level is derived from immutable thresholds and is never stored.';

create table if not exists private.world_life_xp_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.world_player_life_progression(user_id) on delete cascade,
  amount bigint not null check (amount > 0),
  xp_before bigint not null check (xp_before >= 0),
  xp_after bigint not null check (xp_after >= 0),
  level_before integer not null check (level_before >= 1),
  level_after integer not null check (level_after >= 1),
  skill_points_awarded integer not null default 0 check (skill_points_awarded >= 0),
  source_type text not null
    check (source_type ~ '^[a-z][a-z0-9_]{0,31}$'),
  source_id text not null check (char_length(source_id) between 1 and 200),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  created_at timestamptz not null default now(),
  constraint world_life_xp_transactions_math check (xp_after = xp_before + amount),
  constraint world_life_xp_transactions_level_monotonic check (level_after >= level_before)
);
comment on table private.world_life_xp_transactions is
  'Append-only aggregate Life XP ledger. Separate from per-skill Life Skill XP and Campus World EXP.';

create index if not exists world_life_xp_transactions_user_created_idx
  on private.world_life_xp_transactions(user_id,created_at desc);

create table if not exists private.world_life_skill_point_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references private.world_player_life_progression(user_id) on delete cascade,
  delta integer not null check (delta <> 0),
  balance_before integer not null check (balance_before >= 0),
  balance_after integer not null check (balance_after >= 0),
  reason_type text not null check (reason_type in (
    'LEVEL_UP','QUEST_REWARD','ACHIEVEMENT','NODE_RANK_UP','NODE_RESET','SYSTEM','ADMIN'
  )),
  source_id text not null check (char_length(source_id) between 1 and 200),
  node_id text,
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  created_at timestamptz not null default now(),
  constraint world_life_skill_point_transactions_math
    check (balance_after = balance_before + delta),
  constraint world_life_skill_point_transactions_reason_sign check (
    (reason_type in ('LEVEL_UP','QUEST_REWARD','ACHIEVEMENT','NODE_RESET','SYSTEM','ADMIN'))
    or (reason_type = 'NODE_RANK_UP' and delta < 0)
  )
);
comment on table private.world_life_skill_point_transactions is
  'Append-only Life Skill Point ledger. Positive awards/refunds and negative node-rank spends are auditable.';

create index if not exists world_life_skill_point_transactions_user_created_idx
  on private.world_life_skill_point_transactions(user_id,created_at desc);

create or replace function private.world_life_progression_ledger_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LIFE_PROGRESSION_LEDGER_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_progression_ledger_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_xp_transactions_append_only
  on private.world_life_xp_transactions;
create trigger world_life_xp_transactions_append_only
  before update on private.world_life_xp_transactions
  for each row execute function private.world_life_progression_ledger_append_only_v1();

drop trigger if exists world_life_skill_point_transactions_append_only
  on private.world_life_skill_point_transactions;
create trigger world_life_skill_point_transactions_append_only
  before update on private.world_life_skill_point_transactions
  for each row execute function private.world_life_progression_ledger_append_only_v1();

-- ---- Skill Tree definitions ------------------------------------------------------------------

create table if not exists private.world_life_skill_tree_catalog (
  tree_id text primary key
    check (tree_id ~ '^life_tree\.[a-z][a-z0-9_]*$' and char_length(tree_id) <= 100),
  skill_id text references private.world_life_skill_catalog(skill_id),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null default 1 check (definition_version >= 1)
);
comment on table private.world_life_skill_tree_catalog is
  'Life Skill Tree definition mirror. A null skill_id denotes the shared general Life tree.';

insert into private.world_life_skill_tree_catalog(tree_id,skill_id,status,definition_version) values
  ('life_tree.general',null,'COMING_SOON',1),
  ('life_tree.archaeology','life.archaeology','COMING_SOON',1),
  ('life_tree.cooking','life.cooking','COMING_SOON',1),
  ('life_tree.crafting','life.crafting','COMING_SOON',1),
  ('life_tree.farming','life.farming','COMING_SOON',1),
  ('life_tree.fishing','life.fishing','COMING_SOON',1),
  ('life_tree.gathering','life.gathering','COMING_SOON',1),
  ('life_tree.mining','life.mining','COMING_SOON',1),
  ('life_tree.photography','life.photography','COMING_SOON',1),
  ('life_tree.research','life.research','COMING_SOON',1),
  ('life_tree.sailing','life.sailing','COMING_SOON',1),
  ('life_tree.woodcutting','life.woodcutting','COMING_SOON',1),
  ('life_tree.woodworking','life.woodworking','COMING_SOON',1)
on conflict (tree_id) do nothing;

create table if not exists private.world_life_skill_nodes (
  node_id text primary key
    check (
      node_id ~ '^life_node\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$'
      and char_length(node_id) <= 140
    ),
  tree_id text not null references private.world_life_skill_tree_catalog(tree_id),
  max_rank integer not null check (max_rank between 1 and 100),
  point_cost integer not null check (point_cost >= 1),
  required_life_level integer not null default 1 check (required_life_level >= 1),
  required_skill_id text references private.world_life_skill_catalog(skill_id),
  required_skill_level integer
    check (required_skill_level is null or required_skill_level >= 1),
  effect_key text not null
    check (
      effect_key ~ '^[a-z][a-z0-9_.:-]{0,159}$'
      and char_length(effect_key) <= 160
    ),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  definition_version integer not null default 1 check (definition_version >= 1),
  constraint world_life_skill_nodes_skill_requirement_shape check (
    (required_skill_id is null and required_skill_level is null)
    or (required_skill_id is not null and required_skill_level is not null)
  )
);
comment on table private.world_life_skill_nodes is
  'Life Skill Tree nodes. Gameplay effect implementation remains code-owned through effect_key.';

create index if not exists world_life_skill_nodes_tree_idx
  on private.world_life_skill_nodes(tree_id,node_id);

create table if not exists private.world_life_skill_node_prerequisites (
  node_id text not null references private.world_life_skill_nodes(node_id) on delete cascade,
  prerequisite_node_id text not null references private.world_life_skill_nodes(node_id),
  required_rank integer not null check (required_rank >= 1),
  primary key (node_id,prerequisite_node_id),
  constraint world_life_skill_node_prerequisites_no_self
    check (node_id <> prerequisite_node_id)
);
comment on table private.world_life_skill_node_prerequisites is
  'Directed prerequisite edges between Life Skill Tree nodes. DAG/cycle validation belongs to definition QA.';

create table if not exists private.world_player_life_skill_nodes (
  user_id uuid not null references private.world_player_life_progression(user_id) on delete cascade,
  node_id text not null references private.world_life_skill_nodes(node_id),
  rank integer not null check (rank >= 1),
  version bigint not null default 0 check (version >= 0),
  unlocked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,node_id)
);
comment on table private.world_player_life_skill_nodes is
  'Per-account purchased Life Skill Tree ranks. Eligibility and max-rank enforcement belong to the authoritative mutation path.';

-- Node ids in the SP ledger become referential once the node catalog exists.
alter table private.world_life_skill_point_transactions
  drop constraint if exists world_life_skill_point_transactions_node_id_fkey;
alter table private.world_life_skill_point_transactions
  add constraint world_life_skill_point_transactions_node_id_fkey
  foreign key (node_id) references private.world_life_skill_nodes(node_id);

-- ---- read-only derived aggregate snapshot -----------------------------------------------------

create or replace function private.world_life_progression_level_for_xp_v1(
  p_curve_id text,
  p_total_xp bigint)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_level integer;
begin
  if p_curve_id is null
     or p_curve_id !~ '^life\.[a-z][a-z0-9_]*\.v[0-9]+$'
     or char_length(p_curve_id) > 80 then
    raise exception 'INVALID_LIFE_PROGRESSION_CURVE' using errcode = '22023';
  end if;
  if p_total_xp is null or p_total_xp < 0 then
    raise exception 'INVALID_TOTAL_XP' using errcode = '22023';
  end if;

  select t.level into v_level
    from private.world_life_progression_thresholds t
   where t.curve_id = p_curve_id
     and t.min_total_xp <= p_total_xp
   order by t.level desc
   limit 1;

  if v_level is null then
    raise exception 'LIFE_PROGRESSION_CURVE_INVALID' using errcode = 'P0001';
  end if;
  return v_level;
end;
$$;
revoke all on function private.world_life_progression_level_for_xp_v1(text,bigint)
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
  v_total bigint := 0;
  v_earned integer := 0;
  v_spent integer := 0;
  v_balance integer := 0;
  v_version bigint := 0;
  v_level integer;
  v_start bigint;
  v_next bigint;
  v_max integer;
begin
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select p.total_xp,p.skill_points_earned,p.skill_points_spent,p.skill_points_balance,p.version
    into v_total,v_earned,v_spent,v_balance,v_version
    from private.world_player_life_progression p
   where p.user_id = p_user;

  v_total := coalesce(v_total,0);
  v_earned := coalesce(v_earned,0);
  v_spent := coalesce(v_spent,0);
  v_balance := coalesce(v_balance,0);
  v_version := coalesce(v_version,0);

  v_level := private.world_life_progression_level_for_xp_v1(v_curve,v_total);

  select t.min_total_xp into strict v_start
    from private.world_life_progression_thresholds t
   where t.curve_id = v_curve and t.level = v_level;
  select t.min_total_xp into v_next
    from private.world_life_progression_thresholds t
   where t.curve_id = v_curve and t.level = v_level + 1;
  select max(t.level) into v_max
    from private.world_life_progression_thresholds t
   where t.curve_id = v_curve;

  return jsonb_build_object(
    'curveId',v_curve,
    'totalXp',v_total,
    'level',v_level,
    'version',v_version,
    'currentLevelStartXp',v_start,
    'nextLevelXp',v_next,
    'progressXp',v_total-v_start,
    'progressRequired',case when v_next is null then null else v_next-v_start end,
    'maxDefinedLevel',v_max,
    'isMaxLevel',v_next is null,
    'skillPointsEarned',v_earned,
    'skillPointsSpent',v_spent,
    'skillPointsBalance',v_balance
  );
end;
$$;
revoke all on function private.world_life_progression_snapshot_v1(uuid)
  from public, anon, authenticated, service_role;

-- ---- privilege boundary ----------------------------------------------------------------------

alter table private.world_life_progression_thresholds enable row level security;
alter table private.world_player_life_progression enable row level security;
alter table private.world_life_xp_transactions enable row level security;
alter table private.world_life_skill_point_transactions enable row level security;
alter table private.world_life_skill_tree_catalog enable row level security;
alter table private.world_life_skill_nodes enable row level security;
alter table private.world_life_skill_node_prerequisites enable row level security;
alter table private.world_player_life_skill_nodes enable row level security;

revoke all on table
  private.world_life_progression_thresholds,
  private.world_player_life_progression,
  private.world_life_xp_transactions,
  private.world_life_skill_point_transactions,
  private.world_life_skill_tree_catalog,
  private.world_life_skill_nodes,
  private.world_life_skill_node_prerequisites,
  private.world_player_life_skill_nodes
from public, anon, authenticated, service_role;
