// INHA WORLD Life Skill Tree v1 node definitions (imported from #91, see
// docs/architecture/PR91_LIFE_PROGRESSION_SALVAGE.md). Data only; every node is COMING_SOON.
// Gates use the owning skill's level (#91 gated on aggregate Life Level). Node effects are not
// implemented yet; effectRefs name the effect a later consumer will read.

const node = (skill, key, displayName, maxRank, spCost, requiredSkillLevel, effectRef, prerequisites = []) => ({
  nodeId: `life.node.${skill}.${key}`,
  skillId: `life.${skill}`,
  displayName,
  description: `${displayName}: ${effectRef} 효과 노드 (효과 수치 미정).`,
  status: 'COMING_SOON',
  spCost,
  maxRank,
  requiredLifeLevel: 1,
  requiredSkillLevel,
  prerequisites: prerequisites.map(([prerequisite, requiredRank]) =>
    ({ nodeId: `life.node.${skill}.${prerequisite}`, requiredRank })),
  effectRefs: [effectRef],
  introducedVersion: 'life.tree.v1'
});

export const LIFE_SKILL_TREE_V1_NODE_DEFINITIONS = Object.freeze([
  // 낚시 · full tree 17 SP (reached exactly at skill Lv15).
  node('fishing', 'steady_hands', '안정된 손놀림', 3, 1, 2, 'fishing.bite_window.v1'),
  node('fishing', 'fish_sense', '어군 감지', 3, 1, 3, 'fishing.fish_sense.v1', [['steady_hands', 1]]),
  node('fishing', 'baitcraft', '미끼 제작', 2, 1, 5, 'fishing.baitcraft.v1', [['steady_hands', 1]]),
  node('fishing', 'rare_fish_sense', '희귀어 탐지', 2, 2, 8, 'fishing.rare_fish_sense.v1', [['fish_sense', 2]]),
  node('fishing', 'boat_fishing', '선상 낚시', 1, 2, 10, 'fishing.boat_fishing.v1', [['fish_sense', 2]]),
  node('fishing', 'deep_sea_fishing', '심해 어업', 1, 3, 15, 'fishing.deep_sea_fishing.v1', [['rare_fish_sense', 1], ['boat_fishing', 1]]),
  // 벌목 · full tree 17 SP (reached exactly at skill Lv15).
  node('woodcutting', 'clean_cut', '정교한 벌목', 3, 1, 2, 'woodcutting.clean_cut.v1'),
  node('woodcutting', 'timber_eye', '목재 감별', 3, 1, 4, 'woodcutting.timber_eye.v1', [['clean_cut', 1]]),
  node('woodcutting', 'tool_care', '도구 관리', 2, 1, 5, 'woodcutting.tool_care.v1', [['clean_cut', 1]]),
  node('woodcutting', 'hardwood_handling', '경목 처리', 2, 2, 8, 'woodcutting.hardwood_handling.v1', [['timber_eye', 2]]),
  node('woodcutting', 'field_sawmill', '현장 제재', 1, 2, 10, 'woodcutting.field_sawmill.v1', [['tool_care', 2]]),
  node('woodcutting', 'master_forester', '숙련 산림가', 1, 3, 15, 'woodcutting.master_forester.v1', [['hardwood_handling', 1], ['field_sawmill', 1]]),
  // 재배 · full tree 17 SP (reached exactly at skill Lv15).
  node('farming', 'soil_reading', '토양 이해', 3, 1, 2, 'farming.soil_reading.v1'),
  node('farming', 'seed_selection', '종자 선별', 3, 1, 4, 'farming.seed_selection.v1', [['soil_reading', 1]]),
  node('farming', 'water_sense', '수분 관리', 2, 1, 5, 'farming.water_sense.v1', [['soil_reading', 1]]),
  node('farming', 'greenhouse', '온실 재배', 2, 2, 8, 'farming.greenhouse.v1', [['seed_selection', 2]]),
  node('farming', 'crop_rotation', '윤작', 1, 2, 10, 'farming.crop_rotation.v1', [['water_sense', 2]]),
  node('farming', 'smart_farm', '스마트 농장', 1, 3, 15, 'farming.smart_farm.v1', [['greenhouse', 1], ['crop_rotation', 1]])
]);
