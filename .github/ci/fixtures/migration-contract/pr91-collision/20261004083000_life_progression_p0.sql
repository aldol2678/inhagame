-- Condensed shape of #98 (merged, canonical): aggregate Life Level + SP derived from it.
create table if not exists private.world_life_progression_thresholds (
  curve_id text not null,
  level integer not null check (level >= 1),
  min_total_skill_xp bigint not null check (min_total_skill_xp >= 0),
  cumulative_sp integer not null check (cumulative_sp >= 0),
  created_at timestamptz not null default now(),
  primary key (curve_id, level)
);
insert into private.world_life_progression_thresholds(curve_id, level, min_total_skill_xp, cumulative_sp)
values ('life.progression.v1', 1, 0, 0);

create table if not exists private.world_life_skill_tree_catalog (
  node_id text primary key,
  skill_id text not null,
  status text not null check (status in ('ACTIVE','COMING_SOON','DISABLED','HIDDEN')),
  sp_cost integer not null check (sp_cost between 1 and 99),
  required_life_level integer not null,
  required_skill_level integer not null
);

create or replace function private.world_life_progression_snapshot_v1(p_user uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  return (select jsonb_build_object('level', t.level, 'sp', t.cumulative_sp)
            from private.world_life_progression_thresholds t order by t.level desc limit 1);
end;
$$;
