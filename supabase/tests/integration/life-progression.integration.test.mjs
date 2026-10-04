import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  LIFE_SKILL_TREE_REGISTRY,
  lifeProgressionThresholdAuthorityRows,
  lifeTreeAuthorityRow,
  lifeTreeEdgeAuthorityRows
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
    "select coalesce(json_agg(json_build_object('node_id',node_id,'skill_id',skill_id,'status',status,'sp_cost',sp_cost,'max_rank',max_rank,'required_life_level',required_life_level,'required_skill_level',required_skill_level) order by node_id), '[]') from private.world_life_skill_tree_catalog"
  ));
  const code = LIFE_SKILL_TREE_REGISTRY.list().map(lifeTreeAuthorityRow);
  assert.deepEqual(db, code);
});

test('Life Skill Tree DB edges equal code prerequisites (with required rank)', () => {
  const db = JSON.parse(query(
    "select coalesce(json_agg(json_build_object('node_id',node_id,'prerequisite_node_id',prerequisite_node_id,'required_rank',required_rank) order by node_id,prerequisite_node_id), '[]') from private.world_life_skill_tree_edges"
  ));
  const code = LIFE_SKILL_TREE_REGISTRY.list().flatMap(lifeTreeEdgeAuthorityRows)
    .sort((a, b) => `${a.node_id} ${a.prerequisite_node_id}`.localeCompare(`${b.node_id} ${b.prerequisite_node_id}`));
  assert.deepEqual(db, code);
});

test('Life Progression server authority functions are installed', () => {
  const rows = query(
    "select concat_ws(',', to_regprocedure('private.world_life_progression_snapshot_v1(uuid)') is not null, to_regprocedure('private.world_life_skill_tree_snapshot_v1(uuid,text)') is not null, to_regprocedure('private.world_life_node_unlock_v1(uuid,text,text)') is not null, to_regprocedure('private.world_life_skill_sp_snapshot_v1(uuid,text)') is not null)"
  );
  assert.equal(rows, 't,t,t,t');
});

test('SP ledger is keyed by the owning skill pool', () => {
  const columns = query(
    "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema='private' and table_name='world_life_sp_transactions' and column_name in ('skill_id','node_id')"
  );
  assert.equal(columns, 'node_id,skill_id');
});
