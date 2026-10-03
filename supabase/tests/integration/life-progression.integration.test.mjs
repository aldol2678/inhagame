import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  LIFE_SKILL_TREE_REGISTRY,
  lifeProgressionThresholdAuthorityRows,
  lifeTreeAuthorityRow
} from '../../../apps/world/src/life-skills/life-progression-registry.js';

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

test('Life Progression DB threshold mirror equals code authority rows', () => {
  const db = JSON.parse(query(
    "select coalesce(json_agg(json_build_object('curve_id',curve_id,'level',level,'min_total_skill_xp',min_total_skill_xp,'cumulative_sp',cumulative_sp) order by level), '[]') from private.world_life_progression_thresholds where curve_id='life.progression.v1'"
  ));
  const code = lifeProgressionThresholdAuthorityRows();
  assert.deepEqual(db.map(row => ({
    ...row,
    min_total_skill_xp: Number(row.min_total_skill_xp)
  })), code);
});

test('Life Skill Tree P0 catalog is intentionally empty before node-effect approval', () => {
  const db = JSON.parse(query(
    "select coalesce(json_agg(json_build_object('node_id',node_id,'skill_id',skill_id,'status',status,'sp_cost',sp_cost,'required_life_level',required_life_level,'required_skill_level',required_skill_level) order by node_id), '[]') from private.world_life_skill_tree_catalog"
  ));
  const code = LIFE_SKILL_TREE_REGISTRY.list().map(lifeTreeAuthorityRow);
  assert.deepEqual(db, code);
});

test('Life Progression P0 server authority functions are installed', () => {
  const rows = query(
    "select concat_ws(',', to_regprocedure('private.world_life_progression_snapshot_v1(uuid)') is not null, to_regprocedure('private.world_life_skill_tree_snapshot_v1(uuid,text)') is not null, to_regprocedure('private.world_life_node_unlock_v1(uuid,text,text)') is not null)"
  );
  assert.equal(rows, 't,t,t');
});
