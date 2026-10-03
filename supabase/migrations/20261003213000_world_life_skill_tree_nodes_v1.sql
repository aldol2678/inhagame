-- INHA WORLD Life Skill Tree v1 initial node definitions.
--
-- Product semantics are mirrored from apps/world/src/life-skills/life-skill-tree-registry.js.
-- All nodes remain COMING_SOON. This migration defines progression shape only; it does not activate
-- gameplay, expose a mutation RPC, or grant vehicle/technology unlocks.

insert into private.world_life_skill_nodes(
  node_id,tree_id,max_rank,point_cost,required_life_level,
  required_skill_id,required_skill_level,effect_key,status,definition_version
) values
  ('life_node.fishing.steady_hands','life_tree.fishing',3,1,2,null,null,'fishing.bite_window.v1','COMING_SOON',1),
  ('life_node.fishing.fish_sense','life_tree.fishing',3,1,3,null,null,'fishing.fish_sense.v1','COMING_SOON',1),
  ('life_node.fishing.baitcraft','life_tree.fishing',2,1,5,null,null,'fishing.baitcraft.v1','COMING_SOON',1),
  ('life_node.fishing.rare_fish_sense','life_tree.fishing',2,2,8,null,null,'fishing.rare_fish_sense.v1','COMING_SOON',1),
  ('life_node.fishing.boat_fishing','life_tree.fishing',1,2,10,null,null,'fishing.boat_fishing.v1','COMING_SOON',1),
  ('life_node.fishing.deep_sea_fishing','life_tree.fishing',1,3,15,null,null,'fishing.deep_sea_fishing.v1','COMING_SOON',1),

  ('life_node.woodcutting.clean_cut','life_tree.woodcutting',3,1,2,null,null,'woodcutting.clean_cut.v1','COMING_SOON',1),
  ('life_node.woodcutting.timber_eye','life_tree.woodcutting',3,1,4,null,null,'woodcutting.timber_eye.v1','COMING_SOON',1),
  ('life_node.woodcutting.tool_care','life_tree.woodcutting',2,1,5,null,null,'woodcutting.tool_care.v1','COMING_SOON',1),
  ('life_node.woodcutting.hardwood_handling','life_tree.woodcutting',2,2,8,null,null,'woodcutting.hardwood_handling.v1','COMING_SOON',1),
  ('life_node.woodcutting.field_sawmill','life_tree.woodcutting',1,2,10,null,null,'woodcutting.field_sawmill.v1','COMING_SOON',1),
  ('life_node.woodcutting.master_forester','life_tree.woodcutting',1,3,15,null,null,'woodcutting.master_forester.v1','COMING_SOON',1),

  ('life_node.farming.soil_reading','life_tree.farming',3,1,2,null,null,'farming.soil_reading.v1','COMING_SOON',1),
  ('life_node.farming.seed_selection','life_tree.farming',3,1,4,null,null,'farming.seed_selection.v1','COMING_SOON',1),
  ('life_node.farming.water_sense','life_tree.farming',2,1,5,null,null,'farming.water_sense.v1','COMING_SOON',1),
  ('life_node.farming.greenhouse','life_tree.farming',2,2,8,null,null,'farming.greenhouse.v1','COMING_SOON',1),
  ('life_node.farming.crop_rotation','life_tree.farming',1,2,10,null,null,'farming.crop_rotation.v1','COMING_SOON',1),
  ('life_node.farming.smart_farm','life_tree.farming',1,3,15,null,null,'farming.smart_farm.v1','COMING_SOON',1),

  ('life_node.sailing.seamanship','life_tree.sailing',3,1,2,null,null,'sailing.seamanship.v1','COMING_SOON',1),
  ('life_node.sailing.coastal_navigation','life_tree.sailing',3,1,4,null,null,'sailing.coastal_navigation.v1','COMING_SOON',1),
  ('life_node.sailing.weather_reading','life_tree.sailing',2,1,5,null,null,'sailing.weather_reading.v1','COMING_SOON',1),
  ('life_node.sailing.offshore_navigation','life_tree.sailing',2,2,8,null,null,'sailing.offshore_navigation.v1','COMING_SOON',1),
  ('life_node.sailing.cargo_handling','life_tree.sailing',1,2,10,null,null,'sailing.cargo_handling.v1','COMING_SOON',1),
  ('life_node.sailing.deep_sea_navigation','life_tree.sailing',1,3,15,null,null,'sailing.deep_sea_navigation.v1','COMING_SOON',1)
on conflict (node_id) do nothing;

insert into private.world_life_skill_node_prerequisites(
  node_id,prerequisite_node_id,required_rank
) values
  ('life_node.fishing.fish_sense','life_node.fishing.steady_hands',1),
  ('life_node.fishing.baitcraft','life_node.fishing.steady_hands',1),
  ('life_node.fishing.rare_fish_sense','life_node.fishing.fish_sense',2),
  ('life_node.fishing.boat_fishing','life_node.fishing.fish_sense',2),
  ('life_node.fishing.deep_sea_fishing','life_node.fishing.rare_fish_sense',1),
  ('life_node.fishing.deep_sea_fishing','life_node.fishing.boat_fishing',1),

  ('life_node.woodcutting.timber_eye','life_node.woodcutting.clean_cut',1),
  ('life_node.woodcutting.tool_care','life_node.woodcutting.clean_cut',1),
  ('life_node.woodcutting.hardwood_handling','life_node.woodcutting.timber_eye',2),
  ('life_node.woodcutting.field_sawmill','life_node.woodcutting.tool_care',2),
  ('life_node.woodcutting.master_forester','life_node.woodcutting.hardwood_handling',1),
  ('life_node.woodcutting.master_forester','life_node.woodcutting.field_sawmill',1),

  ('life_node.farming.seed_selection','life_node.farming.soil_reading',1),
  ('life_node.farming.water_sense','life_node.farming.soil_reading',1),
  ('life_node.farming.greenhouse','life_node.farming.seed_selection',2),
  ('life_node.farming.crop_rotation','life_node.farming.water_sense',2),
  ('life_node.farming.smart_farm','life_node.farming.greenhouse',1),
  ('life_node.farming.smart_farm','life_node.farming.crop_rotation',1),

  ('life_node.sailing.coastal_navigation','life_node.sailing.seamanship',1),
  ('life_node.sailing.weather_reading','life_node.sailing.seamanship',1),
  ('life_node.sailing.offshore_navigation','life_node.sailing.coastal_navigation',2),
  ('life_node.sailing.offshore_navigation','life_node.sailing.weather_reading',1),
  ('life_node.sailing.cargo_handling','life_node.sailing.seamanship',2),
  ('life_node.sailing.deep_sea_navigation','life_node.sailing.offshore_navigation',1),
  ('life_node.sailing.deep_sea_navigation','life_node.sailing.cargo_handling',1)
on conflict (node_id,prerequisite_node_id) do nothing;
