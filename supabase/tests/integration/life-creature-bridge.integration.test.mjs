import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  LIFE_CREATURE_BRIDGE_REGISTRY,
  lifeCreatureBridgeCreatureAuthorityRow,
  lifeCreatureBridgeMappingAuthorityRow
} from '../../../apps/world/src/creature/life-creature-bridge.js';

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

test('Life -> Creature P1 Creature bridge DB mirror equals code authority', () => {
  const ids = LIFE_CREATURE_BRIDGE_REGISTRY.list().map(item => `'${item.bridgeId}'`).join(',');
  const db = JSON.parse(query(
    `select coalesce(json_agg(json_build_object(
      'bridge_id',bridge_id,
      'source_domain',source_domain,
      'semantic_event_type',semantic_event_type,
      'memory_tag',memory_tag,
      'xp_amount',xp_amount,
      'cooldown_seconds',cooldown_seconds,
      'daily_cap',daily_cap,
      'status',status,
      'definition_version',definition_version
    ) order by bridge_id), '[]')
    from private.world_creature_activity_bridge_catalog
    where bridge_id in (${ids})`
  ));
  const code = LIFE_CREATURE_BRIDGE_REGISTRY.list()
    .map(lifeCreatureBridgeCreatureAuthorityRow)
    .sort((a,b) => a.bridge_id.localeCompare(b.bridge_id));
  assert.deepEqual(db.map(row => ({ ...row, xp_amount: Number(row.xp_amount) })), code);
});

test('Life -> Creature P1 routing DB mirror equals code authority', () => {
  const db = JSON.parse(query(
    "select coalesce(json_agg(json_build_object('bridge_id',bridge_id,'activity_id',activity_id,'life_skill_id',life_skill_id,'required_activity_definition_version',required_activity_definition_version) order by bridge_id), '[]') from private.world_life_creature_bridge_catalog"
  ));
  const code = LIFE_CREATURE_BRIDGE_REGISTRY.list()
    .map(lifeCreatureBridgeMappingAuthorityRow)
    .sort((a,b) => a.bridge_id.localeCompare(b.bridge_id));
  assert.deepEqual(db, code);
});

test('Life -> Creature P1 wrappers are installed but bridge rows remain dormant', () => {
  const installed = query(
    "select concat_ws(',', to_regprocedure('public.world_life_activity_start_with_creature_v1(uuid,text,text,uuid,integer,integer,timestamp with time zone)') is not null, to_regprocedure('public.world_life_activity_finalize_with_creature_v1(uuid,uuid,text,text,text)') is not null)"
  );
  assert.equal(installed, 't,t');

  const statuses = query(
    "select string_agg(status,',' order by bridge_id) from private.world_creature_activity_bridge_catalog where bridge_id like 'creature.bridge.activity.%'"
  );
  assert.equal(statuses, 'COMING_SOON,COMING_SOON,COMING_SOON');

  const xp = query(
    "select coalesce(sum(xp_amount),0) from private.world_creature_activity_bridge_catalog where bridge_id like 'creature.bridge.activity.%'"
  );
  assert.equal(xp, '0');
});

test('Life -> Creature P1 has no captured contexts or decisions before activation', () => {
  assert.equal(query("select count(*) from private.world_life_creature_activity_contexts"), '0');
  assert.equal(query("select count(*) from private.world_life_creature_bridge_decisions"), '0');
});