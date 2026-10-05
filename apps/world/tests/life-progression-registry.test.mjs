import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIFE_SKILL_CURVE_THRESHOLDS,
  LIFE_SKILL_REGISTRY,
  LIFE_SKILL_STATUS
} from '../src/life-skills/life-skill-registry.js';
import {
  LIFE_PROGRESSION_CURVE_ID,
  LIFE_PROGRESSION_THRESHOLDS,
  LIFE_SKILL_TREE_REGISTRY,
  createLifeSkillTreeRegistry,
  lifeProgressionFreshSnapshot,
  lifeProgressionThresholdAuthorityRows,
  lifeSkillSpFreshSnapshot,
  lifeTreeAuthorityRow,
  lifeTreeEdgeAuthorityRows,
  lifeTreeResetFreshState,
  LIFE_TREE_RESET_DEFAULT_COOLDOWN_SECONDS
} from '../src/life-skills/life-progression-registry.js';

const node = (overrides = {}) => ({
  nodeId: 'life.node.mining.root',
  skillId: 'life.mining',
  displayName: '광부의 감각',
  description: '채광 스킬트리의 구조 검증용 루트 노드.',
  status: LIFE_SKILL_STATUS.COMING_SOON,
  spCost: 1,
  requiredLifeLevel: 2,
  requiredSkillLevel: 2,
  prerequisites: [],
  effectRefs: [],
  ...overrides
});

test('aggregate Life Progression curve seeds only Lv1', () => {
  assert.equal(LIFE_PROGRESSION_CURVE_ID, 'life.progression.v1');
  assert.deepEqual(LIFE_PROGRESSION_THRESHOLDS, [
    { curveId: 'life.progression.v1', level: 1, minTotalSkillXp: 0, cumulativeSp: 0 }
  ]);
  assert.deepEqual(lifeProgressionThresholdAuthorityRows(), [{
    curve_id: 'life.progression.v1',
    level: 1,
    min_total_skill_xp: 0,
    cumulative_sp: 0
  }]);
});

test('fresh aggregate Life Progression snapshot is a display level without a shared SP pool', () => {
  const snapshot = lifeProgressionFreshSnapshot();
  assert.deepEqual(snapshot, {
    curveId: 'life.progression.v1',
    totalSkillXp: 0,
    level: 1,
    currentLevelStartXp: 0,
    nextLevelXp: null,
    progressXp: 0,
    progressRequired: null,
    maxDefinedLevel: 1,
    isMaxLevel: true
  });
  assert.equal('earnedSp' in snapshot, false);
  assert.equal('availableSp' in snapshot, false);
});

test('fresh per-skill SP pool starts at skill Lv1 with zero SP and names the next award', () => {
  const snapshot = lifeSkillSpFreshSnapshot(LIFE_SKILL_REGISTRY.get('life.fishing'));
  assert.deepEqual(snapshot, {
    skillId: 'life.fishing',
    curveId: 'life.common.v1',
    skillLevel: 1,
    earnedSp: 0,
    spentSp: 0,
    availableSp: 0,
    nextLevelEarnedSp: 1
  });
  assert.ok(Object.isFrozen(snapshot));
});

test('tree registry accepts a valid same-skill dependency graph', () => {
  const registry = createLifeSkillTreeRegistry({ definitions: [
    node(),
    node({
      nodeId: 'life.node.mining.ore_sense',
      displayName: '광맥 감지',
      prerequisites: ['life.node.mining.root']
    })
  ] });
  assert.equal(registry.size, 2);
  assert.deepEqual(registry.forSkill('life.mining').map(entry => entry.nodeId), [
    'life.node.mining.root',
    'life.node.mining.ore_sense'
  ]);
});

test('tree registry rejects missing prerequisites, cross-skill edges and cycles', () => {
  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [
    node({ prerequisites: ['life.node.mining.missing'] })
  ] }), /Unknown prerequisite/);

  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [
    node(),
    node({
      nodeId: 'life.node.fishing.cross',
      skillId: 'life.fishing',
      displayName: '교차',
      prerequisites: ['life.node.mining.root']
    })
  ] }), /Cross-skill prerequisite/);

  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [
    node({ prerequisites: ['life.node.mining.ore_sense'] }),
    node({
      nodeId: 'life.node.mining.ore_sense',
      displayName: '광맥 감지',
      prerequisites: ['life.node.mining.root']
    })
  ] }), /Cycle detected/);
});

test('multi-rank nodes: maxRank defaults to 1 and prerequisites carry a required rank', () => {
  const registry = createLifeSkillTreeRegistry({ definitions: [
    node({ maxRank: 3 }),
    node({
      nodeId: 'life.node.mining.ore_sense',
      displayName: '광맥 감지',
      prerequisites: [{ nodeId: 'life.node.mining.root', requiredRank: 2 }]
    }),
    node({
      nodeId: 'life.node.mining.vein',
      displayName: '광맥 추적',
      prerequisites: ['life.node.mining.ore_sense']
    })
  ] });
  assert.equal(registry.get('life.node.mining.root').maxRank, 3);
  assert.equal(registry.get('life.node.mining.ore_sense').maxRank, 1);
  assert.deepEqual(registry.get('life.node.mining.vein').prerequisites,
    [{ nodeId: 'life.node.mining.ore_sense', requiredRank: 1 }]);
  assert.equal(lifeTreeAuthorityRow(registry.get('life.node.mining.root')).max_rank, 3);
  assert.deepEqual(lifeTreeEdgeAuthorityRows(registry.get('life.node.mining.ore_sense')), [{
    node_id: 'life.node.mining.ore_sense',
    prerequisite_node_id: 'life.node.mining.root',
    required_rank: 2
  }]);
});

test('tree registry rejects invalid ranks and prerequisite ranks above the prerequisite max rank', () => {
  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [node({ maxRank: 0 })] }), /Invalid maxRank/);
  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [node({ maxRank: 11 })] }), /Invalid maxRank/);
  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [
    node({ prerequisites: [{ nodeId: 'life.node.mining.other', requiredRank: 0 }] })
  ] }), /Invalid prerequisites/);
  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [
    node({ maxRank: 2 }),
    node({
      nodeId: 'life.node.mining.ore_sense',
      displayName: '광맥 감지',
      prerequisites: [{ nodeId: 'life.node.mining.root', requiredRank: 3 }]
    })
  ] }), /exceeds/);
});

test('tree v1: 18 nodes, only implemented Fishing timing effects ACTIVE, 17 SP per tree', () => {
  const nodes = LIFE_SKILL_TREE_REGISTRY.list();
  assert.equal(nodes.length, 18);
  assert.deepEqual(nodes.filter(entry => entry.status === LIFE_SKILL_STATUS.ACTIVE).map(entry => entry.nodeId).sort(), [
    'life.node.fishing.fish_sense',
    'life.node.fishing.steady_hands'
  ]);
  assert.ok(nodes.filter(entry => entry.status !== LIFE_SKILL_STATUS.ACTIVE)
    .every(entry => entry.status === LIFE_SKILL_STATUS.COMING_SOON));
  assert.ok(nodes.every(entry => entry.requiredLifeLevel === 1));
  for (const skillId of ['life.fishing', 'life.woodcutting', 'life.farming']) {
    const tree = LIFE_SKILL_TREE_REGISTRY.forSkill(skillId);
    assert.equal(tree.length, 6, skillId);
    assert.equal(tree.reduce((sum, entry) => sum + entry.maxRank * entry.spCost, 0), 17, skillId);
    assert.deepEqual(tree.map(entry => entry.requiredSkillLevel).sort((a, b) => a - b).at(-1), 15, skillId);
  }
  assert.equal(LIFE_SKILL_TREE_REGISTRY.forSkill('life.sailing').length, 0);
  assert.deepEqual(LIFE_SKILL_TREE_REGISTRY.get('life.node.fishing.deep_sea_fishing').prerequisites, [
    { nodeId: 'life.node.fishing.rare_fish_sense', requiredRank: 1 },
    { nodeId: 'life.node.fishing.boat_fishing', requiredRank: 1 }
  ]);
});

test('tree v1: a full tree is affordable exactly when its last gate opens (skill Lv15)', () => {
  const lv15 = LIFE_SKILL_CURVE_THRESHOLDS.find(row => row.level === 15).cumulativeSp;
  const lv14 = LIFE_SKILL_CURVE_THRESHOLDS.find(row => row.level === 14).cumulativeSp;
  assert.equal(lv15, 17);
  assert.ok(lv14 < 17);
});

test('tree reset is free with a 24 h default cooldown and starts at epoch 0', () => {
  assert.equal(LIFE_TREE_RESET_DEFAULT_COOLDOWN_SECONDS, 24 * 60 * 60);
  const state = lifeTreeResetFreshState();
  assert.deepEqual(state, { epoch: 0, cooldownSeconds: 86400, lastResetAt: null, nextResetAt: null, cost: 0 });
  assert.ok(Object.isFrozen(state));
});
