import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { SocialClient } from "../src/social/social-client.js";

const moduleUrl = new URL("../src/social/social-account-session.js", import.meta.url);
const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const X = "c0000000-0000-4000-8000-000000000003";
const Y = "d0000000-0000-4000-8000-000000000004";

async function harness() {
  assert.equal(existsSync(moduleUrl), true, "the social identity lifecycle must be independently testable");
  const { createSocialAccountSession } = await import(moduleUrl);
  let account = A;
  const calls = [], friends = [], resets = [];
  const client = { rpc() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ resolve: ids => resolve({ data: { friends: ids.map(userId => ({ userId })), blocked: [] } }), reject });
    return promise;
  } };
  const social = new SocialClient({ getClient: () => client, getSelfUserId: () => account });
  const session = createSocialAccountSession({ social, onFriends: value => friends.push(value?.map(p => p.userId) ?? null), onAccountChange: () => resets.push(true) });
  return { social, session, calls, friends, resets, account: next => { account = next; } };
}

for (const late of ["success", "failure"]) test(`old-account ${late} cannot clear or replace the new lobby friend list`, async () => {
  const f = await harness();
  const old = f.session.setAccount(A);
  f.account(B);
  const current = f.session.setAccount(B);
  f.calls[1].resolve([Y]);
  assert.equal(await current, true);
  assert.deepEqual(f.friends.at(-1), [Y]);
  const events = f.friends.length;
  if (late === "success") f.calls[0].resolve([X]);
  else f.calls[0].reject(new Error("synthetic offline"));
  assert.equal(await old, false);
  assert.equal(f.friends.length, events);
  assert.equal(f.resets.length, 1);
});

test("logout clears the lobby after reset listeners and ignores all pending reads", async () => {
  const f = await harness();
  const seed = f.session.setAccount(A);
  f.calls[0].resolve([X]); await seed;
  f.social.onRelationshipChange(() => f.friends.push(["reset-listener"]));
  const old = f.session.setAccount(A);
  await f.session.setAccount(null); // deliberately retain stale A getter like world-online
  assert.equal(f.social.available, false);
  assert.equal(f.friends.at(-1), null);
  const count = f.friends.length;
  f.calls[1].resolve([X]);
  assert.equal(await old, false);
  assert.equal(f.friends.length, count);
});

test("A→B→A applies only the new A refresh and current failures clear its summary", async () => {
  const f = await harness();
  const old = f.session.setAccount(A);
  f.account(B); const middle = f.session.setAccount(B);
  f.account(A); const newest = f.session.setAccount(A);
  f.calls[2].resolve([Y]); await newest;
  f.calls[0].resolve([X]); f.calls[1].resolve([X]);
  assert.deepEqual(await Promise.all([old, middle]), [false, false]);
  assert.deepEqual(f.friends.at(-1), [Y]);
  const failure = f.session.setAccount(A);
  f.calls[3].reject(new Error("synthetic offline"));
  assert.equal(await failure, false);
  assert.equal(f.friends.at(-1), null);
});

test("disposal prevents pending callbacks and later account events from publishing", async () => {
  const f = await harness();
  const old = f.session.setAccount(A);
  f.session.dispose();
  const count = f.friends.length;
  f.calls[0].resolve([X]);
  assert.equal(await old, false);
  assert.equal(await f.session.setAccount(B), false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.friends.length, count);
  assert.equal(f.social.available, false);
});

test("main wires the callback identity and owns only one social list loader", () => {
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  assert.match(source, /socialAccountSession\.setAccount\(identity\?\.userId \?\? null\)/);
  assert.doesNotMatch(source, /social\.mine\(/, "all identity list completions use the fenced lifecycle");
  assert.match(source, /if \(!event\.persisted\) socialAccountSession\.dispose\(\)/);
});

test("main tears down relationship consumers before social logout emits cache removals", async () => {
  const { AccompanyClient } = await import("../src/social/accompany-client.js");
  const { AccompanyController } = await import("../src/social/accompany-controller.js");
  const { createSocialAccountSession } = await import(moduleUrl);
  const calls = [];
  const client = { async rpc(name, args) { calls.push({ name, args }); return { data: { friends: [{ userId: X }] }, error: null }; } };
  const social = new SocialClient({ getClient: () => client, getSelfUserId: () => A });
  const socialAccountSession = createSocialAccountSession({ social });
  await socialAccountSession.setAccount(A);
  const accompany = new AccompanyController({
    client: new AccompanyClient({ getClient: () => client, getSelfUserId: () => A }),
    getSelfUserId: () => A, follow: { isFollowing: () => false }, navigation: { snapshot: () => null }
  });
  accompany.session = { id: "e0000000-0000-4000-8000-000000000005", peerId: X, state: "active" };
  // Exact production relationship listener: resetting caches must never accidentally end a trip on the server.
  social.onRelationshipChange((userId, state) => {
    if (accompany.peerId === userId && state !== "friends") void accompany.end("relationship");
  });
  let roomStopped = false;
  const roomStopObservations = [];
  social.onRelationshipChange(() => roomStopObservations.push(roomStopped));
  const source = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const callback = source.slice(source.indexOf("online.onIdentity((identity) => {"), source.indexOf("online.chat.feed.onChange"));
  // Execute the three actual logout teardown calls in their source order. The other branches
  // are independent UI/account clients; on null, the room-session stop condition is always true.
  const order = [...callback.matchAll(/socialAccountSession\.setAccount\(identity\?\.userId \?\? null\)|accompany\.reset\(\)|roomSession\?\.stop\(\)/g)].map(match => match[0]);
  assert.equal(order.length, 3);
  calls.length = 0;
  for (const call of order) {
    if (call.startsWith("socialAccountSession")) await socialAccountSession.setAccount(null);
    else if (call.startsWith("accompany")) accompany.reset();
    else roomStopped = true;
  }
  assert.deepEqual(calls, [], "logout must not send end_world_accompany or any other RPC");
  assert.deepEqual(roomStopObservations, [true], "room session stopped before cache notifications");
  assert.equal(social.available, false, "explicit null wins while the online getter still reports A");
});

for (const late of ["success", "failure"]) test(`reopened B friend panel ignores A's late mutation ${late}`, async () => {
  const { createFriendPanel } = await import("../src/social/friend-panel.js");
  const { createFakeDocument } = await import("./support/fake-dom.mjs");
  const { createSocialAccountSession } = await import(moduleUrl);
  const f = await harness();
  const doc = createFakeDocument(), panel = doc.createElement("section"), toggle = doc.createElement("button");
  const notifications = [];
  const ui = createFriendPanel({ panel, toggle, social: f.social, doc, timers: {}, onRelationshipChange: (...args) => notifications.push(args) });
  const lifecycle = createSocialAccountSession({ social: f.social, onAccountChange: () => { if (ui.open) void ui.setOpen(false); } });
  const login = lifecycle.setAccount(A); f.calls[0].resolve([X]); await login;
  const firstOpen = ui.setOpen(true); f.calls[1].resolve([X]); await firstOpen;
  const nodes = root => [root, ...root.children.flatMap(nodes)];
  nodes(panel).find(node => node.textContent === "친구 삭제").click();
  assert.equal(f.calls.length, 3);
  f.account(B);
  const next = lifecycle.setAccount(B); f.calls[3].resolve([Y]); await next;
  const reopened = ui.setOpen(true); f.calls[4].resolve([Y]); await reopened;
  if (late === "success") f.calls[2].resolve([]);
  else f.calls[2].reject(new Error("synthetic offline"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 5, "old action cannot trigger a new B list request");
  assert.deepEqual(ui.data.friends.map(person => person.userId), [Y]);
  assert.deepEqual(notifications, []);
  assert.equal(nodes(panel).some(node => node.className === "friend-hint"), false);
});

test("current-account friend panel mutation failures still show an error and refresh", async () => {
  const { createFriendPanel } = await import("../src/social/friend-panel.js");
  const { createFakeDocument } = await import("./support/fake-dom.mjs");
  const f = await harness();
  const doc = createFakeDocument(), panel = doc.createElement("section");
  const ui = createFriendPanel({ panel, toggle: doc.createElement("button"), social: f.social, doc, timers: {} });
  const pending = ui.setOpen(true); f.calls[0].resolve([X]); await pending;
  const nodes = root => [root, ...root.children.flatMap(nodes)];
  nodes(panel).find(node => node.textContent === "친구 삭제").click();
  f.calls[1].reject(new Error("synthetic offline"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.length, 3, "a current error refreshes the active panel");
  f.calls[2].resolve([X]);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nodes(panel).some(node => node.className === "friend-hint" && node.textContent === "잠시 후 다시 시도해 주세요."), true);
});

test("closing the old account panel clears its cached list and visible error", async () => {
  const { createFriendPanel } = await import("../src/social/friend-panel.js");
  const { createFakeDocument } = await import("./support/fake-dom.mjs");
  const f = await harness();
  const doc = createFakeDocument(), panel = doc.createElement("section");
  const ui = createFriendPanel({ panel, toggle: doc.createElement("button"), social: f.social, doc, timers: {} });
  const nodes = root => [root, ...root.children.flatMap(nodes)];
  const opened = ui.setOpen(true); f.calls[0].resolve([X]); await opened;
  nodes(panel).find(node => node.textContent === "친구 삭제").click();
  f.calls[1].reject(new Error("synthetic offline"));
  await new Promise(resolve => setImmediate(resolve));
  f.calls[2].resolve([X]);
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(nodes(panel).some(node => node.className === "friend-hint"));
  await ui.setOpen(false);
  assert.equal(ui.data, null, "a closed account's list is no longer retained by the UI");
  f.account(B); f.social.setAccount(B);
  const reopened = ui.setOpen(true); f.calls[3].resolve([Y]); await reopened;
  assert.equal(nodes(panel).some(node => node.className === "friend-hint"), false, "A's error is not shown to B");
});
