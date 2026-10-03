// INHA WORLD Life Progression P0 Registry.
// Keeps aggregate Life Level / SP / Skill Tree semantics in code while player state stays server-authoritative.
import { LIFE_SKILL_REGISTRY, LIFE_SKILL_STATUS } from './life-skill-registry.js';

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
  if (!Number.isInteger(raw.requiredLifeLevel) || raw.requiredLifeLevel < 1 || raw.requiredLifeLevel > 999) {
    throw new TypeError(`Invalid requiredLifeLevel for ${raw.nodeId}`);
  }
  if (!Number.isInteger(raw.requiredSkillLevel) || raw.requiredSkillLevel < 1 || raw.requiredSkillLevel > 999) {
    throw new TypeError(`Invalid requiredSkillLevel for ${raw.nodeId}`);
  }
  if (!Array.isArray(raw.prerequisites) || raw.prerequisites.some(id =>
    typeof id !== 'string' || !LIFE_TREE_NODE_ID_PATTERN.test(id))) {
    throw new TypeError(`Invalid prerequisites for ${raw.nodeId}`);
  }
  if (new Set(raw.prerequisites).size !== raw.prerequisites.length || raw.prerequisites.includes(raw.nodeId)) {
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
    requiredLifeLevel: raw.requiredLifeLevel,
    requiredSkillLevel: raw.requiredSkillLevel,
    prerequisites: Object.freeze([...raw.prerequisites]),
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
    for (const prerequisiteId of node.prerequisites) {
      const prerequisite = byId.get(prerequisiteId);
      if (!prerequisite) throw new Error(`Unknown prerequisite ${prerequisiteId} for ${node.nodeId}`);
      if (prerequisite.skillId !== node.skillId) {
        throw new Error(`Cross-skill prerequisite ${prerequisiteId} for ${node.nodeId}`);
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(nodeId) {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) throw new Error(`Cycle detected at ${nodeId}`);
    visiting.add(nodeId);
    for (const prerequisiteId of byId.get(nodeId).prerequisites) visit(prerequisiteId);
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
    required_life_level: node.requiredLifeLevel,
    required_skill_level: node.requiredSkillLevel
  });
}

export function lifeProgressionFreshSnapshot() {
  return Object.freeze({
    curveId: LIFE_PROGRESSION_CURVE_ID,
    totalSkillXp: 0,
    level: 1,
    earnedSp: 0,
    spentSp: 0,
    availableSp: 0,
    currentLevelStartXp: 0,
    nextLevelXp: null,
    progressXp: 0,
    progressRequired: null,
    maxDefinedLevel: 1,
    isMaxLevel: true
  });
}
