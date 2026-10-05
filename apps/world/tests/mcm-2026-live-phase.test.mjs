import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createMcm2026EventClient } from "../src/events/zombie-university-2026/event-client.js";
import {
  MCM_2026_EVENT_ID, MCM_2026_NPC_IDS, MCM_2026_PROGRESS_STAGE, MCM_2026_TEASER_LINES
} from "../src/events/zombie-university-2026/event-data.js";
import {
  MCM_2026_PHASE, MCM_2026_SCHEDULE, MCM_2026_TALK, formatMcm2026Countdown, mcm2026ActorVisible,
  mcm2026CanEnterVenue, mcm2026PhaseAt, mcm2026ServerStateAt, mcm2026TalkMode, resolveMcm2026Phase
} from "../src/events/zombie-university-2026/event-phase.js";
import { mcm2026PreviewStartMs } from "../src/events/zombie-university-2026/event-route.js";

const P = MCM_2026_PHASE;
const kst = local => Date.parse(`${local}+09:00`);
const phaseModule = fileURLToPath(new URL("../src/events/zombie-university-2026/event-phase.js", import.meta.url));

const REQUIRED = [
  ["2026-09-28T12:00:00", P.PRELUDE],
  ["2026-09-29T22:59:59", P.PRELUDE],
  ["2026-09-29T23:00:00", P.WARNING],
  ["2026-09-29T23:59:59", P.WARNING],
  ["2026-09-30T00:00:00", P.OUTBREAK],
  ["2026-09-30T17:59:59", P.OUTBREAK],
  ["2026-09-30T18:00:00", P.ONSITE_LIVE],
  ["2026-10-01T00:59:59", P.ONSITE_LIVE],
  ["2026-10-01T01:00:00", P.ENDED]
];

test("required Asia/Seoul instants map to the right live phase", () => {
  for (const [local, phase] of REQUIRED) assert.equal(mcm2026PhaseAt(kst(local)), phase, local);
});

test("phase boundaries have no off-by-one at the millisecond", () => {
  const edges = [
    [MCM_2026_SCHEDULE.preludeStartsAt, P.SCHEDULED, P.PRELUDE],
    [MCM_2026_SCHEDULE.warningStartsAt, P.PRELUDE, P.WARNING],
    [MCM_2026_SCHEDULE.outbreakStartsAt, P.WARNING, P.OUTBREAK],
    [MCM_2026_SCHEDULE.onsiteLiveStartsAt, P.OUTBREAK, P.ONSITE_LIVE],
    [MCM_2026_SCHEDULE.endsAt, P.ONSITE_LIVE, P.ENDED]
  ];
  for (const [iso, before, after] of edges) {
    const at = Date.parse(iso);
    assert.equal(mcm2026PhaseAt(at - 1), before, `${iso} - 1ms`);
    assert.equal(mcm2026PhaseAt(at), after, iso);
  }
  assert.equal(mcm2026PhaseAt(Number.NaN), P.SCHEDULED);
  // The server rule (world_event_state_v1) on the same instants.
  assert.equal(mcm2026ServerStateAt(kst("2026-09-29T23:59:59.999")), "SCHEDULED");
  assert.equal(mcm2026ServerStateAt(kst("2026-09-30T00:00:00")), "ACTIVE");
  assert.equal(mcm2026ServerStateAt(kst("2026-09-30T18:00:00")), "ACTIVE", "18:00 changes no server rule");
  assert.equal(mcm2026ServerStateAt(kst("2026-10-01T00:59:59.999")), "ACTIVE");
  assert.equal(mcm2026ServerStateAt(kst("2026-10-01T01:00:00")), "ENDED");
});

test("schedule is absolute KST: UTC equivalents agree and the host time zone cannot shift it", () => {
  assert.equal(Date.parse(MCM_2026_SCHEDULE.outbreakStartsAt), Date.parse("2026-09-29T15:00:00Z"));
  assert.equal(Date.parse(MCM_2026_SCHEDULE.onsiteLiveStartsAt), Date.parse("2026-09-30T09:00:00Z"));
  assert.equal(Date.parse(MCM_2026_SCHEDULE.endsAt), Date.parse("2026-09-30T16:00:00Z"));
  for (const iso of Object.values(MCM_2026_SCHEDULE)) assert.match(iso, /\+09:00$/);
  const script = `import(${JSON.stringify(`file://${phaseModule}`)}).then(m=>console.log(JSON.stringify(
    ${JSON.stringify(REQUIRED.map(([local]) => kst(local)))}.map(ms=>m.mcm2026PhaseAt(ms)))))`;
  for (const tz of ["America/Los_Angeles", "Pacific/Kiritimati", "UTC"]) {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, TZ: tz } });
    assert.deepEqual(JSON.parse(String(out)), REQUIRED.map(([, phase]) => phase), tz);
  }
});

test("client schedule mirrors the canonical public baseline event row", async () => {
  const sql = await readFile(new URL("../../../supabase/migrations/20261001213132_public_baseline.sql", import.meta.url), "utf8");
  const line = sql.split("\n").find(line => line.startsWith('INSERT INTO "private"."world_events" ') && line.includes("'event.mcm_2026'"));
  assert.ok(line, 'the public baseline contains the event reference seed');
  const columns = [...line.match(/\((.*?)\) VALUES/)[1].matchAll(/"([^"]+)"/g)].map(m => m[1]);
  const values = line.slice(line.indexOf(' VALUES (') + 9, -2).match(/'(?:''|[^'])*'|NULL|true|false|-?\d+(?:\.\d+)?/g);
  assert.equal(columns.length, values.length, 'parse every baseline column without dropping values');
  const row = Object.fromEntries(columns.map((column, i) => [column, values[i].replace(/^'|'$/g, '').replaceAll("''", "'")]));
  assert.equal(row.event_id, 'event.mcm_2026');
  assert.equal(Date.parse(row.starts_at), Date.parse(MCM_2026_SCHEDULE.outbreakStartsAt));
  assert.equal(Date.parse(row.ends_at), Date.parse(MCM_2026_SCHEDULE.endsAt));
});

test("server eventState outranks a skewed local clock", () => {
  const at = local => kst(local);
  // Local clock says 13:00 but the server has not opened the window: never playable.
  assert.equal(resolveMcm2026Phase({ eventState: "SCHEDULED", nowMs: at("2026-09-30T13:00:00") }), P.WARNING);
  assert.equal(resolveMcm2026Phase({ eventState: "SCHEDULED", nowMs: at("2026-10-02T00:00:00") }), P.WARNING);
  assert.equal(resolveMcm2026Phase({ eventState: "SCHEDULED", nowMs: at("2026-09-29T09:00:00") }), P.PRELUDE);
  // Server says ENDED: a clock rolled back to 20:00 cannot bring the event back.
  assert.equal(resolveMcm2026Phase({ eventState: "ENDED", nowMs: at("2026-09-30T20:00:00") }), P.ENDED);
  assert.equal(resolveMcm2026Phase({ eventState: "DISABLED", nowMs: at("2026-09-30T20:00:00") }), P.DISABLED);
  // Server ACTIVE: only OUTBREAK or ONSITE_LIVE, never a teaser phase.
  assert.equal(resolveMcm2026Phase({ eventState: "ACTIVE", nowMs: at("2026-09-29T09:00:00") }), P.OUTBREAK);
  assert.equal(resolveMcm2026Phase({ eventState: "ACTIVE", nowMs: at("2026-09-30T17:59:59") }), P.OUTBREAK);
  assert.equal(resolveMcm2026Phase({ eventState: "ACTIVE", nowMs: at("2026-09-30T18:00:00") }), P.ONSITE_LIVE);
  // Signed out: time only (presentation).
  assert.equal(resolveMcm2026Phase({ nowMs: at("2026-09-29T23:30:00") }), P.WARNING);
});

test("only a server-ACTIVE playable phase may reach the progress endpoint", () => {
  for (const phase of [P.PRELUDE, P.WARNING]) {
    for (const eventState of [null, "SCHEDULED", "ACTIVE"]) {
      assert.equal(mcm2026TalkMode({ phase, eventState }), MCM_2026_TALK.TEASER, `${phase}/${eventState}`);
    }
  }
  assert.equal(mcm2026TalkMode({ phase: P.OUTBREAK, eventState: "ACTIVE" }), MCM_2026_TALK.PLAY);
  assert.equal(mcm2026TalkMode({ phase: P.ONSITE_LIVE, eventState: "ACTIVE" }), MCM_2026_TALK.PLAY);
  assert.equal(mcm2026TalkMode({ phase: P.OUTBREAK, eventState: null }), MCM_2026_TALK.LOGIN);
  assert.equal(mcm2026TalkMode({ phase: P.ENDED, eventState: "ENDED" }), MCM_2026_TALK.ENDED);
  assert.equal(mcm2026TalkMode({ phase: P.SCHEDULED, eventState: "SCHEDULED" }), MCM_2026_TALK.LOCKED);
  assert.equal(mcm2026TalkMode({ phase: P.DISABLED, eventState: "DISABLED" }), MCM_2026_TALK.LOCKED);
  for (const phase of ["PRELUDE", "WARNING"]) {
    for (const id of Object.values(MCM_2026_NPC_IDS)) assert.ok(MCM_2026_TEASER_LINES[phase][id], `${phase} ${id}`);
  }
  assert.match(MCM_2026_TEASER_LINES.WARNING[MCM_2026_NPC_IDS.GUIDE], /오늘 00:00 조사 개시/);
  assert.match(MCM_2026_TEASER_LINES.PRELUDE[MCM_2026_NPC_IDS.GUIDE], /9월 30일 00:00/);
});

test("NPC presence follows the phase; ENDED fully retires the event cast", () => {
  const all = Object.values(MCM_2026_NPC_IDS);
  for (const phase of [P.PRELUDE, P.WARNING, P.OUTBREAK, P.ONSITE_LIVE]) {
    assert.ok(all.every(id => mcm2026ActorVisible(id, phase)), phase);
  }
  assert.deepEqual(all.filter(id => mcm2026ActorVisible(id, P.ENDED)), []);
  assert.deepEqual(all.filter(id => mcm2026ActorVisible(id, P.SCHEDULED)), []);
  assert.deepEqual(all.filter(id => mcm2026ActorVisible(id, P.DISABLED)), []);
});

test("Geonmulju entry needs the server window; after ENDED only an earned clear may settle", () => {
  const state = (eventState, stage, firstClearedAt = null) => ({ eventState, progress: { stage }, landlord: { firstClearedAt } });
  assert.equal(mcm2026CanEnterVenue(state("ACTIVE", "VENUE_UNLOCKED")), true);
  assert.equal(mcm2026CanEnterVenue(state("ACTIVE", "COMPLETED", "2026-09-30T04:00:00Z")), true);
  assert.equal(mcm2026CanEnterVenue(state("ACTIVE", "STARTED")), false);
  assert.equal(mcm2026CanEnterVenue(state("SCHEDULED", "VENUE_UNLOCKED")), false);
  assert.equal(mcm2026CanEnterVenue(state("ENDED", "VENUE_UNLOCKED")), false, "no new minigame after 01:00");
  assert.equal(mcm2026CanEnterVenue(state("ENDED", "COMPLETED", "2026-09-30T15:00:00Z")), true);
  assert.equal(mcm2026CanEnterVenue(state("DISABLED", "COMPLETED", "2026-09-30T15:00:00Z")), false);
  assert.equal(mcm2026CanEnterVenue(null), false);
});

test("countdown copy is short and never negative", () => {
  assert.equal(formatMcm2026Countdown(2 * 86_400_000), "2일");
  assert.equal(formatMcm2026Countdown(86_400_000 + 3 * 3_600_000), "1일 3시간");
  assert.equal(formatMcm2026Countdown(2 * 3_600_000 + 5 * 60_000), "2시간 5분");
  assert.equal(formatMcm2026Countdown(30_000), "1분");
  assert.equal(formatMcm2026Countdown(-5), "1분");
});

test("preview time injection is limited to preview hosts and explicit offsets", () => {
  const ms = mcm2026PreviewStartMs({ hostname: "localhost", search: "?event=mcm-2026-preview&mcmAt=2026-09-29T23:59:50%2B09:00" });
  assert.equal(ms, kst("2026-09-29T23:59:50"));
  assert.equal(mcm2026PreviewStartMs({ hostname: "example.com", search: "?event=mcm-2026-preview&mcmAt=2026-09-30T12:00:00Z" }), null);
  assert.equal(mcm2026PreviewStartMs({ hostname: "localhost", search: "?mcmAt=2026-09-30T12:00:00Z" }), null, "preview flag required");
  assert.equal(mcm2026PreviewStartMs({ hostname: "localhost", search: "?event=mcm-2026-preview&mcmAt=2026-09-30T12:00:00" }), null,
    "a zone-less time would depend on the browser time zone");
});

function timedPreview(start) {
  let now = kst(start);
  const client = createMcm2026EventClient({
    preview: true, previewTimed: true, clock: { now: () => now },
    fetcher: async () => { throw Error("preview must not fetch"); },
    getClient: () => ({ rpc() { throw Error("preview must not rpc"); } }),
    randomBytes: () => Uint8Array.of(3)
  });
  return { client, set: local => { now = kst(local); }, advanceMs: ms => { now += ms; } };
}

async function investigateAll(client) {
  for (const action of ["investigate_hungry", "investigate_staggering", "investigate_dancing"]) await client.advance(action);
}

async function clearRun(client) {
  const run = await client.startRun();
  for (const actorId of run.actorIds) {
    const result = await client.submitRun(run.runId, actorId);
    if (result.status === "CLEARED") return result;
  }
  throw Error("no survivor found");
}

test("PRELUDE and WARNING never start or advance the main investigation", async () => {
  for (const local of ["2026-09-28T12:00:00", "2026-09-29T23:59:59"]) {
    const { client } = timedPreview(local);
    await client.setSignedIn(true);
    assert.equal(client.state.eventState, "SCHEDULED");
    await assert.rejects(client.advance("start"), /EVENT_NOT_ACTIVE/);
    await assert.rejects(client.advance("investigate_dancing"), /EVENT_NOT_ACTIVE/);
    await assert.rejects(client.startRun(), /EVENT_NOT_ACTIVE/);
    assert.equal(client.state.progress.stage, MCM_2026_PROGRESS_STAGE.NOT_STARTED);
    assert.deepEqual(client.state.progress.investigated, []);
  }
});

test("from 00:00:00 the whole route clears; 18:00 does not break a run in progress", async () => {
  const { client, set, advanceMs } = timedPreview("2026-09-29T23:59:59");
  await client.setSignedIn(true);
  assert.equal(client.phase(), P.WARNING);
  set("2026-09-30T00:00:00");
  const reread = client.refreshIfStale();
  assert.ok(reread, "crossing 00:00 re-reads the (preview) server");
  await reread;
  assert.equal(client.state.eventState, "ACTIVE");
  assert.equal(client.phase(), P.OUTBREAK);
  assert.equal((await client.advance("start")).progress.stage, MCM_2026_PROGRESS_STAGE.STARTED);
  await investigateAll(client);
  assert.equal(client.state.progress.stage, MCM_2026_PROGRESS_STAGE.VENUE_UNLOCKED, "any investigation order");
  assert.equal(mcm2026CanEnterVenue(client.state), true);

  set("2026-09-30T17:59:50");
  const run = await client.startRun();
  advanceMs(15_000);
  assert.equal(client.phase(), P.ONSITE_LIVE);
  const wrong = run.actorIds.find(id => id !== "ZUE-MG-004");
  const miss = await client.submitRun(run.runId, wrong);
  assert.equal(miss.status, "ACTIVE", "the run started before 18:00 keeps going after it");
  let clear = null;
  for (const actorId of run.actorIds) {
    clear = await client.submitRun(run.runId, actorId);
    if (clear.status !== "ACTIVE") break;
  }
  assert.equal(clear.status, "CLEARED");
  assert.equal(client.state.progress.stage, MCM_2026_PROGRESS_STAGE.COMPLETED);
  assert.equal((await client.claimMain()).status, "PREVIEW", "preview moves no value");
});

test("from 01:00:00 no new start, run or venue entry; earned completion stays", async () => {
  const { client, set } = timedPreview("2026-09-30T20:00:00");
  await client.setSignedIn(true);
  await client.advance("start");
  await investigateAll(client);
  await clearRun(client);
  assert.equal(client.state.progress.stage, MCM_2026_PROGRESS_STAGE.COMPLETED);
  const completedAt = client.state.progress.completedAt;

  const late = timedPreview("2026-10-01T00:59:59");
  await late.client.setSignedIn(true);
  await late.client.advance("start");
  await investigateAll(late.client);
  const run = await late.client.startRun();
  late.set("2026-10-01T01:00:00");
  await assert.rejects(late.client.submitRun(run.runId, run.actorIds[0]), /EVENT_NOT_ACTIVE/, "a run cannot finish after 01:00");
  await assert.rejects(late.client.startRun(), /EVENT_NOT_ACTIVE/);
  await late.client.refresh();
  assert.equal(late.client.phase(), P.ENDED);
  assert.equal(mcm2026CanEnterVenue(late.client.state), false, "no new minigame entry");

  set("2026-10-01T01:00:00");
  await client.refresh();
  assert.equal(client.phase(), P.ENDED);
  await assert.rejects(client.advance("start"), /EVENT_NOT_ACTIVE/);
  assert.equal(client.state.progress.completedAt, completedAt, "completion record is kept");
  assert.equal(mcm2026CanEnterVenue(client.state), true, "an earned clear may still come back to settle");
});

test("live client re-reads the server at the 00:00 edge and trusts the server clock over the local one", async () => {
  const calls = [];
  let serverState = {
    eventId: MCM_2026_EVENT_ID, eventState: "SCHEDULED",
    startsAt: "2026-09-29T15:00:00Z", endsAt: "2026-09-30T16:00:00Z", serverNow: "2026-09-29T14:59:58Z",
    progress: { stage: "NOT_STARTED", investigated: [], startedAt: null, venueUnlockedAt: null, completedAt: null },
    landlord: { firstClearedAt: null, activeRun: null }
  };
  // The browser clock runs two hours fast (or its time zone was changed and the user set it by hand).
  let local = Date.parse("2026-09-29T16:59:58Z");
  const client = createMcm2026EventClient({
    clock: { now: () => local },
    getClient: () => ({ rpc: async name => { calls.push(name); return { data: serverState, error: null }; } }),
    getSessionToken: async () => "jwt"
  });
  await client.setSignedIn(true);
  assert.equal(client.status().serverOffsetMs, -2 * 3_600_000);
  assert.equal(client.phase(), P.WARNING, "the fast local clock does not open the event");
  assert.equal(client.refreshIfStale(), null);

  local += 2_000; // server 00:00:00
  serverState = { ...serverState, eventState: "ACTIVE", serverNow: "2026-09-29T15:00:00Z" };
  const reread = client.refreshIfStale();
  assert.ok(reread);
  await reread;
  assert.equal(client.phase(), P.OUTBREAK);
  assert.equal(client.refreshIfStale(), null, "no further reads while the state is current");
  assert.deepEqual(calls, ["get_my_mcm_2026_event_v1", "get_my_mcm_2026_event_v1"]);

  // Throttle: a server still reporting SCHEDULED is not hammered every frame.
  serverState = { ...serverState, eventState: "SCHEDULED" };
  await client.refresh();
  calls.length = 0;
  assert.equal(client.refreshIfStale(), null, "within the throttle window");
  local += 5_000;
  assert.ok(client.refreshIfStale());
  assert.equal(calls.length, 1);
});

test("signed-out players get presentation only, and reconnect restores server progress", async () => {
  const guest = createMcm2026EventClient({ clock: { now: () => kst("2026-09-29T10:00:00") } });
  assert.equal(guest.state, null);
  assert.equal(guest.phase(), P.PRELUDE);
  assert.equal(await guest.advance("start"), null, "no progress without an account");

  const stored = {
    eventId: MCM_2026_EVENT_ID, eventState: "ACTIVE",
    startsAt: "2026-09-29T15:00:00Z", endsAt: "2026-09-30T16:00:00Z", serverNow: "2026-09-30T09:30:00Z",
    progress: { stage: "STARTED", investigated: ["dancing"], startedAt: "2026-09-30T08:00:00Z", venueUnlockedAt: null, completedAt: null },
    landlord: { firstClearedAt: null, activeRun: null }
  };
  const client = createMcm2026EventClient({
    clock: { now: () => Date.parse("2026-09-30T09:30:00Z") },
    getClient: () => ({ rpc: async () => ({ data: stored, error: null }) })
  });
  await client.setSignedIn(true);
  assert.equal(client.phase(), P.ONSITE_LIVE);
  assert.deepEqual(client.state.progress.investigated, ["dancing"]);
  await client.setSignedIn(false);
  assert.equal(client.state, null);
  await client.setSignedIn(true);
  assert.deepEqual(client.state.progress, stored.progress, "progress comes back from the server read");
});

test("live-event wiring keeps the server gates and adds no new reward, QR or attendance path", async () => {
  const read = path => readFile(new URL(path, import.meta.url), "utf8");
  const main = await read("../src/main.js");
  assert.match(main, /mcm2026CanEnterVenue\(mcmEvent\.state\)/);
  assert.match(main, /mcmEventUi\.update\(dt\)/);
  assert.match(main, /getGuidance: \(\) => rooms\?\.insideRoom \? "" : mcmEventRuntime/, "no campus distance inside a room");
  const files = await Promise.all([
    "../src/events/zombie-university-2026/event-phase.js",
    "../src/events/zombie-university-2026/event-client.js",
    "../src/events/zombie-university-2026/event-runtime.js",
    "../src/events/zombie-university-2026/event-ui.js",
    "../src/events/zombie-university-2026/minigame-room-runtime.js"
  ].map(read));
  const text = files.join("\n");
  assert.doesNotMatch(text, /\bqr\b|attendance|check-?in|geolocation/i);
  assert.doesNotMatch(text, /world_reward_grant|wallet_credit|grant_item/);
  assert.doesNotMatch(text, /getTimezoneOffset|toLocale(Date|Time)?String|Intl\.DateTimeFormat/,
    "no phase decision depends on the browser time zone");
  const runtime = files[2];
  assert.match(runtime, /mode===MCM_2026_TALK\.TEASER/);
  assert.ok(runtime.indexOf("mode===MCM_2026_TALK.TEASER") < runtime.indexOf('client.advance("start")'),
    "teaser talk returns before any progress call");
  const minigame = files[4];
  assert.match(minigame, /이 중 인간은 단 한 명입니다/);
  assert.match(minigame, /45초/);
});
