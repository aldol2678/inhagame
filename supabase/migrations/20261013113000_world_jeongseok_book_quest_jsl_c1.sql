-- JSL-C1: account-scoped first book-search progress, no XP/coin/item rewards.
-- Draft migration only; never applied to Production by this PR.
create table private.world_jeongseok_book_quest_v1 (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stage smallint not null default 0 check (stage between 0 and 4),
  updated_at timestamptz not null default now()
);
alter table private.world_jeongseok_book_quest_v1 enable row level security;
revoke all on private.world_jeongseok_book_quest_v1 from public, anon, authenticated, service_role;

create function public.advance_jeongseok_book_quest_v1(p_event text)
returns jsonb language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_stage smallint := 0;
begin
  if auth.role() is distinct from 'authenticated' or v_user is null or
      coalesce((auth.jwt()->>'is_anonymous')::boolean, false) or
      not exists (select 1 from public.profiles p where p.user_id = v_user and p.is_banned = false) then
    raise exception 'ACCOUNT_UNAVAILABLE' using errcode = '42501';
  end if;
  if p_event is null or p_event not in ('status','start','search','select:pride_prejudice','report') then
    raise exception 'INVALID_BOOK_QUEST_EVENT' using errcode = '22023';
  end if;
  -- Never create a progress record when only reading status.
  if p_event = 'start' then
    insert into private.world_jeongseok_book_quest_v1(user_id,stage)
      values(v_user,0) on conflict (user_id) do nothing;
  end if;
  select q.stage into v_stage
    from private.world_jeongseok_book_quest_v1 q where q.user_id = v_user
    for update;
  v_stage := coalesce(v_stage,0);
  if (p_event = 'start' and v_stage = 0) or
     (p_event = 'search' and v_stage = 1) or
     (p_event = 'select:pride_prejudice' and v_stage = 2) or
     (p_event = 'report' and v_stage = 3) then
    v_stage := v_stage + 1;
    update private.world_jeongseok_book_quest_v1
      set stage = v_stage, updated_at = now() where user_id = v_user;
  end if;
  -- Replays and out-of-order events never grant progress or economic value.
  return jsonb_build_object('quest_id','jsl_first_book_search_v1','stage',v_stage,'reward',null);
end;
$$;
revoke all on function public.advance_jeongseok_book_quest_v1(text) from public, anon, authenticated, service_role;
grant execute on function public.advance_jeongseok_book_quest_v1(text) to authenticated;
comment on function public.advance_jeongseok_book_quest_v1(text) is
  'JSL-C1 game-only study tutorial; progress is not proof of physical presence; no reward authority.';
