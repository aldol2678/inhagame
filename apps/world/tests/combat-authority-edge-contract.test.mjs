import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(
  new URL('../../../supabase/functions/world-combat-building5/index.ts', import.meta.url)
), 'utf8');

test('Building 5 Edge gateway authenticates the caller then elevates only through service_role RPCs', () => {
  assert.match(source, /userClient\.auth\.getUser\(\)/);
  assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(source, /world_combat_building5_start_v1/);
  assert.match(source, /world_combat_building5_action_v1/);
  assert.match(source, /world_combat_building5_snapshot_v1/);
  assert.match(source, /user\.is_anonymous/);
});

test('Building 5 Edge body allowlist has no client-owned combat outcome fields', () => {
  assert.match(source, /start: new Set\(\["op", "clientEncounterKey"\]\)/);
  assert.match(source, /action: new Set\(\["op", "encounterId", "action", "actionKey"\]\)/);
  assert.match(source, /snapshot: new Set\(\["op", "encounterId"\]\)/);
  assert.match(source, /cancel: new Set\(\["op", "encounterId", "actionKey"\]\)/);
  assert.doesNotMatch(source, /body\.(?:damage|hp|break|breakValue|resultRef|rewardId|loot|playerExp)/);
  assert.match(source, /UNRECOGNIZED_FIELD/);
});

test('Building 5 Edge maps only the six runtime actions plus sync and cancel', () => {
  for (const [local, server] of [
    ['basic','BASIC'],['active_1','ACTIVE_1'],['active_2','ACTIVE_2'],
    ['active_3','ACTIVE_3'],['dodge','DODGE'],['ultimate','ULTIMATE'],['sync','SYNC']
  ]) {
    assert.match(source, new RegExp(`${local}[^\\n]*${server}`));
  }
  assert.match(source, /op === "cancel" \? "CANCEL"/);
});
