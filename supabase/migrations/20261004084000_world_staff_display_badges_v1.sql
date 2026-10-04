-- Restore World presentation badges without publishing account identities or role data.
-- This read surface neither assigns staff roles nor grants gameplay/admin permissions.
create or replace function public.get_world_staff_badges_v1(p_user_ids uuid[])
returns table(user_id uuid, badge_code text)
language sql stable security definer
set search_path = ''
rows 64
as $$
  select a.user_id, 'gm'::text
  from private.world_staff_assignments a
  where auth.uid() is not null
    and coalesce(cardinality(p_user_ids), 0) between 1 and 64
    and a.user_id = any(p_user_ids)
    and a.active
    and a.role in ('world_admin', 'sound_gm')
  order by a.user_id
$$;

comment on function public.get_world_staff_badges_v1(uuid[]) is
  'Display-only GM markers for up to 64 supplied player IDs; never an authorization check.';
revoke all on function public.get_world_staff_badges_v1(uuid[]) from public, anon, authenticated;
grant execute on function public.get_world_staff_badges_v1(uuid[]) to authenticated, service_role;
