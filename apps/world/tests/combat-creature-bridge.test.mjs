import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COMBAT_CREATURE_BRIDGE,
  COMBAT_CREATURE_BRIDGE_ID,
  combatCreatureBridgeAuthorityRow,
  combatCreatureBridgeRoutingRow
} from '../src/creature/combat-creature-bridge.js';

test('Combat -> Creature P1 maps verified combat success without activation', () => {
  assert.equal(COMBAT_CREATURE_BRIDGE_ID, 'creature.bridge.combat.victory');
  assert.deepEqual(combatCreatureBridgeAuthorityRow(), {
    bridge_id: 'creature.bridge.combat.victory',
    source_domain: 'COMBAT',
    semantic_event_type: 'combat.succeeded',
    memory_tag: 'memory.combat.victory',
    xp_amount: 0,
    cooldown_seconds: 0,
    daily_cap: null,
    status: 'COMING_SOON',
    definition_version: 1
  });
  assert.deepEqual(combatCreatureBridgeRoutingRow(), {
    bridge_id: 'creature.bridge.combat.victory',
    required_terminal_status: 'SUCCEEDED'
  });
});

test('Combat -> Creature P1 does not invent support/protection semantics before Combat owns them', () => {
  assert.equal(COMBAT_CREATURE_BRIDGE.semanticEventType, 'combat.succeeded');
  assert.equal(COMBAT_CREATURE_BRIDGE.memoryTag, 'memory.combat.victory');
  assert.equal(COMBAT_CREATURE_BRIDGE.xpAmount, 0);
  assert.equal(COMBAT_CREATURE_BRIDGE.status, 'COMING_SOON');
});