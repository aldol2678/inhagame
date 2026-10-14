// Experiment B · authority concurrency on real PostgreSQL (separate backends) + real Realtime.
// Every case puts the publisher into an OBSERVED lock wait (pg_stat_activity wait_event_type=Lock)
// while the competing state change commits, or the reverse.
import crypto from "node:crypto";
import {
  makeUsers, joinCampus, subscribe, sleep, pool, unsubscribeAll, connectAs, setConfig, resetConfig,
  recorder, verdict, uuidv7, now, rpc
} from "./lib.mjs";

const rec = recorder("B-concurrency");
const area = (id) => `AREA_${id}_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const SETTLE = 1500;
const SEND = "select public.sec01_send_campus_chat($1,$2,$3,$4,$5,$6,$7) as r";

async function room(id, n = 2) {
  const users = await makeUsers(n + 1, id.toLowerCase());
  const [sender, ...recipients] = users;
  const a = area(id);
  const lease = await joinCampus(sender, a);
  const subs = [];
  for (const r of recipients) {
    const l = await joinCampus(r, a);
    const s = await subscribe(r, l.topic);
    if (s.status !== "SUBSCRIBED") throw new Error(`subscribe ${s.status}`);
    subs.push({ user: r, lease: l, sub: s });
  }
  return { users, sender, lease, subs, area: a };
}
async function tx(user, hooks = {}) {
  const c = await connectAs(user);
  await c.begin();
  for (const [k, v] of Object.entries(hooks)) await c.q("select set_config($1,$2,true)", [`sec01.${k}`, String(v)]);
  c.pid = (await c.q("select pg_backend_pid() p")).rows[0].p;
  return c;
}
async function waitLock(pid, timeoutMs = 4000) {
  const t0 = now();
  while (now() - t0 < timeoutMs) {
    const r = await pool.query("select wait_event_type, wait_event from pg_stat_activity where pid = $1", [pid]);
    if (r.rows[0]?.wait_event_type === "Lock") return r.rows[0].wait_event;
    await sleep(20);
  }
  return null;
}
function startSend(c, lease, text, requestId = uuidv7()) {
  const t0 = now();
  return { requestId, p: c.q(SEND, [lease.leaseId, lease.generation, requestId, text, 1, 0, 2])
    .then(async (x) => { await c.q("commit"); c.release(); return { r: x.rows[0].r, ms: now() - t0, err: null }; })
    .catch(async (e) => { await c.q("rollback").catch(() => {}); c.release(); return { r: null, ms: now() - t0, err: e.message }; }) };
}
const got = (s, requestId) => s.sub.messages.filter((m) => m.payload?.envelope?.requestId === requestId).length;
const commitTs = async (sql, params) => (await pool.query(sql, params)).rows[0]?.ts ?? null;

let moderator;
async function report(reporter, target) {
  return (await pool.query("insert into public.world_user_reports(reporter_id, target_id, category) values ($1,$2,'spam') returning id", [reporter.id, target.id])).rows[0].id;
}

await resetConfig();
[moderator] = await makeUsers(1, "mod");
await pool.query("insert into private.world_staff_assignments(user_id, role) values ($1, 'world_admin')", [moderator.id]);

// ---- B1/B2 · block (recipient blocks sender; sender blocks recipient), block commits during publish wait
for (const [id, title, blocker, blocked] of [
  ["B1", "수신자가 발신자 차단 — 발행 잠금 대기 중 차단 확정", "r1", "sender"],
  ["B2", "발신자가 수신자 차단 — 발행 잠금 대기 중 차단 확정", "sender", "r1"]]) {
  const r = await room(id);
  const who = { sender: r.sender, r1: r.subs[0].user };
  const cb = await tx(who[blocker]);
  await cb.q("select public.block_world_user($1)", [who[blocked].id]);
  const cs = await tx(r.sender);
  const s = startSend(cs, r.lease, `${id} 차단 경합`);
  const waited = await waitLock(cs.pid);
  await sleep(300);
  await cb.q("commit"); cb.release();
  const res = await s.p;
  await sleep(SETTLE);
  const g = r.subs.map((x) => got(x, s.requestId));
  const ok = !!waited && res.r?.ok === true && res.r.recipientCount === 1 && g[0] === 0 && g[1] === 1;
  rec.add({ id: `${id}a`, title, verdict: verdict(ok), level: "real PostgreSQL (2 backends) + real Realtime",
    observed: { publisherWaitEvent: waited, publish: { ok: res.r?.ok, recipientCount: res.r?.recipientCount, ms: Math.round(res.ms) }, receivedBlockedSide: g[0], receivedOther: g[1] },
    expected: "publisher waits on the shared pair lock, re-reads after the block commits, and does not publish to the blocked pair" });
  await rpc(who[blocker], "unblock_world_user", { p_target: who[blocked].id });
  // Reverse order: publisher holds locks; block must wait until the publish commits.
  const cs2 = await tx(r.sender, { pause_after_locks: 1.2 });
  const s2 = startSend(cs2, r.lease, `${id} 발행 선점`);
  await sleep(300);
  const cb2 = await tx(who[blocker]);
  const tb = now();
  const blockP = cb2.q("select public.block_world_user($1)", [who[blocked].id]).then(async () => { await cb2.q("commit"); cb2.release(); return now() - tb; });
  const blockWait = await waitLock(cb2.pid);
  const res2 = await s2.p; const blockMs = await blockP;
  await sleep(SETTLE);
  const pubTs = await commitTs("select pg_xact_commit_timestamp(xmin) ts from sec01_lab.approvals where request_id=$1", [s2.requestId]);
  const blkTs = await commitTs("select pg_xact_commit_timestamp(xmin) ts from public.world_user_blocks where blocker_id=$1 and blocked_id=$2", [who[blocker].id, who[blocked].id]);
  const ok2 = !!blockWait && res2.r?.ok && res2.r.recipientCount === 2 && pubTs < blkTs;
  rec.add({ id: `${id}b`, title: `${title.split(" —")[0]} — 발행이 잠금 선점 시 차단 대기`, verdict: verdict(ok2), level: "real PostgreSQL (2 backends) + real Realtime",
    observed: { blockWaitEvent: blockWait, blockWaitedMs: Math.round(blockMs), publishCommit: pubTs, blockCommit: blkTs, received: r.subs.map((x) => got(x, s2.requestId)) },
    expected: "existing block_world_user (exclusive pair lock) waits for the in-flight publish; publish commit precedes block commit" });
  await rpc(who[blocker], "unblock_world_user", { p_target: who[blocked].id });
  await unsubscribeAll(r.users);
}

// ---- B3 · operator sanction of the sender (existing RPC vs lab-locked wrapper)
{
  const r = await room("B3");
  // B3-existing: publish re-checks, then holds 1.5 s before commit; the EXISTING admin RPC commits meanwhile.
  const rid = await report(r.subs[0].user, r.sender);
  const cs = await tx(r.sender, { pause_before_commit: 1.5 });
  const s = startSend(cs, r.lease, "B3 기존 제재 RPC 경합");
  await sleep(400);
  const cm = await tx(moderator);
  const tm = now();
  await cm.q("select public.admin_review_world_user_report_v1($1,'interaction_restriction_24h')", [rid]);
  const sanctionWait = now() - tm;
  await cm.q("commit"); cm.release();
  const res = await s.p;
  await sleep(SETTLE);
  const pubTs = await commitTs("select pg_xact_commit_timestamp(xmin) ts from sec01_lab.approvals where request_id=$1", [s.requestId]);
  const sanTs = await commitTs("select pg_xact_commit_timestamp(xmin) ts from private.world_user_moderation_actions where report_id=$1 and action='interaction_restriction_24h'", [rid]);
  const deliveredAfterSanction = res.r?.ok && pubTs > sanTs;
  rec.add({ id: "B3-existing", title: "운영자 제재(기존 admin_review RPC) — 제재 확정 후 발행 커밋 여부", verdict: deliveredAfterSanction ? "FAIL" : "PASS",
    level: "real PostgreSQL (2 backends) + real Realtime",
    observed: { sanctionRpcWaitedMs: Math.round(sanctionWait), sanctionCommit: sanTs, publishCommit: pubTs, publishOk: res.r?.ok, received: r.subs.map((x) => got(x, s.requestId)) },
    note: "The existing moderation RPC locks only the report row, so it never waits for an in-flight publish: a message checked before the sanction commits AFTER the sanction is confirmed and is delivered.",
    expected: "no publication from the sanctioned sender commits after the sanction commit" });
  await pool.query("delete from private.world_user_moderation_actions where target_id=$1", [r.sender.id]);

  // B3-locked (sanction first): lab wrapper takes the authority lock; publish waits, re-checks, is denied.
  const rid2 = await report(r.subs[0].user, r.sender);
  const cm2 = await tx(moderator);
  await cm2.q("select public.sec01_lab_admin_review_locked($1,'interaction_restriction_24h')", [rid2]);
  const cs2 = await tx(r.sender);
  const s2 = startSend(cs2, r.lease, "B3 잠금 제재 선확정");
  const w2 = await waitLock(cs2.pid);
  await sleep(300);
  await cm2.q("commit"); cm2.release();
  const res2 = await s2.p;
  await pool.query("delete from private.world_user_moderation_actions where target_id=$1", [r.sender.id]);
  // B3-locked (publish first): sanction must wait for the publish to commit.
  const rid3 = await report(r.subs[0].user, r.sender);
  const cs3 = await tx(r.sender, { pause_before_commit: 1.2 });
  const s3 = startSend(cs3, r.lease, "B3 발행 선점");
  await sleep(300);
  const cm3 = await tx(moderator);
  const pm = cm3.q("select public.sec01_lab_admin_review_locked($1,'interaction_restriction_24h')", [rid3]).then(async () => { await cm3.q("commit"); cm3.release(); });
  const w3 = await waitLock(cm3.pid);
  const res3 = await s3.p; await pm;
  await sleep(SETTLE);
  const p3 = await commitTs("select pg_xact_commit_timestamp(xmin) ts from sec01_lab.approvals where request_id=$1", [s3.requestId]);
  const m3 = await commitTs("select pg_xact_commit_timestamp(xmin) ts from private.world_user_moderation_actions where report_id=$1 and action='interaction_restriction_24h'", [rid3]);
  const ok = !!w2 && res2.r?.reason === "denied" && r.subs.every((x) => got(x, s2.requestId) === 0) && !!w3 && res3.r?.ok && p3 < m3;
  rec.add({ id: "B3-locked", title: "운영자 제재 — 권한 잠금 공유 시(lab wrapper)", verdict: verdict(ok), level: "real PostgreSQL (2 backends) + real Realtime",
    observed: { sanctionFirst: { publisherWaitEvent: w2, publish: res2.r, received: r.subs.map((x) => got(x, s2.requestId)) }, publishFirst: { sanctionWaitEvent: w3, publishCommit: p3, sanctionCommit: m3 } },
    expected: "with a shared authority lock the two orders serialise: denied after a confirmed sanction, or published strictly before it" });
  await pool.query("delete from private.world_user_moderation_actions where target_id=$1", [r.sender.id]);

  // B3-recipient: a sanctioned recipient is excluded after the lock wait.
  const rid4 = await report(r.sender, r.subs[0].user);
  const cm4 = await tx(moderator);
  await cm4.q("select public.sec01_lab_admin_review_locked($1,'interaction_restriction_24h')", [rid4]);
  const cs4 = await tx(r.sender);
  const s4 = startSend(cs4, r.lease, "B3 수신자 제재");
  const w4 = await waitLock(cs4.pid);
  await cm4.q("commit"); cm4.release();
  const res4 = await s4.p;
  await sleep(SETTLE);
  rec.add({ id: "B3-recipient", title: "운영자 제재(수신자) — 잠금 대기 후 제외", verdict: verdict(!!w4 && res4.r?.recipientCount === 1 && got(r.subs[0], s4.requestId) === 0),
    level: "real PostgreSQL + real Realtime", observed: { publisherWaitEvent: w4, recipientCount: res4.r?.recipientCount, receivedSanctioned: got(r.subs[0], s4.requestId), receivedOther: got(r.subs[1], s4.requestId) },
    expected: "sanctioned recipient receives nothing" });
  await pool.query("delete from private.world_user_moderation_actions where target_id=$1", [r.subs[0].user.id]);

  // B4 · sanction lift: no RPC exists. Direct UPDATE (ops path) during a publish lock wait.
  const rid5 = await report(r.subs[0].user, r.sender);
  await rpc(moderator, "admin_review_world_user_report_v1", { p_report_id: rid5, p_action: "interaction_restriction_24h" });
  const denied = (await rpc(r.sender, "sec01_send_campus_chat", { p_lease: r.lease.leaseId, p_generation: r.lease.generation, p_request_id: uuidv7(), p_text: "B4 제재 중", p_x: 1, p_y: 0, p_z: 2 })).data;
  const cl = await pool.connect();
  await cl.query("begin");
  await cl.query("update private.world_user_moderation_actions set ends_at = greatest(starts_at + interval '1 microsecond', clock_timestamp()) where target_id=$1 and action='interaction_restriction_24h'", [r.sender.id]);
  const cs5 = await tx(r.sender);
  const s5 = startSend(cs5, r.lease, "B4 해제 경합");
  const w5 = await waitLock(cs5.pid, 1500);
  await sleep(300);
  await cl.query("commit"); cl.release();
  const res5 = await s5.p;
  rec.add({ id: "B4", title: "제재 해제 — 공유 잠금 계약 여부", verdict: "BLOCKED",
    level: "real PostgreSQL",
    observed: { whileRestricted: denied, liftPath: "no lift RPC exists in main/PR #353; lab used a direct UPDATE of ends_at", publisherWaitedOnLift: w5, publishAfterLift: res5.r },
    note: "No sanction-lift RPC exists, so no lock contract can be bound to it. The direct-UPDATE path does not share the authority lock (publisher did not wait); the consequence of this race is a false DENY only, never an unauthorised publish.",
    expected: "a lift RPC that takes the target authority lock exclusively" });
  await unsubscribeAll(r.users);
}

// ---- B5 · generation change of a recipient / the sender during the publish wait
{
  const r = await room("B5");
  const r1 = r.subs[0];
  const oldTopic = r1.lease.topic;
  // (a) recipient moves to another area while the publisher waits on its session row.
  const cmv = await tx(r1.user);
  const mv = (await cmv.q("select public.sec01_move_campus_chat($1,$2,$3) r", [r1.lease.leaseId, r1.lease.generation, area("B5X")])).rows[0].r;
  const cs = await tx(r.sender);
  const s = startSend(cs, r.lease, "B5 이동 경합");
  const w = await waitLock(cs.pid);
  await cmv.q("commit"); cmv.release();
  const res = await s.p;
  // (b) recipient re-joins the SAME area (new generation + new inbox) during the wait.
  const r2 = r.subs[1];
  const crj = await tx(r2.user);
  const rj = (await crj.q("select public.sec01_join_campus_chat($1,$2) r", [r.area, crypto.randomUUID()])).rows[0].r;
  const cs2 = await tx(r.sender);
  const s2 = startSend(cs2, r.lease, "B5 재입장 경합");
  const w2 = await waitLock(cs2.pid);
  await crj.q("commit"); crj.release();
  const res2 = await s2.p;
  // (c) the sender's own generation changes during its wait -> denied.
  const csm = await tx(r.sender);
  const smv = (await csm.q("select public.sec01_move_campus_chat($1,$2,$3) r", [r.lease.leaseId, r.lease.generation, r.area])).rows[0].r;
  const cs3 = await tx(r.sender);
  const s3 = startSend(cs3, r.lease, "B5 발신자 세대 변경");
  const w3 = await waitLock(cs3.pid);
  await csm.q("commit"); csm.release();
  const res3 = await s3.p;
  await sleep(SETTLE);
  const topicRows = async (topic, req) => (await pool.query("select count(*)::int n from realtime.messages where topic=$1 and payload->'envelope'->>'requestId'=$2", [topic, req])).rows[0].n;
  const obs = {
    a: { waitEvent: w, recipientCount: res.r?.recipientCount, rowsOldTopic: await topicRows(oldTopic, s.requestId), rowsNewTopic: await topicRows(mv.topic, s.requestId), receivedOldSubscription: got(r1, s.requestId) },
    b: { waitEvent: w2, recipientCount: res2.r?.recipientCount, rowsOldTopic: await topicRows(r2.lease.topic, s2.requestId), rowsNewTopic: await topicRows(rj.topic, s2.requestId), receivedOldSubscription: got(r2, s2.requestId) },
    c: { waitEvent: w3, publish: res3.r, senderNewGeneration: smv.generation }
  };
  const ok = w && obs.a.recipientCount === 1 && obs.a.rowsOldTopic === 0 && obs.a.rowsNewTopic === 0 && obs.a.receivedOldSubscription === 0
    && w2 && obs.b.rowsOldTopic === 0 && obs.b.rowsNewTopic === 1 && obs.b.receivedOldSubscription === 0
    && w3 && res3.r?.reason === "denied";
  rec.add({ id: "B5", title: "generation 변경 — 이전 토픽 신규 발행 금지", verdict: verdict(!!ok), level: "real PostgreSQL (2 backends) + real Realtime (old subscriptions kept open)",
    observed: obs, expected: "after a committed generation change nothing is written to, or delivered on, the previous topic; a stale sender generation is denied" });
  await unsubscribeAll(r.users);
}

// ---- B6 · lease expiry during the lock wait (clock_timestamp vs now() negative control)
for (const mode of ["clock", "txn"]) {
  const r = await room(`B6${mode === "clock" ? "C" : "T"}`);
  await setConfig({ recheck_clock: mode });
  // Recipient 1's lease expires 0.6 s from now; the publisher is held 1.2 s on the sender rate row.
  await pool.query("update sec01_lab.sessions set lease_expires_at = clock_timestamp() + interval '600 milliseconds' where id=$1", [r.subs[0].lease.leaseId]);
  await pool.query("insert into sec01_lab.rate(user_id) values ($1) on conflict do nothing", [r.sender.id]);
  const holder = await pool.connect();
  await holder.query("begin"); await holder.query("select 1 from sec01_lab.rate where user_id=$1 for update", [r.sender.id]);
  const cs = await tx(r.sender);
  const s = startSend(cs, r.lease, `B6 임대 만료 ${mode}`);
  const w = await waitLock(cs.pid);
  await sleep(1200);
  await holder.query("commit"); holder.release();
  const res = await s.p;
  await setConfig({ recheck_clock: "clock" });
  await sleep(SETTLE);
  const expiredGot = got(r.subs[0], s.requestId);
  const rows = (await pool.query("select count(*)::int n from sec01_lab.deliveries where request_id=$1 and recipient_session_id=$2", [s.requestId, r.subs[0].lease.leaseId])).rows[0].n;
  rec.add({ id: `B6-${mode}`, title: `lease 만료 — 잠금 대기 중 만료 (재검사 시각=${mode === "clock" ? "clock_timestamp()" : "now() 부정 대조군"})`,
    verdict: mode === "clock" ? verdict(!!w && rows === 0 && expiredGot === 0) : (rows > 0 ? "FAIL" : "PASS"),
    level: "real PostgreSQL + real Realtime",
    observed: { waitEvent: w, publish: { ok: res.r?.ok, recipientCount: res.r?.recipientCount }, deliveryRowsToExpiredLease: rows, receivedByExpiredSubscriber: expiredGot },
    note: mode === "txn" ? "Negative control: re-checking with transaction-start now() publishes to a lease that expired during the wait — proves the clock_timestamp() requirement." : undefined,
    expected: "no publication to a lease that expired before the post-wait re-check" });
  await unsubscribeAll(r.users);
}

// ---- B7 · session end (leave) during the wait; sender leave -> denied
{
  const r = await room("B7");
  const r1 = r.subs[0];
  const cl = await tx(r1.user);
  await cl.q("select public.sec01_leave_campus_chat($1)", [r1.lease.leaseId]);
  const cs = await tx(r.sender);
  const s = startSend(cs, r.lease, "B7 수신자 종료");
  const w = await waitLock(cs.pid);
  await cl.q("commit"); cl.release();
  const res = await s.p;
  const cl2 = await tx(r.sender);
  await cl2.q("select public.sec01_leave_campus_chat($1)", [r.lease.leaseId]);
  const cs2 = await tx(r.sender);
  const s2 = startSend(cs2, r.lease, "B7 발신자 종료");
  const w2 = await waitLock(cs2.pid);
  await cl2.q("commit"); cl2.release();
  const res2 = await s2.p;
  await sleep(SETTLE);
  const ok = w && res.r?.recipientCount === 1 && got(r1, s.requestId) === 0 && w2 && res2.r?.reason === "denied";
  rec.add({ id: "B7", title: "세션 종료 — 잠금 대기 중 종료 확정", verdict: verdict(!!ok), level: "real PostgreSQL + real Realtime",
    observed: { recipientLeave: { waitEvent: w, recipientCount: res.r?.recipientCount, receivedByEnded: got(r1, s.requestId) }, senderLeave: { waitEvent: w2, publish: res2.r } },
    expected: "ended recipient excluded; ended sender denied" });
  await unsubscribeAll(r.users);
}

// ---- B8 · randomized contention: deadlocks + commit-timestamp ordering invariant
{
  const users = await makeUsers(8, "b8");
  const a = area("B8");
  const leases = new Map();
  for (const u of users) leases.set(u.id, await joinCampus(u, a));
  await setConfig({ lease_ttl: "10 minutes" });
  for (const u of users) leases.set(u.id, await joinCampus(u, a));
  const errors = []; const counts = {};
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const ops = Array.from({ length: Number(process.env.B8_OPS ?? 2000) }, () => {
    const u = pick(users), v = pick(users.filter((x) => x !== u));
    return pick(["send", "send", "send", "send", "block", "unblock", "move", "renew", "sanction"]) + "|" + u.id + "|" + v.id;
  });
  const t0 = now();
  let reqs = 0;
  async function runOp(op) {
    const [kind, uid, vid] = op.split("|");
    const u = users.find((x) => x.id === uid), v = users.find((x) => x.id === vid);
    const c = await connectAs(u);
    try {
      await c.begin();
      const L = leases.get(uid);
      if (kind === "send") { reqs++; await c.q(SEND, [L.leaseId, L.generation, uuidv7(), `B8 ${reqs}`, 1, 0, 2]); }
      else if (kind === "block") await c.q("select public.block_world_user($1)", [vid]);
      else if (kind === "unblock") await c.q("select public.unblock_world_user($1)", [vid]);
      else if (kind === "move") { const x = (await c.q("select public.sec01_move_campus_chat($1,$2,$3) r", [L.leaseId, L.generation, a])).rows[0].r; if (x.allowed) c.after = () => leases.set(uid, { ...L, generation: x.generation, topic: x.topic }); }
      else if (kind === "renew") await c.q("select public.sec01_renew_campus_chat($1,$2)", [L.leaseId, L.generation]);
      else if (kind === "sanction") {
        await c.q("reset role");
        const rid = (await c.q("insert into public.world_user_reports(reporter_id, target_id, category) values ($1,$2,'spam') returning id", [uid, vid])).rows[0].id;
        await c.q("select pg_advisory_xact_lock(sec01_lab.authority_key($1))", [vid]);
        await c.q("insert into private.world_user_moderation_actions(report_id,target_id,action,starts_at,ends_at) values ($1,$2,'interaction_restriction_24h',clock_timestamp(),clock_timestamp()+interval '300 milliseconds')", [rid, vid]);
      }
      await c.q("commit"); c.after?.();
      counts[kind] = (counts[kind] ?? 0) + 1;
    } catch (e) { errors.push({ kind, code: e.code, message: e.message }); await c.q("rollback").catch(() => {}); }
    finally { c.release(); }
  }
  const lanes = 16; let idx = 0;
  await Promise.all(Array.from({ length: lanes }, async () => { while (idx < ops.length) await runOp(ops[idx++]); }));
  const elapsed = now() - t0;
  await setConfig({ lease_ttl: "30 seconds" });
  // Invariant 1: no delivery whose approval committed after a still-existing block (either direction) between the pair committed.
  const inv = (await pool.query(`
    select count(*)::int as violations from sec01_lab.deliveries d
    join sec01_lab.approvals a using (sender_id, request_id)
    join public.world_user_blocks b on (b.blocker_id=d.sender_id and b.blocked_id=d.recipient_user_id) or (b.blocker_id=d.recipient_user_id and b.blocked_id=d.sender_id)
    where a.area_id = $1 and pg_xact_commit_timestamp(b.xmin) < pg_xact_commit_timestamp(a.xmin)`, [a])).rows[0].violations;
  // Invariant 2: no approval from a sender whose restriction committed before the approval and was active at approval time.
  const inv2 = (await pool.query(`
    select count(*)::int as violations from sec01_lab.approvals a
    join private.world_user_moderation_actions m on m.target_id = a.sender_id and m.action='interaction_restriction_24h'
    where a.area_id = $1 and pg_xact_commit_timestamp(m.xmin) < pg_xact_commit_timestamp(a.xmin) and m.ends_at > a.approved_at and m.starts_at <= a.approved_at`, [a])).rows[0].violations;
  const deadlocks = errors.filter((e) => e.code === "40P01").length;
  // Domain refusals by the EXISTING block/unblock RPCs for a currently restricted caller are expected.
  const expectedErr = (e) => e.code === "42501" && /SOCIAL_RESTRICTED/.test(e.message);
  const unexpected = errors.filter((e) => !expectedErr(e));
  rec.add({ id: "B8", title: "교착상태·경쟁 조건(무작위 연산 · 16 동시 연결)", verdict: verdict(deadlocks === 0 && inv === 0 && inv2 === 0 && unexpected.length === 0),
    level: "real PostgreSQL (16 concurrent backends)",
    observed: { ops: ops.length, committed: counts, expectedDomainRefusals: errors.length - unexpected.length, unexpectedErrors: unexpected.slice(0, 10), deadlocks, elapsedMs: Math.round(elapsed), blockOrderViolations: inv, sanctionOrderViolations: inv2 },
    note: "Sanction in B8 uses the lab authority lock (contract candidate). Invariants use pg_xact_commit_timestamp (track_commit_timestamp=on in the isolated DB). Blocks removed by unblock are not visible to invariant 1.",
    expected: "zero deadlocks and zero ordering violations" });
  await unsubscribeAll(users);
}

// ---- B9 · static lock-contract audit of existing mutating RPCs
{
  const q = await pool.query(`select p.oid::regprocedure::text as fn,
      prosrc ~ 'world_lock_pair' as pair_lock, prosrc ~ 'authority' as authority_lock
    from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in
      ('block_world_user','unblock_world_user','admin_review_world_user_report_v1','review_world_user_report_ops_v1','report_world_user')`);
  const ban = await pool.query(`select count(*)::int n from pg_proc where prosrc ~* 'is_banned\\s*=\\s*true' and pronamespace in ('public'::regnamespace,'private'::regnamespace)`);
  const lift = await pool.query(`select count(*)::int n from pg_proc where pronamespace in ('public'::regnamespace,'private'::regnamespace) and prosrc ~* 'update\\s+private\\.world_user_moderation_actions'`);
  rec.add({ id: "B9", title: "기존 변경 RPC의 잠금 계약 정적 점검", verdict: "FAIL", level: "catalog inspection (real PostgreSQL)",
    observed: { rpcs: q.rows, banSetterFunctions: ban.rows[0].n, sanctionLiftFunctions: lift.rows[0].n },
    note: "block/unblock use world_lock_pair (compatible with the publisher's shared pair lock). Sanction RPCs lock only the report row; ban and sanction-lift have no RPC at all. Shared-lock contract is therefore NOT satisfied by existing moderation paths.",
    expected: "every authority mutation takes the same lock the publisher shares" });
}

await resetConfig();
rec.save();
await pool.end();
process.exit(0);
