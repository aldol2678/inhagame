-- INHA WORLD Activity Settlement P0 (Authority Map section 7.4).
--
-- The single server-side settlement path for outcome-dependent outputs of a verified Activity result:
-- - Keyed by the Activity attempt and its server-produced result_ref; one immutable receipt per attempt.
-- - The output plan is computed by the activity's server resolver from its frozen terminal outcome.
--   Callers are reviewed server-only domain adapters (test 93); no client role can reach it.
-- - Inventory grant, Collection discovery and Life Skill XP commit together with the receipt, or
--   not at all. A rollback leaves the committed Activity outcome untouched for an explicit retry.
-- - Replay with the same plan returns the stored receipt; a different plan for the same attempt fails.

create table private.world_activity_settlements (
  attempt_id uuid primary key
    references private.world_activity_attempts(attempt_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  activity_id text not null,
  result_ref text not null unique,
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  receipt jsonb not null check (jsonb_typeof(receipt) = 'object'),
  settled_at timestamptz not null default now()
);
comment on table private.world_activity_settlements is
  'Append-only settlement receipt per verified Activity result (Authority Map 7.4).';
create index world_activity_settlements_user_idx
  on private.world_activity_settlements(user_id,settled_at desc);

alter table private.world_activity_settlements enable row level security;
revoke all on table private.world_activity_settlements
  from public, anon, authenticated, service_role;

create function private.world_activity_settlement_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Account deletion cascades remove the account's whole history; nothing else may delete a receipt.
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;
  end if;
  raise exception 'ACTIVITY_SETTLEMENT_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_activity_settlement_append_only_v1()
  from public, anon, authenticated, service_role;

create trigger world_activity_settlement_append_only
  before update or delete on private.world_activity_settlements
  for each row execute function private.world_activity_settlement_append_only_v1();

-- Plan shape: {"items":[{"itemId","quantity"}],"discoveries":[{"entryId"}],"lifeXp":[{"skillId","amount"}]}.
-- Ids are validated again by each owning primitive; this check bounds the shape only.
create function private.world_activity_settlement_plan_validate_v1(p_plan jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_entry jsonb;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object'
     or (select array_agg(k order by k) from jsonb_object_keys(p_plan) k)
        is distinct from array['discoveries','items','lifeXp']
     or jsonb_typeof(p_plan->'items') <> 'array'
     or jsonb_typeof(p_plan->'discoveries') <> 'array'
     or jsonb_typeof(p_plan->'lifeXp') <> 'array'
     or jsonb_array_length(p_plan->'items') > 8
     or jsonb_array_length(p_plan->'discoveries') > 8
     or jsonb_array_length(p_plan->'lifeXp') > 8 then
    raise exception 'SETTLEMENT_PLAN_INVALID' using errcode = '22023';
  end if;

  for v_entry in select e from jsonb_array_elements(p_plan->'items') e loop
    if jsonb_typeof(v_entry) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(v_entry) k)
          is distinct from array['itemId','quantity']
       or jsonb_typeof(v_entry->'itemId') <> 'string'
       or v_entry->>'itemId' !~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$'
       or jsonb_typeof(v_entry->'quantity') <> 'number'
       or (v_entry->>'quantity')::numeric <> trunc((v_entry->>'quantity')::numeric)
       or (v_entry->>'quantity')::numeric not between 1 and 999 then
      raise exception 'SETTLEMENT_PLAN_INVALID' using errcode = '22023';
    end if;
  end loop;
  for v_entry in select e from jsonb_array_elements(p_plan->'discoveries') e loop
    if jsonb_typeof(v_entry) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(v_entry) k)
          is distinct from array['entryId']
       or jsonb_typeof(v_entry->'entryId') <> 'string'
       or v_entry->>'entryId' !~ '^collection\.[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,4}$' then
      raise exception 'SETTLEMENT_PLAN_INVALID' using errcode = '22023';
    end if;
  end loop;
  for v_entry in select e from jsonb_array_elements(p_plan->'lifeXp') e loop
    if jsonb_typeof(v_entry) <> 'object'
       or (select array_agg(k order by k) from jsonb_object_keys(v_entry) k)
          is distinct from array['amount','skillId']
       or jsonb_typeof(v_entry->'skillId') <> 'string'
       or v_entry->>'skillId' !~ '^life\.[a-z][a-z0-9_]*$'
       or jsonb_typeof(v_entry->'amount') <> 'number'
       or (v_entry->>'amount')::numeric <> trunc((v_entry->>'amount')::numeric)
       or (v_entry->>'amount')::numeric not between 1 and 1000000 then
      raise exception 'SETTLEMENT_PLAN_INVALID' using errcode = '22023';
    end if;
  end loop;

  if (select count(distinct e->>'itemId') from jsonb_array_elements(p_plan->'items') e)
       <> jsonb_array_length(p_plan->'items')
     or (select count(distinct e->>'entryId') from jsonb_array_elements(p_plan->'discoveries') e)
       <> jsonb_array_length(p_plan->'discoveries')
     or (select count(distinct e->>'skillId') from jsonb_array_elements(p_plan->'lifeXp') e)
       <> jsonb_array_length(p_plan->'lifeXp') then
    raise exception 'SETTLEMENT_PLAN_INVALID' using errcode = '22023';
  end if;
end;
$$;
revoke all on function private.world_activity_settlement_plan_validate_v1(jsonb)
  from public, anon, authenticated, service_role;

create function private.world_activity_settle_v1(
  p_user uuid,
  p_attempt_id uuid,
  p_plan jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_attempt private.world_activity_attempts%rowtype;
  v_existing private.world_activity_settlements%rowtype;
  v_entry jsonb;
  v_key text;
  v_child jsonb;
  v_items jsonb := '[]'::jsonb;
  v_discoveries jsonb := '[]'::jsonb;
  v_xp jsonb := '[]'::jsonb;
  v_receipt jsonb;
begin
  if p_attempt_id is null then
    raise exception 'INVALID_ATTEMPT_ID' using errcode = '22023';
  end if;
  perform private.world_activity_settlement_plan_validate_v1(p_plan);
  if private.world_activity_account_ok_v1(p_user) is not true then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('world_activity:' || p_user::text,0));

  select * into v_attempt
    from private.world_activity_attempts a
   where a.attempt_id = p_attempt_id
     and a.user_id = p_user
     for share;
  if not found then
    raise exception 'ATTEMPT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_existing
    from private.world_activity_settlements s
   where s.attempt_id = p_attempt_id;
  if found then
    if v_existing.plan is distinct from p_plan then
      raise exception 'SETTLEMENT_PLAN_CONFLICT' using errcode = '23505';
    end if;
    return jsonb_build_object('status','ALREADY_PROCESSED','receipt',v_existing.receipt);
  end if;

  if v_attempt.status <> 'SUCCEEDED' then
    raise exception 'ACTIVITY_NOT_SUCCEEDED' using errcode = 'P0001';
  end if;
  if v_attempt.result_ref is null or v_attempt.finalized_at is null then
    raise exception 'ACTIVITY_SUCCESS_PROVENANCE_INVALID' using errcode = 'P0001';
  end if;

  for v_entry in select e from jsonb_array_elements(p_plan->'items') e loop
    v_key := 'activity_settle:' || p_attempt_id::text || '/item/' || (v_entry->>'itemId');
    v_child := private.world_inventory_grant_v1(
      p_user,v_entry->>'itemId',(v_entry->>'quantity')::integer,'ACTIVITY',
      v_attempt.result_ref,v_key,null,
      jsonb_build_object('activityAttemptId',p_attempt_id,'activityId',v_attempt.activity_id));
    if v_child->>'originalStatus' is distinct from 'GRANTED' then
      raise exception 'OUTPUT_UNAVAILABLE' using errcode = 'P0001';
    end if;
    v_items := v_items || jsonb_build_array(v_child);
  end loop;

  for v_entry in select e from jsonb_array_elements(p_plan->'discoveries') e loop
    v_key := 'activity_settle:' || p_attempt_id::text || '/discovery/' || (v_entry->>'entryId');
    v_child := private.world_collection_discover_v1(
      p_user,v_entry->>'entryId','ACTIVITY',v_attempt.activity_id,v_attempt.result_ref,v_key,null);
    v_discoveries := v_discoveries || jsonb_build_array(v_child);
  end loop;

  for v_entry in select e from jsonb_array_elements(p_plan->'lifeXp') e loop
    v_key := 'activity_settle:' || p_attempt_id::text || '/xp/' || (v_entry->>'skillId');
    v_child := private.world_life_skill_xp_apply_v1(
      p_user,v_entry->>'skillId',(v_entry->>'amount')::bigint,'activity',v_attempt.result_ref,v_key);
    v_xp := v_xp || jsonb_build_array(v_child);
  end loop;

  v_receipt := jsonb_build_object(
    'attemptId',p_attempt_id,
    'activityId',v_attempt.activity_id,
    'resultRef',v_attempt.result_ref,
    'items',v_items,
    'discoveries',v_discoveries,
    'lifeXp',v_xp);

  insert into private.world_activity_settlements(
    attempt_id,user_id,activity_id,result_ref,plan,receipt)
  values (
    p_attempt_id,p_user,v_attempt.activity_id,v_attempt.result_ref,p_plan,v_receipt);

  return jsonb_build_object('status','SETTLED','receipt',v_receipt);
end;
$$;
revoke all on function private.world_activity_settle_v1(uuid,uuid,jsonb)
  from public, anon, authenticated, service_role;
