-- INHA WORLD Life Skill Tree v1 nodes: 18 nodes for Fishing / Woodcutting / Farming from #91
-- (docs/architecture/PR91_LIFE_PROGRESSION_SALVAGE.md sections 4-5), on the rank model of
-- 20261004135000. Mirrors apps/world/src/life-skills/life-skill-tree-nodes-v1.js exactly.
--
-- - Every node is COMING_SOON. No skill is activated; no node effect exists yet.
-- - Gates moved from the aggregate Life Level (#91) to the owning skill's level;
--   required_life_level is 1 for every node.
-- - Each tree costs 17 SP to max, which a skill has earned exactly at skill Lv15.
-- - Sailing (6 nodes) is not imported: life.sailing does not exist in the skill catalog.
-- Published rows are immutable (except status) from here on.

insert into private.world_life_skill_tree_catalog(
  node_id,skill_id,status,sp_cost,max_rank,required_life_level,required_skill_level) values
  ('life.node.fishing.steady_hands','life.fishing','COMING_SOON',1,3,1,2),
  ('life.node.fishing.fish_sense','life.fishing','COMING_SOON',1,3,1,3),
  ('life.node.fishing.baitcraft','life.fishing','COMING_SOON',1,2,1,5),
  ('life.node.fishing.rare_fish_sense','life.fishing','COMING_SOON',2,2,1,8),
  ('life.node.fishing.boat_fishing','life.fishing','COMING_SOON',2,1,1,10),
  ('life.node.fishing.deep_sea_fishing','life.fishing','COMING_SOON',3,1,1,15),
  ('life.node.woodcutting.clean_cut','life.woodcutting','COMING_SOON',1,3,1,2),
  ('life.node.woodcutting.timber_eye','life.woodcutting','COMING_SOON',1,3,1,4),
  ('life.node.woodcutting.tool_care','life.woodcutting','COMING_SOON',1,2,1,5),
  ('life.node.woodcutting.hardwood_handling','life.woodcutting','COMING_SOON',2,2,1,8),
  ('life.node.woodcutting.field_sawmill','life.woodcutting','COMING_SOON',2,1,1,10),
  ('life.node.woodcutting.master_forester','life.woodcutting','COMING_SOON',3,1,1,15),
  ('life.node.farming.soil_reading','life.farming','COMING_SOON',1,3,1,2),
  ('life.node.farming.seed_selection','life.farming','COMING_SOON',1,3,1,4),
  ('life.node.farming.water_sense','life.farming','COMING_SOON',1,2,1,5),
  ('life.node.farming.greenhouse','life.farming','COMING_SOON',2,2,1,8),
  ('life.node.farming.crop_rotation','life.farming','COMING_SOON',2,1,1,10),
  ('life.node.farming.smart_farm','life.farming','COMING_SOON',3,1,1,15)
on conflict (node_id) do nothing;

insert into private.world_life_skill_tree_edges(node_id,prerequisite_node_id,required_rank) values
  ('life.node.fishing.fish_sense','life.node.fishing.steady_hands',1),
  ('life.node.fishing.baitcraft','life.node.fishing.steady_hands',1),
  ('life.node.fishing.rare_fish_sense','life.node.fishing.fish_sense',2),
  ('life.node.fishing.boat_fishing','life.node.fishing.fish_sense',2),
  ('life.node.fishing.deep_sea_fishing','life.node.fishing.rare_fish_sense',1),
  ('life.node.fishing.deep_sea_fishing','life.node.fishing.boat_fishing',1),
  ('life.node.woodcutting.timber_eye','life.node.woodcutting.clean_cut',1),
  ('life.node.woodcutting.tool_care','life.node.woodcutting.clean_cut',1),
  ('life.node.woodcutting.hardwood_handling','life.node.woodcutting.timber_eye',2),
  ('life.node.woodcutting.field_sawmill','life.node.woodcutting.tool_care',2),
  ('life.node.woodcutting.master_forester','life.node.woodcutting.hardwood_handling',1),
  ('life.node.woodcutting.master_forester','life.node.woodcutting.field_sawmill',1),
  ('life.node.farming.seed_selection','life.node.farming.soil_reading',1),
  ('life.node.farming.water_sense','life.node.farming.soil_reading',1),
  ('life.node.farming.greenhouse','life.node.farming.seed_selection',2),
  ('life.node.farming.crop_rotation','life.node.farming.water_sense',2),
  ('life.node.farming.smart_farm','life.node.farming.greenhouse',1),
  ('life.node.farming.smart_farm','life.node.farming.crop_rotation',1)
on conflict (node_id,prerequisite_node_id) do nothing;
