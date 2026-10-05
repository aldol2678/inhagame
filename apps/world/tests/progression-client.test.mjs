import test from "node:test";
import assert from "node:assert/strict";
import {
  PROGRESSION_RPC, PROGRESSION_STATE, createProgressionClient, parseProgressionSnapshot
} from "../src/progression/progression-client.js";
import { levelUpMessage } from "../src/progression/progression-hud.js";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

// Server shapes exactly as get_my_world_progression_v1() returns them (P0-F0 v1 curve).
const FRESH = { totalExp: 0, level: 1, currentLevelStartExp: 0, nextLevelExp: 100, progressExp: 0, progressRequired: 100, maxDefinedLevel: 10, isMaxLevel: false };
const MID = { totalExp: 145, level: 2, currentLevelStartExp: 100, nextLevelExp: 300, progressExp: 45, progressRequired: 200, maxDefinedLevel: 10, isMaxLevel: false };
const LV3 = { totalExp: 340, level: 3, currentLevelStartExp: 300, nextLevelExp: 600, progressExp: 40, progressRequired: 300, maxDefinedLevel: 10, isMaxLevel: false };
const MAX = { totalExp: 5240, level: 10, currentLevelStartExp: 4500, nextLevelExp: null, progressExp: 740, progressRequired: null, maxDefinedLevel: 10, isMaxLevel: true };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

/** A fake member client whose rpc responses are queued (or held) by the test. */
function fakeClient() {
  const calls = [];
  const queue = [];
  return {
    calls,
    respond(value) { queue.push(value); },
    rpc(fn, args) {
      calls.push({ fn, args });
      const next = queue.shift() ?? { data: null, error: { message: "NO_FIXTURE" } };
      if (typeof next === "function") return next();
      return next instanceof Promise ? next : Promise.resolve(next);
    }
  };
}

function harness({ client = fakeClient(), retryDelays = [1000, 3000, 8000] } = {}) {
  let current = client;
  const timers = new Map();
  let timerSeq = 0;
  const setTimer = (fn, ms) => { const id = ++timerSeq; timers.set(id, { fn, ms }); return id; };
  const clearTimer = id => timers.delete(id);
  const progression = createProgressionClient({
    getClient: () => current,
    setTimer,
    clearTimer,
    rewardRetryDelays: retryDelays
  });
  const changes = [];
  progression.onChange((change) => changes.push(change));
  const runNextTimer = () => {
    const entry = [...timers.entries()].sort((a, b) => a[0] - b[0])[0];
    if (!entry) return false;
    timers.delete(entry[0]);
    entry[1].fn();
    return entry[1].ms;
  };
  const flush = () => new Promise(resolve => setImmediate(resolve));
  return { progression, client, changes, timers, runNextTimer, flush, setClient: (next) => { current = next; } };
}

test("parser keeps the server contract and rejects anything else", () => {
  assert.deepEqual(parseProgressionSnapshot(FRESH), FRESH);
  assert.deepEqual(parseProgressionSnapshot(MAX), MAX);
  assert.ok(Object.isFrozen(parseProgressionSnapshot(MID)));
  assert.equal(parseProgressionSnapshot({ ...MID, extra: "x" }).extra, undefined, "unknown fields are dropped");
  for (const bad of [null, "Lv.9", {}, { ...MID, level: 0 }, { ...MID, totalExp: -1 }, { ...MID, level: "2" },
    { ...MID, isMaxLevel: "no" }, { ...MID, nextLevelExp: null }, { ...MAX, nextLevelExp: 6000 }, { ...MID, progressRequired: 0 }]) {
    assert.equal(parseProgressionSnapshot(bad), null, JSON.stringify(bad));
  }
});

test("fresh permanent account: one RPC, no arguments, Lv.1 / 0 EXP as served", async () => {
  const { progression, client, changes } = harness();
  client.respond({ data: FRESH, error: null });
  assert.equal(await progression.setAccount(A), true);
  assert.deepEqual(client.calls, [{ fn: PROGRESSION_RPC, args: undefined }], "only get_my_world_progression_v1, no client-supplied user or level");
  assert.equal(progression.state, PROGRESSION_STATE.READY);
  assert.deepEqual(progression.snapshot, FRESH);
  assert.deepEqual(changes.map((c) => c.state), [PROGRESSION_STATE.LOADING, PROGRESSION_STATE.READY]);
  assert.equal(levelUpMessage(changes.at(-1)), null, "the first fetch never announces a level-up");
});

test("signed out and guest sessions never call the RPC", async () => {
  const { progression, client, setClient } = harness();
  assert.equal(await progression.setAccount(null), false);
  assert.equal(progression.state, PROGRESSION_STATE.SIGNED_OUT);
  assert.equal(await progression.refresh("reward"), false);
  setClient(null); // online.supabase is null for a guest session
  await progression.setAccount(A);
  assert.equal(progression.state, PROGRESSION_STATE.SIGNED_OUT);
  assert.equal(client.calls.length, 0);
});

test("RPC errors, throws and malformed data are UNAVAILABLE with no snapshot", async () => {
  for (const response of [
    { data: null, error: { message: "ACCOUNT_UNAVAILABLE" } },
    { data: null, error: { message: "PERMANENT_ACCOUNT_REQUIRED" } },
    () => Promise.reject(new Error("network down")),
    { data: { level: 99 }, error: null }
  ]) {
    const { progression, client } = harness();
    client.respond(response);
    await progression.setAccount(A);
    assert.equal(progression.state, PROGRESSION_STATE.UNAVAILABLE);
    assert.equal(progression.snapshot, null);
  }
});

test("level-up is announced only when the same account's server Level rises", async () => {
  const { progression, client, changes } = harness();
  client.respond({ data: FRESH, error: null });
  await progression.setAccount(A);
  client.respond({ data: FRESH, error: null });
  await progression.refresh("reward");
  assert.equal(levelUpMessage(changes.at(-1)), null, "same Level: no toast");
  client.respond({ data: MID, error: null });
  await progression.refresh("reward");
  assert.equal(levelUpMessage(changes.at(-1)), "LEVEL UP · Lv.2");
  assert.deepEqual(progression.snapshot, MID, "the HUD shows the new server snapshot");
  client.respond({ data: MID, error: null });
  await progression.refresh("resume");
  assert.equal(levelUpMessage(changes.at(-1)), null, "no repeat toast for the same Level");
});

test("account switch drops the old snapshot and never compares Levels across accounts", async () => {
  const { progression, client, changes } = harness();
  client.respond({ data: FRESH, error: null });
  await progression.setAccount(A);
  client.respond({ data: MAX, error: null });
  await progression.setAccount(B);
  const loading = changes.find((c) => c.accountId === B && c.state === PROGRESSION_STATE.LOADING);
  assert.equal(loading.snapshot, null, "A's snapshot is gone as soon as B is bound");
  assert.equal(changes.at(-1).previous, null, "B's first READY has no previous to compare");
  assert.equal(levelUpMessage(changes.at(-1)), null, "Lv.1 (A) → Lv.10 (B) is not a level-up");
  await progression.setAccount(null);
  assert.equal(progression.snapshot, null);
  assert.equal(progression.state, PROGRESSION_STATE.SIGNED_OUT);
});

test("a stale response from a previous account is discarded", async () => {
  const { progression, client, changes } = harness();
  const slowA = deferred();
  client.respond(slowA.promise);
  const first = progression.setAccount(A);
  client.respond({ data: FRESH, error: null });
  await progression.setAccount(B);
  slowA.resolve({ data: MAX, error: null }); // A's answer lands after B is already READY
  assert.equal(await first, false);
  assert.equal(progression.accountId, B);
  assert.deepEqual(progression.snapshot, FRESH, "B keeps its own snapshot");
  assert.ok(!changes.some((c) => c.accountId === B && c.snapshot?.level === 10), "A's Lv.10 never reached B");
});

test("a response that lands after sign-out is discarded", async () => {
  const { progression, client } = harness();
  const slow = deferred();
  client.respond(slow.promise);
  const pending = progression.setAccount(A);
  await progression.setAccount(null);
  slow.resolve({ data: MID, error: null });
  await pending;
  assert.equal(progression.state, PROGRESSION_STATE.SIGNED_OUT);
  assert.equal(progression.snapshot, null);
});

test("refreshes coalesce: never parallel, one follow-up request at most", async () => {
  const { progression, client } = harness();
  client.respond({ data: FRESH, error: null });
  await progression.setAccount(A);
  const hold = deferred();
  client.respond(hold.promise);
  client.respond({ data: LV3, error: null });
  const r1 = progression.refresh("reward");
  const r2 = progression.refresh("reward");
  const r3 = progression.refresh("resume");
  assert.equal(client.calls.length, 2, "one in flight");
  hold.resolve({ data: MID, error: null });
  await Promise.all([r1, r2, r3]);
  assert.equal(client.calls.length, 3, "exactly one coalesced follow-up");
  assert.deepEqual(progression.snapshot, LV3);
});

test("coalescing preserves CORE-15 reward semantics instead of downgrading the follow-up reason", async () => {
  const { progression, client, changes } = harness();
  const slowAccountRead = deferred();
  client.respond(slowAccountRead.promise);
  const account = progression.setAccount(A);

  client.respond({ data: MID, error: null });
  const rewardRead = progression.refresh("core15-first-campus-reward");
  assert.equal(client.calls.length, 1, "reward readback coalesces behind the account read");

  slowAccountRead.resolve({ data: FRESH, error: null });
  await Promise.all([account, rewardRead]);

  assert.equal(client.calls.length, 2, "one semantic follow-up read");
  assert.deepEqual(progression.snapshot, MID);
  const final = changes.at(-1);
  assert.equal(final.reason, "core15-first-campus-reward");
  assert.deepEqual(final.previous, FRESH, "same-account pre-reward snapshot remains the comparison baseline");
  assert.equal(levelUpMessage(final), "LEVEL UP · Lv.2");
});

test("transient reward readback failure retries and recovers against the last READY snapshot", async () => {
  const { progression, client, changes, timers, runNextTimer, flush } = harness();
  client.respond({ data: FRESH, error: null });
  await progression.setAccount(A);

  client.respond({ data: null, error: { message: "network down" } });
  assert.equal(await progression.refresh("core15-first-campus-reward"), false);
  assert.equal(progression.state, PROGRESSION_STATE.UNAVAILABLE);
  assert.equal(progression.snapshot, null, "stale EXP is not presented as current during the failed read");
  assert.equal(timers.size, 1);
  client.respond({ data: MID, error: null });
  assert.equal(runNextTimer(), 1000);
  await flush();
  await flush();

  assert.equal(progression.state, PROGRESSION_STATE.READY);
  assert.deepEqual(progression.snapshot, MID);
  const recovered = changes.at(-1);
  assert.equal(recovered.reason, "core15-first-campus-reward");
  assert.deepEqual(recovered.previous, FRESH, "recovery still compares against the last trusted READY snapshot");
  assert.equal(levelUpMessage(recovered), "LEVEL UP · Lv.2");
  assert.equal(timers.size, 0);
});

test("reward readback retries are bounded; account changes cancel stale retry timers", async () => {
  const { progression, client, timers, runNextTimer, flush } = harness({ retryDelays: [10, 20, 30] });
  client.respond({ data: FRESH, error: null });
  await progression.setAccount(A);

  for (let attempt = 0; attempt < 4; attempt++) {
    client.respond({ data: null, error: { message: `down-${attempt}` } });
    if (attempt === 0) await progression.refresh("reward");
    else { runNextTimer(); await flush(); await flush(); }
  }
  assert.equal(timers.size, 0, "no fourth automatic reward readback retry");

  client.respond({ data: FRESH, error: null });
  await progression.setAccount(B);
  assert.equal(timers.size, 0, "account boundary clears every stale retry");
  assert.equal(progression.accountId, B);
  assert.deepEqual(progression.snapshot, FRESH);
});

test("non-reward refresh failures do not start background retries", async () => {
  const { progression, client, timers } = harness();
  client.respond({ data: FRESH, error: null });
  await progression.setAccount(A);
  client.respond({ data: null, error: { message: "resume failed" } });
  assert.equal(await progression.refresh("resume"), false);
  assert.equal(progression.state, PROGRESSION_STATE.UNAVAILABLE);
  assert.equal(timers.size, 0);
});

test("setAccount with the same id is a no-op", async () => {
  const { progression, client } = harness();
  client.respond({ data: MID, error: null });
  await progression.setAccount(A);
  await progression.setAccount(A);
  assert.equal(client.calls.length, 1);
  assert.equal(progression.status().accountBound, true);
});
