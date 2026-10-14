// Experiment A · publication atomicity (A1-A8) on real PostgreSQL 17 + real Supabase Realtime.
import crypto from "node:crypto";
import {
  makeUsers, joinCampus, subscribe, rpc, sendArgs, sleep, countRows, pool, unsubscribeAll,
  connectAs, setConfig, superPool, resetConfig, recorder, verdict, uuidv7, now
} from "./lib.mjs";

const rec = recorder("A-atomicity");
const area = (id) => `AREA_${id}_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const SETTLE = 2000;

async function room(id, nRecipients = 2) {
  const users = await makeUsers(nRecipients + 1, id.toLowerCase());
  const [sender, ...recipients] = users;
  const a = area(id);
  const lease = await joinCampus(sender, a);
  const subs = [];
  for (const r of recipients) {
    const l = await joinCampus(r, a);
    const s = await subscribe(r, l.topic);
    if (s.status !== "SUBSCRIBED") throw new Error(`subscribe ${s.status} ${s.error}`);
    subs.push({ user: r, lease: l, sub: s });
  }
  return { users, sender, lease, subs, area: a };
}
const received = (subs, requestId) => subs.map((s) => s.sub.messages.filter((m) => m.payload?.envelope?.requestId === requestId).length);

await resetConfig();

// A1 · normal approval + publication
{
  const r = await room("A1");
  const args = sendArgs(r.lease, { text: "A1 정상 발행" });
  const res = await rpc(r.sender, "sec01_send_campus_chat", args);
  await sleep(SETTLE);
  const rows = await countRows(args.p_request_id);
  const got = received(r.subs, args.p_request_id);
  const sameEnv = r.subs.every((s) => JSON.stringify(s.sub.messages[0]?.payload?.envelope) === JSON.stringify(res.data?.envelope));
  const ok = res.data?.ok === true && rows.approvals === 1 && rows.deliveries === 2 && rows.realtime_rows === 2 && got.every((n) => n === 1) && sameEnv;
  rec.add({ id: "A1", title: "정상 승인 및 발행", verdict: verdict(ok), level: "real PostgreSQL + real Supabase Realtime",
    input: { recipients: 2, text: args.p_text }, observed: { rpc: res.data?.ok, rows, receivedPerRecipient: got, envelopeIdenticalToRpcResponse: sameEnv, rpcMs: res.ms },
    expected: "approvals=1, deliveries=2, realtime rows=2, each recipient receives exactly 1 identical envelope" });
  await unsubscribeAll(r.users);
}

// A2 · forced rollback right before commit (two variants)
{
  const r = await room("A2");
  // A2a: injected exception at the very end of the function (all inserts already executed).
  const c = await connectAs(r.sender);
  const reqA = uuidv7();
  let errA = null;
  await c.begin();
  await c.q("select set_config('sec01.fail_before_commit','on',true)");
  try {
    await c.q("select public.sec01_send_campus_chat($1,$2,$3,$4,$5,$6,$7)", [r.lease.leaseId, r.lease.generation, reqA, "A2a 롤백", 1, 0, 2]);
  } catch (e) { errA = e.message; }
  await c.q("rollback");
  // A2b: function succeeds, then the transaction is explicitly rolled back before COMMIT.
  const reqB = uuidv7();
  await c.begin();
  const inside = await c.q("select public.sec01_send_campus_chat($1,$2,$3,$4,$5,$6,$7) as r", [r.lease.leaseId, r.lease.generation, reqB, "A2b 롤백", 1, 0, 2]);
  await c.q("reset role");
  const insideRows = (await c.q("select count(*)::int n from realtime.messages where payload->'envelope'->>'requestId'=$1", [reqB])).rows[0].n;
  await c.q("rollback");
  c.release();
  await sleep(SETTLE);
  const rowsA = await countRows(reqA), rowsB = await countRows(reqB);
  const gotA = received(r.subs, reqA), gotB = received(r.subs, reqB);
  const ok = !!errA && rowsA.approvals + rowsA.deliveries + rowsA.realtime_rows === 0 && gotA.every((n) => n === 0)
    && inside.rows[0].r.ok === true && insideRows === 2 && rowsB.approvals + rowsB.deliveries + rowsB.realtime_rows === 0 && gotB.every((n) => n === 0);
  rec.add({ id: "A2", title: "DB 커밋 직전 강제 롤백", verdict: verdict(ok), level: "real PostgreSQL + real Supabase Realtime",
    input: { variantA: "sec01.fail_before_commit=on (exception after all inserts)", variantB: "function returns ok, ROLLBACK instead of COMMIT" },
    observed: { A: { error: errA, rowsAfter: rowsA, received: gotA }, B: { rpcInsideTx: inside.rows[0].r.ok, realtimeRowsVisibleInsideTx: insideRows, rowsAfter: rowsB, received: gotB } },
    expected: "zero approval/delivery/realtime rows after rollback, zero Realtime deliveries (logical replication only ships committed rows)" });
  await unsubscribeAll(r.users);
}

// A3 · provider warning failure: realtime.messages partition for "today" detached (lab fault).
{
  const r = await room("A3");
  const part = (await pool.query(`select c.oid::regclass::text as name, pg_get_expr(c.relpartbound, c.oid) as bound
      from pg_inherits i join pg_class c on c.oid=i.inhrelid where i.inhparent='realtime.messages'::regclass`)).rows
    .find((p) => { const m = p.bound.match(/FROM \('([^']+)'\) TO \('([^']+)'\)/); const t = new Date().toISOString().replace("T", " ").slice(0, 19); return m && m[1] <= t && t < m[2]; });
  const out = {};
  // Provider direct: what realtime.send itself does when its insert fails.
  await superPool.query(`alter table realtime.messages detach partition ${part.name}`);
  try {
    const notices = [];
    const pc = await pool.connect();
    pc.on("notice", (n) => notices.push(n.message));
    const before = (await pc.query("select count(*)::int n from realtime.messages")).rows[0].n;
    const sendRes = await pc.query("select realtime.send('{\"probe\":1}'::jsonb, 'probe', 'world:campus-chat:00000000-0000-4000-8000-000000000000', true) as r");
    const after = (await pc.query("select count(*)::int n from realtime.messages")).rows[0].n;
    pc.release();
    out.providerDirect = { returned: sendRes.rows[0].r, warnings: notices, rowsDelta: after - before };

    await setConfig({ publish_mode: "realtime_send" });
    const a1 = sendArgs(r.lease, { text: "A3 realtime.send 경로" });
    const resSend = await rpc(r.sender, "sec01_send_campus_chat", a1);
    await setConfig({ publish_mode: "insert" });
    const a2 = sendArgs(r.lease, { text: "A3 direct insert 경로" });
    const resIns = await rpc(r.sender, "sec01_send_campus_chat", a2);
    out.realtimeSendMode = { rpc: resSend.data ?? resSend.error, reqId: a1.p_request_id };
    out.directInsertMode = { rpc: resIns.data ?? resIns.error?.message, reqId: a2.p_request_id };
  } finally {
    await superPool.query(`alter table realtime.messages attach partition ${part.name} ${part.bound}`);
    await resetConfig();
  }
  await sleep(SETTLE);
  out.realtimeSendMode.rows = await countRows(out.realtimeSendMode.reqId);
  out.realtimeSendMode.received = received(r.subs, out.realtimeSendMode.reqId);
  out.directInsertMode.rows = await countRows(out.directInsertMode.reqId);
  out.directInsertMode.received = received(r.subs, out.directInsertMode.reqId);
  const sendModeAtomic = out.realtimeSendMode.rows.approvals === 0 || out.realtimeSendMode.rows.realtime_rows === out.realtimeSendMode.rows.deliveries;
  const insertModeAtomic = out.directInsertMode.rows.approvals === 0 && out.directInsertMode.rows.realtime_rows === 0 && out.directInsertMode.rows.deliveries === 0;
  rec.add({ id: "A3-provider", title: "Provider(realtime.send) 경고성 실패 — 공급자 동작", verdict: out.providerDirect.rowsDelta === 0 && out.providerDirect.returned === "" ? "FAIL" : "PASS",
    note: "FAIL = the provider reports success (void return + WARNING) while writing zero rows; a caller cannot detect the failure from the return value.",
    level: "real PostgreSQL (fault: today's realtime.messages partition detached in the isolated DB)", observed: out.providerDirect,
    expected: "a failed publication must surface as an error, not a warning" });
  rec.add({ id: "A3-send-mode", title: "Provider 경고성 실패 — realtime.send 기반 발행(PR #353 방식)", verdict: verdict(sendModeAtomic),
    level: "real PostgreSQL + real Supabase Realtime", observed: out.realtimeSendMode,
    expected: "approval and publication rows commit or roll back together" });
  rec.add({ id: "A3-insert-mode", title: "Provider 경고성 실패 — 직접 INSERT + 행수 검증(SEC-01 lab 대체안)", verdict: verdict(insertModeAtomic),
    level: "real PostgreSQL + real Supabase Realtime", observed: out.directInsertMode,
    expected: "RPC fails, zero approval/delivery/realtime rows, nothing delivered" });
  await unsubscribeAll(r.users);
}

// A4 · RPC response lost after publication commits (client aborts the HTTP request, then retries)
{
  const r = await room("A4");
  const args = sendArgs(r.lease, { text: "A4 응답 유실" });
  const ctl = new AbortController();
  const p = r.sender.client.rpc("sec01_send_campus_chat", args).abortSignal(ctl.signal);
  setTimeout(() => ctl.abort(), 3);
  const first = await p;
  await sleep(500);
  const rowsAfterLoss = await countRows(args.p_request_id);
  const retry = await rpc(r.sender, "sec01_send_campus_chat", args);
  await sleep(SETTLE);
  const rows = await countRows(args.p_request_id);
  const got = received(r.subs, args.p_request_id);
  const firstLost = !!first.error;
  const delivered = r.subs[0].sub.messages.find((m) => m.payload?.envelope?.requestId === args.p_request_id)?.payload?.envelope;
  const ok = firstLost && rowsAfterLoss.approvals === 1 && retry.data?.ok && retry.data?.replayed === true
    && JSON.stringify(retry.data.envelope) === JSON.stringify(delivered) && rows.realtime_rows === 2 && got.every((n) => n === 1);
  rec.add({ id: "A4", title: "발행 성공 후 RPC 응답 유실", verdict: firstLost ? verdict(ok) : "NOT MEASURED",
    level: "real PostgREST + PostgreSQL + Realtime", input: "abort HTTP request 3 ms after dispatch, then retry same requestId/body",
    observed: { firstResponse: first.error ? String(first.error.message) : "response arrived (abort too late)", rowsAfterLoss, retry: { ok: retry.data?.ok, replayed: retry.data?.replayed }, retryEnvelopeEqualsDelivered: JSON.stringify(retry.data?.envelope) === JSON.stringify(delivered), rows, received: got },
    expected: "server committed once; retry replays the identical envelope; recipients still have exactly one message" });
  await unsubscribeAll(r.users);
}

// A5 · same requestId concurrently (HTTP fan-in + lock-observed direct SQL)
{
  const r = await room("A5");
  const args = sendArgs(r.lease, { text: "A5 동시 요청" });
  const results = await Promise.all(Array.from({ length: 12 }, () => rpc(r.sender, "sec01_send_campus_chat", args)));
  // Lock-observed: connection 1 holds the request lock 1.5 s before commit; connection 2 must wait.
  const args2 = sendArgs(r.lease, { text: "A5 잠금 관찰" });
  const c1 = await connectAs(r.sender), c2 = await connectAs(r.sender);
  await c1.begin(); await c2.begin();
  await c1.q("select set_config('sec01.pause_before_commit','1.5',true)");
  const sql = "select public.sec01_send_campus_chat($1,$2,$3,$4,$5,$6,$7) as r";
  const vals = [args2.p_lease, args2.p_generation, args2.p_request_id, args2.p_text, 1, 0, 2];
  const t0 = now();
  const p1 = c1.q(sql, vals).then(async (x) => { await c1.q("commit"); return { r: x.rows[0].r, at: now() - t0 }; });
  await sleep(200);
  const p2 = c2.q(sql, vals).then(async (x) => { await c2.q("commit"); return { r: x.rows[0].r, at: now() - t0 }; });
  const [o1, o2] = await Promise.all([p1, p2]);
  c1.release(); c2.release();
  await sleep(SETTLE);
  const rows = await countRows(args.p_request_id), rows2 = await countRows(args2.p_request_id);
  const ids = new Set(results.map((x) => x.data?.envelope?.messageId));
  const fresh = results.filter((x) => x.data?.replayed === false).length;
  const ok = results.every((x) => x.data?.ok) && ids.size === 1 && fresh === 1 && rows.approvals === 1 && rows.realtime_rows === 2
    && received(r.subs, args.p_request_id).every((n) => n === 1)
    && o1.r.replayed === false && o2.r.replayed === true && o2.at >= 1400 && o1.r.envelope.messageId === o2.r.envelope.messageId && rows2.realtime_rows === 2;
  rec.add({ id: "A5", title: "동일 requestId 동시 요청", verdict: verdict(ok), level: "real PostgREST + PostgreSQL (separate backends) + Realtime",
    observed: { http12: { distinctMessageIds: ids.size, freshApprovals: fresh, rows, received: received(r.subs, args.p_request_id) },
      lockObserved: { first: { replayed: o1.r.replayed, finishedMs: Math.round(o1.at) }, second: { replayed: o2.r.replayed, finishedMs: Math.round(o2.at), waitedForFirstCommit: o2.at >= 1400 }, rows: rows2 } },
    expected: "exactly one approval; all other callers get the identical envelope as replay" });
  await unsubscribeAll(r.users);
}

// A6 · same requestId, different body (sequential and concurrent)
{
  const r = await room("A6");
  const args = sendArgs(r.lease, { text: "A6 원문" });
  const first = await rpc(r.sender, "sec01_send_campus_chat", args);
  const variants = [{ p_text: "A6 변조" }, { p_x: 1.01 }, { p_text: "A6 원문 " }, { p_text: "a6 원문".replace("a", "A") + "\u200B" }];
  const outs = [];
  for (const v of variants) outs.push({ variant: v, res: (await rpc(r.sender, "sec01_send_campus_chat", { ...args, ...v })).data });
  const reqC = uuidv7();
  const conc = await Promise.all([
    rpc(r.sender, "sec01_send_campus_chat", { ...args, p_request_id: reqC, p_text: "A6 동시 본문1" }),
    rpc(r.sender, "sec01_send_campus_chat", { ...args, p_request_id: reqC, p_text: "A6 동시 본문2" })]);
  await sleep(SETTLE);
  const rows = await countRows(args.p_request_id), rowsC = await countRows(reqC);
  const reasons = conc.map((x) => x.data?.reason ?? (x.data?.ok ? "approved" : "?")).sort();
  // Canonically-equal bodies (trailing space, ZWSP) are the SAME body after normalization -> replay.
  const expectReplay = [false, false, true, true];
  const okSeq = outs.every((o, i) => expectReplay[i] ? o.res?.replayed === true : o.res?.reason === "request_conflict");
  const ok = first.data?.ok && okSeq && rows.approvals === 1 && rows.realtime_rows === 2 && JSON.stringify(reasons) === JSON.stringify(["approved", "request_conflict"]) && rowsC.approvals === 1;
  rec.add({ id: "A6", title: "동일 requestId · 서로 다른 본문", verdict: verdict(ok), level: "real PostgREST + PostgreSQL",
    observed: { sequential: outs.map((o) => ({ variant: o.variant, ok: o.res?.ok, replayed: o.res?.replayed, reason: o.res?.reason })), rows, concurrent: reasons, rowsConcurrent: rowsC },
    expected: "different canonical body -> request_conflict with no rows; canonically identical body -> replay" });
  await unsubscribeAll(r.users);
}

// A8 · repeated lookups/retries never add rows
{
  const r = await room("A8");
  const args = sendArgs(r.lease, { text: "A8 재조회" });
  await rpc(r.sender, "sec01_send_campus_chat", args);
  const base = await countRows(args.p_request_id);
  const outs = [];
  for (let i = 0; i < 20; i++) outs.push((await rpc(r.sender, "sec01_send_campus_chat", args)).data?.replayed);
  for (let i = 0; i < 20; i++) outs.push((await rpc(r.sender, "sec01_get_campus_chat_receipt", { p_request_id: args.p_request_id })).data?.ok);
  await sleep(SETTLE);
  const after = await countRows(args.p_request_id);
  const ok = outs.every(Boolean) && JSON.stringify(base) === JSON.stringify(after) && received(r.subs, args.p_request_id).every((n) => n === 1);
  rec.add({ id: "A8", title: "중복 재조회 시 발행 행 증가 여부", verdict: verdict(ok), level: "real PostgREST + PostgreSQL + Realtime",
    observed: { retries: 20, lookups: 20, rowsBefore: base, rowsAfter: after, received: received(r.subs, args.p_request_id) }, expected: "rows unchanged, one delivery per recipient" });
  await unsubscribeAll(r.users);
}

// A7 · global consistency of every approval written by this suite and all earlier runs
{
  const q = await pool.query(`
    with a as (select * from sec01_lab.approvals),
    d as (select d.*, m.id is not null as has_row, m.topic = d.topic as topic_ok, m.payload->'envelope' = a.envelope as env_ok
            from sec01_lab.deliveries d join a using (sender_id, request_id)
            left join realtime.messages m on m.id = d.realtime_message_id)
    select (select count(*) from a)::int as approvals,
           (select count(*) from a where recipient_count <> (select count(*) from sec01_lab.deliveries x where x.sender_id=a.sender_id and x.request_id=a.request_id))::int as count_mismatch,
           (select count(*) from d)::int as deliveries,
           (select count(*) from d where not has_row)::int as delivery_without_realtime_row,
           (select count(*) from d where has_row and (not topic_ok or not env_ok))::int as payload_or_topic_mismatch,
           (select count(*) from realtime.messages m where m.topic like 'world:campus-chat:%' and m.payload ? 'envelope'
              and not exists (select 1 from sec01_lab.deliveries x where x.realtime_message_id = m.id))::int as realtime_rows_without_delivery`);
  const s = q.rows[0];
  // A3-send-mode intentionally produced delivery rows without realtime rows; report them separately.
  rec.add({ id: "A7", title: "승인 기록과 발행 행의 일치 여부(전수 대조)", verdict: verdict(s.count_mismatch === 0 && s.payload_or_topic_mismatch === 0 && s.realtime_rows_without_delivery === 0),
    level: "real PostgreSQL", observed: s,
    note: "delivery_without_realtime_row > 0 is expected ONLY from the A3 realtime.send fault run (that run is the FAIL evidence).",
    expected: "every approval has recipient_count delivery rows; every delivery row's realtime row carries the identical envelope and topic; no orphan realtime rows" });
}

rec.save({ target: { main: "0dcae7b4825c12e1ec03b6879d3bc0d27f9ad46e", pr353: "83cb427f81384087e759e0e0f158d1629b1e9f63" } });
await pool.end();
process.exit(0);
