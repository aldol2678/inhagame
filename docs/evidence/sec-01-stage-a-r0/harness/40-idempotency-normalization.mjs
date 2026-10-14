// Experiment D · requestId/envelope idempotency windows + JS vs PostgreSQL normalization vectors.
// JS side imports the REAL client code (apps/world/src/network/protocol.js) at main 0dcae7b.
import crypto from "node:crypto";
import { normalizeChatText, encodeAction, ActionType, validateAction } from "../../../../apps/world/src/network/protocol.js";
import {
  makeUsers, joinCampus, sleep, pool, rpc, sendArgs, setConfig, resetConfig, recorder, verdict, uuidv7, countRows,
  subscribe, unsubscribeAll
} from "./lib.mjs";

const rec = recorder("D-idempotency-normalization");
const area = (id) => `AREA_${id}_${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
await resetConfig();

// ---------------------------------------------------------------- D1 · requestId contract
{
  const [u] = await makeUsers(1, "d1");
  const l = await joinCampus(u, area("D1"));
  const v4 = await rpc(u, "sec01_send_campus_chat", { ...sendArgs(l), p_request_id: crypto.randomUUID() });
  const old = await rpc(u, "sec01_send_campus_chat", sendArgs(l, { requestId: uuidv7(Date.now() - 11 * 60_000) }));
  const fut = await rpc(u, "sec01_send_campus_chat", sendArgs(l, { requestId: uuidv7(Date.now() + 5 * 60_000) }));
  const fresh = await rpc(u, "sec01_send_campus_chat", sendArgs(l, { requestId: uuidv7(Date.now() - 9 * 60_000) }));
  // Client side: current campus ChatComposer has no requestId at all.
  const src = await import("node:fs").then((fs) => fs.readFileSync(new URL("../../../../apps/world/src/online/local-chat.js", import.meta.url), "utf8"));
  rec.add({ id: "D1-server", title: "requestId 형식·최초 도착 시각 검증(UUIDv7 내장 시각)", verdict: verdict(v4.data?.reason === "request_id_invalid" && old.data?.reason === "request_expired" && fut.data?.reason === "request_expired" && fresh.data?.ok === true),
    level: "real PostgREST + PostgreSQL", observed: { uuidV4: v4.data, v7_11minOld: old.data, v7_5minFuture: fut.data, v7_9minOld: { ok: fresh.data?.ok } },
    note: "Server can bound first arrival only because UUIDv7 embeds the submit time; with UUIDv4 a delayed first attempt cannot be aged. This is a proposed contract clarification (v0.4 text unavailable).",
    expected: "v4 rejected; v7 older than 10 min or >30 s in the future rejected; inside the window accepted" });
  rec.add({ id: "D1-client", title: "requestId는 사용자가 전송을 제출할 때 생성(클라이언트)", verdict: "NOT MEASURED",
    level: "static inspection", observed: { localChatHasRequestId: /requestId/.test(src) },
    note: "No campus client implementation of requestId exists at main 0dcae7b (ChatComposer.submit sends over Realtime broadcast directly). Must be implemented and tested in Stage B." ,
    expected: "one UUIDv7 per user submit, reused verbatim on every retry of that submit" });
}

// ---------------------------------------------------------------- D2/D4 · replay identity across session/generation/area changes
{
  const [s, r1, r2] = await makeUsers(3, "d2");
  const A1 = area("D2A"), A2 = area("D2B");
  const ls = await joinCampus(s, A1);
  const l1 = await joinCampus(r1, A1); const sub1 = await subscribe(r1, l1.topic);
  const l2 = await joinCampus(r2, A2); const sub2 = await subscribe(r2, l2.topic);
  const args = sendArgs(ls, { text: "D2 원본" });
  const first = await rpc(s, "sec01_send_campus_chat", args);
  const base = await countRows(args.p_request_id);
  const mv = await rpc(s, "sec01_move_campus_chat", { p_lease: ls.leaseId, p_generation: ls.generation, p_area: A2 });
  const afterMove = await rpc(s, "sec01_send_campus_chat", { ...args, p_lease: mv.data.leaseId, p_generation: mv.data.generation });
  await rpc(s, "sec01_leave_campus_chat", { p_lease: ls.leaseId });
  const rj = await joinCampus(s, A2);
  const afterRejoin = await rpc(s, "sec01_send_campus_chat", { ...args, p_lease: rj.leaseId, p_generation: rj.generation });
  const lookup = await rpc(s, "sec01_get_campus_chat_receipt", { p_request_id: args.p_request_id });
  await sleep(1500);
  const after = await countRows(args.p_request_id);
  const same = [afterMove, afterRejoin].every((x) => JSON.stringify(x.data?.envelope) === JSON.stringify(first.data.envelope)) && JSON.stringify(lookup.data?.envelope) === JSON.stringify(first.data.envelope);
  const newAreaGot = sub2.messages.filter((m) => m.payload?.envelope?.requestId === args.p_request_id).length;
  rec.add({ id: "D2-D4", title: "최초 승인·재조회 동일 Envelope / 세션·generation·구역 변경 후 재조회", verdict: verdict(same && JSON.stringify(base) === JSON.stringify(after) && newAreaGot === 0 && afterMove.data?.replayed && afterRejoin.data?.replayed),
    level: "real PostgREST + PostgreSQL + Realtime",
    observed: { originalArea: first.data.envelope.areaId, originalGeneration: first.data.envelope.generation, afterMoveReplayed: afterMove.data?.replayed, afterRejoinReplayed: afterRejoin.data?.replayed,
      replayedEnvelopeArea: afterRejoin.data?.envelope?.areaId, envelopesIdentical: same, rowsBefore: base, rowsAfter: after, deliveredToNewAreaRecipient: newAreaGot,
      deliveredToOriginalRecipient: sub1.messages.filter((m) => m.payload?.envelope?.requestId === args.p_request_id).length },
    expected: "byte-identical original envelope (original area/generation); no new rows; nothing published into the new area" });
  await unsubscribeAll([s, r1, r2]);
}

// ---------------------------------------------------------------- D5/D6 · retry and lookup windows (scaled: 2 s / 4 s)
{
  await setConfig({ retry_window: "2 seconds", lookup_window: "4 seconds" });
  const [u] = await makeUsers(1, "d5");
  const l = await joinCampus(u, area("D5"));
  const args = sendArgs(l, { text: "D5 기간" });
  const t0 = Date.now();
  const first = await rpc(u, "sec01_send_campus_chat", args);
  const at = async (ms, fn) => { await sleep(Math.max(0, t0 + ms - Date.now())); return { tMs: Date.now() - t0, ...(await fn()) }; };
  const r1 = await at(1000, async () => ({ retry: (await rpc(u, "sec01_send_campus_chat", args)).data }));
  const r2 = await at(2600, async () => ({ retry: (await rpc(u, "sec01_send_campus_chat", args)).data }));
  const r3 = await at(3000, async () => ({ lookup: (await rpc(u, "sec01_get_campus_chat_receipt", { p_request_id: args.p_request_id })).data }));
  const r4 = await at(4600, async () => ({ lookup: (await rpc(u, "sec01_get_campus_chat_receipt", { p_request_id: args.p_request_id })).data }));
  await pool.query("select sec01_lab.cleanup()");
  const r5 = { afterCleanup: await countRows(args.p_request_id) };
  // Scaled-down windows above; the production-default arithmetic is verified on the stored config.
  await resetConfig();
  const cfg = (await pool.query("select retry_window::text, lookup_window::text from sec01_lab.config")).rows[0];
  const ok = first.data?.ok && r1.retry?.replayed && r2.retry?.reason === "retry_expired" && r3.lookup?.ok && r4.lookup?.reason === "lookup_expired" && r5.afterCleanup.approvals === 0;
  rec.add({ id: "D5-D6", title: "10분 재시도 제한 · 승인 후 30분 조회 제한 · 기간 초과 거부", verdict: verdict(!!ok),
    level: "real PostgREST + PostgreSQL (windows scaled to 2 s / 4 s; defaults restored to " + `${cfg.retry_window} / ${cfg.lookup_window})`,
    observed: { timeline: [r1, r2, r3, r4], cleanup: r5 },
    note: "Retry after the retry window returns retry_expired WITHOUT re-publishing; the envelope remains readable by lookup until the lookup window. Wall-clock 10/30 min windows were not waited out (scaled).",
    expected: "replay ≤ retry window; retry_expired after; lookup ok ≤ lookup window; lookup_expired after; cleanup removes the approval" });
}

// ---------------------------------------------------------------- D7 · Unicode common vectors (JS client vs PostgreSQL server)
const cp = (s) => [...s].map((c) => "U+" + c.codePointAt(0).toString(16).toUpperCase().padStart(4, "0")).join(" ");
const vectors = [
  ["hangul-precomposed", "안녕하세요"],
  ["hangul-conjoining-jamo(NFD)", "각한"],
  ["hangul-compat-jamo", "ㄱㅏㅎ"],
  ["hangul-mixed-nfd-nfc", "한가글"],
  ["latin-case", "Hello WORLD"],
  ["latin-sharp-s", "STRASSE Straße"],
  ["turkish-dotted-I", "İSTANBUL"],
  ["turkish-dotless-i", "ıIiİ"],
  ["greek-final-sigma", "ΟΔΟΣ ΣΟΦΟΣ"],
  ["combining-acute(NFD)", "e\u0301 A\u030A"],
  ["combining-stack", "a\u0301\u0323"],
  ["emoji-zwj-family", "👨\u200D👩\u200D👧\u200D👦"],
  ["emoji-flag-zwj", "🏳️\u200D🌈"],
  ["emoji-skin-keycap", "👍🏽 1️⃣"],
  ["control-bell", "a\u0007b"],
  ["control-c1-nel", "a\u0085b"],
  ["zwsp-bom-wj", "a\u200Bb\uFEFFc\u2060d"],
  ["bidi-override", "a\u202Eb\u2066c\u2069"],
  ["whitespace-mixed", "  a \t\n\r b\u00A0c\u3000d\u2028e  "],
  ["em-space-kept", "a\u2003b"],
  ["only-spaces", " \t\u3000 "],
  ["only-controls", "\u0007\u200B"],
  ["len-120", "가".repeat(120)],
  ["len-121", "가".repeat(121)],
  ["len-120-after-nfc", "a".repeat(119) + "e\u0301"],
  ["len-emoji-zwj-18", "👨\u200D👩\u200D👧\u200D👦".repeat(18)],
  ["unicode16-garay-case", "\u{10D50}\u{10D51}"],
  ["unicode16-kirat-rai-nfc", "\u{16D67}\u{16D67}"]
];
const lowerSql = `select sec01_lab.canon_text($1) as canon, lower(sec01_lab.canon_text($1)) as lower_default,
  lower(sec01_lab.canon_text($1) collate "ko-x-icu") as lower_ko, lower(sec01_lab.canon_text($1) collate "C") as lower_c,
  char_length(sec01_lab.canon_text($1)) as len`;
const rows = [];
for (const [name, input] of vectors) {
  const js = normalizeChatText(input);
  const jsText = js.ok ? js.text : null;
  const jsCanonRaw = input.normalize("NFC").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B‎‏‪-\u202E\u2060\u2066-\u2069\uFEFF]/g, "").replace(/[\t\n\r\u00A0\u2028\u2029\u3000 ]+/g, " ").trim();
  const pgr = (await pool.query(lowerSql, [input])).rows[0];
  const pgStatus = pgr.canon === "" ? "empty" : pgr.len > 120 ? "too_long" : "ok";
  const jsStatus = js.ok ? "ok" : js.reason;
  const jsLower = jsCanonRaw.toLocaleLowerCase("ko");
  rows.push({ name, input: cp(input), js: { status: jsStatus, text: jsText ?? jsCanonRaw, cps: cp(jsCanonRaw), lowerKo: cp(jsLower) },
    pg: { status: pgStatus, text: pgr.canon, cps: cp(pgr.canon), lowerDefaultIcuEnUS: cp(pgr.lower_default), lowerKoIcu: cp(pgr.lower_ko), lowerC: cp(pgr.lower_c) },
    canonMatch: jsCanonRaw === pgr.canon && jsStatus === pgStatus, lowerMatchKoIcu: jsLower === pgr.lower_ko, lowerMatchDefault: jsLower === pgr.lower_default, lowerMatchC: jsLower === pgr.lower_c });
}
// Strings JS can hold but the server transport cannot (NUL, lone surrogate).
const transport = [];
for (const [name, input] of [["nul", "a\u0000b"], ["lone-surrogate", "a\uD800b"]]) {
  let pg; try { pg = (await pool.query("select sec01_lab.canon_text($1) c", [input])).rows[0].c; } catch (e) { pg = "ERROR: " + e.message; }
  transport.push({ name, input: cp(input), js: normalizeChatText(input), pg });
}
// End-to-end through PostgREST JSON for a subset (different senders to stay under the rate limit).
const e2eNames = ["hangul-conjoining-jamo(NFD)", "turkish-dotted-I", "emoji-zwj-family", "zwsp-bom-wj", "whitespace-mixed", "combining-acute(NFD)"];
const e2eUsers = await makeUsers(e2eNames.length, "d7");
const e2e = [];
for (let i = 0; i < e2eNames.length; i++) {
  const [name, input] = vectors.find((v) => v[0] === e2eNames[i]);
  const l = await joinCampus(e2eUsers[i], area("D7"));
  const r = await rpc(e2eUsers[i], "sec01_send_campus_chat", sendArgs(l, { text: input }));
  const js = normalizeChatText(input);
  e2e.push({ name, envelopeText: r.data?.envelope?.text, envelopeCps: cp(r.data?.envelope?.text ?? ""), jsText: js.text, equal: r.data?.envelope?.text === js.text });
}
const canonMismatch = rows.filter((r) => !r.canonMatch);
rec.add({ id: "D7-canon", title: "Unicode 공통 벡터 — 정규화(NFC·제어문자·공백·길이) JS↔PostgreSQL", verdict: canonMismatch.length === 0 && e2e.every((x) => x.equal) ? "PASS" : "FAIL",
  level: "real PostgreSQL 17.11 (Unicode 15.1, ICU en-US) vs Node 22.22 (ICU 77.1, Unicode 16.0) running the repo's protocol.js",
  observed: { vectors: rows.length, mismatches: canonMismatch.map((r) => ({ name: r.name, input: r.input, js: r.js, pg: r.pg })), e2eThroughPostgREST: e2e, transportOnly: transport },
  expected: "identical canonical text and status for every vector" });
const lowerKoMismatch = rows.filter((r) => !r.lowerMatchKoIcu), lowerDefMismatch = rows.filter((r) => !r.lowerMatchDefault), lowerCMismatch = rows.filter((r) => !r.lowerMatchC);
rec.add({ id: "D7-lower", title: "한글 로케일 소문자 변환(toLocaleLowerCase('ko') ↔ lower())", verdict: lowerKoMismatch.length === 0 && lowerDefMismatch.length === 0 ? "PASS" : "FAIL",
  level: "real PostgreSQL vs Node",
  observed: { mismatchKoIcu: lowerKoMismatch.map((r) => ({ name: r.name, js: r.js.lowerKo, pg: r.pg.lowerKoIcu })),
    mismatchDefaultCollation: lowerDefMismatch.map((r) => ({ name: r.name, js: r.js.lowerKo, pg: r.pg.lowerDefaultIcuEnUS })),
    mismatchCollateC: lowerCMismatch.map((r) => ({ name: r.name, js: r.js.lowerKo, pg: r.pg.lowerC })) },
  note: "Only relevant if the server ever reproduces the client's repeat-suppression key. Production DB collation/ICU version was NOT inspected (Production access prohibited).",
  expected: "identical lower-case keys" });
rec.add({ id: "D7-table", title: "Unicode 벡터 전체 표", verdict: "PASS", level: "data", observed: { rows }, expected: "(data only)" });

// ---------------------------------------------------------------- D8 · coordinate rounding (protocol.js q2 vs server numeric round)
const coords = [0, -0, 0.004, -0.004, 0.005, -0.005, 0.125, -0.125, 1.005, -1.005, 1.015, 2.675, 1.255, 123.456789, 1e-7, -1e-7,
  99999.995, 100000, -100000, 100000.004, -100000.004, 100000.005];
const coordRows = [];
for (const v of coords) {
  const wire = JSON.stringify(v); // what supabase-js puts on the wire
  const enc = encodeAction(1, ActionType.CHAT, { text: "x", x: v, y: 0, z: 0 });
  const jsAccepted = validateAction(enc).ok === true;
  const pg = (await pool.query("select sec01_lab.canon_coord($1::numeric)::text as r", [wire])).rows[0].r;
  const jsR = enc.payload.x;
  coordRows.push({ input: Object.is(v, -0) ? "-0" : String(v), wire, js: { rounded: Object.is(jsR, -0) ? "-0" : String(jsR), accepted: jsAccepted }, pg: { rounded: pg, accepted: pg !== null },
    match: jsAccepted === (pg !== null) && (!jsAccepted || Number(pg) === jsR) });
}
const coordMismatch = coordRows.filter((r) => !r.match);
rec.add({ id: "D8-coords", title: "좌표 소수 둘째 자리 반올림 · 음수 0 · 경계값 JS↔PostgreSQL", verdict: coordMismatch.length ? "FAIL" : "PASS",
  level: "real PostgreSQL numeric vs repo protocol.js encodeAction/validateAction",
  observed: { mismatches: coordMismatch, all: coordRows },
  note: "JS rounds binary doubles with Math.round(v*100)/100 (half toward +∞, binary representation error) and range-checks AFTER rounding; numeric round() is half away from zero on the decimal literal and the lab range-checks BEFORE rounding. JSON.stringify(-0) is \"0\" so negative zero never reaches the server.",
  expected: "identical rounded values and identical accept/reject" });

await resetConfig();
rec.save();
await pool.end();
process.exit(0);
