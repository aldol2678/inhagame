-- INHA WORLD Daily Quiz category mix:
-- keep the 3-question daily run, but target an exact 60% major-question share
-- for each player across every 5 consecutive quiz days.
--
-- 4 of 5 days: 2 major + 1 other
-- 1 of 5 days: 1 major + 2 other
-- => 9 major questions / 15 total questions = 60%.
--
-- The per-day quota is deterministic from account UUID first byte + KST date,
-- while the actual questions remain randomly sampled without replacement.

create or replace function private.world_daily_quiz_major_count_v1(
  p_user uuid,
  p_date date
) returns smallint
language sql
immutable
set search_path = ''
as $$
  select case
    when mod(
      pg_catalog.get_byte(pg_catalog.uuid_send(p_user), 0)
      + (p_date - date '2000-01-01'),
      5
    ) = 0 then 1
    else 2
  end::smallint;
$$;

revoke all on function private.world_daily_quiz_major_count_v1(uuid, date)
  from public, anon, authenticated;

create or replace function public.start_my_world_daily_quiz_v1()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.world_daily_quiz_caller_v1();
  v_today date := private.world_daily_quiz_today_v1();
  v_major_count smallint;
  v_other_count smallint;
  v_questions text[];
begin
  -- One quiz decision per account at a time: concurrent starts wait, then see the same run.
  perform pg_advisory_xact_lock(hashtextextended('world_daily_quiz:' || v_uid::text, 0));

  if not exists (
    select 1
    from private.world_daily_quiz_runs r
    where r.user_id = v_uid
      and r.reward_date = v_today
  ) then
    v_major_count := private.world_daily_quiz_major_count_v1(v_uid, v_today);
    v_other_count := 3 - v_major_count;

    select array_agg(s.question_id order by gen_random_uuid())
      into v_questions
      from (
        (
          select q.question_id
          from private.world_daily_quiz_questions q
          where q.status = 'ACTIVE'
            and q.category = 'major'
          order by gen_random_uuid()
          limit v_major_count
        )
        union all
        (
          select q.question_id
          from private.world_daily_quiz_questions q
          where q.status = 'ACTIVE'
            and q.category <> 'major'
          order by gen_random_uuid()
          limit v_other_count
        )
      ) s;

    if coalesce(cardinality(v_questions), 0) < 3 then
      raise exception 'QUIZ_UNAVAILABLE' using errcode = 'P0001';
    end if;

    insert into private.world_daily_quiz_runs (user_id, reward_date, question_ids)
    values (v_uid, v_today, v_questions)
    on conflict (user_id, reward_date) do nothing;
  end if;

  return private.world_daily_quiz_state_v1(v_uid, v_today);
end;
$$;
