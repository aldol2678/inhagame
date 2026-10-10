import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LIFE_CREATURE_BRIDGES,
  LIFE_CREATURE_BRIDGE_REGISTRY,
  LIFE_CREATURE_BRIDGE_STATUS,
  createLifeCreatureBridgeDefinition,
  createLifeCreatureBridgeRegistry,
  lifeCreatureBridgeCreatureAuthorityRow,
  lifeCreatureBridgeMappingAuthorityRow
} from '../src/creature/life-creature-bridge.js';

test('Life -> Creature P1 maps the three P1-A life activities without activation', () => {
  assert.equal(LIFE_CREATURE_BRIDGE_REGISTRY.size, 3);
  assert.deepEqual(
    LIFE_CREATURE_BRIDGE_REGISTRY.list().map(item => item.activityId),
    [
      'activity.fishing.inkyung',
      'activity.gathering.campus',
      'activity.archaeology.campus_history'
    ]
  );
  assert.ok(LIFE_CREATURE_BRIDGE_REGISTRY.list().every(
    item => item.status === LIFE_CREATURE_BRIDGE_STATUS.COMING_SOON
  ));
  assert.ok(LIFE_CREATURE_BRIDGE_REGISTRY.list().every(item => item.xpAmount === 0));
});

test('Life -> Creature P1 bridge semantics match canonical Activity events and Life skills', () => {
  const fishing = LIFE_CREATURE_BRIDGE_REGISTRY.forActivity('activity.fishing.inkyung');
  assert.deepEqual(lifeCreatureBridgeCreatureAuthorityRow(fishing), {
    bridge_id: 'creature.bridge.activity.fishing',
    source_domain: 'ACTIVITY',
    semantic_event_type: 'activity.fishing.catch',
    memory_tag: 'memory.life.fishing',
    xp_amount: 0,
    cooldown_seconds: 0,
    daily_cap: null,
    status: 'COMING_SOON',
    definition_version: 1
  });
  assert.deepEqual(lifeCreatureBridgeMappingAuthorityRow(fishing), {
    bridge_id: 'creature.bridge.activity.fishing',
    activity_id: 'activity.fishing.inkyung',
    life_skill_id: 'life.fishing',
    required_activity_definition_version: 1
  });
});

test('Life -> Creature P1 rejects an event not owned by the mapped Activity', () => {
  assert.throws(() => createLifeCreatureBridgeDefinition({
    ...DEFAULT_LIFE_CREATURE_BRIDGES.FISHING,
    semanticEventType: 'activity.gathering.harvest'
  }), /semantic event mismatch/);
});

test('Life -> Creature P1 rejects an unknown Life skill and duplicate Activity mapping', () => {
  assert.throws(() => createLifeCreatureBridgeDefinition({
    ...DEFAULT_LIFE_CREATURE_BRIDGES.FISHING,
    lifeSkillId: 'life.ghost'
  }), /Unknown lifeSkillId/);

  assert.throws(() => createLifeCreatureBridgeRegistry({
    definitions: [
      DEFAULT_LIFE_CREATURE_BRIDGES.FISHING,
      {
        ...DEFAULT_LIFE_CREATURE_BRIDGES.GATHERING,
        bridgeId: 'creature.bridge.activity.fishing_alt',
        activityId: 'activity.fishing.inkyung',
        semanticEventType: 'activity.fishing.catch',
        lifeSkillId: 'life.fishing'
      }
    ]
  }), /Duplicate activityId mapping/);
});