-- INHA WORLD Building 5 authoritative Combat P4.
-- First live deterministic resolver + atomic first-clear Reward settlement.
-- Browser inputs: action identity + UUID idempotency only. HP/damage/BREAK/result/reward remain server-owned.

-- Reward source vocabulary: Combat settlement is now a reviewed Reward source.
alter table private.world_reward_transactions
  drop constraint if exists world_reward_transactions_source_type_check;
alter table private.world_reward_transactions
  add constraint world_reward_transactions_source_type_check
  check (source_type in (
    'QUEST','EXPLORATION','ACHIEVEMENT','EVENT','MINIGAME','COMBAT',
    'INHAGAME_REWARD','SYSTEM','ADMIN'
  ));

CREATE OR REPLACE FUNCTION private.world_reward_grant_v1(p_user uuid, p_reward_id text, p_source_type text, p_source_id text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_def private.world_reward_definitions%rowtype;
  v_tx private.world_reward_transactions%rowtype;
  v_entry private.world_reward_transaction_entries%rowtype;
  v_child jsonb;
  v_child_status text;
  v_status text;
  v_granted bigint;
  v_reason text;
  v_child_tx text;
  v_final text;
begin
  -- Structural preflight: nothing is written if any of these fail.
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in (
       'QUEST', 'EXPLORATION', 'ACHIEVEMENT', 'EVENT', 'MINIGAME', 'COMBAT', 'INHAGAME_REWARD', 'SYSTEM', 'ADMIN')
     or p_source_id is null or char_length(p_source_id) not between 1 and 200 then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;
  if p_reward_id is null then
    raise exception 'UNKNOWN_REWARD' using errcode = '22023';
  end if;
  if not private.world_inventory_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  -- One reward execution per account at a time; a concurrent retry waits, then replays.
  perform pg_advisory_xact_lock(hashtextextended('world_reward:' || p_user::text, 0));

  select * into v_tx from private.world_reward_transactions t where t.idempotency_key = p_idempotency_key;
  if found then
    if (v_tx.user_id, v_tx.reward_id, v_tx.source_type, v_tx.source_id)
       is distinct from (p_user, p_reward_id, p_source_type, p_source_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    if v_tx.status <> 'FAILED' then
      return private.world_reward_result_v1(v_tx.reward_transaction_id, true);
    end if;
    -- Resume a FAILED execution from its own snapshot, not from today's definition.
    update private.world_reward_transactions t
       set attempts = t.attempts + 1, updated_at = now()
     where t.reward_transaction_id = v_tx.reward_transaction_id
    returning * into v_tx;
  else
    select * into v_def from private.world_reward_definitions d where d.reward_id = p_reward_id;
    if not found then
      raise exception 'UNKNOWN_REWARD' using errcode = '22023';
    end if;
    if v_def.status <> 'ACTIVE' then
      raise exception 'REWARD_INACTIVE' using errcode = 'P0001';
    end if;
    if not exists (select 1 from private.world_reward_grants g where g.reward_id = p_reward_id) then
      raise exception 'REWARD_EMPTY' using errcode = 'P0001';
    end if;
    if exists (select 1 from private.world_reward_grants g
                where g.reward_id = p_reward_id and g.grant_type not in ('CURRENCY', 'ITEM', 'EXP')) then
      raise exception 'REWARD_UNSUPPORTED_GRANT' using errcode = 'P0001';
    end if;

    begin
      -- Inserted as FAILED (not final) and settled below in this same transaction.
      insert into private.world_reward_transactions (
        user_id, reward_id, reward_version, event_id, source_type, source_id, idempotency_key, status)
      values (
        p_user, p_reward_id, v_def.version, v_def.event_id, p_source_type, p_source_id, p_idempotency_key, 'FAILED')
      returning * into v_tx;
    exception when unique_violation then
      -- Same-account retries are resolved above under the lock; this key belongs to another account.
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end;

    insert into private.world_reward_transaction_entries (
      reward_transaction_id, grant_entry_id, position, grant_type, target_id, requested,
      status, reason, child_idempotency_key)
    select v_tx.reward_transaction_id, g.grant_entry_id, g.position, g.grant_type, g.target_id, g.amount,
           'FAILED', 'NOT_ATTEMPTED', 'reward/' || p_idempotency_key || '/' || g.grant_entry_id
      from private.world_reward_grants g
     where g.reward_id = p_reward_id;
  end if;

  for v_entry in
    select * from private.world_reward_transaction_entries e
     where e.reward_transaction_id = v_tx.reward_transaction_id and e.status = 'FAILED'
     order by e.position
  loop
    begin
      if v_entry.grant_type = 'CURRENCY' then
        v_child := private.world_wallet_apply_v1(
          p_user, v_entry.target_id, v_entry.requested, 'REWARD', 'reward',
          v_tx.reward_id || ':' || v_tx.reward_transaction_id::text, v_entry.child_idempotency_key, null);
        v_status := 'GRANTED';
        v_granted := v_entry.requested;
        v_reason := null;
        v_child_tx := v_child ->> 'transactionId';
      elsif v_entry.grant_type = 'ITEM' then
        v_child := private.world_inventory_grant_v1(
          p_user, v_entry.target_id, v_entry.requested::integer, v_tx.source_type, v_tx.reward_id,
          v_entry.child_idempotency_key, v_tx.event_id,
          jsonb_build_object('rewardTransactionId', v_tx.reward_transaction_id, 'sourceId', v_tx.source_id));
        v_child_status := case when v_child ->> 'status' = 'ALREADY_PROCESSED'
                               then v_child ->> 'originalStatus' else v_child ->> 'status' end;
        -- Readback: the item must be owned now, whether granted here or already owned.
        if not exists (select 1 from private.world_player_items i
                        where i.user_id = p_user and i.item_id = v_entry.target_id) then
          raise exception 'ITEM_READBACK_FAILED';
        end if;
        if v_child_status = 'GRANTED' then
          v_status := 'GRANTED';
          v_granted := v_entry.requested;
          v_reason := null;
        else
          v_status := 'SKIPPED';
          v_granted := 0;
          v_reason := 'ALREADY_OWNED';
        end if;
        v_child_tx := v_child ->> 'grantId';

      elsif v_entry.grant_type = 'EXP' then
        v_child := private.world_exp_apply_v1(
          p_user,
          v_entry.requested,
          'reward',
          v_tx.reward_id || ':' || v_tx.reward_transaction_id::text || ':' || v_entry.grant_entry_id,
          v_entry.child_idempotency_key);
        v_child_status := v_child ->> 'status';
        if v_child_status is null
           or v_child_status not in ('SUCCESS', 'ALREADY_PROCESSED')
           or (v_child ->> 'amount')::bigint is distinct from v_entry.requested
           or v_child ->> 'transactionId' is null then
          raise exception 'EXP_READBACK_FAILED';
        end if;
        v_status := 'GRANTED';
        v_granted := v_entry.requested;
        v_reason := null;
        v_child_tx := v_child ->> 'transactionId';

      else
        -- Defensive only: COLLECTION is rejected by preflight before a transaction exists.
        raise exception 'REWARD_UNSUPPORTED_GRANT';
      end if;
    exception when others then
      -- The child call's own writes were rolled back with this subtransaction; siblings stand.
      v_status := 'FAILED';
      v_granted := 0;
      v_reason := left(sqlerrm, 200);
      v_child_tx := null;
    end;

    update private.world_reward_transaction_entries e
       set status = v_status, granted = v_granted, reason = v_reason,
           child_transaction_id = v_child_tx, attempts = e.attempts + 1, updated_at = now()
     where e.reward_transaction_id = v_entry.reward_transaction_id
       and e.grant_entry_id = v_entry.grant_entry_id;
  end loop;

  select case
           when bool_or(e.status = 'FAILED') then 'FAILED'
           when bool_or(e.status = 'SKIPPED') then 'PARTIAL_SUCCESS'
           else 'SUCCESS' end
    into v_final
    from private.world_reward_transaction_entries e
   where e.reward_transaction_id = v_tx.reward_transaction_id;

  update private.world_reward_transactions t
     set status = v_final, updated_at = now(),
         completed_at = case when v_final = 'FAILED' then null else now() end
   where t.reward_transaction_id = v_tx.reward_transaction_id;

  return private.world_reward_result_v1(v_tx.reward_transaction_id, false);
end;
$function$
;

-- First live Combat definition. The same row is mirrored by apps/world/src/combat/combat-contract.js.
insert into private.world_combat_definition_catalog(
  combat_id,category,availability,availability_ref,resolver_ref,status,
  definition_version,outcome_schema_version)
values(
  'combat.building5.training_drone','TRAINING','ACTIVE',
  'availability.building5.training','resolver.building5.training_drone',
  'ACTIVE',1,1)
on conflict (combat_id) do update set
  category=excluded.category,
  availability=excluded.availability,
  availability_ref=excluded.availability_ref,
  resolver_ref=excluded.resolver_ref,
  status=excluded.status,
  definition_version=excluded.definition_version,
  outcome_schema_version=excluded.outcome_schema_version;

-- Modest one-time onboarding reward, calibrated to the existing first-clear minigame reward.
insert into private.world_reward_definitions(reward_id,status,version,event_id,tags,description)
values(
  'reward.combat.building5_training_first_clear','ACTIVE',1,null,
  array['combat','training','first_clear'],
  '5호관 공명 훈련 드론 첫 클리어 보상')
on conflict (reward_id) do update set
  status=excluded.status,version=excluded.version,event_id=excluded.event_id,
  tags=excluded.tags,description=excluded.description;

insert into private.world_reward_grants(
  reward_id,grant_entry_id,position,grant_type,target_id,amount)
values(
  'reward.combat.building5_training_first_clear',
  'exp.campus',0,'EXP','exp.campus',50)
on conflict (reward_id,grant_entry_id) do update set
  position=excluded.position,grant_type=excluded.grant_type,
  target_id=excluded.target_id,amount=excluded.amount;

create table if not exists private.world_combat_settlement_catalog(
  combat_id text primary key
    references private.world_combat_definition_catalog(combat_id) on delete restrict,
  reward_id text
    references private.world_reward_definitions(reward_id) on delete restrict,
  reward_policy text not null check (reward_policy in ('NONE','FIRST_CLEAR','EACH_CLEAR')),
  status text not null check (status in ('ACTIVE','DISABLED')),
  version integer not null check (version >= 1)
);
comment on table private.world_combat_settlement_catalog is
  'Migration-owned mapping from verified Combat result to Reward orchestration policy.';

insert into private.world_combat_settlement_catalog(
  combat_id,reward_id,reward_policy,status,version)
values(
  'combat.building5.training_drone',
  'reward.combat.building5_training_first_clear',
  'FIRST_CLEAR','ACTIVE',1)
on conflict (combat_id) do update set
  reward_id=excluded.reward_id,reward_policy=excluded.reward_policy,
  status=excluded.status,version=excluded.version;

create table if not exists private.world_combat_action_receipts(
  encounter_id uuid not null
    references private.world_combat_encounters(encounter_id) on delete cascade,
  action_key uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  action_type text not null
    check (action_type in ('BASIC','ACTIVE_1','ACTIVE_2','ACTIVE_3','DODGE','ULTIMATE','SYNC','CANCEL')),
  response jsonb not null check (jsonb_typeof(response)='object'),
  created_at timestamptz not null default now(),
  primary key(encounter_id,action_key)
);
comment on table private.world_combat_action_receipts is
  'Idempotency receipt for server-resolved Combat actions. Browser never writes this table.';

create table if not exists private.world_combat_settlements(
  result_ref text primary key
    check (result_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  encounter_id uuid not null unique
    references private.world_combat_encounters(encounter_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  combat_id text not null
    references private.world_combat_definition_catalog(combat_id) on delete restrict,
  reward_id text references private.world_reward_definitions(reward_id) on delete restrict,
  reward_status text not null
    check (reward_status in ('NOT_CONFIGURED','INELIGIBLE_REPEAT','SUCCESS','PARTIAL_SUCCESS')),
  reward_result jsonb,
  created_at timestamptz not null default now()
);
comment on table private.world_combat_settlements is
  'One immutable settlement decision per server-verified Combat result_ref.';

alter table private.world_combat_settlement_catalog enable row level security;
alter table private.world_combat_action_receipts enable row level security;
alter table private.world_combat_settlements enable row level security;
revoke all on table private.world_combat_settlement_catalog,
  private.world_combat_action_receipts,private.world_combat_settlements
  from public,anon,authenticated,service_role;

create or replace function private.world_combat_building5_initial_state_v1()
returns jsonb
language sql
immutable
set search_path=''
as $$
  select jsonb_build_object(
    'schemaVersion',1,
    'elapsedMs',0,
    'build',jsonb_build_object(
      'jobId','blaster',
      'activeSkills',jsonb_build_array('accelerate','slide','barrage'),
      'ultimate','overdrive'),
    'player',jsonb_build_object(
      'hp',1000,'maxHp',1000,'momentum',0,'ultimateGauge',0,
      'rapidUntilMs',0,'overdriveUntilMs',0,
      'dodgeStartMs',null,'perfectUsed',false,'defeated',false),
    'enemy',jsonb_build_object(
      'hp',4200,'maxHp',4200,'breakValue',0,'breakMax',100,
      'brokenUntilMs',0,'defeated',false),
    'cooldownUntil',jsonb_build_object(
      'basic',0,'active_1',0,'active_2',0,'active_3',0,'dodge',0),
    'enemyAttack',jsonb_build_object(
      'nextWindupMs',1200,'windupMs',680,'damage',44,'engagementRange',5,'impactRadius',1.15),
    'lastAction',null
  )
$$;
revoke all on function private.world_combat_building5_initial_state_v1()
  from public,anon,authenticated,service_role;

create or replace function private.world_combat_building5_result_v1(
  p_encounter_id uuid)
returns jsonb
language sql
stable
set search_path=''
as $$
  select jsonb_build_object(
    'encounterId',e.encounter_id,
    'combatId',e.combat_id,
    'status',e.status,
    'resultRef',e.result_ref,
    'stateVersion',e.state_version,
    'state',e.state_payload,
    'startedAt',e.started_at,
    'finalizedAt',e.finalized_at,
    'settlement',case when s.result_ref is null then null else jsonb_build_object(
      'rewardStatus',s.reward_status,
      'rewardId',s.reward_id,
      'reward',s.reward_result
    ) end
  )
  from private.world_combat_encounters e
  left join private.world_combat_settlements s on s.encounter_id=e.encounter_id
  where e.encounter_id=p_encounter_id
$$;
revoke all on function private.world_combat_building5_result_v1(uuid)
  from public,anon,authenticated,service_role;

create or replace function private.world_combat_settle_v1(
  p_user uuid,
  p_encounter_id uuid,
  p_result_ref text)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_encounter private.world_combat_encounters%rowtype;
  v_catalog private.world_combat_settlement_catalog%rowtype;
  v_existing private.world_combat_settlements%rowtype;
  v_reward jsonb;
  v_status text;
  v_key text;
begin
  select * into v_existing
    from private.world_combat_settlements s
   where s.result_ref=p_result_ref;
  if found then
    if (v_existing.user_id,v_existing.encounter_id)
       is distinct from (p_user,p_encounter_id) then
      raise exception 'COMBAT_SETTLEMENT_CONFLICT' using errcode='23505';
    end if;
    return jsonb_build_object(
      'status','ALREADY_PROCESSED',
      'rewardStatus',v_existing.reward_status,
      'rewardId',v_existing.reward_id,
      'reward',v_existing.reward_result);
  end if;

  select * into v_encounter
    from private.world_combat_encounters e
   where e.encounter_id=p_encounter_id and e.user_id=p_user
   for update;
  if not found then
    raise exception 'COMBAT_ENCOUNTER_NOT_FOUND' using errcode='P0002';
  end if;
  if v_encounter.status <> 'SUCCEEDED'
     or v_encounter.result_ref is distinct from p_result_ref
     or v_encounter.finalized_at is null then
    raise exception 'COMBAT_RESULT_NOT_SETTLEABLE' using errcode='P0001';
  end if;

  select * into v_catalog
    from private.world_combat_settlement_catalog c
   where c.combat_id=v_encounter.combat_id and c.status='ACTIVE';

  if not found or v_catalog.reward_policy='NONE' or v_catalog.reward_id is null then
    insert into private.world_combat_settlements(
      result_ref,encounter_id,user_id,combat_id,reward_id,reward_status,reward_result)
    values(p_result_ref,p_encounter_id,p_user,v_encounter.combat_id,null,'NOT_CONFIGURED',null);
    return jsonb_build_object('status','SUCCESS','rewardStatus','NOT_CONFIGURED');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'world_combat_settlement:'||p_user::text||':'||v_encounter.combat_id,0));

  if v_catalog.reward_policy='FIRST_CLEAR' and exists(
    select 1 from private.world_combat_settlements s
     where s.user_id=p_user and s.combat_id=v_encounter.combat_id
       and s.reward_id=v_catalog.reward_id
       and s.reward_status in ('SUCCESS','PARTIAL_SUCCESS')
  ) then
    insert into private.world_combat_settlements(
      result_ref,encounter_id,user_id,combat_id,reward_id,reward_status,reward_result)
    values(p_result_ref,p_encounter_id,p_user,v_encounter.combat_id,
      v_catalog.reward_id,'INELIGIBLE_REPEAT',null);
    return jsonb_build_object(
      'status','SUCCESS','rewardStatus','INELIGIBLE_REPEAT',
      'rewardId',v_catalog.reward_id);
  end if;

  v_key := case
    when v_catalog.reward_policy='FIRST_CLEAR'
      then 'combat:first-clear:'||p_user::text||':'||v_encounter.combat_id
    else 'combat:'||p_result_ref
  end;

  v_reward := private.world_reward_grant_v1(
    p_user,v_catalog.reward_id,'COMBAT',v_encounter.combat_id,v_key);
  v_status := v_reward->>'status';
  if v_status not in ('SUCCESS','PARTIAL_SUCCESS') then
    raise exception 'COMBAT_REWARD_SETTLEMENT_FAILED' using errcode='P0001';
  end if;

  insert into private.world_combat_settlements(
    result_ref,encounter_id,user_id,combat_id,reward_id,reward_status,reward_result)
  values(p_result_ref,p_encounter_id,p_user,v_encounter.combat_id,
    v_catalog.reward_id,v_status,v_reward);

  return jsonb_build_object(
    'status','SUCCESS','rewardStatus',v_status,
    'rewardId',v_catalog.reward_id,'reward',v_reward);
end;
$$;
revoke all on function private.world_combat_settle_v1(uuid,uuid,text)
  from public,anon,authenticated,service_role;

create or replace function private.world_combat_building5_start_v1(
  p_user uuid,
  p_client_encounter_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_start jsonb;
  v_encounter_id uuid;
begin
  v_start := private.world_combat_start_with_creature_v1(
    p_user,
    'combat.building5.training_drone',
    'combat.building5.training_gate',
    p_client_encounter_key,
    1,1,
    private.world_combat_building5_initial_state_v1());

  v_encounter_id := nullif(v_start->'combat'->'encounter'->>'encounterId','')::uuid;
  if v_encounter_id is null then
    raise exception 'COMBAT_START_RESULT_INVALID' using errcode='P0001';
  end if;

  return jsonb_build_object(
    'status','SUCCESS',
    'encounter',private.world_combat_building5_result_v1(v_encounter_id));
end;
$$;
revoke all on function private.world_combat_building5_start_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.world_combat_building5_snapshot_v1(
  p_user uuid,
  p_encounter_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_encounter private.world_combat_encounters%rowtype;
begin
  if not private.world_combat_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode='22023';
  end if;
  select * into v_encounter from private.world_combat_encounters e
   where e.encounter_id=p_encounter_id and e.user_id=p_user;
  if not found or v_encounter.combat_id <> 'combat.building5.training_drone' then
    raise exception 'COMBAT_ENCOUNTER_NOT_FOUND' using errcode='P0002';
  end if;
  return jsonb_build_object(
    'status','SUCCESS',
    'encounter',private.world_combat_building5_result_v1(p_encounter_id));
end;
$$;
revoke all on function private.world_combat_building5_snapshot_v1(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function private.world_combat_building5_action_v1(
  p_user uuid,
  p_encounter_id uuid,
  p_action text,
  p_action_key uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path=''
as $$
declare
  v_encounter private.world_combat_encounters%rowtype;
  v_receipt private.world_combat_action_receipts%rowtype;
  v_state jsonb;
  v_elapsed bigint;
  v_player_hp integer;
  v_enemy_hp integer;
  v_break integer;
  v_broken_until bigint;
  v_momentum integer;
  v_ult numeric;
  v_dodge_start bigint;
  v_perfect_used boolean;
  v_rapid_until bigint;
  v_overdrive_until bigint;
  v_cdbasic bigint;
  v_cd1 bigint;
  v_cd2 bigint;
  v_cd3 bigint;
  v_cdd bigint;
  v_next_windup bigint;
  v_impact bigint;
  v_delta bigint;
  v_damage integer := 0;
  v_break_add integer := 0;
  v_momentum_add integer := 0;
  v_ult_add numeric := 0;
  v_active_skill boolean := false;
  v_accepted boolean := true;
  v_reason text := null;
  v_result_ref text := null;
  v_finalize jsonb := null;
  v_settlement jsonb := null;
  v_response jsonb;
begin
  if p_action not in ('BASIC','ACTIVE_1','ACTIVE_2','ACTIVE_3','DODGE','ULTIMATE','SYNC','CANCEL')
     or p_action_key is null then
    raise exception 'INVALID_COMBAT_ACTION' using errcode='22023';
  end if;
  if not private.world_combat_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode='22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'world_combat_action:'||p_encounter_id::text,0));

  select * into v_receipt
    from private.world_combat_action_receipts r
   where r.encounter_id=p_encounter_id and r.action_key=p_action_key;
  if found then
    if v_receipt.user_id <> p_user or v_receipt.action_type <> p_action then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode='23505';
    end if;
    return v_receipt.response;
  end if;

  select * into v_encounter
    from private.world_combat_encounters e
   where e.encounter_id=p_encounter_id and e.user_id=p_user
   for update;
  if not found or v_encounter.combat_id <> 'combat.building5.training_drone' then
    raise exception 'COMBAT_ENCOUNTER_NOT_FOUND' using errcode='P0002';
  end if;

  if v_encounter.status <> 'ACTIVE' then
    v_response := jsonb_build_object(
      'status','TERMINAL','accepted',false,'reason','ENCOUNTER_TERMINAL',
      'encounter',private.world_combat_building5_result_v1(p_encounter_id));
    insert into private.world_combat_action_receipts(
      encounter_id,action_key,user_id,action_type,response)
    values(p_encounter_id,p_action_key,p_user,p_action,v_response);
    return v_response;
  end if;

  if p_action='CANCEL' then
    v_finalize := private.world_combat_finalize_with_creature_v1(
      p_user,p_encounter_id,'CANCELLED',null);
    v_response := jsonb_build_object(
      'status','SUCCESS','accepted',true,'reason',null,
      'encounter',private.world_combat_building5_result_v1(p_encounter_id));
    insert into private.world_combat_action_receipts(
      encounter_id,action_key,user_id,action_type,response)
    values(p_encounter_id,p_action_key,p_user,p_action,v_response);
    return v_response;
  end if;

  v_state := v_encounter.state_payload;
  v_elapsed := greatest(0,floor(extract(epoch from (clock_timestamp()-v_encounter.started_at))*1000)::bigint);
  v_player_hp := coalesce((v_state#>>'{player,hp}')::integer,1000);
  v_enemy_hp := coalesce((v_state#>>'{enemy,hp}')::integer,4200);
  v_break := coalesce((v_state#>>'{enemy,breakValue}')::integer,0);
  v_broken_until := coalesce((v_state#>>'{enemy,brokenUntilMs}')::bigint,0);
  v_momentum := coalesce((v_state#>>'{player,momentum}')::integer,0);
  v_ult := coalesce((v_state#>>'{player,ultimateGauge}')::numeric,0);
  v_dodge_start := nullif(v_state#>>'{player,dodgeStartMs}','')::bigint;
  v_perfect_used := coalesce((v_state#>>'{player,perfectUsed}')::boolean,false);
  v_rapid_until := coalesce((v_state#>>'{player,rapidUntilMs}')::bigint,0);
  v_overdrive_until := coalesce((v_state#>>'{player,overdriveUntilMs}')::bigint,0);
  v_cdbasic := coalesce((v_state#>>'{cooldownUntil,basic}')::bigint,0);
  v_cd1 := coalesce((v_state#>>'{cooldownUntil,active_1}')::bigint,0);
  v_cd2 := coalesce((v_state#>>'{cooldownUntil,active_2}')::bigint,0);
  v_cd3 := coalesce((v_state#>>'{cooldownUntil,active_3}')::bigint,0);
  v_cdd := coalesce((v_state#>>'{cooldownUntil,dodge}')::bigint,0);
  v_next_windup := coalesce((v_state#>>'{enemyAttack,nextWindupMs}')::bigint,1200);

  -- Resolve every server-timed enemy impact due before this request.
  while v_player_hp > 0 and v_enemy_hp > 0
    and v_next_windup + 680 <= v_elapsed
  loop
    v_impact := v_next_windup + 680;
    if v_impact >= v_broken_until then
      if v_dodge_start is not null
         and v_impact-v_dodge_start between 70 and 230 then
        if not v_perfect_used and v_impact-v_dodge_start between 70 and 180 then
          v_perfect_used := true;
          v_momentum := least(100,v_momentum+20);
          v_cd1 := greatest(v_impact,v_cd1-1000);
          v_ult := least(100,v_ult+6);
        end if;
      else
        v_player_hp := greatest(0,v_player_hp-44);
      end if;
    end if;
    v_next_windup := v_impact + 2000;
  end loop;

  if v_player_hp <= 0 then
    v_state := jsonb_build_object(
      'schemaVersion',1,'elapsedMs',v_elapsed,
      'build',v_state->'build',
      'player',jsonb_build_object(
        'hp',0,'maxHp',1000,'momentum',v_momentum,'ultimateGauge',v_ult,
        'rapidUntilMs',v_rapid_until,'overdriveUntilMs',v_overdrive_until,
        'dodgeStartMs',v_dodge_start,'perfectUsed',v_perfect_used,'defeated',true),
      'enemy',jsonb_build_object(
        'hp',v_enemy_hp,'maxHp',4200,'breakValue',v_break,'breakMax',100,
        'brokenUntilMs',v_broken_until,'defeated',v_enemy_hp<=0),
      'cooldownUntil',jsonb_build_object(
        'basic',v_cdbasic,'active_1',v_cd1,'active_2',v_cd2,'active_3',v_cd3,'dodge',v_cdd),
      'enemyAttack',jsonb_build_object(
        'nextWindupMs',v_next_windup,'windupMs',680,'damage',44,
        'engagementRange',5,'impactRadius',1.15),
      'lastAction',jsonb_build_object('type','SERVER_ENEMY_IMPACT','atMs',v_elapsed));
    perform private.world_combat_state_write_v1(
      p_user,p_encounter_id,v_encounter.state_version,v_state);
    perform private.world_combat_finalize_with_creature_v1(
      p_user,p_encounter_id,'FAILED',null);
    v_response := jsonb_build_object(
      'status','SUCCESS','accepted',false,'reason','PLAYER_DEFEATED',
      'encounter',private.world_combat_building5_result_v1(p_encounter_id));
    insert into private.world_combat_action_receipts(
      encounter_id,action_key,user_id,action_type,response)
    values(p_encounter_id,p_action_key,p_user,p_action,v_response);
    return v_response;
  end if;

  if p_action='ACTIVE_1' then
    if v_elapsed < v_cd1 then v_accepted:=false; v_reason:='COOLDOWN';
    else
      v_cd1:=v_elapsed+6000; v_momentum_add:=15; v_ult_add:=2; v_active_skill:=true;
      v_rapid_until:=greatest(v_rapid_until,v_elapsed+4200);
    end if;
  elsif p_action='ACTIVE_2' then
    if v_elapsed < v_cd2 then v_accepted:=false; v_reason:='COOLDOWN';
    else v_cd2:=v_elapsed+5200; v_damage:=216; v_break_add:=12; v_momentum_add:=15;
      v_ult_add:=2 + (3*(72::numeric/260)); v_active_skill:=true; end if;
  elsif p_action='ACTIVE_3' then
    if v_elapsed < v_cd3 then v_accepted:=false; v_reason:='COOLDOWN';
    elsif v_momentum < 50 then v_accepted:=false; v_reason:='RESOURCE_REQUIRED';
    else v_cd3:=v_elapsed+10000; v_momentum:=v_momentum-50; v_damage:=546; v_break_add:=42;
      v_ult_add:=2 + (7*(78::numeric/260)); v_active_skill:=true; end if;
  elsif p_action='DODGE' then
    if v_elapsed < v_cdd then v_accepted:=false; v_reason:='COOLDOWN';
    else v_cdd:=v_elapsed+1200; v_dodge_start:=v_elapsed; v_perfect_used:=false; end if;
  elsif p_action='ULTIMATE' then
    if v_ult < 100 then v_accepted:=false; v_reason:='ULTIMATE_NOT_READY';
    else
      v_ult:=0; v_momentum:=100;
      v_rapid_until:=greatest(v_rapid_until,v_elapsed+8000);
      v_overdrive_until:=greatest(v_overdrive_until,v_elapsed+8000);
    end if;
  elsif p_action='BASIC' then
    if v_elapsed < v_cdbasic then
      v_accepted:=false; v_reason:='COOLDOWN';
    else
      v_cdbasic:=v_elapsed + case
        when v_elapsed < v_rapid_until then 145
        when v_momentum >= 70 then 180
        else 220
      end;
      v_damage:=case when v_momentum>=70 then 99 else 88 end;
      v_break_add:=4; v_momentum_add:=8;
      v_ult_add:=greatest(.12::numeric,v_damage::numeric/260);
    end if;
  end if;

  if v_accepted then
    v_momentum:=least(100,v_momentum+v_momentum_add);
    v_ult:=least(100,v_ult+v_ult_add);
    if v_damage>0 then
      v_enemy_hp:=greatest(0,v_enemy_hp-v_damage);
      v_break:=v_break+v_break_add;
      if v_enemy_hp>0 and v_break>=100 then
        v_break:=0;
        v_broken_until:=v_elapsed+1550;
        v_next_windup:=greatest(v_next_windup,v_elapsed+2000);
        v_ult:=least(100,v_ult+12);
      end if;
      if v_enemy_hp=0 then
        v_ult:=least(100,v_ult+3);
      end if;
    end if;
  end if;

  v_state := jsonb_build_object(
    'schemaVersion',1,'elapsedMs',v_elapsed,
    'build',v_state->'build',
    'player',jsonb_build_object(
      'hp',v_player_hp,'maxHp',1000,'momentum',v_momentum,'ultimateGauge',round(v_ult,4),
      'rapidUntilMs',v_rapid_until,'overdriveUntilMs',v_overdrive_until,
      'dodgeStartMs',v_dodge_start,'perfectUsed',v_perfect_used,'defeated',false),
    'enemy',jsonb_build_object(
      'hp',v_enemy_hp,'maxHp',4200,'breakValue',v_break,'breakMax',100,
      'brokenUntilMs',v_broken_until,'defeated',v_enemy_hp<=0),
    'cooldownUntil',jsonb_build_object(
      'basic',v_cdbasic,'active_1',v_cd1,'active_2',v_cd2,'active_3',v_cd3,'dodge',v_cdd),
    'enemyAttack',jsonb_build_object(
      'nextWindupMs',v_next_windup,'windupMs',680,'damage',44,
      'engagementRange',5,'impactRadius',1.15),
    'lastAction',jsonb_build_object(
      'type',p_action,'atMs',v_elapsed,'accepted',v_accepted,'reason',v_reason));

  perform private.world_combat_state_write_v1(
    p_user,p_encounter_id,v_encounter.state_version,v_state);

  if v_enemy_hp=0 then
    v_result_ref:='combat-result:'||p_encounter_id::text;
    v_finalize:=private.world_combat_finalize_with_creature_v1(
      p_user,p_encounter_id,'SUCCEEDED',v_result_ref);
    v_settlement:=private.world_combat_settle_v1(
      p_user,p_encounter_id,v_result_ref);
  end if;

  v_response:=jsonb_build_object(
    'status','SUCCESS','accepted',v_accepted,'reason',v_reason,
    'encounter',private.world_combat_building5_result_v1(p_encounter_id));

  insert into private.world_combat_action_receipts(
    encounter_id,action_key,user_id,action_type,response)
  values(p_encounter_id,p_action_key,p_user,p_action,v_response);

  return v_response;
end;
$$;
revoke all on function private.world_combat_building5_action_v1(uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.world_combat_building5_start_v1(
  p_user uuid,p_client_encounter_key uuid)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception 'SERVER_ONLY' using errcode='42501';
  end if;
  return private.world_combat_building5_start_v1(p_user,p_client_encounter_key);
end
$$;

create or replace function public.world_combat_building5_action_v1(
  p_user uuid,p_encounter_id uuid,p_action text,p_action_key uuid)
returns jsonb language plpgsql volatile security definer set search_path=''
as $$
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception 'SERVER_ONLY' using errcode='42501';
  end if;
  return private.world_combat_building5_action_v1(
    p_user,p_encounter_id,p_action,p_action_key);
end
$$;

create or replace function public.world_combat_building5_snapshot_v1(
  p_user uuid,p_encounter_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if coalesce((select auth.jwt()->>'role'),'') <> 'service_role' then
    raise exception 'SERVER_ONLY' using errcode='42501';
  end if;
  return private.world_combat_building5_snapshot_v1(p_user,p_encounter_id);
end
$$;

revoke execute on function public.world_combat_building5_start_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
revoke execute on function public.world_combat_building5_action_v1(uuid,uuid,text,uuid)
  from public,anon,authenticated,service_role;
revoke execute on function public.world_combat_building5_snapshot_v1(uuid,uuid)
  from public,anon,authenticated,service_role;
grant execute on function public.world_combat_building5_start_v1(uuid,uuid) to service_role;
grant execute on function public.world_combat_building5_action_v1(uuid,uuid,text,uuid) to service_role;
grant execute on function public.world_combat_building5_snapshot_v1(uuid,uuid) to service_role;
