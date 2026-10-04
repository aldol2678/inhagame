import test from "node:test";
import assert from "node:assert/strict";
import { Relationship, SocialClient, SocialError } from "../src/social/social-client.js";

// Synthetic accounts only. Each queued response is controlled independently of the next login.
const A = "a0000000-0000-4000-8000-000000000001";
const B = "b0000000-0000-4000-8000-000000000002";
const X = "c0000000-0000-4000-8000-000000000003";
const Y = "d0000000-0000-4000-8000-000000000004";
const person = userId => ({ userId, nickname: "fixture" });
const list = (friends = [], blocked = []) => ({ friends: friends.map(person), blocked: blocked.map(person), incoming: [], outgoing: [] });
const ok = data => ({ data, error: null });
const stale = error => error instanceof SocialError && error.code === "STALE";

function harness() {
  let account = A;
  const calls = [];
  const clients = new Map([A, B].map(id => [id, { rpc(name, args) {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    calls.push({ account: id, name, args, resolve: data => resolve(ok(data)), fail: message => resolve({ data: null, error: { message } }), reject });
    return promise;
  } }]));
  const social = new SocialClient({ getClient: () => clients.get(account) ?? null, getSelfUserId: () => account });
  return { social, calls, account: next => { account = next; } };
}

async function seed(f, friends = [], blocked = []) {
  const pending = f.social.mine();
  f.calls.at(-1).resolve(list(friends, blocked));
  return pending;
}

// Without an account/generation fence, the older request clears B's blocked cache and
// reports A's relationships to the listeners after B has already loaded successfully.
test("old mine completion cannot overwrite the new account's friends or blocked cache", async () => {
  const f = harness();
  const old = f.social.mine();
  const rejected = assert.rejects(old, stale);
  f.account(B);
  f.social.reset();
  await seed(f, [Y], [X]);
  const changes = [];
  f.social.onBlockedChange((...event) => changes.push(event));
  f.social.onRelationshipChange((...event) => changes.push(event));
  f.calls[0].resolve(list([X], [Y]));
  await rejected;
  assert.equal(f.social.isBlocked(X), true);
  assert.equal(f.social.isBlocked(Y), false);
  assert.equal(f.social.relationshipOf(X), Relationship.BLOCKED_BY_ME);
  assert.equal(f.social.relationshipOf(Y), Relationship.FRIENDS);
  assert.deepEqual(changes, []);
});

for (const [method, payload] of [
  ["profile", { ...person(X), available: true, relationship: Relationship.BLOCKED_BY_ME }],
  ["relationship", { relationship: Relationship.FRIENDS }],
  ...["request", "accept", "reject", "cancel", "remove", "block", "unblock"].map(method => [method, { relationship: Relationship.BLOCKED_BY_ME }])
]) {
  test(`${method}: reset discards a late result and never republishes its relationship`, async () => {
    const f = harness();
    const old = f.social[method](X);
    const rejected = assert.rejects(old, stale);
    f.social.reset();
    const events = [];
    f.social.onRelationshipChange((...event) => events.push(event));
    f.social.onBlockedChange((...event) => events.push(event));
    f.calls[0].resolve(payload);
    await rejected;
    assert.equal(f.social.isBlocked(X), false);
    assert.equal(f.social.relationshipOf(X), null);
    assert.deepEqual(events, []);
    assert.equal(f.calls.length, 1, "stale operations are never retried, especially server writes");
  });
}

test("getter-only clients discard results after account changes even without reset", async () => {
  const f = harness();
  const old = f.social.relationship(X);
  const rejected = assert.rejects(old, stale);
  f.account(B);
  await seed(f, [X]);
  f.calls[0].resolve({ relationship: Relationship.BLOCKED_BY_ME });
  await rejected;
  assert.equal(f.social.relationshipOf(X), Relationship.FRIENDS);
});

test("cached relationship and block reads synchronize getter-only account changes", async () => {
  const f = harness();
  await seed(f, [Y], [X]);
  f.account(B);
  assert.equal(f.social.isBlocked(X), false);
  assert.equal(f.social.relationshipOf(Y), null);
});

test("logout invalidates pending reads even when no replacement request starts", async () => {
  const f = harness();
  const old = f.social.mine();
  const rejected = assert.rejects(old, stale);
  f.account(null);
  f.social.reset();
  f.calls[0].resolve(list([X], [Y]));
  await rejected;
  assert.equal(f.social.available, false);
  assert.equal(f.social.relationshipOf(X), null);
  assert.equal(f.social.isBlocked(Y), false);
});

for (const failure of ["server", "transport"]) test(`stale ${failure} failure is classified as STALE`, async () => {
  const f = harness();
  const old = f.social.request(X);
  const rejected = assert.rejects(old, stale);
  f.social.reset();
  if (failure === "server") f.calls[0].fail("NOT_ALLOWED");
  else f.calls[0].reject(new Error("synthetic offline"));
  await rejected;
});

for (const method of ["request", "report"]) test(`${method}: each account owns its pending duplicate and cleanup`, async () => {
  const f = harness();
  const run = () => method === "report" ? f.social.report(X, "spam") : f.social.request(X);
  const old = run();
  const rejected = assert.rejects(old, stale);
  f.account(B);
  f.social.reset();
  const current = run();
  const duplicate = run();
  assert.equal(f.calls.length, 2, "B starts one fresh write and deduplicates its own clicks");
  f.calls[0].resolve(method === "report" ? { status: "received" } : { relationship: "outgoing" });
  await rejected;
  const afterOldCleanup = run();
  assert.equal(f.calls.length, 2, "old finally must not remove B's in-flight write");
  f.calls[1].resolve(method === "report" ? { status: "duplicate" } : { relationship: "outgoing" });
  const expected = method === "report" ? "duplicate" : "outgoing";
  assert.deepEqual(await Promise.all([current, duplicate, afterOldCleanup]), [expected, expected, expected]);
  assert.deepEqual(f.calls.map(call => call.account), [A, B]);
});

test("a listener that resets during mine cannot leak subsequent old-account notifications", async () => {
  const f = harness();
  const seen = [];
  f.social.onBlockedChange((_id, blocked) => { if (blocked) { f.account(B); f.social.reset(); } });
  f.social.onBlockedChange((id, blocked) => { if (blocked) seen.push(id); });
  f.social.onRelationshipChange((id, state) => { if (state) seen.push(id); });
  const old = f.social.mine();
  const rejected = assert.rejects(old, stale);
  f.calls[0].resolve(list([X], [Y]));
  await rejected;
  assert.equal(f.social.isBlocked(Y), false);
  assert.equal(f.social.relationshipOf(X), null);
  assert.deepEqual(seen, []);
});

test("reset clears both caches before notifying listeners", async () => {
  const f = harness();
  await seed(f, [Y], [X]);
  const observed = [];
  f.social.onBlockedChange(() => observed.push([f.social.isBlocked(X), f.social.relationshipOf(Y)]));
  f.social.reset();
  assert.deepEqual(observed, [[false, null]]);
});

test("explicit account changes invalidate an A→B→A round trip with no intervening RPC", async () => {
  const f = harness();
  assert.equal(typeof f.social.setAccount, "function");
  f.social.setAccount(A);
  const old = f.social.mine();
  const rejected = assert.rejects(old, stale);
  f.account(B); f.social.setAccount(B);
  f.account(A); f.social.setAccount(A);
  await seed(f, [Y]);
  f.calls[0].resolve(list([X]));
  await rejected;
  assert.equal(f.social.relationshipOf(X), null);
  assert.equal(f.social.relationshipOf(Y), Relationship.FRIENDS);
});

test("explicit logout stays authoritative while the online getter still reports the old session", async () => {
  const f = harness();
  assert.equal(typeof f.social.setAccount, "function");
  f.social.setAccount(A);
  await seed(f, [Y], [X]);
  f.social.setAccount(null); // world-online emits onIdentity(null) before clearing its session.
  assert.equal(f.social.available, false);
  assert.equal(f.social.relationshipOf(Y), null);
  assert.equal(f.social.isBlocked(X), false);
  await assert.rejects(f.social.request(X), error => error.code === "SIGNED_OUT");
  assert.equal(f.calls.length, 1, "no old-account write during the logout callback");
});

test("same-account identity refresh preserves valid pending mutations", async () => {
  const f = harness();
  assert.equal(typeof f.social.setAccount, "function");
  f.social.setAccount(A);
  const pending = f.social.request(X);
  assert.equal(f.social.setAccount(A), false);
  const duplicate = f.social.request(X);
  assert.equal(f.calls.length, 1);
  f.calls[0].resolve({ relationship: "outgoing" });
  assert.deepEqual(await Promise.all([pending, duplicate]), ["outgoing", "outgoing"]);
});

test("dispose invalidates pending work, clears listeners and cannot be revived", async () => {
  const f = harness();
  assert.equal(typeof f.social.dispose, "function");
  await seed(f, [Y], [X]);
  const pending = f.social.mine();
  const rejected = assert.rejects(pending, stale);
  const events = [];
  f.social.onBlockedChange((...args) => events.push(args));
  f.social.onRelationshipChange((...args) => events.push(args));
  f.social.dispose();
  f.social.dispose();
  f.social.setAccount(B);
  f.calls[1].resolve(list([X], [Y]));
  await rejected;
  assert.equal(f.social.available, false);
  assert.equal(f.social.isBlocked(X), false);
  assert.equal(f.social.relationshipOf(Y), null);
  assert.deepEqual(events, []);
  await assert.rejects(f.social.block(X), error => error.code === "SIGNED_OUT");
  assert.equal(f.calls.length, 2);
});
