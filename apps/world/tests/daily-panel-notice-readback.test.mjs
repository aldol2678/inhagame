import test from "node:test";
import assert from "node:assert/strict";
import { createAttendanceClient, ATTENDANCE_RPC } from "../src/attendance/attendance-client.js";
import { createAttendancePanel, ATTENDANCE_TEXT } from "../src/attendance/attendance-panel.js";
import { createDailyQuizClient, DAILY_QUIZ_RPC } from "../src/daily-quiz/daily-quiz-client.js";
import { createDailyQuizPanel, DAILY_QUIZ_TEXT } from "../src/daily-quiz/daily-quiz-panel.js";
import { createFakeDocument } from "./support/fake-dom.mjs";

const DATE = "2026-10-06", RUN = "11111111-2222-4333-8444-555555555555";
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const walk = node => [node, ...node.children.flatMap(walk)];
const attendanceView = (done, date = DATE) => ({ rewardDate: date, month: date.slice(0, 7), claimedToday: done,
  attendedDays: Number(done), attendedDates: done ? [date] : [], dailyCoin: 10,
  nextMilestone: { days: 3, bonusCoin: 30 }, milestones: [3, 7, 14, 21].map(days => ({ days, bonusCoin: 30, claimed: false })) });
const quizView = (done, date = DATE, runId = RUN, status = "PASSED") => ({ rewardDate: date,
  status: done ? status : "ACTIVE", runId, progress: { answered: done ? 3 : 2, correct: status === "FAILED" ? 1 : 2, total: 3 }, rewardPreview: [],
  ...(done ? {} : { question: { questionId: "last-question", index: 2, prompt: "마지막 문제", options: ["선택", "나", "다", "라"] } }) });

async function setup(kind, options = {}) {
  const isAttendance = kind === "attendance", view = isAttendance ? attendanceView : quizView;
  const readRpc = isAttendance ? ATTENDANCE_RPC.READ : DAILY_QUIZ_RPC.READ;
  const writeRpc = isAttendance ? ATTENDANCE_RPC.CLAIM : DAILY_QUIZ_RPC.ANSWER;
  const calls = [], rewards = [], config = { response: { data: view(options.done ?? true) }, ...options };
  let mutated = false;
  const rpc = async fn => {
    calls.push(fn);
    if (fn === readRpc) {
      if (!mutated) {
        const data = view(config.beforeMutationDone ?? false);
        if (config.preReadGate) await config.preReadGate.promise;
        return { data };
      }
      if (config.readGate) await config.readGate.promise;
      return config.response;
    }
    assert.equal(fn, writeRpc);
    mutated = true;
    if (config.writeGate) await config.writeGate.promise;
    if (config.failure === "malformed") return { data: { invalid: true } };
    return { error: { message: config.failure === "refused" ? (isAttendance ? "ATTENDANCE_REWARD_FAILED" : "QUIZ_ALREADY_ANSWERED") : "synthetic lost response" } };
  };
  const client = isAttendance ? createAttendanceClient({ getClient: () => ({ rpc }), onRewards: r => rewards.push(r) })
    : createDailyQuizClient({ getClient: () => ({ rpc }), onReward: r => rewards.push(r) });
  if (config.outcomeGate) {
    const method = isAttendance ? "claim" : "answer", original = client[method];
    client[method] = async (...args) => { const result = await original(...args); await config.outcomeGate.promise; return result; };
  }
  const doc = createFakeDocument(), panel = doc.createElement("section");
  const ui = isAttendance ? createAttendancePanel({ panel, attendance: client, doc }) : createDailyQuizPanel({ panel, quiz: client, doc });
  await client.setAccount("fixture-a"); ui.setOpen(true); await flush();
  const click = () => { const node = walk(panel).find(n => n.tagName === "BUTTON" && n.textContent === (isAttendance ? ATTENDANCE_TEXT.claim : "선택")); assert.ok(node); node.click(); };
  const notices = () => walk(panel).filter(n => n.className === "shop-hint").map(n => n.textContent);
  const failureText = isAttendance ? ATTENDANCE_TEXT.failed : DAILY_QUIZ_TEXT.failedWrite;
  const assertNoReplay = () => { assert.equal(calls.filter(fn => fn === writeRpc).length, 1); assert.deepEqual(rewards, []); };
  return { client, ui, panel, config, click, notices, failureText, assertNoReplay, view };
}

for (const kind of ["attendance", "quiz"]) {
  for (const failure of ["transport", "malformed"]) {
    test(`${kind}: already-completed recovery cannot be overwritten by a late ${failure} outcome`, async () => {
      const h = await setup(kind, { failure }); h.click(); await flush();
      assert.equal(h.client.state, "READY");
      assert.deepEqual(h.notices(), []); h.assertNoReplay();
    });
  }
  test(`${kind}: a later trusted completion clears its corresponding failed-write hint`, async () => {
    const readGate = deferred(), h = await setup(kind, { readGate }); h.click(); await flush();
    assert.deepEqual(h.notices(), [h.failureText]);
    readGate.resolve(); await flush();
    assert.deepEqual(h.notices(), []); h.assertNoReplay();
  });
  for (const response of ["incomplete", "unavailable", "malformed", "different-date"]) {
    test(`${kind}: ${response} readback preserves a genuine unrecovered failure`, async () => {
      const h = await setup(kind);
      h.config.response = response === "incomplete" ? { data: h.view(false) } : response === "unavailable" ? { error: { message: "synthetic unavailable" } }
        : response === "malformed" ? { data: { invalid: true } } : { data: h.view(true, "2026-10-07") };
      h.click(); await flush();
      assert.deepEqual(h.notices(), [h.failureText]); h.assertNoReplay();
    });
  }
  for (const destination of ["fixture-b", null]) {
    test(`${kind}: account change to ${destination} clears an existing account's failure`, async () => {
      const h = await setup(kind, { done: false }); h.click(); await flush();
      assert.deepEqual(h.notices(), [h.failureText]);
      await h.client.setAccount(destination); await flush();
      assert.deepEqual(h.notices(), []); h.assertNoReplay();
    });
  }
  for (const accounts of [["fixture-b"], ["fixture-b", "fixture-a"], [null]]) {
    test(`${kind}: queued failure outcome cannot reappear after account boundary ${JSON.stringify(accounts)}`, async () => {
      const outcomeGate = deferred(), h = await setup(kind, { done: false, outcomeGate }); h.click(); await flush();
      for (const account of accounts) await h.client.setAccount(account);
      outcomeGate.resolve(); await flush();
      assert.deepEqual(h.notices(), []); h.assertNoReplay();
    });
  }
  for (const reopenBeforeOutcome of [false, true]) {
    test(`${kind}: a dismissed operation cannot restore its failure when reopenBeforeOutcome=${reopenBeforeOutcome}`, async () => {
      const outcomeGate = deferred(), h = await setup(kind, { done: false, outcomeGate }); h.click(); await flush();
      h.ui.setOpen(false);
      if (reopenBeforeOutcome) h.ui.setOpen(true);
      outcomeGate.resolve(); await flush();
      if (!reopenBeforeOutcome) { assert.equal(h.panel.children.length, 0); h.ui.setOpen(true); await flush(); }
      assert.deepEqual(h.notices(), []); h.assertNoReplay();
    });
  }
  test(`${kind}: rejected late pre-write read cannot clear a genuine write failure`, async () => {
    const h = await setup(kind, { done: false });
    const gate = deferred(); h.config.preReadGate = gate; h.config.beforeMutationDone = true;
    const oldRead = h.client.refresh("open");
    h.click(); await flush(); assert.deepEqual(h.notices(), [h.failureText]);
    gate.resolve(); assert.equal(await oldRead, false); await flush();
    assert.deepEqual(h.notices(), [h.failureText]); h.assertNoReplay();
  });
}

test("quiz: same-run FAILED completion clears transport failure without pretending the quiz passed", async () => {
  const h = await setup("quiz"); h.config.response = { data: quizView(true, DATE, RUN, "FAILED") };
  h.click(); await flush(); assert.equal(h.client.snapshot.status, "FAILED");
  assert.deepEqual(h.notices(), []); h.assertNoReplay();
});
test("quiz: another completed run cannot clear this run's failed-write hint", async () => {
  const h = await setup("quiz"); h.config.response = { data: quizView(true, DATE, "99999999-2222-4333-8444-555555555555") };
  h.click(); await flush(); assert.deepEqual(h.notices(), [h.failureText]); h.assertNoReplay();
});
test("quiz: successful recovery preserves the separate already-processed notice", async () => {
  const h = await setup("quiz", { failure: "refused" }); h.click(); await flush();
  assert.deepEqual(h.notices(), [DAILY_QUIZ_TEXT.refused]);
  await h.client.refresh(); assert.deepEqual(h.notices(), [DAILY_QUIZ_TEXT.refused]); h.assertNoReplay();
});
test("attendance: trusted claimed status clears its generic refused-write failure", async () => {
  const h = await setup("attendance", { failure: "refused" }); h.click(); await flush();
  assert.deepEqual(h.notices(), []); h.assertNoReplay();
});
