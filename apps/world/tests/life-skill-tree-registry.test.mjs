import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIFE_SKILL_NODE_DEFINITIONS,
  LIFE_SKILL_NODE_STATUS,
  LIFE_SKILL_TREE_REGISTRY,
  createLifeSkillNodeDefinition,
  createLifeSkillTreeRegistry,
  lifeSkillNodeAuthorityRow,
  lifeSkillPrerequisiteAuthorityRows,
  lifeSkillTreeFullRankCost
} from '../src/life-skills/life-skill-tree-registry.js';

const trees = [
  'life_tree.fishing',
  'life_tree.woodcutting',
  'life_tree.farming',
  'life_tree.sailing'
];

test('v1 tree registry contains four six-node specializations with 17 SP full-rank cost each', () => {
  assert.equal(LIFE_SKILL_TREE_REGISTRY.size, 24);
  for (const treeId of trees) {
    const nodes = LIFE_SKILL_TREE_REGISTRY.listTree(treeId);
    assert.equal(nodes.length, 6, treeId);
    assert.equal(lifeSkillTreeFullRankCost(treeId), 17, treeId);
    const expectedStatus = treeId === 'life_tree.fishing'
      ? LIFE_SKILL_NODE_STATUS.ACTIVE : LIFE_SKILL_NODE_STATUS.COMING_SOON;
    assert.ok(nodes.every(node => node.status === expectedStatus), treeId);
  }
});

test('capstones cost 3 SP and require Life Lv15 without directly granting vehicle technology', () => {
  const capstones = [
    'life_node.fishing.deep_sea_fishing',
    'life_node.woodcutting.master_forester',
    'life_node.farming.smart_farm',
    'life_node.sailing.deep_sea_navigation'
  ];
  for (const nodeId of capstones) {
    const node = LIFE_SKILL_TREE_REGISTRY.get(nodeId);
    assert.equal(node.requiredLifeLevel, 15);
    assert.equal(node.pointCost, 3);
    assert.equal(node.maxRank, 1);
    assert.ok(node.prerequisites.length >= 2);
  }
  assert.equal(LIFE_SKILL_TREE_REGISTRY.has('life_node.sailing.submarine'), false);
});

test('registry validates prerequisite existence, rank, tree boundary and cycles', () => {
  const base = DEFAULT_LIFE_SKILL_NODE_DEFINITIONS[0];
  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [base, base] }), /Duplicate Life Skill nodeId/);

  const missing = createLifeSkillNodeDefinition({
    ...base,
    nodeId: 'life_node.fishing.missing_child',
    prerequisites: [{ nodeId: 'life_node.fishing.not_here', requiredRank: 1 }]
  });
  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [base, missing] }), /Missing prerequisite/);

  const otherTree = createLifeSkillNodeDefinition({
    ...base,
    nodeId: 'life_node.farming.cross_tree',
    treeId: 'life_tree.farming',
    prerequisites: [{ nodeId: base.nodeId, requiredRank: 1 }]
  });
  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [base, otherTree] }), /Cross-tree prerequisite/);

  const a = createLifeSkillNodeDefinition({
    ...base,
    nodeId: 'life_node.fishing.cycle_a',
    prerequisites: [{ nodeId: 'life_node.fishing.cycle_b', requiredRank: 1 }]
  });
  const b = createLifeSkillNodeDefinition({
    ...base,
    nodeId: 'life_node.fishing.cycle_b',
    prerequisites: [{ nodeId: 'life_node.fishing.cycle_a', requiredRank: 1 }]
  });
  assert.throws(() => createLifeSkillTreeRegistry({ definitions: [a, b] }), /cycle detected/);
});

test('DB authority mapping remains minimal and deterministic', () => {
  const node = LIFE_SKILL_TREE_REGISTRY.get('life_node.sailing.offshore_navigation');
  assert.deepEqual(lifeSkillNodeAuthorityRow(node), {
    node_id: 'life_node.sailing.offshore_navigation',
    tree_id: 'life_tree.sailing',
    max_rank: 2,
    point_cost: 2,
    required_life_level: 8,
    required_skill_id: null,
    required_skill_level: null,
    effect_key: 'sailing.offshore_navigation.v1',
    status: 'COMING_SOON',
    definition_version: 1
  });
  assert.deepEqual(lifeSkillPrerequisiteAuthorityRows(node), [
    {
      node_id: 'life_node.sailing.offshore_navigation',
      prerequisite_node_id: 'life_node.sailing.coastal_navigation',
      required_rank: 2
    },
    {
      node_id: 'life_node.sailing.offshore_navigation',
      prerequisite_node_id: 'life_node.sailing.weather_reading',
      required_rank: 1
    }
  ]);
});
