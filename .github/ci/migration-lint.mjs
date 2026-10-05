// Static checks on supabase/migrations for the Public development lineage (git/Node only, no database).
//
// Usage: node migration-lint.mjs [base-ref]
//   Always: file names are <14-digit version>_<snake_case>.sql, versions are unique, the first
//   migration is the public baseline, every later version is greater than the baseline version,
//   and no migration mentions a Production-only (ops) object.
//   With a resolvable base ref (argument, else origin/<GITHUB_BASE_REF>): migrations are
//   append-only. A file that exists on base may not be edited or deleted, and a new file may not
//   be older than the newest file on base. Without a usable base these two checks are skipped.
//
// Why: Public is the development lineage only. Production keeps its own migration history, so a
// forward migration here must stay ordered and free of ops objects to be portable (see the
// migration lineage plan).
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const BASELINE_VERSION = '20261001213132';
export const BASELINE_NAME = `${BASELINE_VERSION}_public_baseline.sql`;
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
// Mirrors the objects the Public baseline excludes (toolchain rules/baseline.json); the retained
// get_inha_duck_stage3_sample_gate_v1 is a game function and stays allowed.
const OPS_OBJECTS = [/mixpanel/i, /get_inha_duck_observer_(gateway_secret|runtime)/i, /notify_inha_duck_stage3_sample_gate/i];

// head/base: arrays of { name, sql }; base is null when unavailable.
export function lint(head, base = null) {
  const failures = [];
  const seen = new Map();
  for (const { name } of head) {
    const m = NAME.exec(name);
    if (!m) { failures.push(`${name}: expected <14-digit version>_<snake_case_name>.sql`); continue; }
    if (seen.has(m[1])) failures.push(`duplicate version ${m[1]}: ${seen.get(m[1])} and ${name}`);
    seen.set(m[1], name);
  }
  const sorted = head.map((f) => f.name).filter((n) => NAME.test(n)).sort();
  if (sorted.length === 0) failures.push('no migrations found');
  else if (sorted[0] !== BASELINE_NAME) failures.push(`first migration must be ${BASELINE_NAME}, found ${sorted[0]}`);
  for (const name of sorted.slice(1)) {
    if (name.slice(0, 14) <= BASELINE_VERSION) failures.push(`${name}: version must be greater than the baseline ${BASELINE_VERSION}`);
  }
  for (const { name, sql } of head) {
    for (const re of OPS_OBJECTS) {
      if (re.test(sql)) failures.push(`${name}: mentions a Production-only object (${re}); ops objects must not enter Public`);
    }
  }
  if (base) {
    const headByName = new Map(head.map((f) => [f.name, f.sql]));
    const newestBase = base.map((f) => f.name).filter((n) => NAME.test(n)).sort().at(-1) ?? '';
    for (const { name, sql } of base) {
      if (!headByName.has(name)) failures.push(`${name}: migration removed or renamed (migrations are append-only)`);
      else if (headByName.get(name) !== sql) failures.push(`${name}: migration edited (migrations are append-only)`);
    }
    const baseNames = new Set(base.map((f) => f.name));
    for (const { name } of head) {
      if (!baseNames.has(name) && NAME.test(name) && name.slice(0, 14) < newestBase.slice(0, 14)) {
        failures.push(`${name}: new migration is older than the newest existing one (${newestBase})`);
      }
    }
  }
  return failures;
}

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function readTree(dir) {
  return readdirSync(dir).filter((n) => n.endsWith('.sql') || NAME.test(n))
    .map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, 'utf8') }));
}

function readBase(ref, dir) {
  const names = git('ls-tree', '--name-only', ref, `${dir}/`).split('\n').filter(Boolean).map((p) => p.slice(dir.length + 1));
  return names.map((name) => ({ name, sql: git('show', `${ref}:${dir}/${name}`) }));
}

function resolveBase(arg, dir) {
  const candidates = [];
  if (arg) candidates.push(arg);
  if (process.env.GITHUB_BASE_REF) {
    const b = process.env.GITHUB_BASE_REF;
    try { git('fetch', '--quiet', '--depth=1', 'origin', b); candidates.push('FETCH_HEAD'); } catch { /* shallow CI without credentials */ }
    candidates.push(`origin/${b}`);
  } else candidates.push('origin/main');
  for (const ref of candidates) {
    try { git('cat-file', '-e', `${ref}^{commit}`); return readBase(ref, dir); } catch { /* try next */ }
  }
  return null;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = 'supabase/migrations';
  const head = readTree(dir);
  const base = resolveBase(process.argv[2], dir);
  const failures = lint(head, base);
  console.log(`migration-lint: ${head.length} migration(s)${base ? `, append-only vs base (${base.length} files)` : ', no usable base: append-only/ordering-vs-base skipped'}`);
  if (failures.length) { for (const f of failures) console.error(`migration-lint: FAIL ${f}`); process.exit(1); }
  console.log('migration-lint: ok');
}
