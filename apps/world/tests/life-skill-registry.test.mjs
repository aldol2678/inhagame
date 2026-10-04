import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIFE_SKILL_DEFINITIONS,
  LIFE_SKILL_REGISTRY,
  LIFE_SKILL_STATUS,
  createLifeSkillDefinition,
  createLifeSkillRegistry,
  LIFE_SKILL_CURVE_THRESHOLDS,
  lifeSkillAuthorityRow,
  lifeSkillCurvePosition,
  lifeSkillFreshSnapshot,
  lifeSkillThresholdAuthorityRows
} from '../src/life-skills/life-skill-registry.js';

test('Life Skill Registry contains the 11 long-term skills and keeps them pre-activation', () => {
  assert.equal(LIFE_SKILL_REGISTRY.size, 11);
  assert.deepEqual(LIFE_SKILL_REGISTRY.list().map(skill => skill.skillId), [
    'life.fishing',
    'life.gathering',
    'life.archaeology',
    'life.woodcutting',
    'life.mining',
    'life.woodworking',
    'life.cooking',
    'life.crafting',
    'life.farming',
    'life.photography',
    'life.research'
  ]);
  assert.ok(LIFE_SKILL_REGISTRY.list().every(skill => skill.curveId === 'life.common.v1'));
  assert.ok(LIFE_SKILL_REGISTRY.list().every(skill => skill.status === LIFE_SKILL_STATUS.COMING_SOON));
  assert.deepEqual(LIFE_SKILL_REGISTRY.list().slice(0, 3).map(skill => skill.tags.includes('p1a')),
    [true, true, true]);
  assert.deepEqual(LIFE_SKILL_REGISTRY.list().slice(3, 5).map(skill => skill.tags.includes('p1b')),
    [true, true]);
});

test('registry rejects duplicate ids and malformed curve / availability identities', () => {
  const fishing = DEFAULT_LIFE_SKILL_DEFINITIONS.FISHING;
  assert.throws(() => createLifeSkillRegistry({ definitions: [fishing, fishing] }), /Duplicate skillId/);
  assert.throws(() => createLifeSkillDefinition({ ...fishing, skillId: 'fishing' }), /Invalid skillId/);
  assert.throws(() => createLifeSkillDefinition({ ...fishing, skillId: 'life.bad', curveId: 'common.v1' }),
    /Invalid curveId/);
  assert.throws(() => createLifeSkillDefinition({
    ...fishing,
    skillId: 'life.bad_availability',
    availabilityRef: 'quest:raw'
  }), /Invalid availabilityRef/);
  assert.throws(() => createLifeSkillDefinition({
    ...fishing,
    skillId: 'life.bad_status',
    status: 'LOCKED'
  }), /Invalid status/);
});

test('DB authority mirror is deliberately minimal', () => {
  const row = lifeSkillAuthorityRow(LIFE_SKILL_REGISTRY.get('life.fishing'));
  assert.deepEqual(row, {
    skill_id: 'life.fishing',
    curve_id: 'life.common.v1',
    status: 'COMING_SOON'
  });
  assert.equal('display_name' in row, false);
  assert.equal('description' in row, false);
  assert.equal('category' in row, false);
});

test('fresh snapshot is Lv1 / 0 XP without provisioning player state', () => {
  const snapshot = lifeSkillFreshSnapshot(LIFE_SKILL_REGISTRY.get('life.archaeology'));
  assert.deepEqual(snapshot, {
    skillId: 'life.archaeology',
    curveId: 'life.common.v1',
    status: 'COMING_SOON',
    totalXp: 0,
    level: 1,
    version: 0
  });
  assert.ok(Object.isFrozen(snapshot));
});

test('life.common.v1 publishes Lv1..20 with strictly increasing XP and the per-skill SP award', () => {
  assert.equal(LIFE_SKILL_CURVE_THRESHOLDS.length, 20);
  assert.deepEqual(LIFE_SKILL_CURVE_THRESHOLDS.map(row => [row.level, row.minTotalXp, row.cumulativeSp]), [
    [1, 0, 0], [2, 100, 1], [3, 300, 2], [4, 600, 3], [5, 1000, 5],
    [6, 1500, 6], [7, 2100, 7], [8, 2800, 8], [9, 3600, 9], [10, 4500, 11],
    [11, 5500, 12], [12, 6600, 13], [13, 7800, 14], [14, 9100, 15], [15, 10500, 17],
    [16, 12000, 18], [17, 13600, 19], [18, 15300, 20], [19, 17100, 21], [20, 19000, 23]
  ]);
  assert.ok(LIFE_SKILL_CURVE_THRESHOLDS.every(row => row.curveId === 'life.common.v1'));
  assert.ok(Object.isFrozen(LIFE_SKILL_CURVE_THRESHOLDS) && Object.isFrozen(LIFE_SKILL_CURVE_THRESHOLDS[0]));
  assert.deepEqual(lifeSkillThresholdAuthorityRows()[1], {
    curve_id: 'life.common.v1', level: 2, min_total_xp: 100, cumulative_sp: 1
  });
});

test('curve position derives level, earned SP and max-defined overflow', () => {
  assert.deepEqual(lifeSkillCurvePosition('life.common.v1', 0), {
    curveId: 'life.common.v1', level: 1, earnedSp: 0, currentLevelStartXp: 0,
    nextLevelXp: 100, nextLevelEarnedSp: 1, maxDefinedLevel: 20, isMaxLevel: false
  });
  assert.equal(lifeSkillCurvePosition('life.common.v1', 99).level, 1);
  assert.equal(lifeSkillCurvePosition('life.common.v1', 100).level, 2);
  assert.equal(lifeSkillCurvePosition('life.common.v1', 620).level, 4);
  assert.equal(lifeSkillCurvePosition('life.common.v1', 4500).earnedSp, 11);
  const overflow = lifeSkillCurvePosition('life.common.v1', 50000);
  assert.equal(overflow.level, 20);
  assert.equal(overflow.earnedSp, 23);
  assert.equal(overflow.isMaxLevel, true);
  assert.equal(overflow.nextLevelXp, null);
  assert.throws(() => lifeSkillCurvePosition('life.common.v1', -1), /Invalid totalXp/);
  assert.throws(() => lifeSkillCurvePosition('life.unknown.v1', 0), /Unknown curveId/);
});
