// Account switch isolation: nothing that belongs to the previous account (social caches, late
// RPC replies, friend panel completions, unsent chat drafts, online session starts) may surface
// after sign-out or after another account signs in in the same tab.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { Relationship, SocialClient, SocialError } from "../src/social/social-client.js";
import { createFriendPanel } from "../src/social/friend-panel.js";
import { createChatPanel } from "../src/online/chat-panel.js";
import { startWorldOnline } from "../src/online/world-online.js";
import { createLobbyPresenceSummary } from "../src/lobby/lobby-presence-summary.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const A = "a0000000-0000-4000-8000-0000000000a1";
const B = "b0000000-0000-4000-8000-0000000000b2";
const X = "c0000000-0000-4000-8000-0000000000c3";
const Y = "d0000000-0000-4000-8000-0000000000d4";
const nodesOf = (root) => [root, ...(root.children ?? []).flatMap(nodesOf)];
const flush = async () => { for (let i = 0; i < 4; i += 1) await new Promise((resolve) => setImmediate(resolve)); };

function deferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

// Supabase-like client whose RPCs stay pending until the test answers them.
function pendingRpcClient() {
  const calls = [];
  return {
    calls,
    client: { rpc(name, args) { const d = deferred(); calls.push({ name, args, ...d }); return d.promise; } }
  };
}

const socialFor = (fake, account) => new SocialClient({ getClient: () => fake.client, getSelfUserId: () => account.id });
const listOf = (friends = [], blocked = []) => ({ data: { friends: friends.map((userId) => ({ userId, nickname: "친구" })), incoming: [], outgoing: [], blocked: blocked.map((userId) => ({ userId, nickname: "차단" })) }, error: null });

test("a late get_my_world_social reply for account A never fills account B's caches", async () => {
  const fake = pendingRpcClient();
  const account = { id: A };
  const social = socialFor(fake, account);
  const pending = social.mine();
  // Sign out A, sign in B (what main.js does on any identity change).
  account.id = null; social.reset();
  account.id = B; social.reset();
  fake.calls[0].resolve(listOf([X], [Y]));
  await assert.rejects(pending, (error) => error instanceof SocialError && error.code === "STALE");
  assert.equal(social.isBlocked(Y), false, "A's block list never reaches B");
  assert.equal(social.relationshipOf(X), null, "A's friendship never reaches B");
});

test("same-user late reply after a reset is also discarded (reset invalidates pending work)", async () => {
  const fake = pendingRpcClient();
  const account = { id: A };
  const social = socialFor(fake, account);
  const pending = social.profile(X);
  social.reset();
  fake.calls[0].resolve({ data: { userId: X, available: true, relationship: Relationship.BLOCKED_BY_ME, nickname: "x" }, error: null });
  await assert.rejects(pending, (error) => error.code === "STALE");
  assert.equal(social.isBlocked(X), false);
});

test("a pending mutation for A is not shared with B and its late reply changes nothing", async () => {
  const fake = pendingRpcClient();
  const account = { id: A };
  const social = socialFor(fake, account);
  const seen = [];
  social.onRelationshipChange((userId, state) => seen.push([userId, state]));
  const fromA = social.block(X);
  account.id = null; social.reset();
  account.id = B; social.reset();
  const fromB = social.block(X);
  assert.notEqual(fromA, fromB, "B's request is its own, not A's in-flight promise");
  assert.equal(fake.calls.length, 2, "B sent its own RPC");
  fake.calls[0].resolve({ data: { relationship: Relationship.BLOCKED_BY_ME }, error: null });
  await assert.rejects(fromA, (error) => error.code === "STALE");
  assert.equal(social.isBlocked(X), false, "A's block does not appear for B");
  assert.deepEqual(seen, []);
  fake.calls[1].resolve({ data: { relationship: Relationship.BLOCKED_BY_ME }, error: null });
  assert.equal(await fromB, Relationship.BLOCKED_BY_ME);
  assert.equal(social.isBlocked(X), true);
});

test("friend panel: a completion started before close/reopen does not render into the new opening", async () => {
  const fake = pendingRpcClient();
  const account = { id: A };
  const social = socialFor(fake, account);
  const doc = createFakeDocument();
  const toggle = doc.createElement("button"), panel = doc.createElement("section");
  const ui = createFriendPanel({ toggle, panel, social, doc, timers: { setInterval: () => 1, clearInterval: () => {} } });
  void ui.setOpen(true);
  fake.calls[0].resolve(listOf([X]));
  await flush();
  assert.equal(ui.data.friends[0].userId, X);
  // A presses 친구 삭제; before the reply arrives A signs out (panel closes) and B opens it.
  const row = panel.children.find((n) => n.dataset?.section === "friends").children[1];
  row.children.find((c) => c.textContent === "친구 삭제").click();
  await flush();
  void ui.setOpen(false);
  assert.equal(ui.data, null, "closing drops the previous list");
  account.id = B; social.reset();
  void ui.setOpen(true);
  const removeCall = fake.calls.find((c) => c.name === "remove_world_friend");
  const bLoad = fake.calls.filter((c) => c.name === "get_my_world_social").at(-1);
  removeCall.resolve({ data: { relationship: Relationship.NONE }, error: null });
  await flush();
  assert.equal(fake.calls.filter((c) => c.name === "get_my_world_social").length, 2, "A's completion triggers no extra refresh");
  bLoad.resolve(listOf([]));
  await flush();
  assert.deepEqual(ui.data.friends, [], "B sees only B's list");
  assert.doesNotMatch(JSON.stringify(panel.children.map((n) => n.textContent)), /다시 시도/, "no stale error hint");
});

test("chat panel clearDraft drops the previous account's unsent text", () => {
  const doc = createFakeDocument();
  const el = () => doc.createElement("div");
  const input = doc.createElement("input");
  const chat = { signedIn: true, submit: () => ({ result: "sent" }) };
  const ui = createChatPanel({ toggle: el(), form: el(), input, feedList: el(), hint: el(), getChat: () => chat, doc, win: null });
  ui.setOpen(true, { focus: false });
  input.value = "A의 비밀 메시지";
  ui.clearDraft();
  assert.equal(input.value, "");
  assert.equal(ui.open, false);
});

// Runs the real main.js identity handler against recording fakes, with the real SocialClient
// and main.js's own Follow / Accompany relationship listeners. The handler body is sliced out of
// main.js by the regex below and run in a vm with only the fakes listed in createContext: when the
// handler gains a dependency (or its closing lines change), update the regex / fakes here.
function identityHarness() {
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const body = source.match(/online\.onIdentity\(\(identity\) => \{([\s\S]*?)\n  \}\);\n  online\.chat\.feed/)?.[1];
  assert.ok(body, "identity handler found in main.js");
  const log = [];
  const fake = pendingRpcClient();
  const online = { userId: null, supabase: fake.client };
  const social = new SocialClient({ getClient: () => online.supabase, getSelfUserId: () => online.userId });
  const reset = social.reset.bind(social);
  social.reset = () => { log.push("social.reset"); reset(); };
  const follow = {
    target: null,
    isFollowing(userId) { return this.target === userId; },
    stop(reason) { if (!this.target) return; this.target = null; log.push(`follow.stop:${reason}`); }
  };
  const accompany = {
    peerId: null,
    refresh() {},
    reset() { this.peerId = null; log.push("accompany.reset"); },
    end(reason) { log.push(`accompany.end:${reason}`); }
  };
  // Same wiring as main.js.
  social.onRelationshipChange((userId, state) => {
    if (!follow.isFollowing(userId) || state === Relationship.FRIENDS) return;
    follow.stop(state === Relationship.BLOCKED_BY_ME ? "BLOCKED" : "RELATIONSHIP");
  });
  social.onRelationshipChange((userId, state) => {
    if (accompany.peerId === userId && state !== Relationship.FRIENDS) void accompany.end("relationship");
  });
  const noop = () => {}, client = { setAccount: noop };
  const context = createContext({ online, social, follow, accompany, FollowStopReason: { OFFLINE: "OFFLINE" },
    lobbyPresenceSummary: { setFriends: (friends) => log.push(`setFriends:${friends === null ? "null" : friends.map((f) => f.userId).join(",")}`), update: noop },
    playerCard: { close: () => log.push("playerCard.close") },
    chatPanel: { refreshAvailability: noop, clearDraft: () => log.push("chatPanel.clearDraft") },
    friendPanel: { open: false, setAvailable: noop, setOpen: noop },
    photoMode: { close: noop }, guestbookPanel: { setAvailable: noop }, syncBiryongAccount: noop, progression: client,
    biryongRelationships: client, shop: client, wallet: client, jeongseok: client, jeongseokInterior: client, inventory: client,
    collectionBook: client, dailyQuiz: client, attendance: client, lifeSkillBook: client, fishing: client, loadout: client,
    inkyungSideEvent: { setScope: noop }, lastPersonalRoomUserId: null, roomSession: { stop: noop }, roomFurniture: { reset: noop },
    roomPhotoStory: { reset: noop }, roomFunctionAccountId: null, cookingFeature: { reset: noop }, inkyungWaterPath: { close: noop },
    trophyDisplayPanel: { close: noop }, trophyDisplay: { reset: noop }, rooms: { currentSpace: "CAMPUS", cancelPending: noop },
    personalRoomInteraction: { cancelOpen: noop }, personalRoom: { reset: noop }, npcAiSignedIn: false,
    mcmEvent: { setSignedIn: noop }, mcmEventPreviewMode: false, npcTest: { setAiSignedIn: noop }, profile: { setIdentity: noop },
    commissionTrials: { close: noop }, smartphone: { setAccount: noop }, lobbyPlayerSummary: { render: noop },
    nearbyPanel: { render: noop, setOpen: noop }, lobbyQuestHighlight: { update: noop }
  });
  runInContext(`function identityHandler(identity) {${body}\n}`, context);
  const signIn = (userId) => { online.userId = userId; context.identityHandler(userId ? { userId } : null); };
  return { log, fake, online, social, follow, accompany, signIn };
}

test("main.js sign-out ends Follow/Accompany as OFFLINE before social.reset, then clears social state", async () => {
  const h = identityHarness();
  h.signIn(A);
  h.fake.calls[0].resolve(listOf([X]));
  await flush();
  assert.equal(h.social.relationshipOf(X), Relationship.FRIENDS);
  h.follow.target = X;
  h.accompany.peerId = X;
  h.log.length = 0;
  h.signIn(null);
  assert.ok(h.log.includes("follow.stop:OFFLINE"), "an active Follow stops as OFFLINE, not RELATIONSHIP");
  assert.ok(!h.log.some((entry) => entry.startsWith("accompany.end")), "no accompany end() is sent on sign-out");
  const at = (entry) => h.log.indexOf(entry);
  assert.ok(at("accompany.reset") < at("social.reset") && at("follow.stop:OFFLINE") < at("social.reset"));
  assert.ok(at("social.reset") < h.log.lastIndexOf("setFriends:null"), "friends summary is unknown after the reset");
  for (const entry of ["chatPanel.clearDraft", "playerCard.close"]) assert.ok(h.log.includes(entry), entry);
  assert.equal(h.log.filter((entry) => entry === "social.reset").length, 1, "one reset per account change");
});

test("main.js: a late friends list for A never reaches the summary after B signs in", async () => {
  const h = identityHarness();
  h.signIn(A);
  const aLoad = h.fake.calls[0];
  h.signIn(null);
  h.signIn(B);
  const bLoad = h.fake.calls[1];
  h.log.length = 0;
  aLoad.resolve(listOf([X]));
  await flush();
  assert.deepEqual(h.log.filter((entry) => entry.startsWith("setFriends")), [], "A's late reply is dropped");
  assert.equal(h.social.relationshipOf(X), null);
  bLoad.resolve(listOf([Y]));
  await flush();
  assert.deepEqual(h.log.filter((entry) => entry.startsWith("setFriends")), [`setFriends:${Y}`]);
});

// Auth client whose getSession calls stay pending until the test answers them.
function pendingAuthLib() {
  const reads = [];
  let authHandler = null;
  const client = {
    auth: {
      getSession() { const d = deferred(); reads.push(d); return d.promise; },
      onAuthStateChange(handler) { authHandler = handler; return { data: { subscription: { unsubscribe() {} } } }; }
    },
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { nickname: "인덕" } }) }) }) }),
    rpc: async () => ({ data: null, error: null })
  };
  return { reads, client, emit: (event) => authHandler?.(event) };
}

function startOnline(auth, windowTarget = null, documentTarget = null) {
  const transports = [];
  const online = startWorldOnline({
    app: { on() {}, off() {} },
    places: { onPlaceZoneChanged: () => () => {}, getCurrentPlaceZone: () => null },
    player: { getLocalPosition: () => ({ x: 0, y: 0, z: 0 }) }, controller: {},
    createAvatar: () => ({}), hudElement: { textContent: "", dataset: {} },
    supabaseLib: {}, createClient: () => auth.client, createGuestClient: () => null,
    createTransport: (client, options) => { transports.push({ client, options }); throw new Error("no transport in this test"); },
    allowGuests: false, windowTarget, documentTarget
  });
  return { online, transports };
}

test("online: a session read still pending at stop() never opens a session afterwards", async () => {
  const auth = pendingAuthLib();
  const { online, transports } = startOnline(auth);
  assert.equal(auth.reads.length, 1);
  online.stop();
  auth.reads[0].resolve({ data: { session: { user: { id: A, is_anonymous: false } } } });
  await flush();
  assert.equal(transports.length, 0, "no Realtime transport created for A after stop");
  assert.equal(online.identity, null);
  await online.refreshAuth();
  assert.equal(auth.reads.length, 1, "a stopped instance never reads Auth again");
});

test("online: an older session read (A) resolving after a newer one (signed out) is discarded", async () => {
  const auth = pendingAuthLib();
  const { online, transports } = startOnline(auth);
  void online.refreshAuth(); // e.g. SIGNED_OUT → refresh while the first read is pending
  auth.reads[1].resolve({ data: { session: null } });
  await flush();
  auth.reads[0].resolve({ data: { session: { user: { id: A, is_anonymous: false } } } });
  await flush();
  assert.equal(transports.length, 0, "A's stale session never reconnects");
  assert.equal(online.identity, null);
  online.stop();
});

test("online: pagehide invalidates a pending session read", async () => {
  const auth = pendingAuthLib();
  const listeners = {};
  const windowTarget = { addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener() {} };
  const { online, transports } = startOnline(auth, windowTarget);
  listeners.pagehide();
  auth.reads[0].resolve({ data: { session: { user: { id: A, is_anonymous: false } } } });
  await flush();
  assert.equal(transports.length, 0);
  online.stop();
});

test("online: an auth event after pagehide opens nothing until a pageshow resumes", async () => {
  const auth = pendingAuthLib();
  const listeners = {};
  const windowTarget = { addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener() {} };
  const { online, transports } = startOnline(auth, windowTarget);
  auth.reads[0].resolve({ data: { session: null } });
  await flush();
  listeners.pagehide();
  auth.emit("SIGNED_IN");
  await new Promise((resolve) => setTimeout(resolve, 5));
  void online.refreshAuth();
  assert.equal(auth.reads.length, 1, "a suspended page never reads Auth or reconnects");
  listeners.pageshow({ persisted: true });
  assert.equal(auth.reads.length, 2, "pageshow(persisted) refreshes once");
  listeners.pageshow({ persisted: false });
  assert.equal(auth.reads.length, 2, "a second pageshow does not resume again");
  auth.reads[1].resolve({ data: { session: { user: { id: A, is_anonymous: false } } } });
  await flush();
  assert.equal(transports.length, 1, "the resumed page reconnects");
  online.stop();
});

test("online: a page shown again without a BFCache pageshow resumes once, never for a stale account", async () => {
  const auth = pendingAuthLib();
  const listeners = {};
  const windowTarget = { addEventListener: (type, fn) => { listeners[type] = fn; }, removeEventListener() {} };
  const documentTarget = {
    visibilityState: "visible",
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type, fn) => { if (listeners[type] === fn) delete listeners[type]; }
  };
  const { online, transports } = startOnline(auth, windowTarget, documentTarget);
  listeners.visibilitychange();
  assert.equal(auth.reads.length, 1, "visible while not suspended does nothing");
  // iOS-style tab/app switch: hidden + pagehide while A's read is still pending.
  documentTarget.visibilityState = "hidden";
  listeners.visibilitychange();
  listeners.pagehide();
  assert.equal(auth.reads.length, 1, "hidden never resumes");
  documentTarget.visibilityState = "visible";
  listeners.visibilitychange();
  assert.equal(auth.reads.length, 2, "visible again resumes with a fresh Auth read");
  listeners.visibilitychange();
  listeners.pageshow({ persisted: false });
  assert.equal(auth.reads.length, 2, "resumes only once");
  auth.reads[0].resolve({ data: { session: { user: { id: A, is_anonymous: false } } } });
  await flush();
  assert.equal(transports.length, 0, "A's pre-pagehide read never reconnects");
  auth.reads[1].resolve({ data: { session: { user: { id: B, is_anonymous: false } } } });
  await flush();
  assert.equal(transports.length, 1, "the resumed page reconnects for the current account");
  // Non-persisted pageshow after another pagehide also resumes.
  listeners.pagehide();
  listeners.pageshow({ persisted: false });
  assert.equal(auth.reads.length, 3, "pageshow without persisted resumes");
  // Never after stop().
  listeners.pagehide();
  const onVisible = listeners.visibilitychange;
  online.stop();
  assert.equal(listeners.visibilitychange, undefined, "stop() removes the visibility listener");
  onVisible();
  listeners.pageshow({ persisted: true });
  assert.equal(auth.reads.length, 3, "a stopped instance never resumes");
});

test("lobby friends summary: reset notifications and single events never claim a complete list", () => {
  const summary = createLobbyPresenceSummary({
    getOnline: () => ({ status: () => ({ signedIn: true, state: "ONLINE", count: 1 }), remoteByUser: () => null }),
    social: { available: true }
  });
  summary.applyRelationship(X, Relationship.FRIENDS);
  assert.equal(summary.status().totalFriends, null, "one relationship event before mine() is not the full list");
  summary.setFriends([{ userId: X }]);
  assert.equal(summary.status().totalFriends, 1);
  summary.setFriends(null);
  summary.applyRelationship(X, null); // what social.reset() announces
  assert.equal(summary.status().totalFriends, null, "after sign-out the count is unknown, not a confirmed 0");
});

function friendPanelFor(social, roomVisit = null) {
  const doc = createFakeDocument();
  const toggle = doc.createElement("button"), panel = doc.createElement("section");
  const ui = createFriendPanel({ toggle, panel, social, doc, roomVisit, timers: { setInterval: () => 1, clearInterval: () => {} } });
  return { ui, panel };
}

for (const late of ["success", "failure"]) test(`friend panel: A's delayed room-visit ${late} after switching to B changes nothing`, async () => {
  const fake = pendingRpcClient();
  const account = { id: A };
  const social = socialFor(fake, account);
  const visit = deferred();
  const roomVisit = { canVisit: () => ({ ok: true }), onVisit: () => visit.promise, reasonText: () => "A의 방 방문 실패" };
  const { ui, panel } = friendPanelFor(social, roomVisit);
  void ui.setOpen(true);
  fake.calls[0].resolve(listOf([X]));
  await flush();
  const row = panel.children.find((n) => n.dataset?.section === "friends").children[1];
  const visitButton = nodesOf(row).find((c) => c.textContent?.includes("방 방문"));
  assert.ok(visitButton, "visit button rendered");
  visitButton.click();
  void ui.setOpen(false);
  account.id = B; social.reset();
  void ui.setOpen(true);
  fake.calls.at(-1).resolve(listOf([Y]));
  await flush();
  visit.resolve(late === "success" ? { ok: true } : { ok: false, reason: "CLOSED" });
  await flush();
  assert.equal(ui.open, true, "A's result does not close B's panel");
  assert.doesNotMatch(JSON.stringify(nodesOf(panel).map((n) => n.textContent)), /A의 방 방문 실패/, "or show A's hint");
  assert.equal(ui.data.friends[0].userId, Y);
});

test("friend panel: a STALE mine() rejection inside refresh shows no error hint", async () => {
  const fake = pendingRpcClient();
  const account = { id: A };
  const social = socialFor(fake, account);
  const { ui, panel } = friendPanelFor(social);
  void ui.setOpen(true);
  fake.calls[0].resolve(listOf([X]));
  await flush();
  void ui.refresh(); // poll
  social.reset(); // e.g. same-account reconnect while the poll is in flight
  fake.calls[1].resolve(listOf([Y]));
  await flush();
  assert.equal(ui.open, true);
  assert.equal(ui.data.friends[0].userId, X, "the stale list is not rendered");
  assert.doesNotMatch(JSON.stringify(nodesOf(panel).map((n) => n.textContent)), /불러오지 못했어요|로그인이 필요해요/);
});
