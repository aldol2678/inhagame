export const PERIODS = Object.freeze(['morning', 'class_time', 'lunch', 'evening']);
export const DISTRIBUTION = Object.freeze({student: 10, club_member: 3, teaching_assistant: 2, staff: 2, faculty: 1, shop_worker: 2});
export const LOCATIONS = Object.freeze([
  'inkyung_spawn', 'inkyung_bench_east', 'inkyung_bench_west', 'inkyung_walkway',
  'inkyung_waterfront', 'inkyung_photo_point', 'transit_to_main_hall',
  'transit_to_student_center', 'transit_to_building',
  'class_building_2', 'class_building_4', 'class_building_5', 'class_building_6',
  'class_building_9', 'class_hitech', 'class_seoho', 'class_lawschool', 'class_60th',
  'study_jungseok', 'life_student_center',
  'life_back_market_67', 'life_back_market_91', 'life_back_market_west',
  'life_back_market_north', 'life_back_gate', 'life_dorm_1', 'life_dorm_2',
  'off_zone'
]);
export const ACTIVITIES = Object.freeze(['idle', 'walk', 'sit', 'drink_coffee', 'use_phone', 'read', 'talk_with_friend', 'take_photo', 'listen_to_music', 'eat_snack', 'wait', 'walk_to_class', 'walk_to_club', 'leave_zone']);
export const SOCIAL_MODES = Object.freeze(['low', 'medium', 'high']);
export const RELATIONSHIP_TYPES = Object.freeze(['friend', 'acquaintance', 'clubmate', 'coworker']);
export const BEHAVIOR_TAGS = Object.freeze(['observant', 'reserved', 'outgoing', 'reader', 'photographer', 'coffee_fan', 'club_goer', 'helpful', 'commuter', 'music_fan', 'routine_oriented', 'slow_paced']);
export const FORBIDDEN_CAPABILITIES = Object.freeze(['is_authored_npc', 'can_start_quest', 'can_change_world_state', 'can_create_group', 'can_modify_relationships_autonomously']);
