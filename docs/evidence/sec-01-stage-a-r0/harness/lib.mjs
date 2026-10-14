// SEC-01 Stage A harness library. Talks ONLY to the disposable local Supabase stack started by
// `supabase start` (127.0.0.1). The keys below are the public, well-known local-development demo
// keys printed by the Supabase CLI; they are not production credentials.
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const API_URL = process.env.SEC01_API_URL ?? "http://127.0.0.1:54321";
export const DB_URL = process.env.SEC01_DB_URL ?? "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
export const ANON_KEY = process.env.SEC01_ANON_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE_KEY = process.env.SEC01_SERVICE_KEY ?? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(API_URL) || !/@(127\.0\.0\.1|localhost):/.test(DB_URL)) {
  throw new Error("SEC-01 harness refuses to run against a non-local target");
}

export const RESULTS_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../results");
export const pool = new pg.Pool({ connectionString: DB_URL, max: 40 });
// Fault injection only (detaching a realtime.messages partition needs the table owner).
export const SUPER_DB_URL = DB_URL.replace("postgres:postgres@", "supabase_admin:postgres@");
export const superPool = new pg.Pool({ connectionString: SUPER_DB_URL, max: 2 });
export const admin = createClient(API_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const now = () => Number(process.hrtime.bigint()) / 1e6;

// RFC 9562 UUIDv7 (48-bit unix ms + random). `atMs` lets tests forge old/future request ids.
export function uuidv7(atMs = Date.now()) {
  const b = crypto.randomBytes(16);
  const ms = BigInt(atMs);
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6] & 0x0f) | 0x70;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let userSeq = 0;
const runTag = crypto.randomBytes(3).toString("hex");
// Synthetic accounts only: sec01-<run>-<n>@example.test, profile nickname "lab<n>".
export async function makeUsers(n, label = "u") {
  const out = [];
  for (let i = 0; i < n; i++) {
    const idx = ++userSeq;
    const email = `sec01-${runTag}-${label}${idx}@example.test`;
    const password = crypto.randomBytes(12).toString("hex");
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    const id = data.user.id;
    await pool.query("insert into public.profiles(user_id, nickname) values ($1, $2)", [id, `lab${label}${idx}`.slice(0, 12)]);
    const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    const s = await client.auth.signInWithPassword({ email, password });
    if (s.error) throw s.error;
    await client.realtime.setAuth(s.data.session.access_token);
    out.push({ id, email, label: `${label}${idx}`, token: s.data.session.access_token, client });
  }
  return out;
}

export async function rpc(user, fn, args) {
  const t0 = now();
  const { data, error } = await user.client.rpc(fn, args);
  return { data, error, ms: now() - t0 };
}

// Direct SQL in the PostgREST security context of `user` on a dedicated connection.
export async function connectAs(user) {
  const c = await pool.connect();
  const claims = JSON.stringify({ sub: user.id, role: "authenticated", is_anonymous: false, aud: "authenticated" });
  return {
    c,
    async begin() {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    },
    q: (sql, params) => c.query(sql, params),
    release: () => c.release()
  };
}

// Subscribe to a private Realtime topic. Resolves {status, messages, channel} once the join settles.
// fresh: open a separate WebSocket for this subscription (Phoenix closes a duplicate join of the
// same topic on one socket, which would otherwise masquerade as an authorization result).
export function freshClient(user) {
  const client = createClient(API_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false },
    global: user.token ? { headers: { Authorization: `Bearer ${user.token}` } } : undefined });
  if (user.token) client.realtime.setAuth(user.token);
  (user.extraClients ??= []).push(client);
  return client;
}
export function subscribe(user, topic, { isPrivate = true, event = "campus_chat_v1", timeoutMs = 8000, fresh = false, broadcast } = {}) {
  const messages = [];
  const client = fresh ? freshClient(user) : user.client;
  const channel = client.channel(topic, { config: { private: isPrivate, ...(broadcast ? { broadcast } : {}) } });
  channel.on("broadcast", { event }, (msg) => messages.push({ at: Date.now(), t: now(), payload: msg.payload }));
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ status: "TIMEOUT", messages, channel }), timeoutMs);
    channel.subscribe((status, err) => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timer);
        resolve({ status, error: err ? String(err.message ?? err) : null, messages, channel });
      }
    });
  });
}

export async function unsubscribeAll(users) {
  for (const u of users) {
    for (const c of [u.client, ...(u.extraClients ?? [])]) { try { await c.removeAllChannels(); } catch { /* ignore */ } }
    u.extraClients = [];
  }
}

export async function joinCampus(user, area = "AREA_LAB_PLAZA", clientSession = crypto.randomUUID()) {
  const r = await rpc(user, "sec01_join_campus_chat", { p_area: area, p_client_session: clientSession });
  if (r.error || !r.data?.allowed) throw new Error(`join failed: ${JSON.stringify(r.error ?? r.data)}`);
  return { ...r.data, clientSession };
}

export function sendArgs(lease, { requestId = uuidv7(), text = "안녕", x = 1, y = 0, z = 2 } = {}) {
  return { p_lease: lease.leaseId, p_generation: lease.generation, p_request_id: requestId, p_text: text, p_x: x, p_y: y, p_z: z };
}

export async function setConfig(fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  await pool.query(`update sec01_lab.config set ${keys.map((k, i) => `${k} = $${i + 1}`).join(", ")}`, Object.values(fields));
}
export async function resetConfig() {
  await pool.query("update sec01_lab.config set lease_ttl='30 seconds', retry_window='10 minutes', lookup_window='30 minutes', publish_mode='insert', recheck_clock='clock', lock_mode='shared', require_uuid_v7=true");
}

export async function countRows(requestId) {
  const r = await pool.query(`select
      (select count(*) from sec01_lab.approvals where request_id = $1)::int as approvals,
      (select count(*) from sec01_lab.deliveries where request_id = $1)::int as deliveries,
      (select count(*) from realtime.messages where payload->'envelope'->>'requestId' = $1::text)::int as realtime_rows`, [requestId]);
  return r.rows[0];
}

// Result recorder: PASS / FAIL / BLOCKED / NOT MEASURED with evidence.
export function recorder(name) {
  const results = [];
  return {
    add(entry) { results.push(entry); const tag = entry.verdict.padEnd(12); console.log(`${tag} ${entry.id} ${entry.title}`); return entry; },
    results,
    save(extra = {}) {
      fs.mkdirSync(RESULTS_DIR, { recursive: true });
      const file = path.join(RESULTS_DIR, `${name}.json`);
      fs.writeFileSync(file, JSON.stringify({ suite: name, ranAt: new Date().toISOString(), ...extra, results }, null, 2));
      console.log(`saved ${file}`);
    }
  };
}

export const verdict = (ok) => (ok ? "PASS" : "FAIL");
