-- INHA WORLD Life Skill curve v1 (Lv2..20) + per-skill SP pools.
--
-- Implements the Authority Map section 7.1 target contract:
-- - Each Life Skill earns SP from its own Skill Level (life.common.v1 cumulative_sp).
-- - SP is spent only in the owning skill's tree. The SP ledger carries the pool (skill_id), and
--   a composite FK pins every spend to the node's own skill.
-- - The aggregate Life Level (life.progression.v1) stays a derived display level. It is no longer
--   an SP source: its cumulative_sp column must stay 0 for every future row.
--
-- Curve values are the #91 candidate recorded in docs/architecture/PR91_LIFE_PROGRESSION_SALVAGE.md
-- section 1: min_total_xp(L) = 50 * L * (L - 1), +1 SP per level and +2 at every 5th level.
-- Lv20 is the highest defined level, not a cap. No Life Skill is activated here.

-- ---- 1. per-skill curve carries cumulative SP ----
alter table private.world_life_skill_thresholds
  add column if not exists cumulative_sp integer not null default 0
    check (cumulative_sp >= 0);
comment on table private.world_life_skill_thresholds is
  'Immutable per-curve Life Skill thresholds with cumulative per-skill SP. Rows append only.';

create or replace function private.world_life_skill_threshold_validate_insert_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max_level integer;
  v_max_xp bigint;
  v_max_sp integer;
begin
  select max(t.level), max(t.min_total_xp), max(t.cumulative_sp)
    into v_max_level, v_max_xp, v_max_sp
    from private.world_life_skill_thresholds t
   where t.curve_id = new.curve_id;

  if v_max_level is null then
    if new.level <> 1 or new.min_total_xp <> 0 or new.cumulative_sp <> 0 then
      raise exception 'LIFE_SKILL_CURVE_INVALID' using errcode = '23514';
    end if;
  elsif new.level <> v_max_level + 1
     or new.min_total_xp <= v_max_xp
     or new.cumulative_sp < v_max_sp then
    raise exception 'LIFE_SKILL_CURVE_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.world_life_skill_threshold_validate_insert_v1()
  from public, anon, authenticated, service_role;

insert into private.world_life_skill_thresholds(curve_id,level,min_total_xp,cumulative_sp) values
  ('life.common.v1', 2,   100,  1),
  ('life.common.v1', 3,   300,  2),
  ('life.common.v1', 4,   600,  3),
  ('life.common.v1', 5,  1000,  5),
  ('life.common.v1', 6,  1500,  6),
  ('life.common.v1', 7,  2100,  7),
  ('life.common.v1', 8,  2800,  8),
  ('life.common.v1', 9,  3600,  9),
  ('life.common.v1',10,  4500, 11),
  ('life.common.v1',11,  5500, 12),
  ('life.common.v1',12,  6600, 13),
  ('life.common.v1',13,  7800, 14),
  ('life.common.v1',14,  9100, 15),
  ('life.common.v1',15, 10500, 17),
  ('life.common.v1',16, 12000, 18),
  ('life.common.v1',17, 13600, 19),
  ('life.common.v1',18, 15300, 20),
  ('life.common.v1',19, 17100, 21),
  ('life.common.v1',20, 19000, 23)
on conflict (curve_id,level) do nothing;

-- ---- 2. aggregate Life Level is no longer an SP source ----
create or replace function private.world_life_progression_threshold_validate_insert_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_max_level integer;
  v_max_xp bigint;
begin
  -- Per-skill pools (Authority Map 7.1): SP is earned only from per-skill curves.
  if new.cumulative_sp <> 0 then
    raise exception 'LIFE_PROGRESSION_CURVE_INVALID' using errcode = '23514';
  end if;

  select max(t.level), max(t.min_total_skill_xp)
    into v_max_level, v_max_xp
    from private.world_life_progression_thresholds t
   where t.curve_id = new.curve_id;

  if v_max_level is null then
    if new.level <> 1 or new.min_total_skill_xp <> 0 then
      raise exception 'LIFE_PROGRESSION_CURVE_INVALID' using errcode = '23514';
    end if;
  elsif new.level <> v_max_level + 1
     or new.min_total_skill_xp <= v_max_xp then
    raise exception 'LIFE_PROGRESSION_CURVE_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.world_life_progression_threshold_validate_insert_v1()
  from public, anon, authenticated, service_role;

comment on table private.world_life_progression_thresholds is
  'Aggregate Life Level thresholds derived from summed per-skill XP. Display level only; cumulative_sp is retired and must stay 0.';

-- ---- 3. SP ledger gains the pool dimension ----
-- The ledger and tree catalog hold no rows yet (no ACTIVE node exists), so the pool column is added
-- as NOT NULL directly. Fail loudly instead of guessing a pool for an existing spend.
do $$
begin
  if exists (select 1 from private.world_life_sp_transactions) then
    raise exception 'LIFE_SP_POOL_MIGRATION_REQUIRES_EMPTY_LEDGER';
  end if;
end;
$$;

alter table private.world_life_skill_tree_catalog
  add constraint world_life_skill_tree_catalog_node_skill_key unique (node_id,skill_id);

alter table private.world_life_sp_transactions
  add column skill_id text not null;
alter table private.world_life_sp_transactions
  add constraint world_life_sp_transactions_node_skill_fk
    foreign key (node_id,skill_id)
    references private.world_life_skill_tree_catalog(node_id,skill_id);
comment on table private.world_life_sp_transactions is
  'Append-only per-skill SP spend ledger. skill_id is the SP pool and always equals the node''s skill.';

create index if not exists world_life_sp_transactions_user_skill_idx
  on private.world_life_sp_transactions(user_id,skill_id);

-- ---- 4. per-skill SP read ----
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
begin
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  v_skill := private.world_life_skill_snapshot_v1(p_user,p_skill_id);
  v_level := (v_skill->>'level')::integer;

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
     and s.skill_id = p_skill_id;

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

-- ---- 5. aggregate snapshot without a shared SP pool ----
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
  v_max integer;
begin
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  v_total := private.world_life_progression_total_skill_xp_v1(p_user);

  select t.level,t.min_total_skill_xp
    into v_level,v_start
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

  return jsonb_build_object(
    'curveId',v_curve,
    'totalSkillXp',v_total,
    'level',v_level,
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

-- ---- 6. tree snapshot carries the owning skill's pool ----
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

-- ---- 7. node unlock spends only the owning skill's pool ----
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
      'skillId',v_existing.skill_id,
      'sp',private.world_life_skill_sp_snapshot_v1(p_user,v_existing.skill_id)
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
      'skillId',v_existing.skill_id,
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
    user_id,skill_id,node_id,sp_cost,sp_before,sp_after,idempotency_key)
  values (
    p_user,v_node.skill_id,p_node_id,v_node.sp_cost,v_available,
    v_available-v_node.sp_cost,p_idempotency_key)
  returning * into v_tx;

  insert into private.world_player_life_nodes(user_id,node_id,transaction_id)
  values (p_user,p_node_id,v_tx.transaction_id);

  return jsonb_build_object(
    'status','SUCCESS',
    'transactionId',v_tx.transaction_id,
    'nodeId',v_tx.node_id,
    'skillId',v_tx.skill_id,
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
