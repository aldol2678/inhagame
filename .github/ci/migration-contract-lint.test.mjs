import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { lintMigrationContracts, readMigrations, splitStatements, normalizeType } from './migration-contract-lint.mjs';

const fixture = (name) => readMigrations(fileURLToPath(new URL(`./fixtures/migration-contract/${name}`, import.meta.url)));
const f = (name, sql) => ({ name, sql });

test('#91 / #98 collision fixture fails with the skipped tables and their stale inserts', () => {
  const findings = lintMigrationContracts(fixture('pr91-collision'));
  const summary = findings.map((x) => `${x.rule} ${x.table}`);
  assert.deepEqual(summary, [
    'CONTRACT_COLLISION private.world_life_progression_thresholds',
    'CONTRACT_COLLISION private.world_life_skill_tree_catalog',
    'UNKNOWN_COLUMN private.world_life_progression_thresholds'
  ]);
  assert.match(findings[0].message, /SKIPPED on replay/);
  assert.match(findings[0].message, /min_total_xp, skill_points_reward/);
  assert.match(findings[0].message, /min_total_skill_xp, cumulative_sp/);
  assert.equal(findings[0].file, '20261004120000_superseded_life_tree.sql');
});

test('the collision is caught whichever side lands first', () => {
  const [canonical, superseded] = fixture('pr91-collision');
  const reversed = [f('20261004070000_superseded.sql', superseded.sql), f('20261004083000_canonical.sql', canonical.sql)];
  const rules = lintMigrationContracts(reversed).map((x) => x.rule);
  assert.ok(rules.includes('CONTRACT_COLLISION'));
});

test('normal evolution is not a finding: ALTER, index, policy, rename, retype, function versions, drop + recreate', () => {
  assert.deepEqual(lintMigrationContracts(fixture('benign-evolution')), []);
});

test('a re-declaration that omits a column added later is a stale contract', () => {
  const files = [
    f('20261004000000_a.sql', 'create table private.t (id int, a text);'),
    f('20261004010000_b.sql', 'alter table private.t add column b text;'),
    f('20261004020000_c.sql', 'create table if not exists private.t (id integer, a text);')
  ];
  const [finding] = lintMigrationContracts(files);
  assert.equal(finding.rule, 'CONTRACT_COLLISION');
  assert.match(finding.message, /existing columns this definition omits: b/);
});

test('a type change in a re-declaration is reported', () => {
  const files = [
    f('20261004000000_a.sql', 'create table private.t (id int, amount bigint);'),
    f('20261004010000_b.sql', 'create table if not exists private.t (id int, amount numeric);')
  ];
  assert.match(lintMigrationContracts(files)[0].message, /amount bigint -> numeric/);
});

test('copied or inherited column lists are unknown statically and never compared', () => {
  const files = [
    f('20261004000000_a.sql', 'create table private.t (id int, a text);'),
    f('20261004010000_b.sql', 'create table if not exists private.t (like private.template including all);'),
    f('20261004020000_c.sql', 'create table if not exists private.t (extra int) inherits (private.base);')
  ];
  assert.deepEqual(lintMigrationContracts(files), []);
});

test('plain create of an existing table is reported (replay would fail)', () => {
  const files = [
    f('20261004000000_a.sql', 'create table public.t (id int);'),
    f('20261004010000_b.sql', 'create table t (id int);')
  ];
  assert.equal(lintMigrationContracts(files)[0].rule, 'DUPLICATE_CREATE');
});

test('renamed tables keep their contract under the new name', () => {
  const files = [
    f('20261004000000_a.sql', 'create table private.old_t (id int);'),
    f('20261004010000_b.sql', 'alter table private.old_t rename to new_t;'),
    f('20261004020000_c.sql', 'insert into private.new_t (id, missing) values (1, 2);')
  ];
  const [finding] = lintMigrationContracts(files);
  assert.equal(finding.rule, 'UNKNOWN_COLUMN');
  assert.equal(finding.table, 'private.new_t');
});

test('statement splitter respects strings, quoted identifiers, dollar quotes and comments', () => {
  const sql = [
    "select 'a;b', \"we;ird\" from x; -- c;",
    'create function f() returns int as $body$ begin; return 1; end $body$ language plpgsql;',
    "/* x; /* nested; */ y; */ select E'it\\'s;';",
    'select $$;$$;'
  ].join('\n');
  const texts = splitStatements(sql).map((s) => s.text.replace(/\s+/g, ' '));
  assert.equal(texts.length, 4);
  assert.match(texts[1], /\$body\$ begin; return 1; end \$body\$/);
  assert.equal(splitStatements(sql)[1].line, 2);
});

test('type normalization treats Postgres aliases as equal', () => {
  assert.equal(normalizeType('timestamptz'), 'timestamp with time zone');
  assert.equal(normalizeType('INT8'), 'bigint');
  assert.equal(normalizeType('varchar( 40 )'), 'character varying(40)');
  assert.equal(normalizeType('text[]'), 'text[]');
  assert.equal(normalizeType('public.citext'), 'citext');
});

test('current supabase/migrations have no contract findings', () => {
  const dir = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));
  assert.deepEqual(lintMigrationContracts(readMigrations(dir)), []);
});

test('replay reconstructs real table contracts (baseline pg_dump + later hand-written migrations)', () => {
  const dir = fileURLToPath(new URL('../../supabase/migrations', import.meta.url));
  const tables = new Map();
  lintMigrationContracts(readMigrations(dir), tables);
  const cols = (t) => [...(tables.get(t)?.cols?.keys() ?? [])].sort();
  assert.ok(tables.size > 100, `tracked ${tables.size} tables`);
  assert.deepEqual(cols('private.world_wallets'), ['balance', 'created_at', 'currency_id', 'updated_at', 'user_id', 'version']);
  assert.deepEqual(cols('private.world_life_progression_thresholds'),
    ['created_at', 'cumulative_sp', 'curve_id', 'level', 'min_total_skill_xp']);
  assert.equal(tables.get('private.world_wallets').cols.get('updated_at'), 'timestamp with time zone');
  // Columns added by a later ALTER (material catalog M1 widened only constraints; MATERIAL rows are data).
  assert.ok(cols('private.world_item_catalog').includes('ownership_policy'));
  assert.ok(cols('public.profiles').includes('avatar_key'));
});
