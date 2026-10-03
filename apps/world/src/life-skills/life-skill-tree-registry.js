// INHA WORLD Life Skill Tree v1 pure Registry.
// Product-semantic canon for node identity, costs, gates and prerequisite graph.
// Persistent player ranks remain server-authoritative.

export const LIFE_SKILL_NODE_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  COMING_SOON: 'COMING_SOON',
  DISABLED: 'DISABLED',
  HIDDEN: 'HIDDEN'
});

export const LIFE_SKILL_TREE_ID_PATTERN = /^life_tree\.[a-z][a-z0-9_]*$/;
export const LIFE_SKILL_NODE_ID_PATTERN = /^life_node\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
export const LIFE_SKILL_EFFECT_KEY_PATTERN = /^[a-z][a-z0-9_.:-]{0,159}$/;

const statuses = new Set(Object.values(LIFE_SKILL_NODE_STATUS));

export function createLifeSkillNodeDefinition(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Life Skill node definition must be an object');
  }
  if (typeof raw.nodeId !== 'string' || !LIFE_SKILL_NODE_ID_PATTERN.test(raw.nodeId) || raw.nodeId.length > 140) {
    throw new TypeError('Invalid Life Skill nodeId');
  }
  if (typeof raw.treeId !== 'string' || !LIFE_SKILL_TREE_ID_PATTERN.test(raw.treeId) || raw.treeId.length > 100) {
    throw new TypeError(`Invalid treeId for ${raw.nodeId}`);
  }
  if (!Number.isInteger(raw.maxRank) || raw.maxRank < 1 || raw.maxRank > 100) {
    throw new TypeError(`Invalid maxRank for ${raw.nodeId}`);
  }
  if (!Number.isInteger(raw.pointCost) || raw.pointCost < 1 || raw.pointCost > 10) {
    throw new TypeError(`Invalid pointCost for ${raw.nodeId}`);
  }
  if (!Number.isInteger(raw.requiredLifeLevel) || raw.requiredLifeLevel < 1) {
    throw new TypeError(`Invalid requiredLifeLevel for ${raw.nodeId}`);
  }
  if (typeof raw.effectKey !== 'string' || !LIFE_SKILL_EFFECT_KEY_PATTERN.test(raw.effectKey)) {
    throw new TypeError(`Invalid effectKey for ${raw.nodeId}`);
  }
  if (!statuses.has(raw.status)) throw new TypeError(`Invalid status for ${raw.nodeId}`);
  if (!Number.isInteger(raw.definitionVersion) || raw.definitionVersion < 1) {
    throw new TypeError(`Invalid definitionVersion for ${raw.nodeId}`);
  }

  const prerequisites = raw.prerequisites ?? [];
  if (!Array.isArray(prerequisites)) throw new TypeError(`Invalid prerequisites for ${raw.nodeId}`);
  const normalizedPrerequisites = prerequisites.map((prerequisite) => {
    if (!prerequisite || typeof prerequisite !== 'object' ||
        typeof prerequisite.nodeId !== 'string' ||
        !LIFE_SKILL_NODE_ID_PATTERN.test(prerequisite.nodeId) ||
        !Number.isInteger(prerequisite.requiredRank) ||
        prerequisite.requiredRank < 1) {
      throw new TypeError(`Invalid prerequisite for ${raw.nodeId}`);
    }
    return Object.freeze({
      nodeId: prerequisite.nodeId,
      requiredRank: prerequisite.requiredRank
    });
  });

  return Object.freeze({
    nodeId: raw.nodeId,
    treeId: raw.treeId,
    displayName: String(raw.displayName ?? '').trim(),
    maxRank: raw.maxRank,
    pointCost: raw.pointCost,
    requiredLifeLevel: raw.requiredLifeLevel,
    requiredSkillId: raw.requiredSkillId ?? null,
    requiredSkillLevel: raw.requiredSkillLevel ?? null,
    effectKey: raw.effectKey,
    status: raw.status,
    definitionVersion: raw.definitionVersion,
    prerequisites: Object.freeze(normalizedPrerequisites)
  });
}

const comingSoon = ({
  nodeId, treeId, displayName, maxRank, pointCost, requiredLifeLevel,
  effectKey, prerequisites = []
}) => createLifeSkillNodeDefinition({
  nodeId,
  treeId,
  displayName,
  maxRank,
  pointCost,
  requiredLifeLevel,
  requiredSkillId: null,
  requiredSkillLevel: null,
  effectKey,
  status: LIFE_SKILL_NODE_STATUS.COMING_SOON,
  definitionVersion: 1,
  prerequisites
});

export const DEFAULT_LIFE_SKILL_NODE_DEFINITIONS = Object.freeze([
  // Fishing · full investment 17 SP.
  comingSoon({ nodeId: 'life_node.fishing.steady_hands', treeId: 'life_tree.fishing',
    displayName: '안정된 손놀림', maxRank: 3, pointCost: 1, requiredLifeLevel: 2,
    effectKey: 'fishing.bite_window.v1' }),
  comingSoon({ nodeId: 'life_node.fishing.fish_sense', treeId: 'life_tree.fishing',
    displayName: '어군 감지', maxRank: 3, pointCost: 1, requiredLifeLevel: 3,
    effectKey: 'fishing.fish_sense.v1',
    prerequisites: [{ nodeId: 'life_node.fishing.steady_hands', requiredRank: 1 }] }),
  comingSoon({ nodeId: 'life_node.fishing.baitcraft', treeId: 'life_tree.fishing',
    displayName: '미끼 제작', maxRank: 2, pointCost: 1, requiredLifeLevel: 5,
    effectKey: 'fishing.baitcraft.v1',
    prerequisites: [{ nodeId: 'life_node.fishing.steady_hands', requiredRank: 1 }] }),
  comingSoon({ nodeId: 'life_node.fishing.rare_fish_sense', treeId: 'life_tree.fishing',
    displayName: '희귀어 탐지', maxRank: 2, pointCost: 2, requiredLifeLevel: 8,
    effectKey: 'fishing.rare_fish_sense.v1',
    prerequisites: [{ nodeId: 'life_node.fishing.fish_sense', requiredRank: 2 }] }),
  comingSoon({ nodeId: 'life_node.fishing.boat_fishing', treeId: 'life_tree.fishing',
    displayName: '선상 낚시', maxRank: 1, pointCost: 2, requiredLifeLevel: 10,
    effectKey: 'fishing.boat_fishing.v1',
    prerequisites: [{ nodeId: 'life_node.fishing.fish_sense', requiredRank: 2 }] }),
  comingSoon({ nodeId: 'life_node.fishing.deep_sea_fishing', treeId: 'life_tree.fishing',
    displayName: '심해 어업', maxRank: 1, pointCost: 3, requiredLifeLevel: 15,
    effectKey: 'fishing.deep_sea_fishing.v1',
    prerequisites: [
      { nodeId: 'life_node.fishing.rare_fish_sense', requiredRank: 1 },
      { nodeId: 'life_node.fishing.boat_fishing', requiredRank: 1 }
    ] }),

  // Woodcutting · full investment 17 SP.
  comingSoon({ nodeId: 'life_node.woodcutting.clean_cut', treeId: 'life_tree.woodcutting',
    displayName: '정교한 벌목', maxRank: 3, pointCost: 1, requiredLifeLevel: 2,
    effectKey: 'woodcutting.clean_cut.v1' }),
  comingSoon({ nodeId: 'life_node.woodcutting.timber_eye', treeId: 'life_tree.woodcutting',
    displayName: '목재 감별', maxRank: 3, pointCost: 1, requiredLifeLevel: 4,
    effectKey: 'woodcutting.timber_eye.v1',
    prerequisites: [{ nodeId: 'life_node.woodcutting.clean_cut', requiredRank: 1 }] }),
  comingSoon({ nodeId: 'life_node.woodcutting.tool_care', treeId: 'life_tree.woodcutting',
    displayName: '도구 관리', maxRank: 2, pointCost: 1, requiredLifeLevel: 5,
    effectKey: 'woodcutting.tool_care.v1',
    prerequisites: [{ nodeId: 'life_node.woodcutting.clean_cut', requiredRank: 1 }] }),
  comingSoon({ nodeId: 'life_node.woodcutting.hardwood_handling', treeId: 'life_tree.woodcutting',
    displayName: '경목 처리', maxRank: 2, pointCost: 2, requiredLifeLevel: 8,
    effectKey: 'woodcutting.hardwood_handling.v1',
    prerequisites: [{ nodeId: 'life_node.woodcutting.timber_eye', requiredRank: 2 }] }),
  comingSoon({ nodeId: 'life_node.woodcutting.field_sawmill', treeId: 'life_tree.woodcutting',
    displayName: '현장 제재', maxRank: 1, pointCost: 2, requiredLifeLevel: 10,
    effectKey: 'woodcutting.field_sawmill.v1',
    prerequisites: [{ nodeId: 'life_node.woodcutting.tool_care', requiredRank: 2 }] }),
  comingSoon({ nodeId: 'life_node.woodcutting.master_forester', treeId: 'life_tree.woodcutting',
    displayName: '숙련 산림가', maxRank: 1, pointCost: 3, requiredLifeLevel: 15,
    effectKey: 'woodcutting.master_forester.v1',
    prerequisites: [
      { nodeId: 'life_node.woodcutting.hardwood_handling', requiredRank: 1 },
      { nodeId: 'life_node.woodcutting.field_sawmill', requiredRank: 1 }
    ] }),

  // Farming · full investment 17 SP.
  comingSoon({ nodeId: 'life_node.farming.soil_reading', treeId: 'life_tree.farming',
    displayName: '토양 이해', maxRank: 3, pointCost: 1, requiredLifeLevel: 2,
    effectKey: 'farming.soil_reading.v1' }),
  comingSoon({ nodeId: 'life_node.farming.seed_selection', treeId: 'life_tree.farming',
    displayName: '종자 선별', maxRank: 3, pointCost: 1, requiredLifeLevel: 4,
    effectKey: 'farming.seed_selection.v1',
    prerequisites: [{ nodeId: 'life_node.farming.soil_reading', requiredRank: 1 }] }),
  comingSoon({ nodeId: 'life_node.farming.water_sense', treeId: 'life_tree.farming',
    displayName: '수분 관리', maxRank: 2, pointCost: 1, requiredLifeLevel: 5,
    effectKey: 'farming.water_sense.v1',
    prerequisites: [{ nodeId: 'life_node.farming.soil_reading', requiredRank: 1 }] }),
  comingSoon({ nodeId: 'life_node.farming.greenhouse', treeId: 'life_tree.farming',
    displayName: '온실 재배', maxRank: 2, pointCost: 2, requiredLifeLevel: 8,
    effectKey: 'farming.greenhouse.v1',
    prerequisites: [{ nodeId: 'life_node.farming.seed_selection', requiredRank: 2 }] }),
  comingSoon({ nodeId: 'life_node.farming.crop_rotation', treeId: 'life_tree.farming',
    displayName: '윤작', maxRank: 1, pointCost: 2, requiredLifeLevel: 10,
    effectKey: 'farming.crop_rotation.v1',
    prerequisites: [{ nodeId: 'life_node.farming.water_sense', requiredRank: 2 }] }),
  comingSoon({ nodeId: 'life_node.farming.smart_farm', treeId: 'life_tree.farming',
    displayName: '스마트 농장', maxRank: 1, pointCost: 3, requiredLifeLevel: 15,
    effectKey: 'farming.smart_farm.v1',
    prerequisites: [
      { nodeId: 'life_node.farming.greenhouse', requiredRank: 1 },
      { nodeId: 'life_node.farming.crop_rotation', requiredRank: 1 }
    ] }),

  // Sailing · full investment 17 SP. Vehicle/technology unlocks remain outside this tree.
  comingSoon({ nodeId: 'life_node.sailing.seamanship', treeId: 'life_tree.sailing',
    displayName: '기초 선박술', maxRank: 3, pointCost: 1, requiredLifeLevel: 2,
    effectKey: 'sailing.seamanship.v1' }),
  comingSoon({ nodeId: 'life_node.sailing.coastal_navigation', treeId: 'life_tree.sailing',
    displayName: '연안 항법', maxRank: 3, pointCost: 1, requiredLifeLevel: 4,
    effectKey: 'sailing.coastal_navigation.v1',
    prerequisites: [{ nodeId: 'life_node.sailing.seamanship', requiredRank: 1 }] }),
  comingSoon({ nodeId: 'life_node.sailing.weather_reading', treeId: 'life_tree.sailing',
    displayName: '기상 판독', maxRank: 2, pointCost: 1, requiredLifeLevel: 5,
    effectKey: 'sailing.weather_reading.v1',
    prerequisites: [{ nodeId: 'life_node.sailing.seamanship', requiredRank: 1 }] }),
  comingSoon({ nodeId: 'life_node.sailing.offshore_navigation', treeId: 'life_tree.sailing',
    displayName: '원양 항법', maxRank: 2, pointCost: 2, requiredLifeLevel: 8,
    effectKey: 'sailing.offshore_navigation.v1',
    prerequisites: [
      { nodeId: 'life_node.sailing.coastal_navigation', requiredRank: 2 },
      { nodeId: 'life_node.sailing.weather_reading', requiredRank: 1 }
    ] }),
  comingSoon({ nodeId: 'life_node.sailing.cargo_handling', treeId: 'life_tree.sailing',
    displayName: '화물 운용', maxRank: 1, pointCost: 2, requiredLifeLevel: 10,
    effectKey: 'sailing.cargo_handling.v1',
    prerequisites: [{ nodeId: 'life_node.sailing.seamanship', requiredRank: 2 }] }),
  comingSoon({ nodeId: 'life_node.sailing.deep_sea_navigation', treeId: 'life_tree.sailing',
    displayName: '심해 항해', maxRank: 1, pointCost: 3, requiredLifeLevel: 15,
    effectKey: 'sailing.deep_sea_navigation.v1',
    prerequisites: [
      { nodeId: 'life_node.sailing.offshore_navigation', requiredRank: 1 },
      { nodeId: 'life_node.sailing.cargo_handling', requiredRank: 1 }
    ] })
]);

export function createLifeSkillTreeRegistry({ definitions = DEFAULT_LIFE_SKILL_NODE_DEFINITIONS } = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const node = createLifeSkillNodeDefinition(raw);
    if (byId.has(node.nodeId)) throw new Error(`Duplicate Life Skill nodeId: ${node.nodeId}`);
    byId.set(node.nodeId, node);
  }

  for (const node of byId.values()) {
    const seen = new Set();
    for (const prerequisite of node.prerequisites) {
      if (seen.has(prerequisite.nodeId)) throw new Error(`Duplicate prerequisite: ${node.nodeId}`);
      seen.add(prerequisite.nodeId);
      if (prerequisite.nodeId === node.nodeId) throw new Error(`Self prerequisite: ${node.nodeId}`);
      const parent = byId.get(prerequisite.nodeId);
      if (!parent) throw new Error(`Missing prerequisite ${prerequisite.nodeId} for ${node.nodeId}`);
      if (parent.treeId !== node.treeId) throw new Error(`Cross-tree prerequisite for ${node.nodeId}`);
      if (prerequisite.requiredRank > parent.maxRank) {
        throw new Error(`Prerequisite rank exceeds maxRank for ${node.nodeId}`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  const visit = (nodeId) => {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) throw new Error(`Life Skill node cycle detected at ${nodeId}`);
    visiting.add(nodeId);
    for (const prerequisite of byId.get(nodeId).prerequisites) visit(prerequisite.nodeId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of byId.keys()) visit(nodeId);

  return Object.freeze({
    get: nodeId => byId.get(nodeId) ?? null,
    has: nodeId => byId.has(nodeId),
    list: () => Object.freeze([...byId.values()]),
    listTree: treeId => Object.freeze([...byId.values()].filter(node => node.treeId === treeId)),
    get size() { return byId.size; }
  });
}

export const LIFE_SKILL_TREE_REGISTRY = createLifeSkillTreeRegistry();

export function lifeSkillNodeAuthorityRow(node) {
  return Object.freeze({
    node_id: node.nodeId,
    tree_id: node.treeId,
    max_rank: node.maxRank,
    point_cost: node.pointCost,
    required_life_level: node.requiredLifeLevel,
    required_skill_id: node.requiredSkillId,
    required_skill_level: node.requiredSkillLevel,
    effect_key: node.effectKey,
    status: node.status,
    definition_version: node.definitionVersion
  });
}

export function lifeSkillPrerequisiteAuthorityRows(node) {
  return Object.freeze(node.prerequisites.map(prerequisite => Object.freeze({
    node_id: node.nodeId,
    prerequisite_node_id: prerequisite.nodeId,
    required_rank: prerequisite.requiredRank
  })));
}

export function lifeSkillTreeFullRankCost(treeId, registry = LIFE_SKILL_TREE_REGISTRY) {
  return registry.listTree(treeId)
    .reduce((sum, node) => sum + (node.maxRank * node.pointCost), 0);
}
