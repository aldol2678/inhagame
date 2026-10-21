import test from "node:test";
import assert from "node:assert/strict";
import { createLobbyPresenceSummary } from "../src/lobby/lobby-presence-summary.js";
import { Relationship } from "../src/social/social-client.js";
import { createRealtimeWorld, createWorldClient, runWorld } from "./support/online-world-harness.mjs";

function fixture() {
  const current = { signedIn: true, state: "CONNECTING", count: 0 };
  const remotes = new Map();
  const social = { available: true };
  const friendsButton = { textContent: "", disabled: false, addEventListener() {}, setAttribute() {} };
  const population = { state: "READY", snapshot: { online: 7 } };
  let reads = 0;
  const online = {
    status: () => current,
    remoteByUser(userId) { reads++; return remotes.get(userId) ?? null; }
  };
  const summary = createLobbyPresenceSummary({
    friendsButton, getOnline: () => online, getPopulation: () => population, social
  });
  summary.setFriends([{ userId: "friend-a" }]);
  return { current, remotes, social, friendsButton, population, online, summary, reads: () => reads };
}

for (const [state, text] of [
  ["CONNECTING", "친구 상태 연결 중…"],
  ["RECONNECTING", "친구 상태 재연결 중…"],
  ["OFFLINE", "친구 상태 오프라인"],
  ["UNKNOWN", "친구 상태 알 수 없음"]
]) {
  test(`${state} never claims zero or stale same-zone friends`, () => {
    const f = fixture();
    f.current.state = state;
    f.current.count = 0;
    f.remotes.set("friend-a", { userId: "friend-a", presence: "present" });
    const reads = f.reads();
    const next = f.summary.update();
    assert.equal(next.sameZoneFriends, null);
    assert.equal(next.zoneCount, null);
    assert.equal(next.friendsText, text);
    assert.equal(f.friendsButton.textContent, text);
    assert.equal(f.friendsButton.disabled, false, "the friend panel remains usable for members");
    assert.equal(f.reads(), reads, "unconfirmed presence is never queried for a count");
    assert.equal(next.worldCount, 7, "independent READY global population stays visible");
  });
}

test("unknown → online zero → online N → reconnect → fresh counts", () => {
  const f = fixture();
  assert.equal(f.summary.status().sameZoneFriends, null);
  Object.assign(f.current, { state: "ONLINE", count: 0 });
  assert.equal(f.summary.update().sameZoneFriends, 0);
  assert.equal(f.summary.status().zoneCount, 0);
  assert.equal(f.friendsButton.textContent, "같은 구역 0명 · 친구 1명");
  Object.assign(f.current, { count: 2 });
  f.remotes.set("friend-a", { userId: "friend-a", presence: "present" });
  assert.equal(f.summary.update().sameZoneFriends, 1);
  Object.assign(f.current, { state: "RECONNECTING", count: 0 });
  assert.equal(f.summary.update().sameZoneFriends, null);
  f.remotes.clear();
  Object.assign(f.current, { state: "ONLINE", count: 1 });
  assert.equal(f.summary.update().sameZoneFriends, 0);
  assert.equal(f.summary.status().zoneCount, 1);
});

test("a synced online connection still needs a complete friend list", () => {
  const f = fixture();
  Object.assign(f.current, { state: "ONLINE", count: 1 });
  f.summary.setFriends(null);
  assert.equal(f.summary.status().sameZoneFriends, null);
  assert.equal(f.summary.status().totalFriends, null);
  assert.equal(f.friendsButton.textContent, "친구 상태 불러오는 중…");
  f.summary.applyRelationship("friend-a", Relationship.FRIENDS);
  assert.equal(f.summary.status().totalFriends, null, "one relationship cannot establish a whole list");
  f.summary.setFriends([]);
  assert.equal(f.summary.status().sameZoneFriends, 0);
  assert.equal(f.summary.status().totalFriends, 0);
});

test("logout reset events cannot convert an unknown friend list into known zero", () => {
  const f = fixture();
  Object.assign(f.current, { state: "ONLINE", count: 2 });
  f.summary.setFriends(null);
  f.summary.applyRelationship("friend-a", null);
  assert.equal(f.summary.status().totalFriends, null);
  assert.equal(f.summary.status().sameZoneFriends, null);
  f.current.signedIn = false;
  f.social.available = false;
  assert.equal(f.summary.update().friendsText, "로그인하면 친구 상태 확인");
  assert.equal(f.summary.status().sameZoneFriends, null);
  assert.equal(f.friendsButton.disabled, true);
  f.current.signedIn = true;
  f.social.available = true;
  assert.equal(f.summary.update().totalFriends, null, "new account stays unknown before its own list");
  f.summary.setFriends([{ userId: "friend-b" }]);
  f.remotes.set("friend-a", { userId: "friend-a", presence: "present" });
  assert.equal(f.summary.update().sameZoneFriends, 0, "old account friends cannot contribute");
});

test("blocked, unavailable, and removed relationships never remain in friend counts", () => {
  const f = fixture();
  Object.assign(f.current, { state: "ONLINE", count: 2 });
  f.remotes.set("friend-a", { userId: "friend-a", presence: "present" });
  for (const state of [Relationship.BLOCKED_BY_ME, Relationship.UNAVAILABLE, Relationship.NONE]) {
    f.summary.setFriends([{ userId: "friend-a" }]);
    assert.equal(f.summary.status().sameZoneFriends, 1);
    f.summary.applyRelationship("friend-a", state);
    assert.equal(f.summary.status().sameZoneFriends, 0);
    assert.equal(f.summary.status().totalFriends, 0);
  }
});

test("presence getter failure is unknown instead of a partial or zero count", () => {
  const f = fixture();
  Object.assign(f.current, { state: "ONLINE", count: 2 });
  f.online.remoteByUser = () => { throw new Error("unavailable"); };
  const next = f.summary.update();
  assert.equal(next.sameZoneFriends, null);
  assert.equal(next.friendsText, "친구 상태 알 수 없음");
  assert.equal(next.degraded, true);
});

test("missing and stale remote samples are not confirmed presence data", () => {
  const f = fixture();
  Object.assign(f.current, { state: "ONLINE", count: 2 });
  for (const presence of ["suspect", undefined]) {
    f.remotes.set("friend-a", { userId: "friend-a", presence });
    assert.equal(f.summary.update().sameZoneFriends, null);
    assert.equal(f.friendsButton.textContent, "친구 상태 알 수 없음");
  }
  delete f.online.remoteByUser;
  assert.equal(f.summary.update().sameZoneFriends, null);
});

test("invalid online counts remain unknown instead of being coerced into zero", () => {
  const f = fixture();
  f.current.state = "ONLINE";
  for (const count of [undefined, null, "0", NaN, Infinity, -1, 1.5]) {
    f.current.count = count;
    assert.equal(f.summary.update().zoneCount, null, String(count));
    assert.equal(f.summary.status().sameZoneFriends, null, String(count));
    assert.equal(f.friendsButton.textContent, "친구 상태 알 수 없음");
  }
});

test("global population validates its own READY data without inventing zero", () => {
  const f = fixture();
  for (const online of [undefined, null, "0", NaN, Infinity, -1, 1.5]) {
    f.population.snapshot.online = online;
    assert.equal(f.summary.update().worldCount, null, String(online));
    assert.equal(f.summary.status().worldText, "전체 접속 —");
  }
  f.population.snapshot.online = 0;
  assert.equal(f.summary.update().worldText, "전체 접속 0명");
  f.population.state = "UNAVAILABLE";
  assert.equal(f.summary.update().worldCount, null, "last READY zero becomes unknown after failure");
});

test("missing or unsupported connection state is explicit UNKNOWN", () => {
  const f = fixture();
  for (const state of [undefined, null, "INVALID"]) {
    f.current.state = state;
    assert.equal(f.summary.update().networkState, "UNKNOWN");
    assert.equal(f.friendsButton.textContent, "친구 상태 알 수 없음");
  }
});

test("real world-online sync/reconnect contract controls the display without live services", async () => {
  const world = createRealtimeWorld();
  const a = createWorldClient(world, { label: "A" });
  const b = createWorldClient(world, { label: "B" });
  const summary = createLobbyPresenceSummary({ getOnline: () => a.online, social: { available: true } });
  summary.setFriends([{ userId: "user-b" }]);
  await runWorld(world, 600);
  assert.equal(a.online.status().state, "ONLINE");
  assert.equal(summary.status().sameZoneFriends, 1);
  const aClient = a.online.transport.client;
  world.server.dropClient(aClient);
  await runWorld(world, 300);
  assert.equal(a.online.status().state, "RECONNECTING");
  assert.equal(summary.status().sameZoneFriends, null);
  assert.equal(summary.status().zoneCount, null);
  b.online.stop();
  b.active = false;
  world.server.restoreClient(aClient);
  await runWorld(world, 2500);
  assert.equal(a.online.status().state, "ONLINE");
  assert.equal(summary.status().sameZoneFriends, 0);
  assert.equal(summary.status().zoneCount, 1);
  a.online.stop();
});
