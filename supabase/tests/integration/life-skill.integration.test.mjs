import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { LIFE_SKILL_REGISTRY, lifeSkillAuthorityRow } from '../../../apps/world/src/life-skills/life-skill-registry.js';

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

test('Life Skill DB mirror equals code Registry authority rows', () => {
  const db = JSON.parse(query("select coalesce(json_agg(s order by s.skill_id), '[]') from private.world_life_skill_catalog s"));
  const code = LIFE_SKILL_REGISTRY.list().map(lifeSkillAuthorityRow)
    .sort((a, b) => a.skill_id.localeCompare(b.skill_id));
  assert.deepEqual(db, code);
});

test('committed common curve contains only Lv1=0 before balance activation', () => {
  const rows = JSON.parse(query("select coalesce(json_agg(t order by t.level), '[]') from private.world_life_skill_thresholds t where t.curve_id='life.common.v1'"));
  assert.deepEqual(rows.map(row => [row.level, Number(row.min_total_xp)]), [[1, 0]]);
});
