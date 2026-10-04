// INHA WORLD Life Activity -> Creature Bridge P1 contract.
// This layer maps verified Life Activity semantics into Creature Core-owned bridge definitions.
// It does not activate Life Skills, Creature forms, Creature XP tuning, or evolution.

import {
  ACTIVITY_REGISTRY
} from '../activity/activity-contract.js';
import {
  LIFE_SKILL_REGISTRY
} from '../life-skills/life-skill-registry.js';
import {
  CREATURE_DEFINITION_STATUS,
  CREATURE_SOURCE_DOMAIN,
  createCreatureActivityBridgeDefinition
} from './creature-core-contract.js';

export const LIFE_CREATURE_BRIDGE_STATUS = CREATURE_DEFINITION_STATUS;

export function createLifeCreatureBridgeDefinition(raw, {
  activityRegistry = ACTIVITY_REGISTRY,
  lifeSkillRegistry = LIFE_SKILL_REGISTRY
} = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Life Creature bridge definition must be an object');
  }

  const activity = activityRegistry.get(raw.activityId);
  if (!activity) throw new TypeError(`Unknown activityId for ${raw.bridgeId}`);

  const skill = lifeSkillRegistry.get(raw.lifeSkillId);
  if (!skill) throw new TypeError(`Unknown lifeSkillId for ${raw.bridgeId}`);

  if (!activity.semanticEventTypes.includes(raw.semanticEventType)) {
    throw new TypeError(`Activity semantic event mismatch for ${raw.bridgeId}`);
  }

  if (!Number.isInteger(raw.requiredActivityDefinitionVersion) ||
      raw.requiredActivityDefinitionVersion < 1 ||
      raw.requiredActivityDefinitionVersion !== activity.definitionVersion) {
    throw new TypeError(`Invalid requiredActivityDefinitionVersion for ${raw.bridgeId}`);
  }

  const creatureBridge = createCreatureActivityBridgeDefinition({
    bridgeId: raw.bridgeId,
    sourceDomain: CREATURE_SOURCE_DOMAIN.ACTIVITY,
    semanticEventType: raw.semanticEventType,
    memoryTag: raw.memoryTag,
    xpAmount: raw.xpAmount,
    cooldownSeconds: raw.cooldownSeconds,
    dailyCap: raw.dailyCap,
    status: raw.status,
    definitionVersion: raw.definitionVersion
  });

  return Object.freeze({
    bridgeId: creatureBridge.bridgeId,
    activityId: activity.activityId,
    lifeSkillId: skill.skillId,
    semanticEventType: creatureBridge.semanticEventType,
    memoryTag: creatureBridge.memoryTag,
    xpAmount: creatureBridge.xpAmount,
    cooldownSeconds: creatureBridge.cooldownSeconds,
    dailyCap: creatureBridge.dailyCap,
    status: creatureBridge.status,
    definitionVersion: creatureBridge.definitionVersion,
    requiredActivityDefinitionVersion: raw.requiredActivityDefinitionVersion
  });
}

export const DEFAULT_LIFE_CREATURE_BRIDGES = Object.freeze({
  FISHING: createLifeCreatureBridgeDefinition({
    bridgeId: 'creature.bridge.activity.fishing',
    activityId: 'activity.fishing.inkyung',
    lifeSkillId: 'life.fishing',
    semanticEventType: 'activity.fishing.catch',
    memoryTag: 'memory.life.fishing',
    xpAmount: 0,
    cooldownSeconds: 0,
    dailyCap: null,
    status: LIFE_CREATURE_BRIDGE_STATUS.COMING_SOON,
    definitionVersion: 1,
    requiredActivityDefinitionVersion: 1
  }),
  GATHERING: createLifeCreatureBridgeDefinition({
    bridgeId: 'creature.bridge.activity.gathering',
    activityId: 'activity.gathering.campus',
    lifeSkillId: 'life.gathering',
    semanticEventType: 'activity.gathering.harvest',
    memoryTag: 'memory.life.gathering',
    xpAmount: 0,
    cooldownSeconds: 0,
    dailyCap: null,
    status: LIFE_CREATURE_BRIDGE_STATUS.COMING_SOON,
    definitionVersion: 1,
    requiredActivityDefinitionVersion: 1
  }),
  ARCHAEOLOGY: createLifeCreatureBridgeDefinition({
    bridgeId: 'creature.bridge.activity.archaeology',
    activityId: 'activity.archaeology.campus_history',
    lifeSkillId: 'life.archaeology',
    semanticEventType: 'activity.archaeology.excavate',
    memoryTag: 'memory.life.archaeology',
    xpAmount: 0,
    cooldownSeconds: 0,
    dailyCap: null,
    status: LIFE_CREATURE_BRIDGE_STATUS.COMING_SOON,
    definitionVersion: 1,
    requiredActivityDefinitionVersion: 1
  })
});

export function createLifeCreatureBridgeRegistry({
  definitions = Object.values(DEFAULT_LIFE_CREATURE_BRIDGES),
  activityRegistry = ACTIVITY_REGISTRY,
  lifeSkillRegistry = LIFE_SKILL_REGISTRY
} = {}) {
  const byBridgeId = new Map();
  const byActivityId = new Map();

  for (const raw of definitions) {
    const definition = createLifeCreatureBridgeDefinition(raw, {
      activityRegistry,
      lifeSkillRegistry
    });
    if (byBridgeId.has(definition.bridgeId)) {
      throw new Error(`Duplicate bridgeId: ${definition.bridgeId}`);
    }
    if (byActivityId.has(definition.activityId)) {
      throw new Error(`Duplicate activityId mapping: ${definition.activityId}`);
    }
    byBridgeId.set(definition.bridgeId, definition);
    byActivityId.set(definition.activityId, definition);
  }

  return Object.freeze({
    get: bridgeId => byBridgeId.get(bridgeId) ?? null,
    forActivity: activityId => byActivityId.get(activityId) ?? null,
    list: () => Object.freeze([...byBridgeId.values()]),
    get size() { return byBridgeId.size; }
  });
}

export const LIFE_CREATURE_BRIDGE_REGISTRY = createLifeCreatureBridgeRegistry();

export function lifeCreatureBridgeCreatureAuthorityRow(definition) {
  return Object.freeze({
    bridge_id: definition.bridgeId,
    source_domain: 'ACTIVITY',
    semantic_event_type: definition.semanticEventType,
    memory_tag: definition.memoryTag,
    xp_amount: definition.xpAmount,
    cooldown_seconds: definition.cooldownSeconds,
    daily_cap: definition.dailyCap,
    status: definition.status,
    definition_version: definition.definitionVersion
  });
}

export function lifeCreatureBridgeMappingAuthorityRow(definition) {
  return Object.freeze({
    bridge_id: definition.bridgeId,
    activity_id: definition.activityId,
    life_skill_id: definition.lifeSkillId,
    required_activity_definition_version: definition.requiredActivityDefinitionVersion
  });
}