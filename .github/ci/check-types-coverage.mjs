// Every table, view, column, function and enum that the committed supabase/database.types.ts
// declares must exist in a database bootstrapped from the committed migrations: the apps are
// typed against that file, so a name it has and the migrations do not create is drift.
// Objects the migrations create but the committed file lacks only mean the file is stale; they
// are listed, not failed.
//
// Usage: node check-types-coverage.mjs <committed.types.ts> <generated.types.ts>
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Both files come from `supabase gen types typescript`, which indents by two spaces:
// schema (2) > section (4) > object (6) > Row (8) > column (10).
export function inventory(source) {
  const names = new Set();
  let schema = null, section = null, object = null, inRow = false, inDatabase = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^export type Database = \{$/.test(line)) { inDatabase = true; continue; }
    if (!inDatabase) continue;
    if (line === '}') break;
    let m;
    if ((m = /^ {2}([A-Za-z0-9_]+): \{$/.exec(line))) {
      schema = m[1] === '__InternalSupabase' ? null : m[1]; section = object = null; inRow = false;
    } else if (schema && (m = /^ {4}(Tables|Views|Functions|Enums|CompositeTypes): \{$/.exec(line))) {
      section = m[1]; object = null; inRow = false;
    } else if (schema && section && (m = /^ {6}"?([A-Za-z0-9_]+)"?:/.exec(line))) {
      object = m[1]; inRow = false;
      names.add(`${schema}.${section}.${object}`);
    } else if (object && /^ {8}Row: \{$/.test(line)) {
      inRow = true;
    } else if (inRow && /^ {8}\}$/.test(line)) {
      inRow = false;
    } else if (inRow && (m = /^ {10}"?([A-Za-z0-9_]+)"?\??:/.exec(line))) {
      names.add(`${schema}.${section}.${object}.${m[1]}`);
    }
  }
  return names;
}

export function compare(committed, generated) {
  return {
    missing: [...committed].filter((name) => !generated.has(name)).sort(),
    untyped: [...generated].filter((name) => !committed.has(name)).sort(),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [committedPath, generatedPath] = process.argv.slice(2);
  if (!committedPath || !generatedPath) {
    console.error('usage: node check-types-coverage.mjs <committed.types.ts> <generated.types.ts>');
    process.exit(2);
  }
  const committed = inventory(readFileSync(committedPath, 'utf8'));
  const generated = inventory(readFileSync(generatedPath, 'utf8'));
  if (committed.size === 0 || generated.size === 0) {
    console.error(`types-coverage: FAIL could not parse (committed ${committed.size}, generated ${generated.size} names)`);
    process.exit(1);
  }
  const { missing, untyped } = compare(committed, generated);
  console.log(`types-coverage: committed file declares ${committed.size} names; bootstrap has ${generated.size}`);
  if (untyped.length) {
    console.log(`types-coverage: ${untyped.length} name(s) exist in the bootstrap but not in ${committedPath} (stale types, not a failure):`);
    for (const name of untyped) console.log(`  + ${name}`);
  }
  if (missing.length) {
    console.error(`types-coverage: FAIL ${missing.length} name(s) in ${committedPath} are not created by the migrations:`);
    for (const name of missing) console.error(`  - ${name}`);
    process.exit(1);
  }
  console.log('types-coverage: ok');
}
