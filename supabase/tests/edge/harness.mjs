// Offline harness for supabase/functions/*/index.ts. The function source runs unchanged under
// Node (type stripping): Deno.serve and Deno.env are replaced, supabase-js is served by an
// in-memory FakeSupabase (Auth users, RPC handlers, tables), and network access throws.
// No secrets, no Supabase project, no email or third-party provider is ever reached.
import { register } from 'node:module';
import { randomUUID } from 'node:crypto';

register('./loader.mjs', import.meta.url);

export const SUPABASE_URL = 'http://supabase.edge-test.invalid';
export const ANON_KEY = 'anon-key-fixture';
export const SERVICE_ROLE_KEY = 'service-role-key-fixture';

const env = new Map();
export function resetEnv(values = {}) {
  env.clear();
  const all = { SUPABASE_URL, SUPABASE_ANON_KEY: ANON_KEY, SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY, ...values };
  for (const [key, value] of Object.entries(all)) if (value !== undefined) env.set(key, value);
}

globalThis.fetch = async (input) => {
  throw new Error(`edge harness: network is disabled (${input})`);
};

let served = null;
globalThis.Deno = {
  serve(handler) { served = handler; return { finished: Promise.resolve() }; },
  env: { get: (key) => env.get(key) },
};

/** Import supabase/functions/<name>/index.ts once and return the handler it passed to Deno.serve. */
export async function loadEdgeFunction(name) {
  served = null;
  resetEnv();
  await import(new URL(`../../functions/${name}/index.ts`, import.meta.url).href);
  if (typeof served !== 'function') throw new Error(`${name}/index.ts did not call Deno.serve`);
  return served;
}

/** Install a fresh backend for one test. */
export function fakeSupabase() {
  const backend = new FakeSupabase();
  globalThis.__edgeFakeSupabase = backend;
  resetEnv();
  return backend;
}

/** Call a handler like the Edge runtime would. `body` objects are JSON-encoded; strings are sent raw. */
export async function invoke(handler, { method = 'POST', headers = {}, body, path = '/' } = {}) {
  const init = { method, headers: new Headers(headers) };
  if (body !== undefined && method !== 'GET' && method !== 'HEAD') {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    if (!init.headers.has('content-type')) init.headers.set('content-type', 'application/json');
  }
  const response = await handler(new Request(`http://edge.test${path}`, init));
  const text = await response.text();
  let json;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = undefined; }
  return { status: response.status, headers: response.headers, text, json };
}

export const bearer = (token) => ({ Authorization: `Bearer ${token}` });

export class FakeSupabase {
  constructor() {
    this.users = new Map();      // access token -> Auth user
    this.rpcHandlers = new Map(); // name -> (args, ctx) => { data, error }
    this.tables = new Map();      // name -> rows
    this.failures = new Map();    // "table:action" -> error returned once
    this.log = [];                // every rpc / query, in order
    this.defaults = {
      ranked_sessions: () => {
        const now = Date.now();
        return {
          run_id: randomUUID(), nonce: randomUUID(), stage_key: 'secret', status: 'started',
          started_at: new Date(now).toISOString(), expires_at: new Date(now + 5 * 60_000).toISOString(),
          run_type: 'ranked', ruleset_version: 'secret-2.1-r1',
        };
      },
    };
  }

  addUser(token, user) { this.users.set(token, { is_anonymous: false, ...user }); return this.users.get(token); }
  onRpc(name, handler) { this.rpcHandlers.set(name, handler); }
  rows(table) {
    if (!this.tables.has(table)) this.tables.set(table, []);
    return this.tables.get(table);
  }
  failOnce(table, action, error) { this.failures.set(`${table}:${action}`, error); }
  rpcCalls(name) { return this.log.filter((entry) => entry.kind === 'rpc' && entry.name === name); }
  writes(table) {
    return this.log.filter((entry) => entry.kind === 'query' && entry.table === table && entry.action !== 'select');
  }

  createClient(url, key, options) { return new FakeClient(this, url, key, options); }

  async getUser(token) {
    const user = token ? this.users.get(token) : undefined;
    if (!user) return { data: { user: null }, error: { status: 401, message: 'invalid JWT' } };
    return { data: { user: structuredClone(user) }, error: null };
  }
}

class FakeClient {
  constructor(backend, url, key, options) {
    if (url !== SUPABASE_URL) throw new Error(`edge harness: client created for unexpected URL ${url}`);
    this.backend = backend;
    this.role = key === SERVICE_ROLE_KEY ? 'service_role' : key === ANON_KEY ? 'anon' : `unknown-key:${key}`;
    this.bearer = String(options?.global?.headers?.Authorization ?? '').replace(/^Bearer /i, '');
    this.auth = { getUser: (token) => backend.getUser(token ?? this.bearer) };
  }

  rpc(name, args) {
    const run = async () => {
      this.backend.log.push({ kind: 'rpc', role: this.role, bearer: this.bearer, name, args });
      const handler = this.backend.rpcHandlers.get(name);
      if (!handler) return { data: null, error: { code: 'PGRST202', message: `no fake for rpc ${name}` } };
      const result = await handler(args, { role: this.role, bearer: this.bearer });
      return { data: result?.data ?? null, error: result?.error ?? null };
    };
    return { then: (resolve, reject) => run().then(resolve, reject) };
  }

  from(table) { return new FakeQuery(this, table); }
}

class FakeQuery {
  constructor(client, table) {
    this.client = client;
    this.table = table;
    this.action = 'select';
    this.filters = [];
    this.returning = false;
    this.mode = 'many';
  }
  select(columns, options = {}) {
    if (this.action === 'select') { this.columns = columns; this.options = options; } else this.returning = true;
    return this;
  }
  insert(values) { this.action = 'insert'; this.payload = values; return this; }
  update(values) { this.action = 'update'; this.payload = values; return this; }
  eq(column, value) { this.filters.push([column, 'eq', value]); return this; }
  gte(column, value) { this.filters.push([column, 'gte', value]); return this; }
  single() { this.mode = 'single'; return this; }
  maybeSingle() { this.mode = 'maybe'; return this; }
  then(resolve, reject) { return Promise.resolve().then(() => this.execute()).then(resolve, reject); }

  execute() {
    const backend = this.client.backend;
    backend.log.push({
      kind: 'query', role: this.client.role, table: this.table, action: this.action,
      filters: this.filters, payload: this.payload,
    });
    const failure = backend.failures.get(`${this.table}:${this.action}`);
    if (failure) {
      backend.failures.delete(`${this.table}:${this.action}`);
      return { data: null, error: failure, count: null };
    }
    const rows = backend.rows(this.table);
    const matches = (row) => this.filters.every(([column, op, value]) =>
      op === 'eq' ? row[column] === value : row[column] >= value);
    let data;
    if (this.action === 'select') {
      const found = rows.filter(matches);
      if (this.options?.head) return { data: null, error: null, count: found.length };
      data = found;
    } else if (this.action === 'insert') {
      const inserted = (Array.isArray(this.payload) ? this.payload : [this.payload])
        .map((values) => ({ ...(backend.defaults[this.table]?.() ?? {}), ...values }));
      rows.push(...inserted);
      data = inserted;
    } else {
      data = rows.filter(matches);
      for (const row of data) Object.assign(row, this.payload);
    }
    if (this.action !== 'select' && !this.returning) return { data: null, error: null, count: null };
    data = data.map((row) => structuredClone(row));
    if (this.mode === 'many') return { data, error: null, count: null };
    if (data.length > 1) return { data: null, error: { code: 'PGRST116', message: 'multiple rows' }, count: null };
    if (data.length === 0 && this.mode === 'single') {
      return { data: null, error: { code: 'PGRST116', message: 'no rows' }, count: null };
    }
    return { data: data[0] ?? null, error: null, count: null };
  }
}
