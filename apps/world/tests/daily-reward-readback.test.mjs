import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createAttendanceClient, ATTENDANCE_RPC } from "../src/attendance/attendance-client.js";
import { createDailyQuizClient, DAILY_QUIZ_RPC } from "../src/daily-quiz/daily-quiz-client.js";
import { createWalletClient, WALLET_RPC, INDUCK_COIN } from "../src/wallet/wallet-client.js";
import { createProgressionClient, PROGRESSION_RPC } from "../src/progression/progression-client.js";
import { levelUpMessage } from "../src/progression/progression-hud.js";

const TODAY = "2026-10-05";
const RUN = "11111111-2222-4333-8444-555555555555";
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };
const ok = data => ({ data, error: null });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const attendanceView = done => ({ rewardDate: TODAY, month: "2026-10", claimedToday: done,
  attendedDays: Number(done), attendedDates: done ? [TODAY] : [], dailyCoin: 10,
  nextMilestone: { days: 3, bonusCoin: 30 },
  milestones: [3, 7, 14, 21].map(days => ({ days, bonusCoin: 30, claimed: false })) });
const quizView = done => ({ rewardDate: TODAY, status: done ? "PASSED" : "ACTIVE", runId: RUN,
  progress: { answered: done ? 3 : 2, correct: done ? 3 : 2, total: 3 }, rewardPreview: [],
  ...(done ? {} : { question: { questionId: "synthetic-final", index: 2, prompt: "Synthetic question", options: ["a", "b", "c", "d"] } }) });
const progressView = done => done
  ? { totalExp: 120, level: 2, currentLevelStartExp: 100, nextLevelExp: 300, progressExp: 20, progressRequired: 200, maxDefinedLevel: 10, isMaxLevel: false }
  : { totalExp: 90, level: 1, currentLevelStartExp: 0, nextLevelExp: 100, progressExp: 90, progressRequired: 100, maxDefinedLevel: 10, isMaxLevel: false };

function harness(kind, { failure = "transport", recoveryFailures = [], holdMutation = null, holdEconomic = null } = {}) {
  const calls = [], toasts = [], levels = [], timers = new Map(), accounts = new Map();
  let account = "fixture-a", timerId = 0;
  const record = id => { if (!accounts.has(id)) accounts.set(id, { done: false }); return accounts.get(id); };
  const mutationRpc = kind === "attendance" ? ATTENDANCE_RPC.CLAIM : DAILY_QUIZ_RPC.ANSWER;
  const statusRpc = kind === "attendance" ? ATTENDANCE_RPC.READ : DAILY_QUIZ_RPC.READ;
  const failedReads = new Set();
  const rpc = async (fn, args) => {
    const id = account, state = record(id);
    calls.push({ fn, args, account: id });
    if (fn === mutationRpc) {
      state.done = true; // synthetic server commits before the response is lost
      if (holdMutation) await holdMutation.promise;
      if (failure === "transport") throw new Error("synthetic response lost after commit");
      if (failure === "malformed") return ok({ invalid: true });
      if (failure === "malformed-date") return ok({ ...(kind === "attendance" ? attendanceView(true) : quizView(true)), rewardDate: [TODAY] });
      if (failure === "null") return null;
      if (failure === "undefined") return undefined;
      if (failure === "settled-without-reward") return ok(kind === "attendance"
        ? { ...attendanceView(true), claimed: false, replayed: true, rewards: [] } : quizView(true));
      return { error: { message: kind === "attendance" ? "ATTENDANCE_REWARD_FAILED" : "QUIZ_ALREADY_ANSWERED" } };
    }
    if (state.done && recoveryFailures.includes(fn) && !failedReads.has(fn)) {
      failedReads.add(fn);
      return { error: { message: "synthetic recovery read unavailable" } };
    }
    if (fn === WALLET_RPC || fn === PROGRESSION_RPC) {
      if (holdEconomic && state.done) await holdEconomic.promise;
      return ok(fn === WALLET_RPC ? { currencies: [{ id: INDUCK_COIN, balance: state.done ? 110 : 100 }] } : progressView(state.done));
    }
    if (fn === statusRpc) return ok(kind === "attendance" ? attendanceView(state.done) : quizView(state.done));
    throw new Error(`Unexpected synthetic RPC ${fn}`);
  };
  const timerOptions = { setTimer: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id), rewardRetryDelays: [10, 20, 30] };
  const wallet = createWalletClient({ getClient: () => ({ rpc }), ...timerOptions });
  const progression = createProgressionClient({ getClient: () => ({ rpc }), ...timerOptions });
  progression.onChange(change => { const message = levelUpMessage(change); if (message) levels.push(message); });
  // Execute the actual production composition, rather than restating its callbacks in the test.
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const start = main.indexOf("const dailyQuiz = createDailyQuizClient({");
  const end = main.indexOf("// Wardrobe P0:", start);
  const context = { createDailyQuizClient, createAttendanceClient, online: { supabase: { rpc } }, wallet, progression,
    inventory: { refresh() { throw new Error("Daily recovery must not invent an inventory reward"); } },
    mcmEventUi: { showReward: value => toasts.push(value), say: value => toasts.push(value) } };
  vm.runInNewContext(main.slice(start, end).replace("const dailyQuiz =", "globalThis.dailyQuiz =").replace("const attendance =", "globalThis.attendance ="), context);
  const daily = kind === "attendance" ? context.attendance : context.dailyQuiz;
  const bind = async id => { account = id; await Promise.all([wallet.setAccount(id), progression.setAccount(id), daily.setAccount(id)]); };
  const mutate = () => kind === "attendance" ? daily.claim() : daily.answer(0);
  const runTimer = async () => { const entry = timers.entries().next().value; assert.ok(entry, "expected bounded readback retry"); timers.delete(entry[0]); entry[1].fn(); await flush(); return entry[1].ms; };
  return { calls, toasts, levels, timers, wallet, progression, daily, bind, mutate, runTimer, mutationRpc, statusRpc };
}

for (const kind of ["attendance", "quiz"]) {
  for (const failure of ["transport", "malformed", "malformed-date", "null", "undefined", "refused", "settled-without-reward"]) {
    test(`${kind}: ${failure} response after commit recovers served economics without reward replay`, async () => {
      const h = harness(kind, { failure });
      await h.bind("fixture-a");
      const result = await h.mutate();
      await flush();
      assert.equal(result.outcome, failure === "settled-without-reward" ? (kind === "attendance" ? "ALREADY_CLAIMED" : "OK") : failure === "refused" ? "REFUSED" : "FAILED");
      assert.equal(h.daily.snapshot.claimedToday ?? h.daily.snapshot.status, kind === "attendance" ? true : "PASSED");
      assert.equal(h.wallet.balance(), 110, "lost response must not strand the old displayed balance");
      assert.equal(h.progression.snapshot.totalExp, kind === "quiz" ? 120 : 90, "quiz re-reads EXP; attendance remains wallet-only");
      assert.deepEqual(h.toasts, [], "readback never impersonates a newly claimed reward");
      assert.deepEqual(h.levels, [], "recovery silently repairs the HUD instead of replaying a toast");
      assert.equal(h.calls.filter(c => c.fn === h.mutationRpc).length, 1, "only the user's explicit mutation");
    });
  }

  test(`${kind}: failed status and economic recovery reads retry independently without another mutation`, async () => {
    const h = harness(kind, { recoveryFailures: [WALLET_RPC, PROGRESSION_RPC, kind === "attendance" ? ATTENDANCE_RPC.READ : DAILY_QUIZ_RPC.READ] });
    await h.bind("fixture-a");
    await h.mutate(); await flush();
    assert.equal(h.daily.state, "UNAVAILABLE");
    assert.equal(h.wallet.state, "UNAVAILABLE");
    assert.equal(h.wallet.balance(), null, "failed recovery does not keep a stale balance looking current");
    assert.equal(h.timers.size, kind === "quiz" ? 2 : 1);
    assert.equal(await h.daily.refresh("retry"), true);
    while (h.timers.size) await h.runTimer();
    assert.equal(h.wallet.balance(), 110);
    assert.equal(h.progression.snapshot.totalExp, kind === "quiz" ? 120 : 90);
    assert.deepEqual(h.toasts, []);
    assert.deepEqual(h.levels, []);
    assert.equal(h.calls.filter(c => c.fn === h.mutationRpc).length, 1);
  });

  for (const destination of ["fixture-b", null]) {
    test(`${kind}: old account's late unknown outcome cannot request recovery under ${destination}`, async () => {
      const holdMutation = deferred(), h = harness(kind, { holdMutation });
      await h.bind("fixture-a");
      const mutation = h.mutate();
      await h.bind(destination);
      const count = h.calls.length;
      holdMutation.resolve();
      assert.equal((await mutation).outcome, "STALE"); await flush();
      assert.equal(h.calls.length, count, "no old-account status/economic recovery callback");
      assert.equal(h.wallet.balance(), destination ? 100 : null);
      assert.deepEqual(h.toasts, []);
    });
  }

  test(`${kind}: account switch discards in-flight recovery economics`, async () => {
    const holdEconomic = deferred(), h = harness(kind, { holdEconomic });
    await h.bind("fixture-a");
    await h.mutate(); await flush();
    await h.bind("fixture-b");
    holdEconomic.resolve(); await flush();
    assert.equal(h.wallet.balance(), 100);
    assert.equal(h.progression.snapshot.totalExp, 90);
    assert.equal(h.timers.size, 0);
    assert.deepEqual(h.toasts, []);
    assert.deepEqual(h.levels, []);
  });
}


for (const spec of [
  { name: "wallet", create: createWalletClient, rpc: WALLET_RPC, view: n => ({ currencies: [{ id: INDUCK_COIN, balance: n }] }), value: c => c.balance() },
  { name: "progression", create: createProgressionClient, rpc: PROGRESSION_RPC, view: n => progressView(n === 110), value: c => c.snapshot?.totalExp }
]) {
  function economicHarness() {
    const calls = [], timers = new Map(), changes = [];
    let sequence = 0;
    const c = spec.create({ getClient: () => ({ rpc(fn) {
      return new Promise(resolve => calls.push({ fn, resolve }));
    } }), setTimer: (fn, ms) => { const id = ++sequence; timers.set(id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id), rewardRetryDelays: [10, 20, 30] });
    c.onChange(change => changes.push(change));
    const bind = async id => { const p = c.setAccount(id); if (id) calls.at(-1).resolve(ok(spec.view(100))); await p; };
    const fail = () => calls.at(-1).resolve({ data: {}, error: null });
    const tick = () => { const [id, timer] = timers.entries().next().value; timers.delete(id); timer.fn(); return timer.ms; };
    return { c, calls, timers, changes, bind, fail, tick };
  }

  test(`${spec.name}: daily recovery query retries stop at the bounded budget, and a later explicit read recovers`, async () => {
    const h = economicHarness(); await h.bind("fixture-a");
    const first = h.c.refresh("daily-reward-recovery"); h.fail(); assert.equal(await first, false);
    for (const ms of [10, 20, 30]) { assert.equal(h.tick(), ms); h.fail(); await flush(); }
    assert.equal(h.timers.size, 0, "no unbounded polling when the server remains unavailable");
    assert.equal(h.calls.length, 5, "account + first recovery + three bounded read-only retries");
    assert.ok(h.calls.every(call => call.fn === spec.rpc));
    const retry = h.c.refresh("open"); h.calls.at(-1).resolve(ok(spec.view(110))); assert.equal(await retry, true);
    assert.equal(spec.value(h.c), spec.name === "wallet" ? 110 : 120);
  });

  test(`${spec.name}: daily recovery reason survives an earlier in-flight ordinary read and a later ordinary refresh`, async () => {
    const h = economicHarness(); await h.bind("fixture-a");
    const old = h.c.refresh("open");
    const recovery = h.c.refresh("daily-reward-recovery");
    assert.equal(h.c.refresh("resume"), old);
    h.calls.at(-1).resolve(ok(spec.view(100))); await flush();
    assert.equal(h.calls.length, 3, "one fresh post-mutation read follows the older read");
    h.fail(); assert.equal(await recovery, false);
    assert.equal(h.timers.size, 1, "ordinary reads cannot erase recovery retry semantics");
    h.tick(); h.calls.at(-1).resolve(ok(spec.view(110))); await flush();
    assert.equal(h.changes.at(-1).reason, "daily-reward-recovery");
    assert.equal(h.timers.size, 0);
    assert.equal(levelUpMessage(h.changes.at(-1)), null);
  });

  test(`${spec.name}: account change cancels daily recovery timer and even a late timer cannot read the new account`, async () => {
    const h = economicHarness(); await h.bind("fixture-a");
    const p = h.c.refresh("daily-reward-recovery"); h.fail(); await p;
    const timer = h.timers.values().next().value; assert.ok(timer);
    await h.bind("fixture-b"); assert.equal(h.timers.size, 0);
    const count = h.calls.length; timer.fn(); await flush();
    assert.equal(h.calls.length, count);
    assert.equal(spec.value(h.c), spec.name === "wallet" ? 100 : 90);
  });
}

test("CORE-15 and confirmed rewards keep their stronger reason and level-up semantics during daily recovery", async () => {
  for (const reason of ["core15-first-campus-reward", "reward"]) {
    const calls = [], changes = [];
    const p = createProgressionClient({ getClient: () => ({ rpc: () => new Promise(resolve => calls.push(resolve)) }) });
    p.onChange(change => changes.push(change));
    const bound = p.setAccount("fixture-a"); calls.at(-1)(ok(progressView(false))); await bound;
    const recovery = p.refresh("daily-reward-recovery");
    const confirmed = p.refresh(reason);
    p.refresh("daily-reward-recovery");
    calls.at(-1)(ok(progressView(false))); await flush();
    calls.at(-1)(ok(progressView(true))); await Promise.all([recovery, confirmed]);
    assert.equal(changes.at(-1).reason, reason);
    assert.equal(levelUpMessage(changes.at(-1)), "LEVEL UP · Lv.2");
  }
});

test("a generic progression read already in flight stays silent when it observes committed daily recovery EXP", async () => {
  const calls = [], changes = [];
  const p = createProgressionClient({ getClient: () => ({ rpc: () => new Promise(resolve => calls.push(resolve)) }) });
  p.onChange(change => changes.push(change));
  const bound = p.setAccount("fixture-a"); calls.at(-1)(ok(progressView(false))); await bound;
  const old = p.refresh("resume"); p.refresh("daily-reward-recovery");
  calls.at(-1)(ok(progressView(true))); await flush();
  assert.equal(changes.at(-1).snapshot.totalExp, 120);
  assert.equal(levelUpMessage(changes.at(-1)), null, "an overlapping ordinary read cannot leak a recovery level-up toast");
  calls.at(-1)(ok(progressView(true))); await old;
  assert.ok(changes.every(change => levelUpMessage(change) === null));
});


test("an ordinary progression read between recovery retries repairs the HUD silently", async () => {
  const calls = [], changes = [], timers = new Map();
  const p = createProgressionClient({ getClient: () => ({ rpc: () => new Promise(resolve => calls.push(resolve)) }),
    setTimer: fn => { timers.set(1, fn); return 1; }, clearTimer: id => timers.delete(id) });
  p.onChange(change => changes.push(change));
  const bound = p.setAccount("fixture-a"); calls.at(-1)(ok(progressView(false))); await bound;
  const recovery = p.refresh("daily-reward-recovery"); calls.at(-1)({ error: { message: "synthetic read failure" } }); await recovery;
  assert.equal(timers.size, 1);
  const ordinary = p.refresh("resume"); calls.at(-1)(ok(progressView(true))); await ordinary;
  assert.equal(p.snapshot.totalExp, 120);
  assert.equal(levelUpMessage(changes.at(-1)), null);
  assert.equal(timers.size, 0);
  const later = p.refresh("reward"); calls.at(-1)(ok({ ...progressView(true), level: 3, totalExp: 320 })); await later;
  assert.equal(levelUpMessage(changes.at(-1)), "LEVEL UP · Lv.3", "later confirmed reward remains normal");
});


test("a silent recovery read cannot consume the level-up baseline of an already queued confirmed reward", async () => {
  for (const reason of ["core15-first-campus-reward", "reward"]) {
    const calls = [], changes = [];
    const p = createProgressionClient({ getClient: () => ({ rpc: () => new Promise(resolve => calls.push(resolve)) }) });
    p.onChange(change => changes.push(change));
    const bound = p.setAccount("fixture-a"); calls.at(-1)(ok(progressView(false))); await bound;
    const recovery = p.refresh("daily-reward-recovery");
    const confirmed = p.refresh(reason);
    calls.at(-1)(ok(progressView(true))); await flush();
    assert.equal(p.snapshot.totalExp, 120, "server HUD snapshot updates immediately");
    assert.equal(levelUpMessage(changes.at(-1)), null);
    assert.notEqual(changes.at(-1).reason, "core15-first-campus-reward", "old read does not acknowledge CORE-15 growth");
    calls.at(-1)(ok(progressView(true))); await Promise.all([recovery, confirmed]);
    assert.equal(changes.at(-1).reason, reason);
    assert.equal(levelUpMessage(changes.at(-1)), "LEVEL UP · Lv.2", "fresh confirmed read keeps its original comparison baseline");
  }
});

test("an ordinary read after failed confirmed follow-up keeps the stronger reward semantics and level-up baseline", async () => {
  for (const reason of ["core15-first-campus-reward", "reward"]) {
    const calls = [], changes = [], timers = new Map();
    const p = createProgressionClient({ getClient: () => ({ rpc: () => new Promise(resolve => calls.push(resolve)) }),
      setTimer: fn => { timers.set(1, fn); return 1; }, clearTimer: id => timers.delete(id) });
    p.onChange(change => changes.push(change));
    const bound = p.setAccount("fixture-a"); calls.at(-1)(ok(progressView(false))); await bound;
    const recovery = p.refresh("daily-reward-recovery"); p.refresh(reason);
    calls.at(-1)(ok(progressView(true))); await flush();
    calls.at(-1)({ error: { message: "synthetic confirmed-read failure" } }); await recovery;
    assert.equal(timers.size, 1);
    const ordinary = p.refresh("resume"); calls.at(-1)(ok(progressView(true))); await ordinary;
    assert.equal(changes.at(-1).reason, reason, "a later fresh read must fulfill the pending confirmed readback");
    assert.equal(levelUpMessage(changes.at(-1)), "LEVEL UP · Lv.2");
    assert.equal(timers.size, 0);
  }
});
