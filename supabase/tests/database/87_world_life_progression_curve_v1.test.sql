-- INHA WORLD Life Progression v1 balance curve.
begin;
create extension if not exists pgtap with schema extensions;
select * from no_plan();

select results_eq($$
  select level,min_total_xp,skill_points_reward
    from private.world_life_progression_thresholds
   where curve_id='life.progression.v1'
   order by level
$$,$$values
  (1,0::bigint,0),
  (2,100::bigint,1),
  (3,300::bigint,1),
  (4,600::bigint,1),
  (5,1000::bigint,2),
  (6,1500::bigint,1),
  (7,2100::bigint,1),
  (8,2800::bigint,1),
  (9,3600::bigint,1),
  (10,4500::bigint,2),
  (11,5500::bigint,1),
  (12,6600::bigint,1),
  (13,7800::bigint,1),
  (14,9100::bigint,1),
  (15,10500::bigint,2),
  (16,12000::bigint,1),
  (17,13600::bigint,1),
  (18,15300::bigint,1),
  (19,17100::bigint,1),
  (20,19000::bigint,2)
$$,'Life Progression v1 defines the committed Lv1..20 XP/SP curve');

select is((
  select sum(skill_points_reward)
    from private.world_life_progression_thresholds
   where curve_id='life.progression.v1'
),23::bigint,'Lv20 has earned 23 total SP before any quest/achievement bonus');

select results_eq($$
  select level
    from private.world_life_progression_thresholds
   where curve_id='life.progression.v1'
     and skill_points_reward=2
   order by level
$$,$$values (5),(10),(15),(20)$$,
  'every fifth Life Level is a two-SP milestone');

select is(private.world_life_progression_level_for_xp_v1('life.progression.v1',99),1,
  '99 XP remains Life Lv1');
select is(private.world_life_progression_level_for_xp_v1('life.progression.v1',100),2,
  '100 XP reaches Life Lv2');
select is(private.world_life_progression_level_for_xp_v1('life.progression.v1',4499),9,
  '4499 XP remains Life Lv9');
select is(private.world_life_progression_level_for_xp_v1('life.progression.v1',4500),10,
  '4500 XP reaches milestone Life Lv10');
select is(private.world_life_progression_level_for_xp_v1('life.progression.v1',18999),19,
  '18999 XP remains Life Lv19');
select is(private.world_life_progression_level_for_xp_v1('life.progression.v1',19000),20,
  '19000 XP reaches the currently highest defined Life Lv20');
select is(private.world_life_progression_level_for_xp_v1('life.progression.v1',999999),20,
  'XP beyond the current range is retained at max-defined Life Lv20');

select throws_ok($$
  update private.world_life_progression_thresholds
     set skill_points_reward=9
   where curve_id='life.progression.v1' and level=10
$$,'42501','LIFE_PROGRESSION_CURVE_IMMUTABLE','published XP/SP curve rows are immutable');

select throws_ok($$
  insert into private.world_life_progression_thresholds(
    curve_id,level,min_total_xp,skill_points_reward
  ) values ('life.progression.v1',22,23100,1)
$$,'23514','LIFE_PROGRESSION_CURVE_INVALID','future Life levels must append sequentially from Lv21');

select * from finish();
rollback;
