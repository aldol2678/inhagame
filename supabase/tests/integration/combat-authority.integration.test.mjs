import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  COMBAT_REGISTRY,
  combatAuthorityRow
} from '../../../apps/world/src/combat/combat-contract.js';

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

test('Combat P0 DB catalog mirrors the intentionally empty code Registry', () => {
  const db = JSON.parse(query(
    "select coalesce(json_agg(json_build_object('combat_id',combat_id,'category',category,'availability',availability,'availability_ref',availability_ref,'resolver_ref',resolver_ref,'status',status,'definition_version',definition_version,'outcome_schema_version',outcome_schema_version) order by combat_id), '[]') from private.world_combat_definition_catalog"
  ));
  const code = COMBAT_REGISTRY.list().map(combatAuthorityRow);
  assert.deepEqual(db, code);
});

test('Combat P0 server authority functions are installed', () => {
  const installed = query(
    "select concat_ws(',', to_regprocedure('public.world_combat_start_v1(uuid,text,text,uuid,integer,integer,jsonb)') is not null, to_regprocedure('public.world_combat_state_write_v1(uuid,uuid,bigint,jsonb)') is not null, to_regprocedure('public.world_combat_snapshot_v1(uuid,uuid)') is not null, to_regprocedure('public.world_combat_finalize_v1(uuid,uuid,text,text)') is not null)"
  );
  assert.equal(installed, 't,t,t,t');
});

test('Combat P0 persists no player encounter rows before a definition is activated', () => {
  assert.equal(query("select count(*) from private.world_combat_encounters"), '0');
});
