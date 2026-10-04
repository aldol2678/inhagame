// Static schema-contract checks on supabase/migrations (git/Node only, no database).
//
// Usage: node migration-contract-lint.mjs [migrations-dir]
//
// Replays the table contracts the migrations declare, in version order, and fails on the shapes
// that let a superseded migration silently overwrite a newer canonical schema (the #91 / #98
// collision). Normal evolution - ALTER TABLE, indexes, policies, grants, `create or replace
// function` follow-ups - is not a finding.
//
//   CONTRACT_COLLISION  `create table if not exists T` where T already exists with a different
//                       column contract. Postgres skips the statement, so everything after it in
//                       that migration runs against a table it did not define.
//   DUPLICATE_CREATE    `create table T` (no IF NOT EXISTS) for a table that already exists.
//   UNKNOWN_COLUMN      a top-level `insert into T (cols)` that names a column T does not have.
//
// Function bodies are not parsed here. The replayed database compiles every plpgsql body against
// the real schema (supabase/tests/database/94_authority_schema_validity.test.sql); this lint is
// the fast, explainable first line that runs without Docker. Contract: docs/architecture/AUTHORITY_MAP.md.
import { readdirSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const MIGRATION = /^\d{14}_[a-z0-9_]+\.sql$/;

// Split SQL into top-level statements. Comments are blanked; string literals, quoted identifiers
// and dollar-quoted bodies are kept verbatim so they never split a statement.
export function splitStatements(sql) {
  const out = [];
  let buf = '';
  let line = 1;
  let startLine = 1;
  let i = 0;
  const n = sql.length;
  const push = () => {
    const text = buf.trim();
    if (text) out.push({ text, line: startLine });
    buf = '';
  };
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    if (!buf.trim()) startLine = line;
    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === '\n') line++;
        if (sql[i] === '/' && sql[i + 1] === '*') { depth++; i += 2; continue; }
        if (sql[i] === '*' && sql[i + 1] === '/') { depth--; i += 2; continue; }
        i++;
      }
      buf += ' ';
      continue;
    }
    if (c === "'" || c === '"') {
      const escapes = c === "'" && /[eE]$/.test(buf) && !/[a-zA-Z0-9_][eE]$/.test(buf);
      let j = i + 1;
      while (j < n) {
        if (escapes && sql[j] === '\\') { j += 2; continue; }
        if (sql[j] === c) {
          if (sql[j + 1] === c) { j += 2; continue; }
          break;
        }
        j++;
      }
      const chunk = sql.slice(i, j + 1);
      line += chunk.split('\n').length - 1;
      buf += chunk;
      i = j + 1;
      continue;
    }
    if (c === '$') {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 80));
      if (m && !/[A-Za-z0-9_]$/.test(buf)) {
        const tag = m[0];
        const end = sql.indexOf(tag, i + tag.length);
        const stop = end === -1 ? n : end + tag.length;
        const chunk = sql.slice(i, stop);
        line += chunk.split('\n').length - 1;
        buf += chunk;
        i = stop;
        continue;
      }
    }
    if (c === ';') { push(); i++; continue; }
    if (c === '\n') line++;
    buf += c;
    i++;
  }
  push();
  return out;
}

const IDENT = String.raw`(?:"(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_$]*)`;
const QNAME = String.raw`(${IDENT}(?:\s*\.\s*${IDENT})?)`;

function unquote(id) {
  return id.startsWith('"') ? id.slice(1, -1).replace(/""/g, '"') : id.toLowerCase();
}

export function qualify(qname) {
  const parts = qname.split(/\s*\.\s*(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(unquote);
  return parts.length === 1 ? `public.${parts[0]}` : `${parts[0]}.${parts[1]}`;
}

// Split on commas that are not inside parentheses or quotes (statement text has no comments).
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === c && text[j + 1] !== c)) j += text[j] === c ? 2 : 1;
      cur += text.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

// Text between the parenthesis at `open` and its match.
function parenBody(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < text.length && !(text[j] === c && text[j + 1] !== c)) j += text[j] === c ? 2 : 1;
      i = j;
      continue;
    }
    if (c === '(') depth++;
    if (c === ')' && --depth === 0) return text.slice(open + 1, i);
  }
  return null;
}

const TYPE_ALIASES = new Map([
  ['int', 'integer'], ['int4', 'integer'], ['int8', 'bigint'], ['int2', 'smallint'],
  ['serial', 'integer'], ['serial4', 'integer'], ['bigserial', 'bigint'], ['serial8', 'bigint'],
  ['smallserial', 'smallint'], ['serial2', 'smallint'],
  ['bool', 'boolean'], ['float8', 'double precision'], ['float4', 'real'], ['decimal', 'numeric'],
  ['varchar', 'character varying'], ['char', 'character'],
  ['timestamptz', 'timestamp with time zone'], ['timestamp', 'timestamp without time zone'],
  ['timetz', 'time with time zone'], ['time', 'time without time zone']
]);

export function normalizeType(raw) {
  let t = raw.toLowerCase().replace(/\s+/g, ' ').replace(/\s*([(),\[\]])\s*/g, '$1').trim();
  t = t.replace(/^(?:pg_catalog|public|extensions)\./, '');
  const m = /^([a-z0-9_ ]+?)((?:\(.*\))?(?:\[\])*)$/.exec(t);
  if (!m) return t;
  const base = TYPE_ALIASES.get(m[1]) ?? m[1];
  return base + m[2];
}

const COLUMN_STOP = /\s+(?:not\s+null|null|default|constraint|check|references|primary\s+key|unique|generated|collate)\b/i;
const TABLE_CONSTRAINT = /^(?:constraint|primary\s+key|unique|check|foreign\s+key|exclude)\b/i;

// Column contract of a CREATE TABLE body, or null when it cannot be known statically (LIKE).
function parseColumns(body) {
  const cols = new Map();
  for (const element of splitTopLevel(body)) {
    if (/^like\b/i.test(element)) return null;
    if (TABLE_CONSTRAINT.test(element)) continue;
    const m = new RegExp(`^(${IDENT})\\s+([\\s\\S]+)$`).exec(element);
    if (!m) continue;
    const type = m[2].split(COLUMN_STOP)[0];
    cols.set(unquote(m[1]), normalizeType(type));
  }
  return cols;
}

function describeDiff(existing, declared) {
  const missing = [...declared.keys()].filter((c) => !existing.has(c));
  const extra = [...existing.keys()].filter((c) => !declared.has(c));
  const retyped = [...declared.keys()]
    .filter((c) => existing.has(c) && existing.get(c) !== declared.get(c))
    .map((c) => `${c} ${existing.get(c)} -> ${declared.get(c)}`);
  const parts = [];
  if (missing.length) parts.push(`columns the existing table does not have: ${missing.join(', ')}`);
  if (extra.length) parts.push(`existing columns this definition omits: ${extra.join(', ')}`);
  if (retyped.length) parts.push(`type changes: ${retyped.join('; ')}`);
  return parts.join('; ');
}

const CREATE_TABLE = new RegExp(
  String.raw`^create\s+(?:(?:global|local)\s+)?(?:temp(?:orary)?\s+|unlogged\s+)?table\s+(if\s+not\s+exists\s+)?${QNAME}\s*`, 'i');
const ALTER_TABLE = new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?${QNAME}\s+([\s\S]+)$`, 'i');
const DROP_TABLE = /^drop\s+table\s+(?:if\s+exists\s+)?([\s\S]+?)(?:\s+(?:cascade|restrict))?$/i;
const INSERT = new RegExp(String.raw`^insert\s+into\s+${QNAME}\s*(?:as\s+${IDENT}\s*)?\(`, 'i');

// files: [{ name, sql }] in any order. Returns [{ rule, file, line, table, message }].
// `tables` receives the replayed contracts: qualified name -> { cols: Map | null, file, line }.
export function lintMigrationContracts(files, tables = new Map()) {
  const findings = [];
  const sorted = [...files].filter((f) => MIGRATION.test(f.name)).sort((a, b) => a.name.localeCompare(b.name));
  for (const { name, sql } of sorted) {
    for (const { text, line } of splitStatements(sql)) {
      const at = { file: name, line };
      let m;
      if ((m = CREATE_TABLE.exec(text))) {
        const table = qualify(m[2]);
        if (table.startsWith('pg_temp.')) continue;
        const rest = text.slice(m[0].length);
        const cols = rest.startsWith('(') && !/\)\s*inherits\b/i.test(rest) ? parseColumns(parenBody(rest, 0) ?? '') : null;
        const prior = tables.get(table);
        if (prior && !m[1]) {
          findings.push({ rule: 'DUPLICATE_CREATE', ...at, table,
            message: `create table ${table} but ${prior.file}:${prior.line} already created it; replay fails here - change it with ALTER TABLE` });
        } else if (prior && cols && prior.cols) {
          const diff = describeDiff(prior.cols, cols);
          if (diff) {
            findings.push({ rule: 'CONTRACT_COLLISION', ...at, table,
              message: `create table if not exists ${table} is SKIPPED on replay because ${prior.file}:${prior.line} already defines it with a different contract (${diff}). Statements after it in this migration run against a table it did not define. Use ALTER TABLE for an intended change, or a new name for a new object.` });
          }
        } else if (!prior) {
          tables.set(table, { cols, ...at });
        }
        continue;
      }
      if ((m = ALTER_TABLE.exec(text))) {
        const table = qualify(m[1]);
        const entry = tables.get(table);
        const renameTable = new RegExp(String.raw`^rename\s+to\s+(${IDENT})\s*$`, 'i').exec(m[2].trim());
        if (renameTable) {
          if (entry) {
            tables.delete(table);
            tables.set(`${table.split('.')[0]}.${unquote(renameTable[1])}`, entry);
          }
          continue;
        }
        if (!entry?.cols) continue;
        for (const action of splitTopLevel(m[2])) {
          let a;
          if (/^add\s+(?:constraint|primary\s+key|unique|check|foreign\s+key|exclude)\b/i.test(action)) continue;
          if (/^drop\s+(?:constraint)\b/i.test(action)) continue;
          if ((a = new RegExp(String.raw`^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})\s+([\s\S]+)$`, 'i').exec(action))) {
            const col = unquote(a[1]);
            if (!entry.cols.has(col)) entry.cols.set(col, normalizeType(a[2].split(COLUMN_STOP)[0]));
          } else if ((a = new RegExp(String.raw`^drop\s+(?:column\s+)?(?:if\s+exists\s+)?(${IDENT})`, 'i').exec(action))) {
            entry.cols.delete(unquote(a[1]));
          } else if ((a = new RegExp(String.raw`^rename\s+(?:column\s+)?(${IDENT})\s+to\s+(${IDENT})$`, 'i').exec(action))) {
            const from = unquote(a[1]);
            if (entry.cols.has(from)) {
              entry.cols.set(unquote(a[2]), entry.cols.get(from));
              entry.cols.delete(from);
            }
          } else if ((a = new RegExp(String.raw`^alter\s+(?:column\s+)?(${IDENT})\s+(?:set\s+data\s+)?type\s+([\s\S]+?)(?:\s+using\b[\s\S]*)?$`, 'i').exec(action))) {
            const col = unquote(a[1]);
            if (entry.cols.has(col)) entry.cols.set(col, normalizeType(a[2].split(COLUMN_STOP)[0]));
          }
        }
        continue;
      }
      if ((m = DROP_TABLE.exec(text))) {
        for (const q of splitTopLevel(m[1])) {
          const qm = new RegExp(`^${QNAME}$`).exec(q.trim());
          if (qm) tables.delete(qualify(qm[1]));
        }
        continue;
      }
      if ((m = INSERT.exec(text))) {
        const table = qualify(m[1]);
        const entry = tables.get(table);
        if (!entry?.cols) continue;
        const list = parenBody(text, m[0].length - 1);
        if (list == null) continue;
        const unknown = splitTopLevel(list).map(unquote).filter((c) => !entry.cols.has(c));
        if (unknown.length) {
          findings.push({ rule: 'UNKNOWN_COLUMN', ...at, table,
            message: `insert into ${table} names column(s) ${unknown.join(', ')} that the current contract (${entry.file}:${entry.line}) does not have` });
        }
      }
    }
  }
  return findings;
}

export function readMigrations(dir) {
  return readdirSync(dir).filter((n) => MIGRATION.test(n)).map((name) => ({ name, sql: readFileSync(`${dir}/${name}`, 'utf8') }));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const dir = process.argv[2] ?? 'supabase/migrations';
  const files = readMigrations(dir);
  const findings = lintMigrationContracts(files);
  console.log(`migration-contract-lint: ${files.length} migration(s) in ${dir}`);
  if (findings.length) {
    for (const f of findings) console.error(`migration-contract-lint: FAIL ${f.rule} ${f.file}:${f.line} ${f.message}`);
    process.exit(1);
  }
  console.log('migration-contract-lint: ok');
}
