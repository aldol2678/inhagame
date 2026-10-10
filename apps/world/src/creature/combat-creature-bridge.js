// INHA WORLD Combat -> Creature Bridge P1 contract.
// P1 wires verified Combat success into Creature Core without activating Creature growth.
// Support/protection memories stay deferred until Combat Core emits those verified semantics.

import {
  COMBAT_ENCOUNTER_STATE
} from '../combat/combat-contract.js';
import {
  CREATURE_DEFINITION_STATUS,
  CREATURE_SOURCE_DOMAIN,
  createCreatureActivityBridgeDefinition
} from './creature-core-contract.js';

export const COMBAT_CREATURE_BRIDGE_ID = 'creature.bridge.combat.victory';

export const COMBAT_CREATURE_BRIDGE = Object.freeze({
  ...createCreatureActivityBridgeDefinition({
    bridgeId: COMBAT_CREATURE_BRIDGE_ID,
    sourceDomain: CREATURE_SOURCE_DOMAIN.COMBAT,
    semanticEventType: 'combat.succeeded',
    memoryTag: 'memory.combat.victory',
    xpAmount: 0,
    cooldownSeconds: 0,
    dailyCap: null,
    status: CREATURE_DEFINITION_STATUS.COMING_SOON,
    definitionVersion: 1
  }),
  requiredTerminalStatus: COMBAT_ENCOUNTER_STATE.SUCCEEDED
});

export function combatCreatureBridgeAuthorityRow(definition = COMBAT_CREATURE_BRIDGE) {
  return Object.freeze({
    bridge_id: definition.bridgeId,
    source_domain: definition.sourceDomain,
    semantic_event_type: definition.semanticEventType,
    memory_tag: definition.memoryTag,
    xp_amount: definition.xpAmount,
    cooldown_seconds: definition.cooldownSeconds,
    daily_cap: definition.dailyCap,
    status: definition.status,
    definition_version: definition.definitionVersion
  });
}

export function combatCreatureBridgeRoutingRow(definition = COMBAT_CREATURE_BRIDGE) {
  return Object.freeze({
    bridge_id: definition.bridgeId,
    required_terminal_status: definition.requiredTerminalStatus
  });
}