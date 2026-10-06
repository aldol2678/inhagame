-- MAIN 03 M3.2: the student-center shop visit advances only stage 1 -> 2.
-- Visit events remain client-observed World/Interaction evidence; Quest enforces order.
-- This is not trusted position evidence and grants no Reward, purchase, or Loadout progress.

create or replace function public.advance_world_first_style_quest_v1(p_user uuid, p_event text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_quest constant text := 'campus_first_style_v1';
  v_stage smallint;
  v_available boolean := false;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'SERVER_ONLY' using errcode = '42501';
  end if;
  if p_event not in ('status', 'start', 'visit_student_center') or p_event is null then
    raise exception 'INVALID_QUEST_EVENT' using errcode = '22023';
  end if;
  if p_user is null or not exists (
    select 1 from public.profiles p
    join auth.users u on u.id = p.user_id
    where p.user_id = p_user and p.is_banned = false and u.is_anonymous = false
  ) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '22023';
  end if;

  select exists (
    select 1 from private.world_quest_progress_v1 q
    where q.user_id = p_user
      and q.quest_id = 'campus_navigation_intro_v1'
      and q.stage = 9
  ) into v_available;

  if v_available and p_event = 'start' then
    insert into private.world_quest_progress_v1 (user_id, quest_id, stage)
    values (p_user, v_quest, 1)
    on conflict (user_id, quest_id) do nothing;
  end if;

  -- A single conditional UPDATE makes repeated/concurrent visits idempotent.
  -- Visiting before start, without Main 2, or at stage 2+ never writes progress.
  if v_available and p_event = 'visit_student_center' then
    update private.world_quest_progress_v1 q
    set stage = 2, updated_at = now()
    where q.user_id = p_user and q.quest_id = v_quest and q.stage = 1;
  end if;

  select q.stage into v_stage
  from private.world_quest_progress_v1 q
  where q.user_id = p_user and q.quest_id = v_quest;

  return jsonb_build_object(
    'quest_id', v_quest,
    'stage', coalesce(v_stage, 0),
    'available', v_available
  );
end;
$$;

revoke all on function public.advance_world_first_style_quest_v1(uuid,text) from public, anon, authenticated;
grant execute on function public.advance_world_first_style_quest_v1(uuid,text) to service_role;
