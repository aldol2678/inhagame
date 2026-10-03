import test from 'node:test';
import assert from 'node:assert/strict';
import { LIFE_SKILL_STATUS } from '../src/life-skills/life-skill-registry.js';
import {
  LIFE_PROGRESSION_CURVE_ID,
  LIFE_PROGRESSION_THRESHOLDS,
  LIFE_SKILL_TREE_REGISTRY,
  createLifeSkillTreeRegistry,
  lifeProgressionFreshSnapshot,
  lifeProgressionThresholdAuthorityRows
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

test('Life Progression P0 seeds only Lv1 and no live tree nodes', () => {
  assert.equal(LIFE_PROGRESSION_CURVE_ID, 'life.progression.v1');
  assert.deepEqual(LIFE_PROGRESSION_THRESHOLDS, [
    { curveId: 'life.progression.v1', level: 1, minTotalSkillXp: 0, cumulativeSp: 0 }
  ]);
  assert.equal(LIFE_SKILL_TREE_REGISTRY.size, 0);
  assert.deepEqual(lifeProgressionThresholdAuthorityRows(), [{
    curve_id: 'life.progression.v1',
    level: 1,
    min_total_skill_xp: 0,
    cumulative_sp: 0
  }]);
});

test('fresh Life Progression snapshot starts at Lv1 with zero SP', () => {
  assert.deepEqual(lifeProgressionFreshSnapshot(), {
    curveId: 'life.progression.v1',
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
