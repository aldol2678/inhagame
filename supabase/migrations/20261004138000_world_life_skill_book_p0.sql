-- INHA WORLD Life Skill Book P0: player-facing, self-only Life Skill reads and actions.
--
-- - Caller = auth.uid() of a permanent, non-banned account. No function takes a user id, an SP amount,
--   a rank or a cost. The server decides every outcome; the client only renders server views.
-- - Only ACTIVE skills and ACTIVE nodes are visible. An unknown and a hidden skill / node look the
--   same to the player (LIFE_SKILL_NOT_FOUND / LIFE_NODE_NOT_FOUND).
-- - The tree view carries the server's own unlock / reset decision per node (canUnlock, lockReason,
--   nextRankCost) and for the tree (canReset, resetBlockedBy, nextResetAt). The actions re-check
--   everything through the existing primitives; the view is a hint, never an authority.
-- - Actions take a client request id (uuid). The idempotency key is derived from it on the server,
--   so a lost response is retried with the same id and returns the committed result.
-- Nothing is activated here: with every skill COMING_SOON the book is empty.

-- ---- caller ----
create or replace function private.world_life_caller_v1()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, true) then
    raise exception 'PERMANENT_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  if not private.world_life_skill_account_ok_v1(v_uid) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function private.world_life_caller_v1()
  from public, anon, authenticated, service_role;

-- ---- views ----
create or replace function private.world_life_book_skill_view_v1(p_user uuid, p_skill_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_skill jsonb := private.world_life_skill_snapshot_v1(p_user,p_skill_id);
  v_sp jsonb := private.world_life_skill_sp_snapshot_v1(p_user,p_skill_id);
begin
  return jsonb_build_object(
    'skillId',p_skill_id,
    'level',v_skill->'level',
    'totalXp',v_skill->'totalXp',
    'currentLevelStartXp',v_skill->'currentLevelStartXp',
    'nextLevelXp',v_skill->'nextLevelXp',
    'maxDefinedLevel',v_skill->'maxDefinedLevel',
    'isMaxLevel',v_skill->'isMaxLevel',
    'sp',jsonb_build_object(
      'earned',v_sp->'earnedSp',
      'spent',v_sp->'spentSp',
      'available',v_sp->'availableSp',
      'nextLevelEarned',v_sp->'nextLevelEarnedSp'
    )
  );
end;
$$;
revoke all on function private.world_life_book_skill_view_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_book_tree_view_v1(p_user uuid, p_skill_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_skill jsonb := private.world_life_book_skill_view_v1(p_user,p_skill_id);
  v_reset jsonb := private.world_life_tree_reset_state_v1(p_user,p_skill_id);
  v_life_level integer := (private.world_life_progression_snapshot_v1(p_user)->>'level')::integer;
  v_skill_level integer := (v_skill->>'level')::integer;
  v_available integer := (v_skill->'sp'->>'available')::integer;
  v_spent integer := (v_skill->'sp'->>'spent')::integer;
  v_nodes jsonb;
begin
  -- Same order of checks as world_life_node_unlock_v1, so the hint matches the authority.
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'nodeId',x.node_id,
             'rank',x.rank,
             'maxRank',x.max_rank,
             'nextRankCost',case when x.rank >= x.max_rank then null else x.sp_cost end,
             'requiredSkillLevel',x.required_skill_level,
             'prerequisites',x.prerequisites,
             'canUnlock',x.lock_reason is null,
             'lockReason',x.lock_reason)
           order by x.node_id),'[]'::jsonb)
    into v_nodes
    from (
      select n.node_id,n.max_rank,n.sp_cost,n.required_skill_level,r.rank,p.prerequisites,
             case
               when r.rank >= n.max_rank then 'MAX_RANK'
               when not p.all_met then 'PREREQUISITE'
               when v_life_level < n.required_life_level then 'LIFE_LEVEL'
               when v_skill_level < n.required_skill_level then 'SKILL_LEVEL'
               when v_available < n.sp_cost then 'SP'
               else null
             end as lock_reason
        from private.world_life_skill_tree_catalog n
        cross join lateral (
          select private.world_life_node_rank_v1(p_user,n.node_id) as rank
        ) r
        cross join lateral (
          select coalesce(jsonb_agg(jsonb_build_object(
                   'nodeId',e.prerequisite_node_id,
                   'requiredRank',e.required_rank,
                   'visible',pn.status = 'ACTIVE',
                   'met',private.world_life_node_rank_v1(p_user,e.prerequisite_node_id) >= e.required_rank)
                   order by e.prerequisite_node_id),'[]'::jsonb) as prerequisites,
                 coalesce(bool_and(private.world_life_node_rank_v1(p_user,e.prerequisite_node_id) >= e.required_rank),true)
                   as all_met
            from private.world_life_skill_tree_edges e
            join private.world_life_skill_tree_catalog pn on pn.node_id = e.prerequisite_node_id
           where e.node_id = n.node_id
        ) p
       where n.skill_id = p_skill_id
         and n.status = 'ACTIVE'
    ) x;

  return jsonb_build_object(
    'skill',v_skill,
    'reset',jsonb_build_object(
      'cost',0,
      'cooldownSeconds',v_reset->'cooldownSeconds',
      'lastResetAt',v_reset->'lastResetAt',
      'nextResetAt',v_reset->'nextResetAt',
      'canReset',v_spent > 0 and v_reset->>'nextResetAt' is null,
      'resetBlockedBy',case
        when v_spent = 0 then 'EMPTY'
        when v_reset->>'nextResetAt' is not null then 'COOLDOWN'
        else null end
    ),
    'nodes',v_nodes
  );
end;
$$;
revoke all on function private.world_life_book_tree_view_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_book_visible_skill_v1(p_skill_id text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_skill_id is null or not exists (
    select 1 from private.world_life_skill_catalog s
     where s.skill_id = p_skill_id and s.status = 'ACTIVE'
  ) then
    raise exception 'LIFE_SKILL_NOT_FOUND' using errcode = 'P0002';
  end if;
end;
$$;
revoke all on function private.world_life_book_visible_skill_v1(text)
  from public, anon, authenticated, service_role;

-- ---- self-only reads ----
create or replace function public.get_my_world_life_skills_v1()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.world_life_caller_v1();
  v_life jsonb := private.world_life_progression_snapshot_v1(v_user);
begin
  return jsonb_build_object(
    'lifeLevel',jsonb_build_object('level',v_life->'level','totalSkillXp',v_life->'totalSkillXp'),
    'skills',coalesce((
      select jsonb_agg(private.world_life_book_skill_view_v1(v_user,s.skill_id) order by s.skill_id)
        from private.world_life_skill_catalog s
       where s.status = 'ACTIVE'
    ),'[]'::jsonb)
  );
end;
$$;

create or replace function public.get_my_world_life_skill_tree_v1(p_skill_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.world_life_caller_v1();
begin
  perform private.world_life_book_visible_skill_v1(p_skill_id);
  return private.world_life_book_tree_view_v1(v_user,p_skill_id);
end;
$$;

-- ---- self-only actions ----
create or replace function public.unlock_my_world_life_node_v1(p_node_id text, p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.world_life_caller_v1();
  v_key text;
  v_skill_id text;
  v_result jsonb;
begin
  if p_request_id is null then
    raise exception 'INVALID_REQUEST_ID' using errcode = '22023';
  end if;
  v_key := 'life.unlock:' || v_user::text || ':' || p_request_id::text;

  -- A committed request replays even if the node was hidden afterwards.
  select t.skill_id into v_skill_id
    from private.world_life_sp_transactions t
   where t.idempotency_key = v_key;
  if not found then
    select n.skill_id into v_skill_id
      from private.world_life_skill_tree_catalog n
      join private.world_life_skill_catalog s on s.skill_id = n.skill_id
     where n.node_id = p_node_id and n.status = 'ACTIVE' and s.status = 'ACTIVE';
    if not found then
      raise exception 'LIFE_NODE_NOT_FOUND' using errcode = 'P0002';
    end if;
  end if;

  v_result := private.world_life_node_unlock_v1(v_user,p_node_id,v_key);
  return jsonb_build_object(
    'status',v_result->'status',
    'nodeId',v_result->'nodeId',
    'skillId',v_skill_id,
    'rankAfter',v_result->'rankAfter',
    'tree',private.world_life_book_tree_view_v1(v_user,v_skill_id)
  );
end;
$$;

create or replace function public.reset_my_world_life_tree_v1(p_skill_id text, p_request_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_user uuid := private.world_life_caller_v1();
  v_key text;
  v_result jsonb;
begin
  if p_request_id is null then
    raise exception 'INVALID_REQUEST_ID' using errcode = '22023';
  end if;
  v_key := 'life.reset:' || v_user::text || ':' || p_request_id::text;

  if not exists (select 1 from private.world_life_tree_resets r where r.idempotency_key = v_key) then
    perform private.world_life_book_visible_skill_v1(p_skill_id);
  end if;

  v_result := private.world_life_tree_reset_v1(v_user,p_skill_id,v_key);
  return jsonb_build_object(
    'status',v_result->'status',
    'skillId',p_skill_id,
    'refundedSp',v_result->'refundedSp',
    'tree',private.world_life_book_tree_view_v1(v_user,p_skill_id)
  );
end;
$$;

revoke execute on function public.get_my_world_life_skills_v1()
  from public, anon, authenticated, service_role;
revoke execute on function public.get_my_world_life_skill_tree_v1(text)
  from public, anon, authenticated, service_role;
revoke execute on function public.unlock_my_world_life_node_v1(text,uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.reset_my_world_life_tree_v1(text,uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_my_world_life_skills_v1() to authenticated;
grant execute on function public.get_my_world_life_skill_tree_v1(text) to authenticated;
grant execute on function public.unlock_my_world_life_node_v1(text,uuid) to authenticated;
grant execute on function public.reset_my_world_life_tree_v1(text,uuid) to authenticated;
