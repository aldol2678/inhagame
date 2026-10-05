// Social S1-C1 · Player Inspect, friends, block, report (client side).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MAIN_ENTRANCE } from "../src/basic-campus.js";
import { POSE_FIELDS, PRESENCE_FIELDS } from "../src/network/protocol.js";
import { Relationship, SocialClient, SocialError, parseCard } from "../src/social/social-client.js";
import { createPlayerCard } from "../src/social/player-card.js";
import { createFriendPanel } from "../src/social/friend-panel.js";
import { ChatFeed } from "../src/online/local-chat.js";
import { FakeSocialServer } from "./support/fake-social-server.mjs";
import { createFakeDocument } from "./support/fake-dom.mjs";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const code = (path) => read(path).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
const A = "a0000000-0000-4000-8000-0000000000a1";
const B = "b0000000-0000-4000-8000-0000000000b2";
const B2 = "b2000000-0000-4000-8000-0000000000b2"; // same nickname as B
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const server = new FakeSocialServer([
    { userId: A, nickname: "앨리스", title: "인덕 탐험가", avatar: "explorer" },
    { userId: B, nickname: "밥", avatar: "star", inhaVerified: true },
    { userId: B2, nickname: "밥" }
  ]);
  const clientFor = (me) => new SocialClient({ getClient: () => server.clientFor(me), getSelfUserId: () => me });
  return { server, a: clientFor(A), b: clientFor(B) };
}

function cardFixture(social, remotes, onMessage = null) {
  const doc = createFakeDocument();
  const panel = doc.createElement("section");
  panel.hidden = true;
  const card = createPlayerCard({ panel, social, doc, getSelfUserId: () => social.getSelfUserId(),
    getRemote: (sid) => remotes[sid] ?? null, getPlaceZoneId: () => "AREA_INKYUNG_STUDENT_CENTER", onMessage });
  const texts = () => {
    const out = [];
    const walk = (n) => { if (n.textContent) out.push(n.textContent); n.children.forEach(walk); };
    walk(panel);
    return out;
  };
  const buttons = () => {
    const out = [];
    const walk = (n) => { if (n.tagName === "BUTTON") out.push(n); n.children.forEach(walk); };
    walk(panel);
    return out;
  };
  const press = async (label) => { buttons().find((b) => b.textContent === label).click(); await flush(); await flush(); };
  return { doc, panel, card, texts, buttons, press, labels: () => buttons().map((b) => b.textContent) };
}

test("1–6. inspect opens with safe fields only; self never; identity is the Presence user id", async () => {
  const { server, a } = setup();
  const f = cardFixture(a, { "s-b": { userId: B, displayName: "밥" }, "s-b2": { userId: B2, displayName: "밥" }, "s-me": { userId: A, displayName: "앨리스" } });
  assert.equal(await f.card.open("s-me"), false, "self is not inspectable");
  assert.equal(f.panel.hidden, true);
  assert.equal(await f.card.open("s-b2"), true);
  assert.equal(f.panel.hidden, false);
  assert.equal(server.calls.at(-1).args.p_target, B2, "second 밥 is its own user id");
  await f.card.open("s-b");
  assert.equal(server.calls.at(-1).args.p_target, B, "same nickname, different target");
  assert.equal(f.card.current.userId, B);
  assert.equal(f.card.current.card.inhaVerified, true, "safe Inha verification flag is available");
  assert.match(f.texts().join(" | "), /✓ 인하대/, "verified badge is rendered on the card");
  const text = f.texts().join(" | ");
  assert.match(text, /밥/);
  assert.doesNotMatch(text, /leak@example|비공개|2020-01-01/, "private fields never rendered");
  assert.deepEqual(Object.keys(parseCard({ ...server.card(B), available: true, relationship: "none" })).sort(),
    ["available", "avatar", "inhaVerified", "nickname", "relationship", "title", "userId"]);
  // DOM text is never a target: renaming the node changes nothing.
  f.panel.children.forEach((n) => { n.textContent = "관리자"; });
  await f.press("+ 친구 요청").catch(() => {});
  assert.ok(server.calls.every((c) => c.args.p_target === undefined || [B, B2].includes(c.args.p_target)));
});

test("guestbook-style user-id open works even when the author is offline", async () => {
  const { server, a } = setup();
  const f = cardFixture(a, {});
  assert.equal(await f.card.openUser(B, "밥"), true);
  assert.equal(f.card.current.sessionId, null);
  assert.equal(f.card.current.userId, B);
  assert.equal(server.calls.at(-1).name, "get_world_public_profile");
  assert.equal(server.calls.at(-1).args.p_target, B);
  assert.match(f.texts().join(" | "), /밥/);
  assert.match(f.texts().join(" | "), /✓ 인하대/);
});

test("player card message action hands off the trusted user id and disappears when blocked", async () => {
  const { a } = setup();
  const targets = [];
  const f = cardFixture(a, { "s-b": { userId: B, displayName: "밥" } }, (userId) => { targets.push(userId); return true; });
  await f.card.open("s-b");
  assert.ok(f.labels().includes("✉ 쪽지 보내기"));
  await f.press("✉ 쪽지 보내기");
  assert.deepEqual(targets, [B], "message handoff uses the server-resolved card user id");
  await f.press("차단");
  assert.ok(!f.labels().includes("✉ 쪽지 보내기"), "blocked targets have no message action");
});

test("7–11, 12–19. card actions follow the DB state machine end to end", async () => {
  const { server, a, b } = setup();
  const fa = cardFixture(a, { "s-b": { userId: B, displayName: "밥" } });
  const fb = cardFixture(b, { "s-a": { userId: A, displayName: "앨리스" } });
  await fa.card.open("s-b");
  assert.deepEqual(fa.labels().filter((l) => l !== "×"), ["+ 친구 요청", "차단", "신고"], "NONE");
  await fa.press("+ 친구 요청");
  assert.deepEqual(fa.labels().filter((l) => l !== "×"), ["요청 취소", "차단", "신고"], "OUTGOING");
  await fb.card.open("s-a");
  assert.deepEqual(fb.labels().filter((l) => l !== "×"), ["수락", "거절", "차단", "신고"], "INCOMING");
  await fb.press("거절");
  assert.equal(server.relationship(A, B), "none", "reject → NONE");
  await fa.card.open("s-b");
  await fa.press("+ 친구 요청");
  await fa.press("요청 취소");
  assert.equal(server.relationship(A, B), "none", "cancel → NONE");
  await fa.press("+ 친구 요청");
  await fb.card.open("s-a");
  await fb.press("수락");
  assert.deepEqual(fb.labels().filter((l) => l !== "×"), ["👣 친구 따라가기", "친구 삭제", "차단", "신고"], "ACCEPTED (S1-C2 follow remains available)");
  assert.equal(server.relationship(A, B), "friends");
  await fa.card.open("s-b");
  await fa.press("친구 삭제");
  assert.equal(server.relationship(A, B), "none", "remove → NONE");
  await fa.press("차단");
  assert.deepEqual(fa.labels().filter((l) => l !== "×"), ["차단 해제", "신고"], "BLOCKED_BY_ME");
  assert.equal(a.isBlocked(B), true);
  await fb.card.open("s-a");
  assert.deepEqual(fb.labels().filter((l) => l !== "×"), ["차단", "신고"], "blocked side: generic unavailable, no friend button");
  assert.ok(fb.texts().includes("지금은 이 사용자와 상호작용할 수 없어요."), "generic unavailable state");
  assert.ok(!fb.texts().some((t) => /차단(했|당|한 사용자)/.test(t)), "never tells B they were blocked");
  assert.equal(fb.texts().includes("앨리스"), true, "only the Presence display name, no card details");
  assert.equal(fb.texts().includes("인덕 탐험가"), false, "no title from the card when unavailable");
  await fa.press("차단 해제");
  assert.equal(server.relationship(A, B), "none", "unblock → NONE, not friends");
  assert.equal(a.isBlocked(B), false);
});

test("13. double clicks share one request", async () => {
  const { server, a } = setup();
  const before = server.calls.length;
  const [x, y] = await Promise.all([a.request(B), a.request(B)]);
  assert.deepEqual([x, y], ["outgoing", "outgoing"]);
  assert.equal(server.calls.length - before, 1);
});

test("20–21. a block hides that user's chat: incoming suppressed, current entries and bubbles cleared", async () => {
  const { a } = setup();
  const clock = { t: 0, now() { return this.t; } };
  const feed = new ChatFeed({ clock, moderation: { check: () => ({ ok: true }), isBlocked: (id) => a.isBlocked(id) } });
  feed.setPlaceZone("AREA_INKYUNG_STUDENT_CENTER");
  const bob = { sessionId: "s-b", userId: B, displayName: "밥", placeZoneId: "AREA_INKYUNG_STUDENT_CENTER" };
  const here = { x: 0, y: 1.15, z: 0 };
  feed.receive({ sender: bob, placeZoneId: "AREA_INKYUNG_STUDENT_CENTER", text: "안녕", position: here, receiverPosition: here });
  assert.equal(feed.bubbleFor("s-b"), "안녕");
  a.onBlockedChange((id, blocked) => { if (blocked) feed.removeSender(id); });
  await a.block(B);
  assert.equal(feed.entries.length, 0, "existing entries removed");
  assert.equal(feed.bubbleFor("s-b"), null, "bubble cleared at once");
  assert.equal(feed.receive({ sender: bob, placeZoneId: "AREA_INKYUNG_STUDENT_CENTER", text: "또 왔어", position: here, receiverPosition: here }), "blocked");
  assert.equal(feed.entries.length, 0);
  // The live wiring uses the same two hooks.
  const main = code("../src/main.js");
  assert.match(main, /isBlocked: \(userId\) => social\.isBlocked\(userId\)/);
  assert.match(main, /social\.onBlockedChange\(\(userId, blocked\) => \{\s*if \(blocked\) online\?\.chat\.removeSender\(userId\);\s*nearbyPanel\.render\(\);\s*\}\)/);
  assert.match(code("../src/online/world-online.js"), /removeSender\(userId\) \{ chatFeed\.removeSender\(userId\); \}/);
});

test("22–23. reports are structured: allowlisted category, semantic zone, never chat text", async () => {
  const { server, a } = setup();
  const f = cardFixture(a, { "s-b": { userId: B, displayName: "밥" } });
  await f.card.open("s-b");
  await f.press("신고");
  assert.deepEqual(f.labels().slice(-4), ["스팸", "괴롭힘", "부적절한 닉네임", "기타"]);
  await f.press("괴롭힘");
  const call = server.calls.find((c) => c.name === "report_world_user");
  assert.deepEqual(Object.keys(call.args).sort(), ["p_category", "p_place_zone_id", "p_target"], "no text field at all");
  assert.deepEqual(call.args, { p_target: B, p_category: "harassment", p_place_zone_id: "AREA_INKYUNG_STUDENT_CENTER" });
  assert.match(f.texts().join(" "), /신고가 접수됐어요/);
  await assert.rejects(() => a.report(B, "rude"), (e) => e instanceof SocialError && e.code === "INVALID_CATEGORY");
});

test("moderation restriction is a first-class social error", async () => {
  const client = new SocialClient({
    getSelfUserId: () => A,
    getClient: () => ({ rpc: async () => ({ data: null, error: { message: "SOCIAL_RESTRICTED" } }) })
  });
  await assert.rejects(() => client.profile(B), (error) =>
    error instanceof SocialError && error.code === "SOCIAL_RESTRICTED");
});

test("24. guests have no social layer and write nothing", async () => {
  const server = new FakeSocialServer([{ userId: B, nickname: "밥" }]);
  const guest = new SocialClient({ getClient: () => null, getSelfUserId: () => null });
  assert.equal(guest.available, false);
  await assert.rejects(() => guest.request(B), (e) => e.code === "SIGNED_OUT");
  const f = cardFixture(guest, { "s-b": { userId: B, displayName: "밥" } });
  assert.equal(await f.card.open("s-b"), false, "no card for guests");
  assert.equal(server.calls.length, 0);
  await assert.rejects(() => new SocialClient({ getClient: () => server.clientFor(A), getSelfUserId: () => A }).request("밥"),
    (e) => e.code === "TARGET_UNAVAILABLE", "a nickname is never a target");
  assert.equal(server.calls.length, 0, "a nickname never even reaches an RPC");
});

test("25–27. Esc and outside taps close the card; nameplate taps do not; canvas drags never open it", async () => {
  const { a } = setup();
  const f = cardFixture(a, { "s-b": { userId: B, displayName: "밥" } });
  await f.card.open("s-b");
  f.doc.dispatch("keydown", { code: "Escape" });
  assert.equal(f.panel.hidden, true, "Esc closes");
  await f.card.open("s-b");
  const plate = f.doc.createElement("div");
  plate.closest = (sel) => (sel === ".remote-nameplate" ? plate : null);
  f.doc.dispatch("pointerdown", { target: plate });
  assert.equal(f.panel.hidden, false, "tapping another nameplate keeps the card");
  f.doc.dispatch("pointerdown", { target: f.doc.createElement("canvas") });
  assert.equal(f.panel.hidden, true, "outside tap closes");
  // Opening is only wired to the nameplate click; the canvas camera handlers never call it.
  const avatar = code("../src/online/remote-avatar.js");
  assert.match(avatar, /plate\.addEventListener\("click"[^\n]*onInspect/);
  assert.match(avatar, /plate\.addEventListener\("pointerdown", \(event\) => event\.stopPropagation\(\)\)/, "a tap on the plate never starts a camera drag");
  assert.doesNotMatch(code("../src/orbit-camera-controller.js"), /onInspect|playerCard/);
  assert.match(code("../src/main.js"), /onInspect: \(sessionId\) => \{ if \(!chatPanel\.open\)/, "no inspect while typing chat");
});

test("28. mobile: card and panel fit a 375 px screen", () => {
  const css = read("../styles.css");
  assert.match(css, /\.player-card \{[^}]*width: min\(300px, calc\(100vw - 32px\)\)/);
  assert.match(css, /\.player-card \{[^}]*max-height: calc\(100dvh - 140px\); overflow: auto/);
  assert.match(css, /\.friend-panel \{ max-height: calc\(100dvh - 48px\); overflow: auto; \}/);
  assert.match(css, /\.player-card button:not\(\.player-card-close\), \.friend-row button \{\s*min-height: 40px/);
});

test("29–30. friend panel sections, actions and refresh after every mutation", async () => {
  const { server, a, b } = setup();
  await a.request(B);
  const doc = createFakeDocument();
  const toggle = doc.createElement("button"), panel = doc.createElement("section");
  const timers = { setInterval: () => 1, clearInterval: () => {} };
  const ui = createFriendPanel({ toggle, panel, social: b, doc, timers });
  await ui.setOpen(true);
  const sections = () => panel.children.filter((n) => n.dataset?.section).map((n) => [n.dataset.section, n.children[0].textContent]);
  assert.deepEqual(sections(), [["incoming", "받은 요청 1"], ["friends", "친구 0"], ["outgoing", "보낸 요청 0"]]);
  const loads = () => server.calls.filter((c) => c.me === B && c.name === "get_my_world_social").length;
  const before = loads();
  const incoming = panel.children.find((n) => n.dataset?.section === "incoming");
  incoming.children[1].children.find((c) => c.textContent === "수락").click();
  await flush(); await flush(); await flush();
  assert.ok(loads() > before, "refreshed after the mutation");
  assert.deepEqual(sections(), [["incoming", "받은 요청 0"], ["friends", "친구 1"], ["outgoing", "보낸 요청 0"]]);
  assert.equal(server.relationship(A, B), "friends");
  const aList = await a.mine();
  assert.deepEqual(aList.friends.map((f) => f.nickname), ["밥"], "both lists agree");
  doc.dispatch("keydown", { code: "Escape" });
  assert.equal(ui.open, false);
  ui.setAvailable(false);
  assert.equal(toggle.hidden, true, "no friends button for guests");
});

test("31. friendship never rides the realtime packets", async () => {
  assert.deepEqual([...POSE_FIELDS], ["v", "seq", "x", "y", "z", "yaw", "vx", "vz", "anim"]);
  assert.deepEqual([...PRESENCE_FIELDS], ["v", "sessionId", "userId", "displayName", "placeZoneId", "joinedAt"]);
  for (const file of ["../src/network/protocol.js", "../src/network/network-manager.js", "../src/network/supabase-realtime-transport.js"]) {
    assert.doesNotMatch(code(file), /friend|relationship|block_world|social/i, file);
  }
  const world = createRealtimeWorld();
  const x = createWorldClient(world, { label: "X", at: MAIN_ENTRANCE });
  createWorldClient(world, { label: "Y", at: MAIN_ENTRANCE });
  await runWorld(world, 700);
  assert.ok(world.server.wire.every((w) => !/friend|relationship|blocked/i.test(JSON.stringify(w.payload))));
  const remote = x.online.remotePlayer(x.online.status().remotes[0].sessionId);
  assert.deepEqual(Object.keys(remote).sort(), ["displayName", "placeZoneId", "sessionId", "userId"], "inspect identity from Presence");
});

test("32. profile editing stays in /profile; the card is read-only", () => {
  const card = code("../src/social/player-card.js");
  assert.doesNotMatch(card, /<input|createElement\("input"\)|createElement\("form"\)|update\(|from\("profiles"\)/);
  assert.doesNotMatch(code("../src/social/social-client.js"), /\.from\(|\.upsert\(|\.insert\(\{/, "only RPCs, no table access");
  assert.match(read("../campus/index.html"), /<section id="player-card" class="player-card"[^>]*hidden><\/section>/);
});
