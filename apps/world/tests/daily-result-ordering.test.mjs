import test from "node:test";
import assert from "node:assert/strict";
import { createDailyQuizClient, DAILY_QUIZ_RPC } from "../src/daily-quiz/daily-quiz-client.js";
import { createAttendanceClient, ATTENDANCE_RPC } from "../src/attendance/attendance-client.js";
import { createDailyQuizPanel } from "../src/daily-quiz/daily-quiz-panel.js";
import { createAttendancePanel } from "../src/attendance/attendance-panel.js";

const TODAY = "2026-09-30";
const TOMORROW = "2026-10-01";
const RUN = "11111111-2222-4333-8444-555555555555";
const reward = {
  rewardId: "reward.daily.fixture", rewardVersion: 1, rewardTransactionId: "tx-fixture",
  status: "SUCCESS", replayed: false, completedAt: "2026-09-30T00:00:00Z",
  entries: [{ grantType: "CURRENCY", targetId: "currency.induck_coin", requested: 10,
    granted: 10, status: "GRANTED", reason: null }]
};

function quizView(answered = null, rewardDate = TODAY) {
  return {
    rewardDate, rewardPreview: [], status: answered === null ? "AVAILABLE" : answered === 3 ? "PASSED" : "ACTIVE",
    runId: answered === null ? null : RUN, progress: { answered: answered ?? 0, total: 3, correct: answered ?? 0 },
    ...(answered !== null && answered < 3 ? { question: { questionId: `question-${answered}`, index: answered,
      prompt: "Synthetic question", options: ["a", "b", "c", "d"] } } : {}),
    ...(answered > 0 ? { lastAnswer: { questionId: `question-${answered - 1}`, index: answered - 1, correct: true } } : {})
  };
}

function attendanceView(claimedToday = false, rewardDate = TODAY) {
  return {
    rewardDate, month: rewardDate.slice(0, 7), claimedToday, attendedDays: claimedToday ? 1 : 0,
    attendedDates: claimedToday ? [rewardDate] : [], dailyCoin: 10,
    nextMilestone: { days: 3, bonusCoin: 30 },
    milestones: [[3, 30], [7, 50], [14, 100], [21, 150]].map(([days, bonusCoin]) => ({ days, bonusCoin, claimed: false }))
  };
}

const cases = [
  {
    name: "quiz start", create: createDailyQuizClient, read: DAILY_QUIZ_RPC.READ, write: DAILY_QUIZ_RPC.START,
    before: () => quizView(), after: () => quizView(0), nextDay: () => quizView(null, TOMORROW),
    mutate: client => client.start(), success: "OK", refusal: "QUIZ_UNAVAILABLE", callback: "onReward", paid: false
  },
  {
    name: "quiz answer", create: createDailyQuizClient, read: DAILY_QUIZ_RPC.READ, write: DAILY_QUIZ_RPC.ANSWER,
    before: () => quizView(0), after: () => quizView(1), nextDay: () => quizView(null, TOMORROW),
    mutate: client => client.answer(0), success: "OK", refusal: "QUIZ_ALREADY_ANSWERED", callback: "onReward", paid: false
  },
  {
    name: "quiz final answer", create: createDailyQuizClient, read: DAILY_QUIZ_RPC.READ, write: DAILY_QUIZ_RPC.ANSWER,
    before: () => quizView(2), after: () => ({ ...quizView(3), reward }), nextDay: () => quizView(null, TOMORROW),
    mutate: client => client.answer(0), success: "OK", refusal: "QUIZ_ALREADY_ANSWERED", callback: "onReward", paid: true
  },
  {
    name: "attendance claim", create: createAttendanceClient, read: ATTENDANCE_RPC.READ, write: ATTENDANCE_RPC.CLAIM,
    before: () => attendanceView(), after: () => ({ ...attendanceView(true), claimed: true, replayed: false, rewards: [reward] }),
    nextDay: () => attendanceView(false, TOMORROW), mutate: client => client.claim(), success: "CLAIMED",
    refusal: "ATTENDANCE_REWARD_FAILED", callback: "onRewards", paid: true
  }
];

function harness(spec) {
  const calls = [];
  const rewards = [];
  const changes = [];
  const client = spec.create({
    getClient: () => ({ rpc(fn, args) {
      return new Promise((resolve, reject) => calls.push({ fn, args, resolve, reject }));
    } }),
    [spec.callback]: (...args) => rewards.push(args)
  });
  client.onChange(change => changes.push(change));
  const respond = (call, data) => call.resolve({ data, error: null });
  const bind = async (account = "account-a", data = spec.before()) => {
    const request = client.setAccount(account);
    respond(calls.at(-1), data);
    assert.equal(await request, true);
  };
  return { client, calls, rewards, changes, respond, bind };
}

// Promises, not timeouts: RPC resolutions and deferred refreshes drain before assertions.
const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };

for (const spec of cases) {
  for (const reason of ["open", "resume"]) {
    test(`${spec.name}: slow ${reason} read cannot overwrite a successful mutation`, async () => {
      const h = harness(spec);
      await h.bind();
      const oldRead = h.client.refresh(reason);
      const oldCall = h.calls.at(-1);
      assert.equal(h.client.refresh(reason), oldRead, "overlapping reads coalesce");
      const mutation = spec.mutate(h.client);
      const writeCall = h.calls.at(-1);
      assert.equal(writeCall.fn, spec.write);
      assert.equal((await spec.mutate(h.client)).outcome, "BUSY", "duplicate clicks never reach the server");
      h.respond(writeCall, spec.after());
      assert.equal((await mutation).outcome, spec.success);
      const accepted = h.client.snapshot;
      const changeCount = h.changes.length;
      h.respond(oldCall, spec.before());
      assert.equal(await oldRead, false, "the superseded read reports that it was not applied");
      assert.equal(h.client.snapshot, accepted);
      assert.equal(h.changes.length, changeCount, "no stale UI notification");
      assert.equal(h.client.pending, false);
      assert.equal(h.calls.filter(call => call.fn === spec.write).length, 1);
      assert.equal(h.rewards.length, Number(spec.paid));
    });
  }

  test(`${spec.name}: an old status error cannot erase the successful result`, async () => {
    const h = harness(spec);
    await h.bind();
    const oldRead = h.client.refresh("open");
    const oldCall = h.calls.at(-1);
    const mutation = spec.mutate(h.client);
    h.respond(h.calls.at(-1), spec.after());
    await mutation;
    const accepted = h.client.snapshot;
    oldCall.reject(new Error("old transport failure"));
    assert.equal(await oldRead, false);
    assert.equal(h.client.state, "READY");
    assert.equal(h.client.snapshot, accepted);
  });

  test(`${spec.name}: refresh during a write waits, coalesces, and can apply the next server day`, async () => {
    const h = harness(spec);
    await h.bind();
    const mutation = spec.mutate(h.client);
    const writeCall = h.calls.at(-1);
    const refresh = h.client.refresh("resume");
    assert.equal(h.client.refresh("open"), refresh);
    assert.equal(h.calls.length, 2, "no status read races the active mutation");
    h.respond(writeCall, spec.after());
    assert.equal((await mutation).outcome, spec.success);
    await flush();
    assert.equal(h.calls.length, 3, "one requested post-mutation read is sent");
    assert.equal(h.calls.at(-1).fn, spec.read);
    h.respond(h.calls.at(-1), spec.nextDay());
    assert.equal(await refresh, true);
    assert.equal(h.client.snapshot.rewardDate, TOMORROW);
    assert.equal(h.client.snapshot.claimedToday ?? h.client.snapshot.status, spec.name === "attendance claim" ? false : "AVAILABLE");
    assert.equal(h.rewards.length, Number(spec.paid), "only the mutation calls the reward callback");
    assert.equal(h.calls.filter(call => call.fn === spec.write).length, 1);
  });

  for (const failure of ["refused", "malformed", "transport"]) {
    test(`${spec.name}: ${failure} mutation recovers with a fresh read, not the pre-mutation request`, async () => {
      const h = harness(spec);
      await h.bind();
      const oldRead = h.client.refresh("open");
      const oldCall = h.calls.at(-1);
      const mutation = spec.mutate(h.client);
      const writeCall = h.calls.at(-1);
      if (failure === "refused") writeCall.resolve({ error: { message: spec.refusal } });
      else if (failure === "transport") writeCall.reject(new Error("mutation transport failure"));
      else h.respond(writeCall, { invalid: true });
      const result = await mutation;
      assert.equal(result.outcome, failure === "refused" ? "REFUSED" : "FAILED");
      assert.equal(result.code, failure === "refused" ? spec.refusal : failure === "malformed" ? "MALFORMED_RESPONSE" : "FAILED");
      assert.equal(h.calls.length, 4, "failure must start an independent status read");
      const recovery = h.client.refresh("retry");
      const recoveryCall = h.calls.at(-1);
      h.respond(oldCall, spec.before());
      assert.equal(await oldRead, false);
      assert.equal(h.client.refresh("open"), recovery, "old read cleanup does not clear the newer read");
      h.respond(recoveryCall, spec.nextDay());
      assert.equal(await recovery, true);
      assert.equal(h.client.snapshot.rewardDate, TOMORROW);
      assert.equal(h.client.pending, false);
      assert.equal(h.rewards.length, 0);
      assert.equal(h.calls.filter(call => call.fn === spec.write).length, 1, "never automatically retry a write");
    });
  }

  test(`${spec.name}: requested post-mutation status errors remain visible and retryable`, async () => {
    const h = harness(spec);
    await h.bind();
    const mutation = spec.mutate(h.client);
    const writeCall = h.calls.at(-1);
    const refresh = h.client.refresh("resume");
    h.respond(writeCall, spec.after());
    await mutation;
    await flush();
    h.calls.at(-1).resolve({ error: { message: "new status unavailable" } });
    assert.equal(await refresh, false);
    assert.equal(h.client.state, "UNAVAILABLE");
    assert.equal(h.client.snapshot, null);
    const retry = h.client.refresh("retry");
    h.respond(h.calls.at(-1), spec.nextDay());
    assert.equal(await retry, true);
    assert.equal(h.client.state, "READY");
    assert.equal(h.rewards.length, Number(spec.paid));
  });

  test(`${spec.name}: a queued refresh shares failed-write recovery and a later write stays locked`, async () => {
    const h = harness(spec);
    await h.bind();
    const mutation = spec.mutate(h.client);
    const writeCall = h.calls.at(-1);
    const queued = h.client.refresh("resume");
    writeCall.resolve({ error: { message: spec.refusal } });
    assert.equal((await mutation).outcome, "REFUSED");
    await flush();
    assert.equal(h.calls.length, 3, "queued refresh and recovery share one fresh read");
    h.respond(h.calls.at(-1), spec.before());
    assert.equal(await queued, true);
    const nextMutation = spec.mutate(h.client);
    assert.equal(h.client.pending, true);
    assert.equal((await spec.mutate(h.client)).outcome, "BUSY");
    h.respond(h.calls.at(-1), spec.after());
    assert.equal((await nextMutation).outcome, spec.success);
    assert.equal(h.rewards.length, Number(spec.paid));
    assert.equal(h.calls.filter(call => call.fn === spec.write).length, 2, "only the two explicit clicks write");
  });

  test(`${spec.name}: an old account's completion cannot unlock the new account's mutation`, async () => {
    const h = harness(spec);
    await h.bind();
    const oldMutation = spec.mutate(h.client);
    const oldWriteCall = h.calls.at(-1);
    const oldQueued = h.client.refresh("resume");
    assert.equal(h.calls.length, 2, "the old account refresh waits for its mutation");
    await h.bind("account-b");
    const currentMutation = spec.mutate(h.client);
    const currentWriteCall = h.calls.at(-1);
    h.respond(oldWriteCall, spec.after());
    assert.equal((await oldMutation).outcome, "STALE");
    assert.equal(await oldQueued, false);
    assert.equal(h.client.pending, true);
    assert.equal((await spec.mutate(h.client)).outcome, "BUSY");
    assert.equal(h.rewards.length, 0);
    h.respond(currentWriteCall, spec.after());
    assert.equal((await currentMutation).outcome, spec.success);
    assert.equal(h.client.pending, false);
    assert.equal(h.rewards.length, Number(spec.paid));
    assert.equal(h.calls.length, 4);
  });

  test(`${spec.name}: same account preserves pending work; switch/reset rejects all old results and queued reads`, async () => {
    const h = harness(spec);
    await h.bind();
    const oldRead = h.client.refresh("open");
    const oldCall = h.calls.at(-1);
    const mutation = spec.mutate(h.client);
    const writeCall = h.calls.at(-1);
    const queued = h.client.refresh("resume");
    await h.client.setAccount("account-a");
    assert.equal(h.client.pending, true);
    assert.equal(h.calls.length, 3);
    await h.client.setAccount(null);
    assert.equal(h.client.state, "SIGNED_OUT");
    assert.equal(h.client.snapshot, null);
    assert.equal(h.client.pending, false);
    await h.bind("account-b", spec.nextDay());
    const accepted = h.client.snapshot;
    h.respond(writeCall, spec.after());
    h.respond(oldCall, spec.before());
    assert.equal((await mutation).outcome, "STALE");
    assert.equal(await oldRead, false);
    assert.equal(await queued, false);
    assert.equal(h.client.snapshot, accepted);
    assert.equal(h.rewards.length, 0);
    assert.equal(h.calls.length, 4, "old queued refresh must not read the new account");
    // Resetting to the original id is a new generation, not a resurrection of its requests.
    await h.bind("account-a");
    const current = spec.mutate(h.client);
    h.respond(h.calls.at(-1), spec.after());
    assert.equal((await current).outcome, spec.success);
    assert.equal(h.rewards.length, Number(spec.paid));
  });
}

function fakeDocument() {
  const make = tag => ({ tagName: tag, children: [], dataset: {}, hidden: false, disabled: false,
    textContent: "", className: "", listeners: {}, append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; }, addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute() {}, focus() {}, click() { return this.listeners.click?.(); } });
  return { createElement: make, addEventListener() {}, make };
}
const descendants = node => [node, ...node.children.flatMap(descendants)];
const panelText = node => descendants(node).map(child => child.textContent).filter(Boolean).join("|");

test("quiz panel: late open status cannot replace question 2 after an answer", async () => {
  const h = harness(cases[1]);
  const doc = fakeDocument();
  const panel = doc.make("section");
  const ui = createDailyQuizPanel({ panel, quiz: h.client, doc });
  await h.bind();
  ui.setOpen(true);
  const oldRead = h.client.refresh("open");
  const oldCall = h.calls.at(-1);
  const answer = descendants(panel).find(node => node.className.split(" ").includes("daily-quiz-option")).click();
  h.respond(h.calls.at(-1), cases[1].after());
  await answer;
  await flush();
  assert.match(panelText(panel), /문제 2 \/ 3/);
  h.respond(oldCall, cases[1].before());
  assert.equal(await oldRead, false);
  assert.match(panelText(panel), /문제 2 \/ 3/);
  assert.doesNotMatch(panelText(panel), /문제 1 \/ 3/);
});

test("attendance panel: late open status cannot bring back the claim button", async () => {
  const h = harness(cases[3]);
  const doc = fakeDocument();
  const panel = doc.make("section");
  const ui = createAttendancePanel({ panel, attendance: h.client, doc });
  await h.bind();
  ui.setOpen(true);
  const oldRead = h.client.refresh("open");
  const oldCall = h.calls.at(-1);
  const claim = descendants(panel).find(node => node.textContent === "오늘 출석하기").click();
  h.respond(h.calls.at(-1), cases[3].after());
  await claim;
  await flush();
  assert.match(panelText(panel), /오늘 출석 완료/);
  h.respond(oldCall, cases[3].before());
  assert.equal(await oldRead, false);
  assert.match(panelText(panel), /오늘 출석 완료/);
  assert.doesNotMatch(panelText(panel), /오늘 출석하기/);
  assert.equal(h.rewards.length, 1);
});

for (const spec of [cases[0], cases[3]]) {
  test(`${spec.name}: the initial account read cannot undo a completed action`, async () => {
    const h = harness(spec);
    const initial = h.client.setAccount("account-a");
    const initialCall = h.calls.at(-1);
    const mutation = spec.mutate(h.client);
    h.respond(h.calls.at(-1), spec.after());
    assert.equal((await mutation).outcome, spec.success);
    const accepted = h.client.snapshot;
    h.respond(initialCall, spec.before());
    assert.equal(await initial, false);
    assert.equal(h.client.snapshot, accepted);
  });
}
