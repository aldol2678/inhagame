-- Public forward migration: ported from the private migration recorded in the Production lineage as
-- 20261002120933 (Life skill authority). Versions are not shared across the two lineages.
-- INHA WORLD P0 Life Skill Authority.
--
-- Skill-specific XP is separate from Campus World EXP.
-- This foundation seeds the common curve identity with Lv1=0 only; Lv2..10 thresholds remain
-- intentionally uncommitted until P1-A playtest tuning. No skill is ACTIVE in this migration.

create table if not exists private.world_life_skill_catalog (
  skill_id text primary key
    check (skill_id ~ '^life\.[a-z][a-z0-9_]*$' and char_length(skill_id) <= 80),
  curve_id text not null
    check (curve_id ~ '^life\.[a-z][a-z0-9_]*\.v[0-9]+$' and char_length(curve_id) <= 80),
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN'))
);
comment on table private.world_life_skill_catalog is
  'Write-authority mirror of the Life Skill code Registry. Product descriptions remain in code.';

insert into private.world_life_skill_catalog(skill_id,curve_id,status) values
  ('life.fishing','life.common.v1','COMING_SOON'),
  ('life.gathering','life.common.v1','COMING_SOON'),
  ('life.archaeology','life.common.v1','COMING_SOON'),
  ('life.woodcutting','life.common.v1','COMING_SOON'),
  ('life.mining','life.common.v1','COMING_SOON'),
  ('life.woodworking','life.common.v1','COMING_SOON'),
  ('life.cooking','life.common.v1','COMING_SOON'),
  ('life.crafting','life.common.v1','COMING_SOON'),
  ('life.farming','life.common.v1','COMING_SOON'),
  ('life.photography','life.common.v1','COMING_SOON'),
  ('life.research','life.common.v1','COMING_SOON')
on conflict (skill_id) do nothing;

create table if not exists private.world_life_skill_thresholds (
  curve_id text not null
    check (curve_id ~ '^life\.[a-z][a-z0-9_]*\.v[0-9]+$' and char_length(curve_id) <= 80),
  level integer not null check (level >= 1),
  min_total_xp bigint not null check (min_total_xp >= 0),
  created_at timestamptz not null default now(),
  primary key (curve_id,level)
);
comment on table private.world_life_skill_thresholds is
  'Immutable per-curve Life Skill thresholds. P0 seeds Lv1 only; later levels append after balance approval.';

create or replace function private.world_life_skill_threshold_validate_insert_v1()
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
    from private.world_life_skill_thresholds t
   where t.curve_id = new.curve_id;

  if v_max_level is null then
    if new.level <> 1 or new.min_total_xp <> 0 then
      raise exception 'LIFE_SKILL_CURVE_INVALID' using errcode = '23514';
    end if;
  elsif new.level <> v_max_level + 1 or new.min_total_xp <= v_max_xp then
    raise exception 'LIFE_SKILL_CURVE_INVALID' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function private.world_life_skill_threshold_validate_insert_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_skill_threshold_validate_insert
  on private.world_life_skill_thresholds;
create trigger world_life_skill_threshold_validate_insert
  before insert on private.world_life_skill_thresholds
  for each row execute function private.world_life_skill_threshold_validate_insert_v1();

create or replace function private.world_life_skill_threshold_immutable_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LIFE_SKILL_CURVE_IMMUTABLE' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_skill_threshold_immutable_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_skill_threshold_immutable
  on private.world_life_skill_thresholds;
create trigger world_life_skill_threshold_immutable
  before update or delete on private.world_life_skill_thresholds
  for each row execute function private.world_life_skill_threshold_immutable_v1();

insert into private.world_life_skill_thresholds(curve_id,level,min_total_xp)
values ('life.common.v1',1,0)
on conflict (curve_id,level) do nothing;

create table if not exists private.world_player_life_skills (
  user_id uuid not null references auth.users(id) on delete cascade,
  skill_id text not null
    check (skill_id ~ '^life\.[a-z][a-z0-9_]*$' and char_length(skill_id) <= 80),
  total_xp bigint not null default 0 check (total_xp >= 0),
  version bigint not null default 0 check (version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id,skill_id)
);
comment on table private.world_player_life_skills is
  'Per-account Life Skill XP projection. Level is never stored; it is derived from the skill curve.';

create table if not exists private.world_life_skill_xp_transactions (
  transaction_id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  skill_id text not null,
  amount bigint not null check (amount > 0),
  xp_before bigint not null check (xp_before >= 0),
  xp_after bigint not null check (xp_after >= 0),
  level_before integer not null check (level_before >= 1),
  level_after integer not null check (level_after >= 1),
  source_type text not null check (source_type in (
    'activity','crafting','research','farming','system','admin'
  )),
  source_id text not null check (char_length(source_id) between 1 and 200),
  idempotency_key text not null unique
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$'),
  created_at timestamptz not null default now(),
  foreign key (user_id,skill_id)
    references private.world_player_life_skills(user_id,skill_id) on delete cascade,
  constraint world_life_skill_xp_transactions_math check (xp_after = xp_before + amount),
  constraint world_life_skill_xp_transactions_level_monotonic check (level_after >= level_before)
);
comment on table private.world_life_skill_xp_transactions is
  'Append-only positive Life Skill XP ledger. Independent from Campus World EXP.';

create index if not exists world_life_skill_xp_transactions_user_created_idx
  on private.world_life_skill_xp_transactions(user_id,created_at desc);

alter table private.world_life_skill_catalog enable row level security;
alter table private.world_life_skill_thresholds enable row level security;
alter table private.world_player_life_skills enable row level security;
alter table private.world_life_skill_xp_transactions enable row level security;
revoke all on table private.world_life_skill_catalog,
  private.world_life_skill_thresholds,
  private.world_player_life_skills,
  private.world_life_skill_xp_transactions
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_xp_append_only_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'LIFE_SKILL_XP_APPEND_ONLY' using errcode = '42501';
end;
$$;
revoke all on function private.world_life_skill_xp_append_only_v1()
  from public, anon, authenticated, service_role;

drop trigger if exists world_life_skill_xp_append_only
  on private.world_life_skill_xp_transactions;
create trigger world_life_skill_xp_append_only
  before update on private.world_life_skill_xp_transactions
  for each row execute function private.world_life_skill_xp_append_only_v1();

create or replace function private.world_life_skill_account_ok_v1(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (
    select 1
      from auth.users u
      join public.profiles p on p.user_id = u.id
     where u.id = p_user
       and u.is_anonymous is not true
       and p.is_banned = false
  );
$$;
revoke all on function private.world_life_skill_account_ok_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_level_for_xp_v1(
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
    raise exception 'INVALID_LIFE_SKILL_CURVE' using errcode = '22023';
  end if;
  if p_total_xp is null or p_total_xp < 0 then
    raise exception 'INVALID_TOTAL_XP' using errcode = '22023';
  end if;

  select t.level into v_level
    from private.world_life_skill_thresholds t
   where t.curve_id = p_curve_id
     and t.min_total_xp <= p_total_xp
   order by t.level desc
   limit 1;

  if v_level is null then
    raise exception 'LIFE_SKILL_CURVE_INVALID' using errcode = 'P0001';
  end if;
  return v_level;
end;
$$;
revoke all on function private.world_life_skill_level_for_xp_v1(text,bigint)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_snapshot_v1(
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
  v_total bigint := 0;
  v_version bigint := 0;
  v_level integer;
  v_start bigint;
  v_next bigint;
  v_max integer;
begin
  select * into v_skill
    from private.world_life_skill_catalog s
   where s.skill_id = p_skill_id;
  if not found then
    raise exception 'LIFE_SKILL_NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.total_xp,p.version
    into v_total,v_version
    from private.world_player_life_skills p
   where p.user_id = p_user
     and p.skill_id = p_skill_id;
  v_total := coalesce(v_total,0);
  v_version := coalesce(v_version,0);

  v_level := private.world_life_skill_level_for_xp_v1(v_skill.curve_id,v_total);
  select t.min_total_xp into strict v_start
    from private.world_life_skill_thresholds t
   where t.curve_id = v_skill.curve_id and t.level = v_level;
  select t.min_total_xp into v_next
    from private.world_life_skill_thresholds t
   where t.curve_id = v_skill.curve_id and t.level = v_level + 1;
  select max(t.level) into v_max
    from private.world_life_skill_thresholds t
   where t.curve_id = v_skill.curve_id;

  return jsonb_build_object(
    'skillId', v_skill.skill_id,
    'curveId', v_skill.curve_id,
    'status', v_skill.status,
    'totalXp', v_total,
    'level', v_level,
    'version', v_version,
    'currentLevelStartXp', v_start,
    'nextLevelXp', v_next,
    'progressXp', v_total - v_start,
    'progressRequired', case when v_next is null then null else v_next - v_start end,
    'maxDefinedLevel', v_max,
    'isMaxLevel', v_next is null
  );
end;
$$;
revoke all on function private.world_life_skill_snapshot_v1(uuid,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skills_list_v1(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'userId',p_user,
    'skills',coalesce((
      select jsonb_agg(
        private.world_life_skill_snapshot_v1(p_user,s.skill_id)
        order by s.skill_id
      )
      from private.world_life_skill_catalog s
    ),'[]'::jsonb)
  );
end;
$$;
revoke all on function private.world_life_skills_list_v1(uuid)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_xp_result_v1(
  p_tx private.world_life_skill_xp_transactions,
  p_status text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'status',p_status,
    'transactionId',p_tx.transaction_id,
    'userId',p_tx.user_id,
    'skillId',p_tx.skill_id,
    'amount',p_tx.amount,
    'xpBefore',p_tx.xp_before,
    'xpAfter',p_tx.xp_after,
    'levelBefore',p_tx.level_before,
    'levelAfter',p_tx.level_after,
    'leveledUp',p_tx.level_after > p_tx.level_before,
    'sourceType',p_tx.source_type,
    'sourceId',p_tx.source_id,
    'idempotencyKey',p_tx.idempotency_key,
    'createdAt',p_tx.created_at,
    'snapshot',private.world_life_skill_snapshot_v1(p_tx.user_id,p_tx.skill_id)
  );
$$;
revoke all on function private.world_life_skill_xp_result_v1(
  private.world_life_skill_xp_transactions,text)
  from public, anon, authenticated, service_role;

create or replace function private.world_life_skill_xp_apply_v1(
  p_user uuid,
  p_skill_id text,
  p_amount bigint,
  p_source_type text,
  p_source_id text,
  p_idempotency_key text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_skill private.world_life_skill_catalog%rowtype;
  v_total bigint;
  v_before_level integer;
  v_after_level integer;
  v_tx private.world_life_skill_xp_transactions%rowtype;
begin
  if p_skill_id is null
     or p_skill_id !~ '^life\.[a-z][a-z0-9_]*$'
     or char_length(p_skill_id) > 80 then
    raise exception 'INVALID_LIFE_SKILL_ID' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;
  if p_source_type is null or p_source_type not in (
       'activity','crafting','research','farming','system','admin')
     or p_source_id is null or char_length(p_source_id) not between 1 and 200 then
    raise exception 'INVALID_SOURCE' using errcode = '22023';
  end if;
  if p_idempotency_key is null
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$' then
    raise exception 'INVALID_IDEMPOTENCY_KEY' using errcode = '22023';
  end if;
  if not private.world_life_skill_account_ok_v1(p_user) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select * into v_skill
    from private.world_life_skill_catalog s
   where s.skill_id = p_skill_id;
  if not found then
    raise exception 'LIFE_SKILL_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- Exact replay wins over current availability. A response-loss retry must return the
  -- committed transaction even if the skill became disabled after that commit.
  select * into v_tx
    from private.world_life_skill_xp_transactions t
   where t.idempotency_key = p_idempotency_key;
  if found then
    if (v_tx.user_id,v_tx.skill_id,v_tx.amount,v_tx.source_type,v_tx.source_id)
       is distinct from
       (p_user,p_skill_id,p_amount,p_source_type,p_source_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_life_skill_xp_result_v1(v_tx,'ALREADY_PROCESSED');
  end if;

  if v_skill.status <> 'ACTIVE' then
    raise exception 'LIFE_SKILL_INACTIVE' using errcode = 'P0001';
  end if;

  perform private.world_life_skill_level_for_xp_v1(v_skill.curve_id,0);

  insert into private.world_player_life_skills(user_id,skill_id)
  values (p_user,p_skill_id)
  on conflict (user_id,skill_id) do nothing;

  select p.total_xp into strict v_total
    from private.world_player_life_skills p
   where p.user_id = p_user
     and p.skill_id = p_skill_id
   for update;

  if v_total > 9223372036854775807::bigint - p_amount then
    raise exception 'INVALID_AMOUNT' using errcode = '22023';
  end if;

  v_before_level := private.world_life_skill_level_for_xp_v1(v_skill.curve_id,v_total);
  v_after_level := private.world_life_skill_level_for_xp_v1(v_skill.curve_id,v_total+p_amount);

  begin
    insert into private.world_life_skill_xp_transactions(
      user_id,skill_id,amount,xp_before,xp_after,level_before,level_after,
      source_type,source_id,idempotency_key)
    values (
      p_user,p_skill_id,p_amount,v_total,v_total+p_amount,v_before_level,v_after_level,
      p_source_type,p_source_id,p_idempotency_key)
    returning * into v_tx;
  exception when unique_violation then
    select * into strict v_tx
      from private.world_life_skill_xp_transactions t
     where t.idempotency_key = p_idempotency_key;
    if (v_tx.user_id,v_tx.skill_id,v_tx.amount,v_tx.source_type,v_tx.source_id)
       is distinct from
       (p_user,p_skill_id,p_amount,p_source_type,p_source_id) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = '23505';
    end if;
    return private.world_life_skill_xp_result_v1(v_tx,'ALREADY_PROCESSED');
  end;

  update private.world_player_life_skills p
     set total_xp = v_tx.xp_after,
         version = p.version + 1,
         updated_at = now()
   where p.user_id = p_user
     and p.skill_id = p_skill_id;

  return private.world_life_skill_xp_result_v1(v_tx,'SUCCESS');
end;
$$;
revoke all on function private.world_life_skill_xp_apply_v1(
  uuid,text,bigint,text,text,text)
  from public, anon, authenticated, service_role;
