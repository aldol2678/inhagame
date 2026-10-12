// Test-only PostgreSQL harness. Each query owns a real psql connection and transaction.
// It accepts only the checked-in disposable Supabase stack, never a project URL or remote DB.
import assert from 'node:assert/strict';
import { execFile, spawn, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';

const exec = promisify(execFile);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const LOCAL_CONTAINER = 'supabase_db_p2-public-local';
export const ROOM_ID = 'ROOM_CLUBHOUSE_01';
export const lit = value => `'${String(value).replaceAll("'", "''")}'`;
export function parsePgJson(output) {
  const last = String(output).split('\n').filter(Boolean).at(-1);
  if (last === 't') return true;
  if (last === 'f') return false;
  return JSON.parse(last);
}

export function assertLocalDbUrl(raw) {
  let url;
  try { url = new URL(raw); } catch { throw new Error('ROOM_SOCIAL_LOCAL_DB_REQUIRED'); }
  assert.ok(['postgres:', 'postgresql:'].includes(url.protocol), 'PostgreSQL URL required');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'loopback DB only');
  assert.equal(url.port, '54322', 'checked-in disposable DB port only');
  assert.equal(url.username, 'postgres', 'local fixture administrator only');
  assert.equal(url.pathname, '/postgres', 'disposable postgres database only');
  assert.equal(url.search, '', 'connection-string overrides are forbidden');
  assert.equal(url.hash, '', 'URL fragments are forbidden');
  return raw;
}

export function sanitizedPgEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(source).filter(([key]) =>
    !key.startsWith('PG') && !key.startsWith('SUPABASE_') &&
    !['DB_URL', 'DATABASE_URL', 'PSQLRC', 'PSQL_FALLBACK_CONTAINER'].includes(key)));
}

export function userTransaction(userId, query, applicationName = 'room-social-query') {
  assert.match(userId, UUID, 'synthetic authenticated account UUID required');
  assert.match(applicationName, /^[a-z0-9_-]{1,63}$/);
  return `begin; set local statement_timeout='35s'; set local lock_timeout='25s';
    set local application_name=${lit(applicationName)}; set local role authenticated;
    set local request.jwt.claims=${lit(JSON.stringify({ sub: userId, role: 'authenticated', is_anonymous: false }))};
    ${query}; commit;`;
}

export function assertContendedBackends(rows, names) {
  assert.ok(Array.isArray(rows), 'pg_stat_activity must return real backend evidence');
  assert.equal(rows.length, names.length, 'every contender must be present before releasing the lock');
  assert.equal(new Set(rows.map(row => row.pid)).size, names.length, 'independent PostgreSQL backend PIDs required');
  for (const name of names) {
    const row = rows.find(row => row.applicationName === name);
    assert.ok(row, `missing contender ${name}`);
    assert.equal(row.waiting, true, `contender ${name} must be waiting for a database lock`);
  }
  return rows;
}

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
export async function waitUntil(check, { timeoutMs = 10000, pollMs = 25, description = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  do {
    const result = await check();
    if (result) return result;
    await pause(pollMs);
  } while (Date.now() < deadline);
  throw new Error(`ROOM_SOCIAL_TIMEOUT: ${description}`);
}

export function createPgHarness({ dbUrl = process.env.DB_URL, fallbackContainer = process.env.PSQL_FALLBACK_CONTAINER } = {}) {
  assertLocalDbUrl(dbUrl);
  if (fallbackContainer) assert.equal(fallbackContainer, LOCAL_CONTAINER, 'only the checked-in local container is permitted');
  const env = sanitizedPgEnvironment();
  const version = spawnSync('psql', ['--version'], { env, encoding: 'utf8' });
  let executable = 'psql', prefix = [dbUrl];
  if (version.error?.code === 'ENOENT') {
    assert.equal(fallbackContainer, LOCAL_CONTAINER, 'psql missing; verified local container fallback required');
    executable = 'docker';
    prefix = ['exec', '-i', LOCAL_CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres'];
  } else if (version.error || version.status !== 0) throw new Error('LOCAL_PSQL_UNAVAILABLE');
  const common = ['-X', '-v', 'ON_ERROR_STOP=1', '-Atq'];

  async function query(sql, { timeoutMs = 40000 } = {}) {
    try {
      const { stdout } = await exec(executable, [...prefix, ...common, '-c', sql], {
        env, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024
      });
      return stdout.trim();
    } catch (cause) {
      // execFile's default message contains the connection string. Never put it in CI output.
      const error = new Error(`LOCAL_SQL_FAILED: ${String(cause.stderr ?? cause.code ?? 'unknown').slice(0, 2000)}`);
      error.code = cause.code;
      throw error;
    }
  }
  const json = async sql => parsePgJson(await query(sql));
  const asUser = (userId, sql, app) => json(userTransaction(userId, sql, app));

  async function race(operations, label, { gateQuery = `select room_id from private.world_club_rooms where room_id=${lit(ROOM_ID)} for update` } = {}) {
    assert.ok(operations.length >= 2, 'a race needs independent contenders');
    const prefixName = `room-social-${randomUUID().slice(0, 8)}-${label}`;
    const names = operations.map((_, index) => `${prefixName}-${index}`);
    const holder = spawn(executable, [...prefix, ...common, '-f', '-'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '', holderDone = false, holderFailure = null;
    holder.stdout.on('data', data => { stdout += data; });
    holder.stderr.on('data', data => { stderr += data; });
    const closed = new Promise(resolve => {
      holder.on('error', error => { holderFailure = error; holderDone = true; resolve(); });
      holder.on('close', code => { if (code && !holderFailure) holderFailure = new Error(stderr); holderDone = true; resolve(); });
    });
    holder.stdin.on('error', error => { holderFailure ??= error; });
    holder.stdin.write(`begin; set local idle_in_transaction_session_timeout='30s';
      set local statement_timeout='25s'; set local application_name=${lit(`${prefixName}-gate`)};
      ${gateQuery};
      \\echo ROOM_SOCIAL_GATE_READY
`);
    let tasks = [], released = false;
    const release = () => {
      if (!released) { released = true; if (!holderDone) holder.stdin.end('rollback;\n\\q\n'); }
    };
    try {
      await waitUntil(() => {
        if (holderFailure || holderDone) throw new Error(`ROOM_SOCIAL_GATE_FAILED: ${String(holderFailure ?? stderr)}`);
        return stdout.includes('ROOM_SOCIAL_GATE_READY');
      }, { description: 'real room-row lock holder' });
      tasks = operations.map((operation, index) => asUser(operation.userId,
        `select jsonb_build_object('backendPid',pg_backend_pid(),'result',(${operation.expression}))`, names[index])
        .then(value => ({ value }), error => ({ error })));
      const contention = await waitUntil(async () => {
        const rows = await json(`select coalesce(jsonb_agg(jsonb_build_object('pid',pid,
          'applicationName',application_name,'waiting',wait_event_type='Lock')),'[]'::jsonb)
          from pg_stat_activity where application_name in (${names.map(lit).join(',')})`);
        if (rows.length !== names.length || !rows.every(row => row.waiting)) return false;
        return assertContendedBackends(rows, names);
      }, { description: `${operations.length} independent transactions contending on the room lock` });
      release();
      const completed = await Promise.all(tasks);
      for (const item of completed) if (item.error) throw item.error;
      const values = completed.map(item => item.value);
      assert.deepEqual(new Set(values.map(value => value.backendPid)), new Set(contention.map(row => row.pid)),
        'the observed contenders must be the connections that committed the RPCs');
      return { values: values.map(value => value.result), contention };
    } finally {
      release();
      await Promise.all(tasks);
      await closed;
    }
  }
  return { query, json, asUser, race };
}
