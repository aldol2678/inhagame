-- Condensed shape of #91 (open, superseded) after a date-only rebase onto #98.
-- Same object names, different contract. `if not exists` makes both creates no-ops on replay.
create table if not exists private.world_life_progression_thresholds (
  curve_id text not null,
  level integer not null check (level >= 1),
  min_total_xp bigint not null check (min_total_xp >= 0),
  skill_points_reward integer not null check (skill_points_reward between 0 and 10),
  created_at timestamptz not null default now(),
  primary key (curve_id, level)
);

create table if not exists private.world_life_skill_tree_catalog (
  tree_id text primary key,
  skill_id text,
  status text not null,
  definition_version integer not null
);

insert into private.world_life_progression_thresholds(curve_id, level, min_total_xp, skill_points_reward)
values ('life.progression.v1', 2, 100, 1);

-- Replaces #98's function with one written for the skipped table (only a compile check sees it).
create or replace function private.world_life_progression_snapshot_v1(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return (select jsonb_build_object('level', t.level, 'sp', t.skill_points_reward)
            from private.world_life_progression_thresholds t where t.min_total_xp <= 0
           order by t.level desc limit 1);
end;
$$;
