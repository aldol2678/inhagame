// INHA WORLD Life Progression P0 Registry.
// Keeps aggregate Life Level / SP / Skill Tree semantics in code while player state stays server-authoritative.
import {
  LIFE_SKILL_REGISTRY,
  LIFE_SKILL_STATUS,
  lifeSkillCurvePosition
} from './life-skill-registry.js';

export const LIFE_PROGRESSION_CURVE_ID = 'life.progression.v1';

export const LIFE_PROGRESSION_THRESHOLDS = Object.freeze([
  Object.freeze({ curveId: LIFE_PROGRESSION_CURVE_ID, level: 1, minTotalSkillXp: 0, cumulativeSp: 0 })
]);

export const LIFE_TREE_NODE_ID_PATTERN = /^life\.node\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const statuses = new Set(Object.values(LIFE_SKILL_STATUS));

export function createLifeSkillTreeNodeDefinition(raw, { skillRegistry = LIFE_SKILL_REGISTRY } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Life Skill Tree node must be an object');
  }
  if (typeof raw.nodeId !== 'string' || !LIFE_TREE_NODE_ID_PATTERN.test(raw.nodeId) || raw.nodeId.length > 120) {
    throw new TypeError('Invalid nodeId');
  }
  if (typeof raw.skillId !== 'string' || !skillRegistry.has(raw.skillId)) {
    throw new TypeError(`Unknown skillId for ${raw.nodeId}`);
  }
  if (typeof raw.displayName !== 'string' || !raw.displayName.trim()) {
    throw new TypeError(`Invalid displayName for ${raw.nodeId}`);
  }
  if (typeof raw.description !== 'string' || !raw.description.trim()) {
    throw new TypeError(`Invalid description for ${raw.nodeId}`);
  }
  if (!statuses.has(raw.status)) throw new TypeError(`Invalid status for ${raw.nodeId}`);
  if (!Number.isInteger(raw.spCost) || raw.spCost < 1 || raw.spCost > 99) {
    throw new TypeError(`Invalid spCost for ${raw.nodeId}`);
  }
  const maxRank = raw.maxRank ?? 1;
  if (!Number.isInteger(maxRank) || maxRank < 1 || maxRank > 10) {
    throw new TypeError(`Invalid maxRank for ${raw.nodeId}`);
  }
  if (!Number.isInteger(raw.requiredLifeLevel) || raw.requiredLifeLevel < 1 || raw.requiredLifeLevel > 999) {
    throw new TypeError(`Invalid requiredLifeLevel for ${raw.nodeId}`);
  }
  if (!Number.isInteger(raw.requiredSkillLevel) || raw.requiredSkillLevel < 1 || raw.requiredSkillLevel > 999) {
    throw new TypeError(`Invalid requiredSkillLevel for ${raw.nodeId}`);
  }
  // A prerequisite is a node id (rank 1) or { nodeId, requiredRank }.
  if (!Array.isArray(raw.prerequisites)) throw new TypeError(`Invalid prerequisites for ${raw.nodeId}`);
  const prerequisites = raw.prerequisites.map(entry => {
    const prerequisite = typeof entry === 'string' ? { nodeId: entry, requiredRank: 1 } : entry;
    if (!prerequisite || typeof prerequisite !== 'object' ||
        typeof prerequisite.nodeId !== 'string' || !LIFE_TREE_NODE_ID_PATTERN.test(prerequisite.nodeId) ||
        !Number.isInteger(prerequisite.requiredRank) || prerequisite.requiredRank < 1) {
      throw new TypeError(`Invalid prerequisites for ${raw.nodeId}`);
    }
    return Object.freeze({ nodeId: prerequisite.nodeId, requiredRank: prerequisite.requiredRank });
  });
  const prerequisiteIds = prerequisites.map(prerequisite => prerequisite.nodeId);
  if (new Set(prerequisiteIds).size !== prerequisiteIds.length || prerequisiteIds.includes(raw.nodeId)) {
    throw new TypeError(`Invalid prerequisite set for ${raw.nodeId}`);
  }
  if (!Array.isArray(raw.effectRefs) || raw.effectRefs.some(ref =>
    typeof ref !== 'string' || !/^[a-z][a-z0-9_.:-]{1,119}$/.test(ref))) {
    throw new TypeError(`Invalid effectRefs for ${raw.nodeId}`);
  }

  return Object.freeze({
    nodeId: raw.nodeId,
    skillId: raw.skillId,
    displayName: raw.displayName.trim(),
    description: raw.description.trim(),
    status: raw.status,
    spCost: raw.spCost,
    maxRank,
    requiredLifeLevel: raw.requiredLifeLevel,
    requiredSkillLevel: raw.requiredSkillLevel,
    prerequisites: Object.freeze(prerequisites),
    effectRefs: Object.freeze([...raw.effectRefs]),
    introducedVersion: raw.introducedVersion ?? 'life.progression.p0'
  });
}

export const DEFAULT_LIFE_SKILL_TREE_NODES = Object.freeze([]);

export function createLifeSkillTreeRegistry({
  definitions = DEFAULT_LIFE_SKILL_TREE_NODES,
  skillRegistry = LIFE_SKILL_REGISTRY
} = {}) {
  const byId = new Map();
  for (const raw of definitions) {
    const node = createLifeSkillTreeNodeDefinition(raw, { skillRegistry });
    if (byId.has(node.nodeId)) throw new Error(`Duplicate nodeId: ${node.nodeId}`);
    byId.set(node.nodeId, node);
  }

  for (const node of byId.values()) {
    for (const { nodeId: prerequisiteId, requiredRank } of node.prerequisites) {
      const prerequisite = byId.get(prerequisiteId);
      if (!prerequisite) throw new Error(`Unknown prerequisite ${prerequisiteId} for ${node.nodeId}`);
      if (prerequisite.skillId !== node.skillId) {
        throw new Error(`Cross-skill prerequisite ${prerequisiteId} for ${node.nodeId}`);
      }
      if (requiredRank > prerequisite.maxRank) {
        throw new Error(`Prerequisite rank ${requiredRank} exceeds ${prerequisiteId} max rank`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(nodeId) {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) throw new Error(`Cycle detected at ${nodeId}`);
    visiting.add(nodeId);
    for (const prerequisite of byId.get(nodeId).prerequisites) visit(prerequisite.nodeId);
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  for (const nodeId of byId.keys()) visit(nodeId);

  return Object.freeze({
    get: nodeId => byId.get(nodeId) ?? null,
    has: nodeId => byId.has(nodeId),
    list: () => Object.freeze([...byId.values()]),
    forSkill: skillId => Object.freeze([...byId.values()].filter(node => node.skillId === skillId)),
    get size() { return byId.size; }
  });
}

export const LIFE_SKILL_TREE_REGISTRY = createLifeSkillTreeRegistry();

export function lifeProgressionThresholdAuthorityRows() {
  return Object.freeze(LIFE_PROGRESSION_THRESHOLDS.map(row => Object.freeze({
    curve_id: row.curveId,
    level: row.level,
    min_total_skill_xp: row.minTotalSkillXp,
    cumulative_sp: row.cumulativeSp
  })));
}

export function lifeTreeAuthorityRow(node) {
  if (!node) throw new TypeError('Life Skill Tree node is required');
  return Object.freeze({
    node_id: node.nodeId,
    skill_id: node.skillId,
    status: node.status,
    sp_cost: node.spCost,
    max_rank: node.maxRank,
    required_life_level: node.requiredLifeLevel,
    required_skill_level: node.requiredSkillLevel
  });
}

export function lifeTreeEdgeAuthorityRows(node) {
  if (!node) throw new TypeError('Life Skill Tree node is required');
  return Object.freeze(node.prerequisites.map(prerequisite => Object.freeze({
    node_id: node.nodeId,
    prerequisite_node_id: prerequisite.nodeId,
    required_rank: prerequisite.requiredRank
  })));
}

// Aggregate Life Level is a display level only. SP lives in per-skill pools (Authority Map 7.1).
export function lifeProgressionFreshSnapshot() {
  return Object.freeze({
    curveId: LIFE_PROGRESSION_CURVE_ID,
    totalSkillXp: 0,
    level: 1,
    currentLevelStartXp: 0,
    nextLevelXp: null,
    progressXp: 0,
    progressRequired: null,
    maxDefinedLevel: 1,
    isMaxLevel: true
  });
}

// Fresh per-skill SP pool: earned from the owning skill's level, spent only in that skill's tree.
export function lifeSkillSpFreshSnapshot(definition) {
  if (!definition) throw new TypeError('Life Skill definition is required');
  const position = lifeSkillCurvePosition(definition.curveId, 0);
  return Object.freeze({
    skillId: definition.skillId,
    curveId: definition.curveId,
    skillLevel: position.level,
    earnedSp: position.earnedSp,
    spentSp: 0,
    availableSp: position.earnedSp,
    nextLevelEarnedSp: position.nextLevelEarnedSp
  });
}
