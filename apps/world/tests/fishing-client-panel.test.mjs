import test from "node:test";
import assert from "node:assert/strict";
import {
  FISHING_API_PATH,
  FISHING_CLIENT_STATE,
  createFishingClient,
  parseFishingAttempt,
  parseFishingRead
} from "../src/activity/fishing-client.js";
import { FISHING_PHASE, FISHING_TEXT, createFishingPanel, fishingPhase, fishingSkillLine } from "../src/activity/fishing-panel.js";
import {
  FISHING_CONTEXT_PRIORITY,
  FISHING_SPOTS,
  FISHING_SPOT_RADIUS,
  fishingContextAction,
  findNearbyFishingSpot
} from "../src/activity/fishing-spots.js";
import { FISHING_SOURCES } from "../src/activity/fishing-core.js";
import { overPondWater } from "../src/landmark-detail-layout.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const ATTEMPT = "33333333-3333-4333-8333-333333333333";
const NONCE = "44444444-4444-4444-8444-444444444444";
const KEYS = ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2"];

const attempt = (extra = {}) => ({
  activityId: "activity.fishing.inkyung", sourceRef: FISHING_SOURCES[0], clientAttemptKey: KEYS[0],
  attemptId: ATTEMPT, nonce: NONCE, status: "ACTIVE", startedAtMs: 1000, biteAtMs: 4000,
  hookDeadlineMs: 5500, expiresAtMs: 31000, result: null, ...extra
});
const caught = () => attempt({ status: "SUCCEEDED", result: {
  resultRef: `fishing_result:${ATTEMPT}`, status: "SUCCEEDED", reason: "CAUGHT",
  catch: { speciesId: "carp", itemId: "material.fish_carp", quantity: 1, collectionEntryId: "collection.fish.carp",
    skillId: "life.fishing", lifeXp: 20 } } });
const readView = (extra = {}) => ({
  attempt: null, settlement: "NOT_REQUIRED", receipt: null,
  inventory: { itemId: "material.fish_carp", quantity: 0 },
  discovery: { entryId: "collection.fish.carp", discovered: false },
  lifeSkill: { skillId: "life.fishing", status: "ACTIVE", level: 1, totalXp: 0, nextLevelXp: 100 }, ...extra
});

function fakeFetch() {
  const calls = [];
  const queue = [];
  const fetcher = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    const next = queue.shift();
    if (!next) throw new Error("unexpected request");
    if (next === "NETWORK") throw new TypeError("network");
    return { status: next.status ?? 200, ok: (next.status ?? 200) < 400, json: async () => next.body ?? null };
  };
  return { calls, fetcher, reply: (body, status = 200) => queue.push({ body, status }), fail: () => queue.push("NETWORK") };
}

function harness({ token = "token-a", clock = { t: 10_000 } } = {}) {
  const net = fakeFetch();
  let key = 0;
  const fishing = createFishingClient({
    getToken: async () => token, fetcher: net.fetcher, now: () => clock.t, uuid: () => KEYS[key++ % KEYS.length]
  });
  return { net, fishing, clock };
}

test("spots stand on the pond shore, one per allowlisted source, and drive the F action", () => {
  assert.deepEqual(FISHING_SPOTS.map(s => s.sourceRef), FISHING_SOURCES);
  for (const spot of FISHING_SPOTS) assert.equal(overPondWater(spot.position.x, spot.position.z), false, spot.sourceRef);
  const [north, south] = FISHING_SPOTS;
  assert.ok(north.position.z > south.position.z, "+z is north");
  assert.equal(findNearbyFishingSpot({ x: north.position.x + 1, z: north.position.z }).spot, north);
  assert.equal(findNearbyFishingSpot({ x: north.position.x + FISHING_SPOT_RADIUS + 0.1, z: north.position.z }), null);
  let opened = null;
  const action = fishingContextAction(south.position, { available: true, onOpen: spot => { opened = spot; } });
  assert.equal(action.priority, FISHING_CONTEXT_PRIORITY);
  assert.equal(action.label, "낚시하기");
  action.trigger();
  assert.equal(opened, south);
  assert.equal(fishingContextAction(south.position, { available: false }), null, "no action without the server");
  assert.equal(fishingContextAction(south.position, { available: true, blocked: true }), null);
});

test("parsers accept the server projections and refuse anything else", () => {
  assert.equal(parseFishingAttempt(attempt()).status, "ACTIVE");
  assert.equal(parseFishingAttempt(caught()).result.catch.lifeXp, 20);
  assert.equal(parseFishingAttempt(attempt({ sourceRef: "fishing.elsewhere" })), null);
  assert.equal(parseFishingAttempt(attempt({ biteAtMs: 6000 })), null, "bite after the deadline");
  assert.equal(parseFishingAttempt(attempt({ status: "SUCCEEDED" })), null, "a success needs its result");
  assert.equal(parseFishingAttempt({ ...caught(), result: { ...caught().result, catch: null } }), null);
  assert.deepEqual(parseFishingRead(readView()).skill, { level: 1, totalXp: 0, nextLevelXp: 100 });
  assert.equal(parseFishingRead(readView({ settlement: "MAYBE" })), null);
  assert.equal(parseFishingRead(readView({ lifeSkill: { skillId: "life.mining", level: 1, totalXp: 0, nextLevelXp: 100 } })), null);
});

test("availability comes from the server: 404 hides fishing, a read makes it ready", async () => {
  const off = harness();
  off.net.reply(null, 404);
  assert.equal(await off.fishing.setAccount(A), false);
  assert.equal(off.fishing.state, FISHING_CLIENT_STATE.UNAVAILABLE);
  assert.equal(await off.fishing.probe({ minIntervalMs: 0 }), false, "a switched-off endpoint is not re-probed");
  assert.equal(off.net.calls.length, 1);

  const guest = harness({ token: null });
  assert.equal(await guest.fishing.setAccount(A), false);
  assert.equal(guest.fishing.available, false);
  assert.equal(guest.net.calls.length, 0, "no request without a permanent-account token");

  const on = harness();
  on.net.reply(readView());
  assert.equal(await on.fishing.setAccount(A), true);
  assert.equal(on.fishing.available, true);
  assert.deepEqual(on.net.calls[0], { url: FISHING_API_PATH, body: { op: "read" }, auth: "Bearer token-a" });
});

test("start sends only the spot and a key; HOOK sends the server ids; a catch is settled then re-read", async () => {
  const { net, fishing, clock } = harness();
  net.reply(readView());
  await fishing.setAccount(A);
  net.reply({ status: "STARTED", attempt: attempt({ startedAtMs: 50_000, biteAtMs: 53_000, hookDeadlineMs: 54_500, expiresAtMs: 80_000 }) });
  const started = await fishing.start(FISHING_SOURCES[0]);
  assert.equal(started.outcome, "STARTED");
  assert.deepEqual(net.calls[1].body, { op: "start", activityId: "activity.fishing.inkyung",
    sourceRef: FISHING_SOURCES[0], clientAttemptKey: KEYS[0] });
  assert.equal(fishing.serverNow(), 50_000, "server clock estimated from the start round trip");
  clock.t += 3000;
  net.reply({ status: "RESOLVED", attempt: caught() });
  net.reply({ status: "SUCCESS", receipt: {} });
  net.reply(readView({ attempt: caught(), settlement: "SETTLED", inventory: { itemId: "material.fish_carp", quantity: 1 },
    lifeSkill: { skillId: "life.fishing", level: 1, totalXp: 20, nextLevelXp: 100 } }));
  const hooked = await fishing.hook();
  assert.equal(hooked.outcome, "SETTLED");
  assert.deepEqual(net.calls.slice(2).map(c => c.body), [
    { op: "input", attemptId: ATTEMPT, sourceRef: FISHING_SOURCES[0], nonce: NONCE, action: "HOOK" },
    { op: "settle", attemptId: ATTEMPT },
    { op: "read", attemptId: ATTEMPT }
  ]);
  assert.ok(net.calls.every(c => !("p_user" in c.body) && !("user" in c.body) && !("lifeXp" in c.body)));
  assert.equal(fishing.read.carpQuantity, 1);
  assert.equal(fishing.read.skill.totalXp, 20);
});

test("a lost start reply reuses its key so the retry replays; an account switch drops the attempt", async () => {
  const { net, fishing } = harness();
  net.reply(readView());
  await fishing.setAccount(A);
  net.fail();
  assert.equal((await fishing.start(FISHING_SOURCES[1])).error, "NETWORK");
  net.reply({ status: "ALREADY_PROCESSED", attempt: attempt({ sourceRef: FISHING_SOURCES[1] }) });
  assert.equal((await fishing.start(FISHING_SOURCES[1])).outcome, "REPLAYED");
  assert.equal(net.calls[1].body.clientAttemptKey, net.calls[2].body.clientAttemptKey);
  net.reply({ error: "ATTEMPT_ALREADY_ACTIVE" }, 409);
  net.reply(readView({ attempt: attempt({ sourceRef: FISHING_SOURCES[1] }) }));
  const refused = await fishing.start(FISHING_SOURCES[0]);
  assert.equal(refused.error, "ATTEMPT_ALREADY_ACTIVE");
  assert.equal(fishing.attempt.sourceRef, FISHING_SOURCES[1], "the active cast is recovered, not replaced");
  net.reply(readView());
  await fishing.setAccount(B);
  assert.equal(fishing.attempt, null);
  assert.equal(fishing.available, true);
});

test("panel follows the server bite window and only sends HOOK / CANCEL", async () => {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  panel.hidden = true;
  const { net, fishing, clock } = harness();
  net.reply(readView());
  await fishing.setAccount(A);
  let settled = 0;
  const ticks = [];
  const ui = createFishingPanel({ panel, fishing, doc, onSettled: () => { settled += 1; },
    setInterval: fn => { ticks.push(fn); return ticks.length; }, clearInterval: () => {} });
  const all = (root, out = []) => { out.push(root); for (const c of root.children ?? []) all(c, out); return out; };
  const text = () => all(panel).map(n => n.textContent).join(" ");
  const find = cls => all(panel).find(n => (n.className ?? "").includes(cls));
  const flush = () => new Promise(resolve => setTimeout(resolve, 0));

  net.reply(readView());
  ui.setOpen(true, FISHING_SPOTS[0]);
  await flush();
  assert.match(text(), /인경호 북쪽 낚시터/);
  assert.match(text(), /낚시 Lv 1 · XP 0 \/ 100/);
  net.reply({ status: "STARTED", attempt: attempt({ startedAtMs: 10_000, biteAtMs: 13_000, hookDeadlineMs: 14_500, expiresAtMs: 40_000 }) });
  find("fishing-cast").click();
  await flush(); await flush();
  assert.equal(panel.dataset.phase, FISHING_PHASE.WAITING);
  assert.match(text(), new RegExp(FISHING_TEXT.waiting));
  clock.t = 13_100;
  ticks.at(-1)();
  assert.equal(panel.dataset.phase, FISHING_PHASE.BITE);
  assert.equal(find("fishing-hook").textContent, FISHING_TEXT.hookNow);
  net.reply({ status: "RESOLVED", attempt: caught() });
  net.reply({ status: "SUCCESS", receipt: {} });
  net.reply(readView({ attempt: caught(), settlement: "SETTLED", inventory: { itemId: "material.fish_carp", quantity: 3 },
    lifeSkill: { skillId: "life.fishing", level: 1, totalXp: 20, nextLevelXp: 100 } }));
  find("fishing-hook").click();
  for (let i = 0; i < 6; i++) await flush();
  assert.equal(panel.dataset.phase, FISHING_PHASE.RESULT);
  assert.match(text(), /붕어를 낚았어요/);
  assert.match(text(), /\+20 낚시 XP · 붕어 3마리 보유/);
  assert.equal(settled, 1, "the owning views are re-read after a settled catch");
  assert.equal(net.calls.at(-3).body.action, "HOOK");
  ui.setOpen(false);
  assert.equal(panel.hidden, true);
});

test("phase and skill helpers are pure presentation of server numbers", () => {
  const a = parseFishingAttempt(attempt());
  assert.equal(fishingPhase(null, 0), FISHING_PHASE.IDLE);
  assert.equal(fishingPhase(a, 3999), FISHING_PHASE.WAITING);
  assert.equal(fishingPhase(a, 4000), FISHING_PHASE.BITE);
  assert.equal(fishingPhase(a, 5500), FISHING_PHASE.LATE);
  assert.equal(fishingPhase(parseFishingAttempt(caught()), 0), FISHING_PHASE.RESULT);
  assert.equal(fishingSkillLine({ level: 20, totalXp: 19000, nextLevelXp: null }), "낚시 Lv 20 · 최고 레벨 · XP 19000");
});
