-- DRAFT, NOT A MIGRATION. Keep it out of supabase/migrations until a staging Realtime run proves it.
--
-- Purpose: stop a kicked account from JOINING (or re-joining) a private world Realtime channel.
-- This is "new connection blocking" only. It is not a revocation of sockets that are already open;
-- Supabase Realtime documents no server API for that and this draft does not assume one.
--
-- What the policy can and cannot do (see README "Realtime"):
--   * Realtime evaluates the realtime.messages RLS policies when a client joins a private channel.
--     A blocked account that joins after the kick is refused if the policy says so.   [expected]
--   * Whether Realtime re-evaluates the policy for an already-joined socket (for example when the
--     client refreshes its access token) is NOT established here.                      [UNKNOWN]
--
-- Blast radius: this adds a predicate to the two policies every online player depends on. Apply it only
-- after the heartbeat hardening migration, on staging first, and keep the rollback below ready.
-- A grants-contract entry for the new authenticated EXECUTE function is required when promoted.
begin;

create or replace function public.world_session_join_allowed_v1()
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select not exists (
    select 1 from private.world_session_kick_blocks k
    where k.user_id = (select auth.uid()) and k.blocked_until > now()
  );
$function$;
revoke all on function public.world_session_join_allowed_v1() from public, anon, authenticated;
grant execute on function public.world_session_join_allowed_v1() to authenticated;

create or replace function private.install_world_online_realtime_policies()
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  drop policy if exists "world online members read place zone" on realtime.messages;
  drop policy if exists "world online members write place zone" on realtime.messages;

  drop policy if exists "world online players read place zone" on realtime.messages;
  create policy "world online players read place zone"
    on realtime.messages
    for select
    to authenticated
    using (
      (select auth.uid()) is not null
      and (select public.world_session_join_allowed_v1())
      and realtime.messages.extension in ('broadcast', 'presence')
      and (
        (select realtime.topic()) ~ '^world:campus:AREA_[A-Z0-9_]{1,60}$'
        or (select public.can_access_world_room_realtime_v1((select realtime.topic())))
      )
    );

  drop policy if exists "world online players write place zone" on realtime.messages;
  create policy "world online players write place zone"
    on realtime.messages
    for insert
    to authenticated
    with check (
      (select auth.uid()) is not null
      and (select public.world_session_join_allowed_v1())
      and realtime.messages.extension in ('broadcast', 'presence')
      and (
        (select realtime.topic()) ~ '^world:campus:AREA_[A-Z0-9_]{1,60}$'
        or (select public.can_access_world_room_realtime_v1((select realtime.topic())))
      )
    );
end;
$$;
revoke all on function private.install_world_online_realtime_policies() from public, anon, authenticated;

do $$
begin
  if to_regclass('realtime.messages') is not null then
    perform private.install_world_online_realtime_policies();
  else
    raise notice 'realtime.messages absent (Realtime service not running); policies not installed';
  end if;
end $$;
commit;

-- ROLLBACK (run as a separate script):
--   Re-run the "private.install_world_online_realtime_policies" body from
--   supabase/migrations/20261002130000_world_personal_room_session_d2.sql (without the join predicate),
--   then: drop function public.world_session_join_allowed_v1();
