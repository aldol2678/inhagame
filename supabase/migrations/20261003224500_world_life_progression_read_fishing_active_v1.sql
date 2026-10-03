-- INHA WORLD Life Progression read-model + first active Life Skill Tree.
--
-- Adds authenticated self-only read RPCs for aggregate Life progression and tree details.
-- Fishing is the first ACTIVE Life Skill Tree. The underlying life.fishing skill remains
-- COMING_SOON until its per-skill XP curve / activity settlement is tuned separately.

create or replace function private.world_life_skill_tree_snapshot_v1(
  p_user uuid,
  p_tree_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_tree private.world_life_skill_tree_catalog%rowtype;
  v_progress jsonb;
  v_life_level integer;
  v_balance integer;
  v_nodes jsonb;
  v_spent integer := 0;
  v_node_count integer := 0;
begin
  if p_tree_id is null
     or p_tree_id !~ '^life_tree\.[a-z][a-z0-9_]*$'
     or char_length(p_tree_id) > 100 then
    raise exception 'INVALID_LIFE_SKILL_TREE' using errcode = '22023';
  end if;
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  select * into v_tree
    from private.world_life_skill_tree_catalog t
   where t.tree_id=p_tree_id;
  if not found or v_tree.status='HIDDEN' then
    raise exception 'LIFE_SKILL_TREE_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_progress := private.world_life_progression_snapshot_v1(p_user);
  v_life_level := (v_progress->>'level')::integer;
  v_balance := (v_progress->>'skillPointsBalance')::integer;

  with node_rows as (
    select
      n.*,
      coalesce(p.rank,0) as player_rank,
      case when n.required_skill_id is null then null
           else (private.world_life_skill_snapshot_v1(p_user,n.required_skill_id)->>'level')::integer
      end as player_skill_level,
      exists (
        select 1
          from private.world_life_skill_node_prerequisites e
          left join private.world_player_life_skill_nodes pp
            on pp.user_id=p_user and pp.node_id=e.prerequisite_node_id
         where e.node_id=n.node_id
           and coalesce(pp.rank,0) < e.required_rank
      ) as prerequisite_blocked
    from private.world_life_skill_nodes n
    left join private.world_player_life_skill_nodes p
      on p.user_id=p_user and p.node_id=n.node_id
    where n.tree_id=p_tree_id
  )
  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'nodeId',r.node_id,
        'treeId',r.tree_id,
        'maxRank',r.max_rank,
        'pointCost',r.point_cost,
        'requiredLifeLevel',r.required_life_level,
        'requiredSkillId',r.required_skill_id,
        'requiredSkillLevel',r.required_skill_level,
        'effectKey',r.effect_key,
        'status',r.status,
        'definitionVersion',r.definition_version,
        'rank',r.player_rank,
        'canRankUp',(
          v_tree.status='ACTIVE'
          and r.status='ACTIVE'
          and r.player_rank < r.max_rank
          and v_life_level >= r.required_life_level
          and (r.required_skill_id is null or r.player_skill_level >= r.required_skill_level)
          and not r.prerequisite_blocked
          and v_balance >= r.point_cost
        ),
        'unavailableReason',case
          when v_tree.status <> 'ACTIVE' or r.status <> 'ACTIVE' then 'INACTIVE'
          when r.player_rank >= r.max_rank then 'MAX_RANK'
          when v_life_level < r.required_life_level then 'LIFE_LEVEL_REQUIRED'
          when r.required_skill_id is not null and r.player_skill_level < r.required_skill_level then 'LIFE_SKILL_LEVEL_REQUIRED'
          when r.prerequisite_blocked then 'PREREQUISITE_REQUIRED'
          when v_balance < r.point_cost then 'INSUFFICIENT_SP'
          else null
        end,
        'prerequisites',coalesce((
          select jsonb_agg(jsonb_build_object(
            'nodeId',e.prerequisite_node_id,
            'requiredRank',e.required_rank,
            'currentRank',coalesce(pp.rank,0)
          ) order by e.prerequisite_node_id)
          from private.world_life_skill_node_prerequisites e
          left join private.world_player_life_skill_nodes pp
            on pp.user_id=p_user and pp.node_id=e.prerequisite_node_id
          where e.node_id=r.node_id
        ),'[]'::jsonb)
      )
      order by r.required_life_level,r.node_id
    ),'[]'::jsonb),
    coalesce(sum(r.player_rank*r.point_cost),0)::integer,
    count(*)::integer
  into v_nodes,v_spent,v_node_count
  from node_rows r;

  return jsonb_build_object(
    'treeId',v_tree.tree_id,
    'skillId',v_tree.skill_id,
    'status',v_tree.status,
    'definitionVersion',v_tree.definition_version,
    'spentPoints',v_spent,
    'nodeCount',v_node_count,
    'canReset',v_spent > 0,
    'nodes',v_nodes
  );
end;
$$;
revoke all on function private.world_life_skill_tree_snapshot_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_progression_dashboard_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_progress jsonb;
  v_trees jsonb;
begin
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;

  v_progress := private.world_life_progression_snapshot_v1(p_user);

  select coalesce(jsonb_agg(jsonb_build_object(
    'treeId',t.tree_id,
    'skillId',t.skill_id,
    'status',t.status,
    'definitionVersion',t.definition_version,
    'nodeCount',(select count(*)::integer from private.world_life_skill_nodes n where n.tree_id=t.tree_id),
    'spentPoints',coalesce((
      select sum(p.rank*n.point_cost)::integer
      from private.world_player_life_skill_nodes p
      join private.world_life_skill_nodes n on n.node_id=p.node_id
      where p.user_id=p_user and n.tree_id=t.tree_id
    ),0)
  ) order by t.tree_id),'[]'::jsonb)
    into v_trees
    from private.world_life_skill_tree_catalog t
   where t.status <> 'HIDDEN'
     and exists (select 1 from private.world_life_skill_nodes n where n.tree_id=t.tree_id);

  return v_progress || jsonb_build_object('trees',v_trees);
end;
$$;
revoke all on function private.world_life_progression_dashboard_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_my_world_life_progression_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.world_life_progression_caller_v1();
begin
  return private.world_life_progression_dashboard_v1(v_uid);
end;
$$;

create or replace function public.get_my_world_life_skill_tree_v1(p_tree_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.world_life_progression_caller_v1();
begin
  return private.world_life_skill_tree_snapshot_v1(v_uid,p_tree_id);
end;
$$;

revoke all on function public.get_my_world_life_progression_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.get_my_world_life_skill_tree_v1(text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_world_life_progression_v1() to authenticated;
grant execute on function public.get_my_world_life_skill_tree_v1(text) to authenticated;

comment on function public.get_my_world_life_progression_v1() is
  'Authenticated self-only aggregate Life progression + available tree summaries.';
comment on function public.get_my_world_life_skill_tree_v1(text) is
  'Authenticated self-only Life Skill Tree read model with server-derived rank-up availability.';

-- First live specialization: Fishing tree only.
update private.world_life_skill_tree_catalog
   set status='ACTIVE'
 where tree_id='life_tree.fishing'
   and status='COMING_SOON';

update private.world_life_skill_nodes
   set status='ACTIVE'
 where tree_id='life_tree.fishing'
   and status='COMING_SOON';
