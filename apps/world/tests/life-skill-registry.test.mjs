import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIFE_SKILL_DEFINITIONS,
  LIFE_SKILL_REGISTRY,
  LIFE_SKILL_STATUS,
  createLifeSkillDefinition,
  createLifeSkillRegistry,
  lifeSkillAuthorityRow,
  lifeSkillFreshSnapshot
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
