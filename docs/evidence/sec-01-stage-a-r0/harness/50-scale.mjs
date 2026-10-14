// Experiment E · scale and performance on the isolated stack (synthetic accounts/sessions/messages).
// Single 4-vCPU container host; all clients run in this one Node process. Numbers are relative
// evidence for this lab, NOT production capacity figures.
import crypto from "node:crypto";
import fs from "node:fs";
import { execSync } from "node:child_process";
import {
  makeUsers, joinCampus, subscribe, sleep, pool, rpc, sendArgs, unsubscribeAll, connectAs, resetConfig,
  recorder, uuidv7, now
} from "./lib.mjs";

const rec = recorder("E-scale");
const SCENARIOS = (process.env.E_SCENARIOS ?? "2,10,30,100").split(",").map(Number);
const MESSAGES = Number(process.env.E_MESSAGES ?? 40);
const pct = (arr, p) => { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return +s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)].toFixed(2); };
const stats = (arr) => ({ n: arr.length, p50: pct(arr, 50), p95: pct(arr, 95), max: arr.length ? +Math.max(...arr).toFixed(2) : null });

function cg(container) {
  const id = execSync(`docker inspect -f '{{.Id}}' ${container}`).toString().trim();
  const read = (p) => Number(fs.readFileSync(p, "utf8").trim());
  return {
    cpuNs: () => read(`/sys/fs/cgroup/cpuacct/docker/${id}/cpuacct.usage`),
    memBytes: () => read(`/sys/fs/cgroup/memory/docker/${id}/memory.usage_in_bytes`)
  };
}
const DB = cg("supabase_db_p2-public-local"), RT = cg("supabase_realtime_p2-public-local"), REST = cg("supabase_rest_p2-public-local");

async function sizes() {
  return (await pool.query(`select
    pg_total_relation_size('sec01_lab.approvals') a, pg_total_relation_size('sec01_lab.deliveries') d,
    pg_total_relation_size('sec01_lab.sessions') s,
    (select sum(pg_total_relation_size(inhrelid)) from pg_inherits where inhparent='realtime.messages'::regclass) m`)).rows[0];
}
async function tableStats() {
  return (await pool.query(`select relname, n_tup_ins, n_tup_upd, n_tup_del, seq_scan, idx_scan
     from pg_stat_user_tables where schemaname='sec01_lab' or (schemaname='realtime' and relname like 'messages%')`)).rows;
}

await resetConfig();
const scenarioRows = [];
for (const N of SCENARIOS) {
  const AREA = `AREA_E${N}_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const memRt0 = RT.memBytes();
  const users = await makeUsers(N, `e${N}`);
  const leases = [];
  const tJoin = [];
  for (const u of users) { const t = now(); leases.push(await joinCampus(u, AREA)); tJoin.push(now() - t); }
  const subs = [];
  for (let i = 0; i < N; i++) {
    const s = await subscribe(users[i], leases[i].topic, { timeoutMs: 15000 });
    subs.push(s);
  }
  const joinedOk = subs.filter((s) => s.status === "SUBSCRIBED").length;
  await sleep(1000);
  const memRt1 = RT.memBytes();

  // Sequential paced load: rate = min(10, 0.5N) msg/s, senders rotate (stays under 3 msgs / 5 s each).
  const rate = Math.min(10, 0.5 * N);
  await pool.query("select pg_stat_statements_reset()");
  const ts0 = await tableStats(), sz0 = await sizes();
  const cpu0 = { db: DB.cpuNs(), rt: RT.cpuNs(), rest: REST.cpuNs() };
  const sends = [];
  const tLoad = now();
  const lockSamples = []; let sampling = true;
  const sampler = (async () => { while (sampling) {
    const r = await pool.query("select count(*) filter (where wait_event_type='Lock')::int w, count(*) filter (where state='active')::int a from pg_stat_activity where query ilike '%sec01_send_campus_chat%' and pid<>pg_backend_pid()");
    lockSamples.push(r.rows[0]); await sleep(10); } })();
  for (let i = 0; i < MESSAGES; i++) {
    const si = i % N;
    const args = sendArgs(leases[si], { text: `E${N} 메시지 ${i}` });
    const t0 = now();
    const p = rpc(users[si], "sec01_send_campus_chat", args).then((r) => ({ ...r, t0, si, requestId: args.p_request_id }));
    sends.push(p);
    await sleep(1000 / rate);
  }
  const results = await Promise.all(sends);
  await sleep(2500);
  sampling = false; await sampler;
  const loadSec = (now() - tLoad) / 1000;
  const cpu1 = { db: DB.cpuNs(), rt: RT.cpuNs(), rest: REST.cpuNs() };
  const ts1 = await tableStats(), sz1 = await sizes();

  const approve = results.map((r) => r.ms);
  const okCount = results.filter((r) => r.data?.ok).length;
  const failures = results.filter((r) => !r.data?.ok).map((r) => r.data?.reason ?? r.error?.message);
  // Delivery latency per recipient frame = receive time - RPC dispatch time.
  const delivery = []; let expectedFrames = 0, gotFrames = 0;
  for (const r of results) {
    if (!r.data?.ok) continue;
    expectedFrames += r.data.recipientCount;
    for (let j = 0; j < N; j++) {
      if (j === r.si) continue;
      const m = subs[j].messages.find((x) => x.payload?.envelope?.requestId === r.requestId);
      if (m) { gotFrames++; delivery.push(m.t - r.t0); }
    }
  }
  // Statement-level DB work inside the function (pg_stat_statements track=all).
  const pgss = (await pool.query(`select left(regexp_replace(query, '\\s+', ' ', 'g'), 90) q, calls::int, rows::bigint,
      round(total_exec_time::numeric, 2) ms, shared_blks_hit::bigint hit, shared_blks_read::bigint rd
      from pg_stat_statements where query ~* '(sec01_lab|realtime\\.messages|world_user_blocks|world_user_moderation|profiles|sec01_send)' order by total_exec_time desc limit 25`)).rows;
  const fnStat = pgss.find((r) => /sec01_send_campus_chat/.test(r.q) && /from|select/i.test(r.q));
  const insOf = (rel) => { const a = ts0.filter((x) => x.relname.startsWith(rel)).reduce((s, x) => s + Number(x.n_tup_ins), 0); const b = ts1.filter((x) => x.relname.startsWith(rel)).reduce((s, x) => s + Number(x.n_tup_ins), 0); return b - a; };
  const scansOf = (rel) => { const f = (t) => t.filter((x) => x.relname === rel).reduce((s, x) => s + Number(x.seq_scan) + Number(x.idx_scan), 0); return f(ts1) - f(ts0); };

  // DB-side function time without HTTP: direct SQL, distinct senders.
  const direct = [];
  for (let i = 0; i < Math.min(N, 20); i++) {
    const c = await connectAs(users[i]); await c.begin();
    await sleep(5);
    const t = now();
    try { await c.q("select public.sec01_send_campus_chat($1,$2,$3,$4,1,0,2)", [leases[i].leaseId, leases[i].generation, uuidv7(), `E${N} direct ${i}`]); } catch { /* rate-limited senders are skipped */ }
    direct.push(now() - t);
    await c.q("commit"); c.release();
  }
  await sleep(5200);

  // Burst: every session sends ONE message at the same instant (worst-case contention).
  const burstT0 = now();
  const burst = await Promise.all(users.map((u, i) => { const args = sendArgs(leases[i], { text: `E${N} 버스트 ${i}` }); const t0 = now(); return rpc(u, "sec01_send_campus_chat", args).then((r) => ({ ...r, t0, si: i, requestId: args.p_request_id })); }));
  const burstWall = now() - burstT0;
  await sleep(4000);
  let bExp = 0, bGot = 0; const bDel = [];
  for (const r of burst) {
    if (!r.data?.ok) continue;
    bExp += r.data.recipientCount;
    for (let j = 0; j < N; j++) { if (j === r.si) continue; const m = subs[j].messages.find((x) => x.payload?.envelope?.requestId === r.requestId); if (m) { bGot++; bDel.push(m.t - r.t0); } }
  }

  // Lease renew cost (one renew per session, as the renew interval would issue).
  const renew = [];
  await Promise.all(users.map(async (u, i) => { const r = await rpc(u, "sec01_renew_campus_chat", { p_lease: leases[i].leaseId, p_generation: leases[i].generation }); renew.push(r.ms); }));

  const memRt2 = RT.memBytes();
  const row = {
    sessions: N, subscribed: joinedOk,
    approvalRpcMs: stats(approve),
    publishDbFunctionMs: stats(direct),
    realtimeDeliveryMs: stats(delivery),
    fanoutPerMessage: N - 1,
    framesExpected: expectedFrames, framesReceived: gotFrames,
    failureRate: +((MESSAGES - okCount) / MESSAGES).toFixed(4), failures: [...new Set(failures)],
    dbPerMessage: {
      inserts: { approvals: insOf("approvals") / MESSAGES, deliveries: insOf("deliveries") / MESSAGES, realtimeMessages: insOf("messages") / MESSAGES },
      sessionsTableScans: +(scansOf("sessions") / MESSAGES).toFixed(1),
      functionCalls: fnStat?.calls ?? null, functionTotalMs: fnStat ? Number(fnStat.ms) : null
    },
    pgssTopStatements: pgss.slice(0, 12),
    lockWait: { samples: lockSamples.length, samplesWithWaiter: lockSamples.filter((s) => s.w > 0).length, maxConcurrentWaiters: Math.max(0, ...lockSamples.map((s) => s.w)) },
    burst: { senders: N, wallMs: Math.round(burstWall), approvalRpcMs: stats(burst.map((r) => r.ms)), ok: burst.filter((r) => r.data?.ok).length,
      rejected: [...new Set(burst.filter((r) => !r.data?.ok).map((r) => r.data?.reason ?? r.error?.message))], deliveryMs: stats(bDel), framesExpected: bExp, framesReceived: bGot },
    renewRpcMs: stats(renew),
    cpuSecondsDuringPacedLoad: { db: +((cpu1.db - cpu0.db) / 1e9).toFixed(3), realtime: +((cpu1.rt - cpu0.rt) / 1e9).toFixed(3), postgrest: +((cpu1.rest - cpu0.rest) / 1e9).toFixed(3), wallSeconds: +loadSec.toFixed(1),
      dbCpuMsPerMessage: +(((cpu1.db - cpu0.db) / 1e6) / MESSAGES).toFixed(2) },
    realtimeMemoryMB: { beforeClients: +(memRt0 / 2 ** 20).toFixed(1), afterSubscribe: +(memRt1 / 2 ** 20).toFixed(1), afterLoad: +(memRt2 / 2 ** 20).toFixed(1) },
    storageBytes: { approvalsPerMessage: Math.round((sz1.a - sz0.a) / MESSAGES), deliveriesPerMessage: Math.round((sz1.d - sz0.d) / MESSAGES),
      realtimeMessagesPerMessage: Math.round((sz1.m - sz0.m) / MESSAGES), sessionsTableTotal: Number(sz1.s) },
    joinRpcMs: stats(tJoin)
  };
  scenarioRows.push(row);
  console.log(JSON.stringify({ N, approval: row.approvalRpcMs, delivery: row.realtimeDeliveryMs, frames: `${gotFrames}/${expectedFrames}`, burst: row.burst.deliveryMs, burstFrames: `${bGot}/${bExp}` }));
  await unsubscribeAll(users);
  await pool.query("update sec01_lab.sessions set ended_at = clock_timestamp() where area_id = $1", [AREA]);
  await sleep(1500);
}

rec.add({ id: "E-table", title: "규모별 성능 측정표", verdict: "PASS", level: "real PostgreSQL 17 + PostgREST + Supabase Realtime (local Docker, single host)",
  observed: { messagesPerScenario: MESSAGES, scenarios: scenarioRows }, expected: "(measurement)" });
rec.save();
await pool.end();
process.exit(0);
