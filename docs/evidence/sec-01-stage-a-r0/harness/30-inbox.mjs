// Experiment C · per-recipient private inbox security on real Supabase Realtime (v2.140.10).
// Every case records three separate layers:
//   serverPublished = realtime.messages rows written for that inbox (server decision)
//   delivered       = frames actually received over the attacker's/recipient's WebSocket
//   clientDisplay   = not applicable here (no campus client yet) unless stated
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  makeUsers, joinCampus, subscribe, sleep, pool, unsubscribeAll, connectAs, setConfig, resetConfig,
  recorder, verdict, uuidv7, rpc, sendArgs, admin, API_URL, ANON_KEY
} from "./lib.mjs";

const rec = recorder("C-inbox");
const area = (id) => `AREA_${id}_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
const SETTLE = 1500;
const rowsFor = async (topic, requestId) => (await pool.query(
  "select count(*)::int n from realtime.messages where topic=$1 and ($2::text is null or payload->'envelope'->>'requestId'=$2)", [topic, requestId ?? null])).rows[0].n;
const got = (sub, requestId) => sub.messages.filter((m) => !requestId || m.payload?.envelope?.requestId === requestId).length;

await resetConfig();
const [S, A, B] = await makeUsers(3, "c");
const AREA = area("C");
const lS = await joinCampus(S, AREA), lA = await joinCampus(A, AREA), lB = await joinCampus(B, AREA);

// C1 · authenticated recipient on its own inbox
const subA = await subscribe(A, lA.topic);
{
  const args = sendArgs(lS, { text: "C1 정상 수신" });
  const res = await rpc(S, "sec01_send_campus_chat", args);
  await sleep(SETTLE);
  rec.add({ id: "C1", title: "정상 인증 수신자 접근", verdict: verdict(subA.status === "SUBSCRIBED" && got(subA, args.p_request_id) === 1),
    level: "real Supabase Realtime", observed: { join: subA.status, serverPublished: await rowsFor(lA.topic, args.p_request_id), delivered: got(subA, args.p_request_id), rpcOk: res.data?.ok },
    expected: "joins and receives exactly one frame" });
}

// C2 · unauthorized user / anonymous client subscribing to A's topic (topic is known to the attacker)
const subB_onA = await subscribe(B, lA.topic, { timeoutMs: 6000, fresh: true });
const anon = createClient(API_URL, ANON_KEY, { auth: { persistSession: false } });
const anonUser = { client: anon };
const subAnon = await subscribe(anonUser, lA.topic, { timeoutMs: 6000 });
{
  const args = sendArgs(lS, { text: "C2 탈취 시도" });
  await rpc(S, "sec01_send_campus_chat", args);
  await sleep(SETTLE);
  const ok = subB_onA.status !== "SUBSCRIBED" && subAnon.status !== "SUBSCRIBED" && got(subB_onA, args.p_request_id) === 0 && got(subAnon, args.p_request_id) === 0;
  rec.add({ id: "C2", title: "비인가 사용자 토픽 구독", verdict: verdict(ok), level: "real Supabase Realtime",
    observed: { otherUser: { join: subB_onA.status, error: subB_onA.error, delivered: got(subB_onA, args.p_request_id) },
      anonymousKey: { join: subAnon.status, error: subAnon.error, delivered: got(subAnon, args.p_request_id) },
      serverPublishedToA: await rowsFor(lA.topic, args.p_request_id), deliveredToA: got(subA, args.p_request_id) },
    expected: "private join refused by RLS for any non-owner; zero frames" });
}

// C3 · public channel with the SAME topic name as A's private inbox
const subB_public = await subscribe(B, lA.topic, { isPrivate: false, timeoutMs: 6000, fresh: true });
{
  const args = sendArgs(lS, { text: "C3 동명 토픽" });
  await rpc(S, "sec01_send_campus_chat", args);
  await sleep(SETTLE);
  // Reverse direction: attacker broadcasts a forged envelope on the public twin; does A's private channel get it?
  const forgedReq = uuidv7();
  let forgedSend = null;
  if (subB_public.status === "SUBSCRIBED") {
    forgedSend = await subB_public.channel.send({ type: "broadcast", event: "campus_chat_v1",
      payload: { envelope: { v: 1, requestId: forgedReq, senderUserId: S.id, senderName: "lab위조", text: "C3 위조 메시지" }, recipientGeneration: lA.generation } });
  }
  // Also via the HTTP broadcast endpoint (no WebSocket), public and private flags.
  const httpPublic = await fetch(`${API_URL}/realtime/v1/api/broadcast`, { method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${B.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: lA.topic, event: "campus_chat_v1", private: false, payload: { envelope: { requestId: forgedReq + "-http" } } }] }) }).then((r) => r.status).catch((e) => String(e));
  const httpPrivate = await fetch(`${API_URL}/realtime/v1/api/broadcast`, { method: "POST",
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${B.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messages: [{ topic: lA.topic, event: "campus_chat_v1", private: true, payload: { envelope: { requestId: forgedReq + "-httpp" } } }] }) }).then((r) => r.status).catch((e) => String(e));
  await sleep(SETTLE);
  const aGotForged = subA.messages.filter((m) => String(m.payload?.envelope?.requestId ?? "").startsWith(forgedReq)).length;
  const ok = got(subB_public, args.p_request_id) === 0 && aGotForged === 0;
  rec.add({ id: "C3", title: "공개·private 동명 토픽 발행", verdict: verdict(ok), level: "real Supabase Realtime",
    observed: { attackerPublicJoin: subB_public.status, attackerReceivedServerMessage: got(subB_public, args.p_request_id),
      attackerForgedWsSend: forgedSend, httpBroadcastPublicStatus: httpPublic, httpBroadcastPrivateStatus: httpPrivate,
      victimPrivateReceivedForged: aGotForged, forgedRowsInRealtimeMessages: await rowsFor(lA.topic, forgedReq) },
    expected: "private DB broadcast never reaches the public twin; public-twin broadcasts never reach the private inbox" });
}

// C4 · provider called directly by a client
{
  const viaRest = await B.client.schema("realtime").rpc("send", { payload: { x: 1 }, event: "campus_chat_v1", topic: lA.topic, private: true });
  const c = await connectAs(B);
  const notices = []; c.c.on("notice", (n) => notices.push(n.message));
  await c.begin();
  const before = await rowsFor(lA.topic);
  let sqlSend = null, sqlInsert = null;
  try { await c.q("select realtime.send('{\"envelope\":{\"text\":\"C4 위조\"}}'::jsonb,'campus_chat_v1',$1,true)", [lA.topic]); sqlSend = "returned"; } catch (e) { sqlSend = e.message; }
  await c.q("savepoint s1");
  try { await c.q("insert into realtime.messages(topic, extension, payload, event, private) values ($1,'broadcast','{\"envelope\":{}}','campus_chat_v1',true)", [lA.topic]); sqlInsert = "inserted"; }
  catch (e) { sqlInsert = e.message; await c.q("rollback to savepoint s1"); }
  await c.q("commit"); c.release();
  const after = await rowsFor(lA.topic);
  // Attacker's OWN inbox: can a recipient inject frames into its own private channel (self-spoof)?
  // ack:true -> Realtime answers the client broadcast after its INSERT-policy check; self:true -> echo if relayed.
  const subBown = await subscribe(B, lB.topic, { fresh: true, broadcast: { ack: true, self: true } });
  const subBown2 = await subscribe(B, lB.topic, { fresh: true });
  const selfSend = subBown.status === "SUBSCRIBED" ? await subBown.channel.send({ type: "broadcast", event: "campus_chat_v1", payload: { envelope: { requestId: "self-forged" } } }) : null;
  await sleep(SETTLE);
  const selfEcho = subBown.messages.filter((m) => m.payload?.envelope?.requestId === "self-forged").length
    + subBown2.messages.filter((m) => m.payload?.envelope?.requestId === "self-forged").length;
  const ok = !!viaRest.error && sqlSend === "returned" && after === before && sqlInsert !== "inserted" && selfEcho === 0;
  rec.add({ id: "C4", title: "Provider 함수 직접 호출", verdict: verdict(ok), level: "real PostgREST + PostgreSQL + Realtime",
    observed: { postgrestRealtimeSchema: viaRest.error?.message ?? "allowed", sqlRealtimeSend: sqlSend, sqlWarnings: notices, rowsDelta: after - before,
      sqlDirectInsert: sqlInsert, ownInboxJoin: subBown.status, ownInboxWsSendAck: selfSend, ownInboxEchoOnTwoSockets: selfEcho },
    note: "realtime.send returns normally (warning only) for a forged topic — success-looking provider calls are checked by actual row count.",
    expected: "no client path writes a frame into any campus inbox" });
  await unsubscribeAll([B]);
}

// C5 · reuse of another recipient's capability (topic, lease id, generation)
{
  const renew = await rpc(B, "sec01_renew_campus_chat", { p_lease: lA.leaseId, p_generation: lA.generation });
  const send = await rpc(B, "sec01_send_campus_chat", sendArgs(lA, { text: "C5 남의 임대" }));
  const leave = await rpc(B, "sec01_leave_campus_chat", { p_lease: lA.leaseId });
  const move = await rpc(B, "sec01_move_campus_chat", { p_lease: lA.leaseId, p_generation: lA.generation, p_area: area("C5") });
  const sub = await subscribe(B, lA.topic, { timeoutMs: 6000, fresh: true });
  const aStill = (await pool.query("select ended_at is null and generation=$2 as ok from sec01_lab.sessions where id=$1", [lA.leaseId, lA.generation])).rows[0].ok;
  const ok = renew.data?.allowed === false && send.data?.reason === "denied" && leave.data === false && move.data?.allowed === false && sub.status !== "SUBSCRIBED" && aStill;
  rec.add({ id: "C5", title: "다른 수신자의 capability 재사용", verdict: verdict(ok), level: "real PostgREST + Realtime",
    observed: { renew: renew.data, send: send.data, leave: leave.data, move: move.data, subscribe: sub.status, victimLeaseUntouched: aStill },
    expected: "all denied; victim lease unchanged" });
  await unsubscribeAll([B]);
}

// C6 · re-subscribing a previous-generation topic
{
  const oldTopic = lA.topic;
  const mv = await rpc(A, "sec01_move_campus_chat", { p_lease: lA.leaseId, p_generation: lA.generation, p_area: AREA });
  const reSub = await subscribe(A, oldTopic, { timeoutMs: 6000, fresh: true });
  const newSub = await subscribe(A, mv.data.topic, { fresh: true });
  const args = sendArgs(lS, { text: "C6 세대 변경 후" });
  await rpc(S, "sec01_send_campus_chat", args);
  await sleep(SETTLE);
  const ok = reSub.status !== "SUBSCRIBED" && newSub.status === "SUBSCRIBED" && got(newSub, args.p_request_id) === 1
    && got(subA, args.p_request_id) === 0 && (await rowsFor(oldTopic, args.p_request_id)) === 0;
  rec.add({ id: "C6", title: "이전 generation 토픽 재구독", verdict: verdict(ok), level: "real Supabase Realtime",
    observed: { move: mv.data ?? mv.error, oldTopicResubscribe: reSub.status, oldTopicError: reSub.error, newTopicError: newSub.error, stillOpenOldSubscriptionDelivered: got(subA, args.p_request_id),
      serverPublishedOldTopic: await rowsFor(oldTopic, args.p_request_id), newTopic: { join: newSub.status, delivered: got(newSub, args.p_request_id) } },
    note: "The pre-rotation subscription stays SUBSCRIBED (Realtime does not re-authorise a joined channel); safety comes from the server never writing to the old topic.",
    expected: "old topic join refused; new topic receives; nothing written to old topic" });
  lA.generation = mv.data.generation; lA.topic = mv.data.topic; lA.sub = newSub;
}

// C7 · late lease-renew response / renew racing a rotation
{
  const g = lA.generation;
  const c1 = await connectAs(A); await c1.begin();
  const mv = (await c1.q("select public.sec01_move_campus_chat($1,$2,$3) r", [lA.leaseId, g, AREA])).rows[0].r;
  const c2 = await connectAs(A); await c2.begin();
  const renewP = c2.q("select public.sec01_renew_campus_chat($1,$2) r", [lA.leaseId, g]).then((x) => x.rows[0].r);
  await sleep(300);
  await c1.q("commit"); c1.release();
  const renew = await renewP; await c2.q("commit"); c2.release();
  const stale = await rpc(A, "sec01_renew_campus_chat", { p_lease: lA.leaseId, p_generation: g });
  // Expired lease cannot be resurrected by a late renew.
  await pool.query("update sec01_lab.sessions set lease_expires_at = clock_timestamp() - interval '1 second' where id=$1", [lA.leaseId]);
  const resurrect = await rpc(A, "sec01_renew_campus_chat", { p_lease: lA.leaseId, p_generation: mv.generation });
  const ok = renew.allowed === false && stale.data?.allowed === false && resurrect.data?.allowed === false;
  rec.add({ id: "C7", title: "늦은 lease 갱신 응답", verdict: verdict(ok), level: "real PostgreSQL (2 backends) + PostgREST",
    observed: { renewWaitingOnRotation: renew, lateRenewOldGeneration: stale.data ?? stale.error, renewAfterExpiry: resurrect.data ?? resurrect.error },
    note: "Client-side handling of a late successful renew (compare generation before applying) is a client contract; no campus client exists yet -> NOT MEASURED at the client layer.",
    expected: "server denies renew for a rotated generation and for an expired lease" });
  const re = await joinCampus(A, AREA); Object.assign(lA, re);
}

// C8 · logout never reaches the server (client stops renewing; socket/token survive)
{
  await setConfig({ lease_ttl: "6 seconds" });
  const [X, W] = await makeUsers(2, "c8");
  const lX = await joinCampus(X, AREA);
  const subX = await subscribe(X, lX.topic);
  const lS2 = await joinCampus(W, AREA);
  const tLogout = Date.now();
  const timeline = [];
  for (let i = 0; i < 8; i++) {
    const args = sendArgs(lS2, { text: `C8 ${i}` });
    const r = await rpc(W, "sec01_send_campus_chat", args);
    timeline.push({ tMs: Date.now() - tLogout, requestId: args.p_request_id, published: (await rowsFor(lX.topic, args.p_request_id)) > 0, rpc: r.data?.reason ?? (r.data?.ok ? "ok" : "?") });
    await sleep(1800); // 1.8 s spacing never trips the 3-per-5 s rate limit
    await rpc(W, "sec01_renew_campus_chat", { p_lease: lS2.leaseId, p_generation: lS2.generation });
  }
  await sleep(SETTLE);
  for (const t of timeline) t.delivered = got(subX, t.requestId) > 0;
  const lastDelivered = Math.max(-1, ...timeline.filter((t) => t.delivered).map((t) => t.tMs));
  const firstRefused = timeline.find((t) => !t.published)?.tMs ?? null;
  // Variant: logout DOES reach GoTrue (all sessions revoked) but the leave RPC never arrives.
  const [Y] = await makeUsers(1, "c8b");
  await setConfig({ lease_ttl: "30 seconds" });
  const lY = await joinCampus(Y, AREA);
  const subY = await subscribe(Y, lY.topic);
  const lS3 = await joinCampus(W, AREA);
  const so = await admin.auth.admin.signOut(Y.token, "global");
  await sleep(500);
  const argsY = sendArgs(lS3, { text: "C8b 로그아웃 후" });
  await rpc(W, "sec01_send_campus_chat", argsY);
  await sleep(SETTLE);
  await setConfig({ lease_ttl: "30 seconds" });
  rec.add({ id: "C8", title: "로그아웃 요청이 서버에 도착하지 않은 경우", verdict: lastDelivered <= 6000 + 1000 && firstRefused !== null ? "PASS" : "FAIL",
    level: "real PostgREST + Realtime (TTL 6 s lab setting)",
    observed: { ttlMs: 6000, timeline, lastDeliveredAfterLogoutMs: lastDelivered, firstServerRefusalMs: firstRefused,
      logoutReachedAuthButNotLeave: { gotrueSignOutError: so.error?.message ?? null, channelStillReceived: got(subY, argsY.p_request_id), serverPublished: await rowsFor(lY.topic, argsY.p_request_id) } },
    note: "Residual exposure is bounded by the lease TTL, not by logout. A GoTrue sign-out does not close an already-joined Realtime channel (the JWT stays valid until exp); the app MUST call leave on logout and the lease TTL bounds the failure case.",
    expected: "deliveries stop no later than lease expiry (+ one send interval)" });
  await unsubscribeAll([X, Y, W]);
}

// C9 · sanction while the recipient's Realtime channel stays connected
{
  const [Z] = await makeUsers(1, "c9");
  const lZ = await joinCampus(Z, AREA);
  const subZ = await subscribe(Z, lZ.topic);
  const lS4 = await joinCampus(S, AREA);
  const pre = sendArgs(lS4, { text: "C9 제재 전" });
  await rpc(S, "sec01_send_campus_chat", pre);
  await pool.query("insert into private.world_user_moderation_actions(target_id, action, starts_at, ends_at) values ($1,'interaction_restriction_24h', clock_timestamp(), clock_timestamp() + interval '1 hour')", [Z.id]);
  await sleep(200);
  const post = sendArgs(lS4, { p_request_id: undefined, text: "C9 제재 후" });
  const r = await rpc(S, "sec01_send_campus_chat", post);
  // Control: a publisher WITHOUT the per-recipient re-check (row written straight to Z's topic).
  const ctlId = crypto.randomUUID();
  await pool.query("insert into realtime.messages(id, topic, extension, payload, event, private) values ($1,$2,'broadcast',$3,'campus_chat_v1',true)",
    [ctlId, lZ.topic, JSON.stringify({ envelope: { requestId: "c9-control" } })]);
  await sleep(SETTLE);
  const resub = await subscribe(Z, lZ.topic, { timeoutMs: 6000, fresh: true });
  await pool.query("delete from private.world_user_moderation_actions where target_id=$1", [Z.id]);
  const ok = got(subZ, pre.p_request_id) === 1 && (await rowsFor(lZ.topic, post.p_request_id)) === 0 && got(subZ, post.p_request_id) === 0;
  rec.add({ id: "C9", title: "Realtime 연결 상태에서 제재 발생", verdict: verdict(ok), level: "real Supabase Realtime",
    observed: { beforeSanction: { delivered: got(subZ, pre.p_request_id) }, afterSanction: { rpc: r.data?.ok, recipientCount: r.data?.recipientCount, serverPublished: await rowsFor(lZ.topic, post.p_request_id), delivered: got(subZ, post.p_request_id) },
      channelStillJoined: subZ.channel.state, controlUnfilteredPublisherDelivered: subZ.messages.filter((m) => m.payload?.envelope?.requestId === "c9-control").length,
      rejoinWhileSanctioned: resub.status },
    note: "The control row shows Realtime keeps delivering to an already-joined channel after the sanction: the server-side refusal to publish is the ONLY delivery boundary.",
    expected: "server refuses to publish to the sanctioned recipient; nothing delivered; re-join refused" });
  await unsubscribeAll([Z]);
}

// C10 · capability leakage in RPC responses
{
  const recips = (await pool.query("select id::text, inbox_id::text, user_id::text from sec01_lab.sessions where area_id=$1 and user_id<>$2", [AREA, S.id])).rows;
  const lS5 = await joinCampus(S, AREA);
  const args = sendArgs(lS5, { text: "C10 누출 점검" });
  const r = await rpc(S, "sec01_send_campus_chat", args);
  const replay = await rpc(S, "sec01_send_campus_chat", args);
  const receipt = await rpc(S, "sec01_get_campus_chat_receipt", { p_request_id: args.p_request_id });
  const blobs = JSON.stringify([r.data, replay.data, receipt.data]);
  const leaks = recips.flatMap((x) => [x.id, x.inbox_id].filter((v) => blobs.includes(v)));
  const keys = [...new Set([...blobs.matchAll(/"([A-Za-z]+)":/g)].map((m) => m[1]))].sort();
  rec.add({ id: "C10", title: "RPC 승인 응답의 capability 정보 누출 여부", verdict: verdict(leaks.length === 0 && !/topic|inbox/i.test(keys.join(","))),
    level: "real PostgREST", observed: { recipientsChecked: recips.length, leakedValues: leaks.length, responseKeys: keys },
    note: "senderClientSessionId (the sender's own declared presence id) is present by design for Stage B avatar binding; it is not a recipient capability.",
    expected: "no recipient lease id, inbox id or topic in any sender-facing response" });
}

await unsubscribeAll([S, A, B]);
await resetConfig();
rec.save();
await pool.end();
process.exit(0);
