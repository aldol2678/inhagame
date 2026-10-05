-- INHA WORLD Life Skill Tree ranks (multi-rank nodes) + published-definition guards.
--
-- Rank model (decided before the #91 node import, docs/architecture/PR91_LIFE_PROGRESSION_SALVAGE.md):
-- - A node has max_rank >= 1. sp_cost is the cost of EACH rank. required_skill_level gates every rank.
-- - A prerequisite edge requires a minimum rank of the prerequisite node (required_rank).
-- - Each acquired rank is one append-only row in world_player_life_nodes and one SP spend row
--   (rank recorded). The current rank is the highest acquired rank; nothing is ever updated.
-- - world_life_node_unlock_v1 acquires exactly the next rank; the client never names a rank.
-- Published definitions are immutable: a node's cost, gates, skill and max rank and every edge are
-- frozen once inserted. Only a node's status may change. Cross-skill edges and edges requiring a rank
-- above the prerequisite's max rank are refused in the database, not only in the code Registry.
-- No node is added and nothing is activated here.

-- ---- 0. player state must still be empty ----
do $$
begin
  if exists (select 1 from private.world_life_sp_transactions)
     or exists (select 1 from private.world_player_life_nodes) then
    raise exception 'LIFE_TREE_RANK_MIGRATION_REQUIRES_EMPTY_STATE';
  end if;
end;
$$;

-- ---- 1. definitions ----
alter table private.world_life_skill_tree_catalog
  add column if not exists max_rank integer not null default 1
    check (max_rank between 1 and 10);
comment on column private.world_life_skill_tree_catalog.sp_cost is
  'SP cost of each rank of the node.';
comment on table private.world_life_skill_tree_catalog is
  'Write-authority mirror for Life Skill Tree nodes. Published rows are immutable except status.';

alter table private.world_life_skill_tree_edges
  add column if not exists required_rank integer not null default 1
    check (required_rank >= 1);
comment on table private.world_life_skill_tree_edges is
  'Directed prerequisite edges (minimum prerequisite rank). Immutable once published; same-skill only.';

create or replace function private.world_life_tree_node_guard_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE'
     or (new.node_id,new.skill_id,new.sp_cost,new.required_life_level,new.required_skill_level,new.max_rank)
        is distinct from
        (old.node_id,old.skill_id,old.sp_cost,old.required_life_level,old.required_skill_level,old.max_rank) then
    raise exception 'LIFE_TREE_DEFINITION_IMMUTABLE' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function private.world_life_tree_node_guard_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_tree_node_guard on private.world_life_skill_tree_catalog;
create trigger world_life_tree_node_guard
  before update or delete on private.world_life_skill_tree_catalog
  for each row execute function private.world_life_tree_node_guard_v1();

create or replace function private.world_life_tree_edge_validate_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_node private.world_life_skill_tree_catalog%rowtype;
  v_prerequisite private.world_life_skill_tree_catalog%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'LIFE_TREE_DEFINITION_IMMUTABLE' using errcode = '42501';
  end if;
  select * into strict v_node
    from private.world_life_skill_tree_catalog n where n.node_id = new.node_id;
  select * into strict v_prerequisite
    from private.world_life_skill_tree_catalog n where n.node_id = new.prerequisite_node_id;
  if v_node.skill_id <> v_prerequisite.skill_id
     or new.required_rank > v_prerequisite.max_rank then
    raise exception 'LIFE_TREE_EDGE_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.world_life_tree_edge_validate_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_tree_edge_validate on private.world_life_skill_tree_edges;
create trigger world_life_tree_edge_validate
  before insert or update or delete on private.world_life_skill_tree_edges
  for each row execute function private.world_life_tree_edge_validate_v1();

-- ---- 2. player state: one append-only row per acquired rank ----
alter table private.world_player_life_nodes
  add column if not exists rank integer not null default 1 check (rank >= 1);
alter table private.world_player_life_nodes
  drop constraint world_player_life_nodes_pkey;
alter table private.world_player_life_nodes
  add constraint world_player_life_nodes_pkey primary key (user_id,node_id,rank);
comment on table private.world_player_life_nodes is
  'Append-only Life Skill Tree ranks acquired by each account. Current rank = highest acquired rank.';

alter table private.world_life_sp_transactions
  add column if not exists rank integer not null check (rank >= 1);
comment on column private.world_life_sp_transactions.rank is
  'Node rank this spend acquired.';

-- ---- 3. reads ----
create or replace function private.world_life_node_rank_v1(p_user uuid, p_node_id text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(max(p.rank),0)::integer
    from private.world_player_life_nodes p
   where p.user_id = p_user and p.node_id = p_node_id;
$$;
revoke all on function private.world_life_node_rank_v1(uuid,text)
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

-- ---- 4. acquire the next rank ----
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

  -- Exact replay returns the committed rank, even if the node was disabled afterwards.
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
    user_id,skill_id,node_id,rank,sp_cost,sp_before,sp_after,idempotency_key)
  values (
    p_user,v_node.skill_id,p_node_id,v_rank_before + 1,v_node.sp_cost,v_available,
    v_available-v_node.sp_cost,p_idempotency_key)
  returning * into v_tx;

  insert into private.world_player_life_nodes(user_id,node_id,rank,transaction_id)
  values (p_user,p_node_id,v_tx.rank,v_tx.transaction_id);

  return jsonb_build_object(
    'status','SUCCESS',
    'transactionId',v_tx.transaction_id,
    'nodeId',v_tx.node_id,
    'skillId',v_tx.skill_id,
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
