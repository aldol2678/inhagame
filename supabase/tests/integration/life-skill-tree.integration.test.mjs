import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  LIFE_SKILL_TREE_REGISTRY,
  lifeSkillNodeAuthorityRow,
  lifeSkillPrerequisiteAuthorityRows
} from '../../../apps/world/src/life-skills/life-skill-tree-registry.js';

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

test('Life Skill Tree DB node mirror equals code Registry authority rows', () => {
  const db = JSON.parse(query(`
    select coalesce(json_agg(n order by n.node_id), '[]')
      from (
        select node_id,tree_id,max_rank,point_cost,required_life_level,
               required_skill_id,required_skill_level,effect_key,status,definition_version
          from private.world_life_skill_nodes
      ) n`));
  const code = LIFE_SKILL_TREE_REGISTRY.list()
    .map(lifeSkillNodeAuthorityRow)
    .sort((a, b) => a.node_id.localeCompare(b.node_id));
  assert.deepEqual(db, code);
});

test('Life Skill Tree DB prerequisite mirror equals code Registry graph', () => {
  const db = JSON.parse(query(`
    select coalesce(json_agg(e order by e.node_id,e.prerequisite_node_id), '[]')
      from private.world_life_skill_node_prerequisites e`));
  const code = LIFE_SKILL_TREE_REGISTRY.list()
    .flatMap(lifeSkillPrerequisiteAuthorityRows)
    .sort((a, b) => a.node_id.localeCompare(b.node_id) ||
      a.prerequisite_node_id.localeCompare(b.prerequisite_node_id));
  assert.deepEqual(db, code);
});
