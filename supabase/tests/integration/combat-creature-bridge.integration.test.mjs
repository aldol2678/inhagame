import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  combatCreatureBridgeAuthorityRow,
  combatCreatureBridgeRoutingRow
} from '../../../apps/world/src/creature/combat-creature-bridge.js';

const DB_URL = process.env.DB_URL;
assert.match(DB_URL ?? '', /^postgres(?:ql)?:\/\/(?:[^@/]+@)?(?:127\.0\.0\.1|localhost)(?::\d+)?\//);

function query(sql) {
  const args = ['-Atq', '-v', 'ON_ERROR_STOP=1', '-c', sql];
  try {
    return execFileSync('psql', [DB_URL, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  } catch (error) {
    const fallback = process.env.PSQL_FALLBACK_CONTAINER;
    if (error.code !== 'ENOENT' || !fallback) throw error;
    return execFileSync('docker', [
      'exec', fallback, 'psql', '-U', 'postgres', '-d', 'postgres', ...args
    ], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim();
  }
}

test('Combat -> Creature P1 bridge DB mirror equals code authority', () => {
  const db = JSON.parse(query(
    "select row_to_json(x) from (select bridge_id,source_domain,semantic_event_type,memory_tag,xp_amount,cooldown_seconds,daily_cap,status,definition_version from private.world_creature_activity_bridge_catalog where bridge_id='creature.bridge.combat.victory') x"
  ));
  assert.deepEqual({ ...db, xp_amount: Number(db.xp_amount) }, combatCreatureBridgeAuthorityRow());
});

test('Combat -> Creature P1 routing DB mirror equals code authority', () => {
  const db = JSON.parse(query(
    "select row_to_json(x) from (select bridge_id,required_terminal_status from private.world_combat_creature_bridge_catalog where bridge_id='creature.bridge.combat.victory') x"
  ));
  assert.deepEqual(db, combatCreatureBridgeRoutingRow());
});

test('Combat -> Creature P1 wrappers are installed but bridge remains dormant', () => {
  const installed = query(
    "select concat_ws(',', to_regprocedure('public.world_combat_start_with_creature_v1(uuid,text,text,uuid,integer,integer,jsonb)') is not null, to_regprocedure('public.world_combat_finalize_with_creature_v1(uuid,uuid,text,text)') is not null)"
  );
  assert.equal(installed, 't,t');

  const row = query(
    "select concat_ws(',',status,xp_amount) from private.world_creature_activity_bridge_catalog where bridge_id='creature.bridge.combat.victory'"
  );
  assert.equal(row, 'COMING_SOON,0');
});

test('Combat -> Creature P1 has no contexts or decisions before Combat activation', () => {
  assert.equal(query("select count(*) from private.world_combat_creature_contexts"), '0');
  assert.equal(query("select count(*) from private.world_combat_creature_bridge_decisions"), '0');
});