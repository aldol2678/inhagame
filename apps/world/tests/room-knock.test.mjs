// Housing H3 · knock client, owner watcher, visitor notices and the owner knock prompt.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  KNOCK_STATUS, OWNER_KNOCK_POLL_MS, RoomKnockClient, RoomKnockError, createOwnerKnockWatcher,
  diffRoomVisitors, parseKnock, waitForKnockAnswer
} from "../src/rooms/room-knock.js";
import { KNOCK_PROMPT_TEXT, createKnockPrompt } from "../src/rooms/knock-prompt.js";
import { DORM_1_LOBBY, DORM_1_LOBBY_FRIEND_ROOM, DORM_1_LOBBY_MY_ROOM, DORM_1_LOBBY_OBSTACLES } from "../src/rooms/dorm1-lobby-layout.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const OWNER = "a1000000-0000-4000-8000-0000000000a1";
const FRIEND = "b2000000-0000-4000-8000-0000000000b2";
const ROOM = "11111111-1111-4111-8111-111111111111";
const KNOCK = "22222222-2222-4222-8222-222222222222";
const KNOCK2 = "33333333-3333-4333-8333-333333333333";
const flush = async (n = 3) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)); };
const knockRow = (over = {}) => ({ knockId: KNOCK, roomId: ROOM, visitorUserId: FRIEND, status: "PENDING",
  expiresAt: "2099-01-01T00:00:00Z", ...over });

test("parseKnock keeps only well-formed server rows", () => {
  assert.equal(parseKnock(knockRow()).status, KNOCK_STATUS.PENDING);
  assert.equal(parseKnock(knockRow({ visitorDisplayName: "  " })).visitorDisplayName, "친구");
  assert.equal(parseKnock(knockRow({ ownerPresent: "yes" })).ownerPresent, false);
  for (const bad of [null, {}, knockRow({ status: "MAYBE" }), knockRow({ knockId: "x" }), knockRow({ roomId: null }),
    knockRow({ visitorUserId: "nope" })]) assert.equal(parseKnock(bad), null);
});

test("knock client sends the right RPCs, maps server errors and voids answers across an account switch", async () => {
  const calls = [];
  let self = FRIEND;
  let reply = { data: knockRow({ status: "OPEN", ownerPresent: false }), error: null };
  const client = new RoomKnockClient({ getClient: () => ({ rpc: async (name, args) => { calls.push([name, args]); return reply; } }),
    getSelfUserId: () => self });
  assert.equal((await client.knock(OWNER)).status, "OPEN");
  assert.deepEqual(calls.at(-1), ["knock_friend_personal_room_v1", { p_owner: OWNER }]);
  await assert.rejects(client.knock("not-a-uuid"), (e) => e instanceof RoomKnockError && e.code === "TARGET_UNAVAILABLE");
  for (const code of ["VISIT_DECLINED", "ROOM_PRIVATE", "RATE_LIMITED", "NOT_FRIENDS"]) {
    reply = { data: null, error: { message: code } };
    await assert.rejects(client.knock(OWNER), (e) => e.code === code);
  }
  reply = { data: null, error: { message: "socket hang up" } };
  await assert.rejects(client.knock(OWNER), (e) => e.code === "FAILED");
  reply = { data: knockRow({ visitorUserId: OWNER }), error: null };
  await assert.rejects(client.knock(OWNER), (e) => e.code === "FAILED", "another visitor's knock is rejected");

  reply = { data: knockRow({ status: "ACCEPTED" }), error: null };
  assert.equal((await client.get(KNOCK)).status, "ACCEPTED");
  assert.deepEqual(calls.at(-1), ["get_my_room_knock_v1", { p_knock: KNOCK }]);
  reply = { data: knockRow({ status: "DECLINED" }), error: null };
  assert.equal((await client.respond(KNOCK, false)).status, "DECLINED");
  assert.deepEqual(calls.at(-1), ["respond_room_knock_v1", { p_knock: KNOCK, p_accept: false }]);
  reply = { data: { roomId: ROOM, knocks: [knockRow(), knockRow({ knockId: KNOCK2, status: "ACCEPTED" }), { junk: true }] }, error: null };
  assert.deepEqual((await client.list()).knocks.map(k => k.knockId), [KNOCK], "only pending, well-formed knocks are listed");
  assert.deepEqual(calls.at(-1), ["list_my_room_knocks_v1", {}]);

  let release;
  const gate = new Promise((r) => { release = r; });
  const slow = new RoomKnockClient({ getClient: () => ({ rpc: async () => { await gate; return { data: knockRow(), error: null }; } }),
    getSelfUserId: () => self });
  const pending = slow.knock(OWNER);
  self = OWNER;
  release();
  await assert.rejects(pending, (e) => e.code === "SIGNED_OUT");
  self = null;
  assert.equal(client.available, false);
  await assert.rejects(client.list(), (e) => e.code === "SIGNED_OUT");
});

test("waitForKnockAnswer polls until an answer, retries network errors and stops at the deadline", async () => {
  let t = 0;
  const statuses = ["PENDING", "FAILED", "ACCEPTED"];
  const client = { get: async () => {
    const next = statuses.shift();
    if (next === "FAILED") throw new RoomKnockError("FAILED");
    return parseKnock(knockRow({ status: next }));
  } };
  const answered = await waitForKnockAnswer({ client, knock: parseKnock(knockRow()), sleep: async (ms) => { t += ms; }, now: () => t });
  assert.equal(answered.knock.status, "ACCEPTED");
  assert.equal(answered.cancelled, false);

  t = 0;
  const silent = { get: async () => parseKnock(knockRow()) };
  const timedOut = await waitForKnockAnswer({ client: silent, knock: parseKnock(knockRow()), sleep: async (ms) => { t += ms; },
    now: () => t, timeoutMs: 5000 });
  assert.equal(timedOut.knock.status, "EXPIRED");

  const terminal = { get: async () => { throw new RoomKnockError("KNOCK_NOT_FOUND"); } };
  await assert.rejects(waitForKnockAnswer({ client: terminal, knock: parseKnock(knockRow()), sleep: async () => {} }),
    (e) => e.code === "KNOCK_NOT_FOUND");

  let cancel = false;
  const cancelled = await waitForKnockAnswer({ client: silent, knock: parseKnock(knockRow()),
    sleep: async () => { cancel = true; }, isCancelled: () => cancel });
  assert.equal(cancelled.cancelled, true);
});

test("owner watcher polls only while home, surfaces each knock once and keeps polling through errors", async () => {
  const timers = [];
  let home = false;
  let rows = [knockRow()];
  let fail = false;
  let lists = 0;
  const seen = [];
  const polled = [];
  const watcher = createOwnerKnockWatcher({
    onPolled: (knocks) => polled.push(knocks.length),
    client: { available: true, list: async () => { lists += 1; if (fail) throw new Error("offline"); return { roomId: ROOM, knocks: rows.map(parseKnock) }; } },
    isOwnerInRoom: () => home, onKnock: (k) => seen.push(k.knockId),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {}
  });
  watcher.start();
  await flush();
  assert.equal(lists, 0, "no heartbeat outside the own room");
  assert.equal(timers.at(-1).ms, OWNER_KNOCK_POLL_MS);
  home = true;
  timers.at(-1).fn(); await flush();
  timers.at(-1).fn(); await flush();
  assert.equal(lists, 2);
  assert.deepEqual(seen, [KNOCK], "one prompt per knock");
  fail = true;
  timers.at(-1).fn(); await flush();
  fail = false;
  rows = [knockRow(), knockRow({ knockId: KNOCK2 })];
  timers.at(-1).fn(); await flush();
  assert.deepEqual(seen, [KNOCK, KNOCK2]);
  assert.deepEqual(polled, [1, 1, 2], "every successful poll reports the pending list");
  watcher.stop();
  assert.equal(watcher.running, false);
  const scheduled = timers.length;
  timers.at(-1).fn(); await flush();
  assert.equal(timers.length, scheduled, "a stopped watcher does not reschedule");
});

test("diffRoomVisitors reports remote visitors who arrived or left", () => {
  const snap = (...people) => ({ participants: [{ userId: OWNER, displayName: "나", role: "owner", local: true }, ...people] });
  const a = { userId: FRIEND, displayName: "친구A", role: "visitor", local: false };
  const b = { userId: "c3000000-0000-4000-8000-0000000000c3", displayName: " ", role: "visitor", local: false };
  assert.deepEqual(diffRoomVisitors(snap(), snap(a)), { joined: ["친구A"], left: [] });
  assert.deepEqual(diffRoomVisitors(snap(a), snap(a, b)), { joined: ["친구"], left: [] });
  assert.deepEqual(diffRoomVisitors(snap(a, b), snap(b)), { joined: [], left: ["친구A"] });
  assert.deepEqual(diffRoomVisitors(null, snap()), { joined: [], left: [] });
});

function walk(node, fn) { fn(node); node.children.forEach((c) => walk(c, fn)); }
const buttonsIn = (root) => { const out = []; walk(root, (n) => { if (n.tagName === "BUTTON") out.push(n); }); return out; };
const textIn = (root) => { const out = []; walk(root, (n) => { if (n.textContent && !n.children.length) out.push(n.textContent); }); return out.join(" | "); };

test("knock prompt shows one knock at a time, answers through the server and skips expired knocks", async () => {
  const doc = createFakeDocument();
  const root = doc.createElement("section");
  root.hidden = true;
  let t = Date.parse("2026-10-03T00:00:00Z");
  const answers = [];
  let failNext = false;
  const prompt = createKnockPrompt({ root, doc, now: () => t,
    respond: async (knock, accept) => { if (failNext) { failNext = false; throw new Error("offline"); } answers.push([knock.knockId, accept]); } });
  const k1 = parseKnock(knockRow({ visitorDisplayName: "민수", expiresAt: "2026-10-03T00:00:30Z" }));
  const k2 = parseKnock(knockRow({ knockId: KNOCK2, visitorDisplayName: "지아", expiresAt: "2026-10-03T00:00:30Z" }));
  assert.equal(prompt.push(k1), true);
  assert.equal(prompt.push(k1), false, "the same knock is never queued twice");
  prompt.push(k2);
  assert.equal(root.hidden, false);
  assert.match(textIn(root), /민수님이 노크했어요/);
  assert.deepEqual(buttonsIn(root).map(b => b.textContent), [KNOCK_PROMPT_TEXT.accept, KNOCK_PROMPT_TEXT.decline]);
  failNext = true;
  await prompt.answer(true);
  assert.match(textIn(root), new RegExp(KNOCK_PROMPT_TEXT.failed), "a failed answer keeps the knock with a retry note");
  await prompt.answer(true);
  assert.deepEqual(answers, [[KNOCK, true]]);
  assert.match(textIn(root), /지아님이 노크했어요/, "the next knock follows");
  prompt.push(parseKnock(knockRow({ knockId: "44444444-4444-4444-8444-444444444444", visitorDisplayName: "서준",
    expiresAt: "2026-10-03T00:00:30Z" })));
  prompt.retain(["44444444-4444-4444-8444-444444444444"]);
  assert.match(textIn(root), /서준님이 노크했어요/, "a knock answered elsewhere leaves; the next one shows");
  t = Date.parse("2026-10-03T00:00:31Z");
  prompt.prune();
  assert.equal(root.hidden, true, "an expired knock disappears");
  prompt.push(k1);
  assert.equal(root.hidden, true, "a knock that already expired is never shown");
  prompt.clear();
  assert.equal(prompt.pending, 0);
});

test("lobby corridor door: inside the lobby, clear of furniture, apart from the own-room door", () => {
  const { x, z } = DORM_1_LOBBY_FRIEND_ROOM.position;
  assert.ok(Math.abs(x) < DORM_1_LOBBY.halfWidth && Math.abs(z) < DORM_1_LOBBY.halfDepth);
  const spot = DORM_1_LOBBY_FRIEND_ROOM.position;
  assert.ok(Math.hypot(spot.x - DORM_1_LOBBY_MY_ROOM.position.x, spot.z - DORM_1_LOBBY_MY_ROOM.position.z) >
    DORM_1_LOBBY_FRIEND_ROOM.radius + DORM_1_LOBBY_MY_ROOM.radius, "the two door actions never overlap");
  for (const box of DORM_1_LOBBY_OBSTACLES.filter(b => !b.id.includes("wall") && !b.id.includes("ceiling"))) {
    assert.ok(!(x > box.minX && x < box.maxX && z > box.minZ && z < box.maxZ), `knock spot clear of ${box.id}`);
  }
});

test("main wires the knock flow: no campus → room jump, knock action, owner prompt and visitor notices", () => {
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const visit = readFileSync(new URL("../src/rooms/friend-room-visit.js", import.meta.url), "utf8");
  assert.doesNotMatch(visit, /enterNestedFromCampus/, "friend visits never jump from the campus into a room");
  assert.match(main, /guideToDorm: \(\) => guideToDorm1\(\)/);
  assert.match(main, /contextActions\.set\("friend-room-knock"/);
  assert.match(main, /createOwnerKnockWatcher\(/);
  assert.match(main, /announceRoomVisitors\(state\)/);
  assert.match(main, /footer: knockPromptRoot/, "the knock prompt is the owner Room HUD footer");
});
