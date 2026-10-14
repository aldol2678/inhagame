// PR #353 reuse probe: run the UNMODIFIED PR #353 send_world_room_chat_v1 (club room path) on the
// isolated stack and inject the same provider fault as A3 (today's realtime.messages partition
// detached). Also observes whether its send path shares the block RPC's pair lock.
// Feature flags are opened only inside this disposable DB and restored to CLOSED afterwards.
import crypto from "node:crypto";
import { makeUsers, pool, superPool, connectAs, recorder, sleep, now } from "./lib.mjs";

const rec = recorder("PR353-probe");
const ROOM = "ROOM_CLUBHOUSE_01";
const [u1, u2, u3] = await makeUsers(3, "p353");

async function asUser(user, sql, params = []) {
  const c = await connectAs(user);
  try { await c.begin(); const r = await c.q(sql, params); await c.q("commit"); return r.rows[0]?.r; }
  catch (e) { await c.q("rollback").catch(() => {}); throw e; } finally { c.release(); }
}

await pool.query(`delete from private.world_club_room_sessions; delete from private.world_room_chat_sessions;
  select private.world_room_cleanup_v1(); update private.world_club_rooms set enabled = true;
  update private.world_room_chat_config set enabled = true where singleton;`);
const out = {};
try {
  out.publisherSafe = (await pool.query("select private.world_room_publisher_safe_v1() s, private.world_room_cleanup_healthy_v1() h")).rows[0];
  const leases = [];
  for (const u of [u1, u2, u3]) {
    const sid = crypto.randomUUID();
    const adm = await asUser(u, "select public.join_world_club_room_v1($1,$2) r", [ROOM, sid]);
    const chat = await asUser(u, "select public.join_world_room_chat_v1('club',$1,$2,$3) r", [ROOM, sid, adm.admissionId]);
    leases.push({ u, adm: adm.allowed, chat });
  }
  out.joins = leases.map((l) => ({ admission: l.adm, chat: l.chat?.allowed, reason: l.chat?.reason }));
  const lease1 = leases[0].chat.leaseId;

  // Baseline delivery count.
  const countRoom = async () => (await pool.query("select count(*)::int n from realtime.messages where topic like 'world:room-chat:%'")).rows[0].n;
  const b0 = await countRoom();
  const okRes = await asUser(u1, "select public.send_world_room_chat_v1($1,$2) r", [lease1, "PR353 정상"]);
  const b1 = await countRoom();
  out.normal = { rpc: okRes?.ok, realtimeRowsAdded: b1 - b0 };

  // Fault: detach today's partition, send, reattach.
  const part = (await pool.query(`select c.oid::regclass::text as name, pg_get_expr(c.relpartbound, c.oid) as bound
      from pg_inherits i join pg_class c on c.oid=i.inhrelid where i.inhparent='realtime.messages'::regclass`)).rows
    .find((p) => { const m = p.bound.match(/FROM \('([^']+)'\) TO \('([^']+)'\)/); const t = new Date().toISOString().replace("T", " ").slice(0, 19); return m && m[1] <= t && t < m[2]; });
  await sleep(5200); // PR #353 rate limit window (3 / 5 s)
  await superPool.query(`alter table realtime.messages detach partition ${part.name}`);
  let faultRes;
  try { faultRes = await asUser(u1, "select public.send_world_room_chat_v1($1,$2) r", [lease1, "PR353 장애 주입"]); }
  finally { await superPool.query(`alter table realtime.messages attach partition ${part.name} ${part.bound}`); }
  const b2 = await countRoom();
  out.fault = { rpcOk: faultRes?.ok, messageIdReturned: faultRes?.message?.id ?? null, realtimeRowsAdded: b2 - b1 };
  rec.add({ id: "PR353-A3", title: "PR #353 send_world_room_chat_v1 — provider 경고성 실패 시 성공 응답", verdict: faultRes?.ok === true && b2 - b1 === 0 ? "FAIL" : "PASS",
    level: "real PostgreSQL 17 (PR #353 SQL unmodified; fault injected in isolated DB)", observed: out,
    expected: "send must not report ok:true when zero recipient rows were written" });

  // Block race: u1 sends while u2's block of u1 commits during the sender's lock wait window.
  // PR #353 send takes the club-room row lock and the sender's session row; block takes only the pair advisory lock.
  await sleep(5200);
  const cBlock = await connectAs(u2);
  await cBlock.begin();
  const tb0 = now();
  await cBlock.q("select public.block_world_user($1)", [u1.id]);
  // Hold the block transaction open: does send wait for it (shared lock contract) or proceed?
  const cSend = await connectAs(u1);
  await cSend.begin();
  const sendP = cSend.q("select public.send_world_room_chat_v1($1,$2) r", [lease1, "PR353 차단 경합"]).then((r) => ({ r: r.rows[0].r, at: now() - tb0 }));
  const raced = await Promise.race([sendP, sleep(1500).then(() => null)]);
  await cBlock.q("commit"); cBlock.release();
  const sendDone = raced ?? await sendP;
  await cSend.q("commit"); cSend.release();
  const deliveredToBlocker = (await pool.query(`select count(*)::int n from realtime.messages
      where topic = $1 and payload->>'text' = 'PR353 차단 경합'`, ["world:room-chat:" + leases[1].chat.leaseId])).rows[0].n;
  rec.add({ id: "PR353-B-block", title: "PR #353 send — 차단 RPC와 공유 잠금 사용 여부", verdict: raced ? "FAIL" : "PASS",
    level: "real PostgreSQL 17, two backends",
    observed: { sendCompletedWhileBlockUncommitted: !!raced, sendFinishedMs: Math.round(sendDone.at), sendOk: sendDone.r?.ok, rowsToBlockerInbox: deliveredToBlocker },
    note: "send finishing while block_world_user is still uncommitted means no shared lock; the block commits AFTER a publish that read pre-block state.",
    expected: "send waits for the in-flight block (shared pair lock) and then excludes the blocker" });
} finally {
  await pool.query(`update private.world_room_chat_config set enabled = false where singleton; update private.world_club_rooms set enabled = false;
    delete from private.world_club_room_sessions; delete from private.world_room_chat_sessions;`);
}
rec.save();
await pool.end(); await superPool.end();
process.exit(0);
