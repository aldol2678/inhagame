-- INHA WORLD Life Progression v1 initial balance curve.
--
-- Defines the first playable aggregate Life Level range, Lv1..20.
-- Lv20 is the highest level currently defined, not a permanent product cap; future levels append.
-- XP follows the same triangular progression shape as Campus progression:
--   min_total_xp(level) = 50 * level * (level - 1)
-- SP: +1 on ordinary level-ups, +2 on every 5-level milestone.

insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',2,100,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',3,300,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',4,600,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',5,1000,2);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',6,1500,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',7,2100,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',8,2800,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',9,3600,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',10,4500,2);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',11,5500,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',12,6600,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',13,7800,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',14,9100,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',15,10500,2);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',16,12000,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',17,13600,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',18,15300,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',19,17100,1);
insert into private.world_life_progression_thresholds(curve_id,level,min_total_xp,skill_points_reward)
values ('life.progression.v1',20,19000,2);
