import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createDailyQuizClient, parseDailyQuiz, DAILY_QUIZ_RPC, DAILY_QUIZ_STATE } from "../src/daily-quiz/daily-quiz-client.js";
import { createDailyQuizPanel, rewardLines, DAILY_QUIZ_TEXT } from "../src/daily-quiz/daily-quiz-panel.js";
import { rewardToastMessage } from "../src/events/zombie-university-2026/event-ui.js";

const RUN = "11111111-2222-4333-8444-555555555555";
const preview = [{ grantType: "CURRENCY", targetId: "currency.induck_coin", amount: 50 }, { grantType: "EXP", targetId: "exp.campus", amount: 25 }];
const reward = Object.freeze({
  rewardId: "reward.daily.campus_quiz", rewardVersion: 1, rewardTransactionId: "tx-quiz", status: "SUCCESS", replayed: false,
  completedAt: "2026-09-29T00:00:00Z",
  entries: [
    { grantType: "CURRENCY", targetId: "currency.induck_coin", requested: 50, granted: 50, status: "GRANTED", reason: null },
    { grantType: "EXP", targetId: "exp.campus", requested: 25, granted: 25, status: "GRANTED", reason: null }
  ]
});
const QUESTIONS = ["quiz.campus.a", "quiz.campus.b", "quiz.campus.c"];
const CORRECT = { "quiz.campus.a": 0, "quiz.campus.b": 1, "quiz.campus.c": 2 };
const question = (index) => ({ questionId: QUESTIONS[index], index, prompt: `문제 ${index + 1}`, options: ["가", "나", "다", "라"] });

// A server stand-in with the P1e contract: one run per day, one answer per question, 2/3 = PASSED.
function fakeServer() {
  let run = null;
  const calls = [];
  const view = (extra = {}) => {
    const base = { rewardDate: "2026-09-29", rewardPreview: preview };
    if (!run) return { ...base, status: "AVAILABLE", progress: { answered: 0, total: 3, correct: 0 } };
    return { ...base, status: run.status, runId: RUN, completedAt: null,
      progress: { answered: run.answered, total: 3, correct: run.correct },
      ...(run.status === "ACTIVE" ? { question: question(run.answered) } : {}), ...extra };
  };
  const rpc = async (fn, args) => {
    calls.push({ fn, args });
    if (fn === DAILY_QUIZ_RPC.READ) return { data: view(), error: null };
    if (fn === DAILY_QUIZ_RPC.START) {
      run ??= { status: "ACTIVE", answered: 0, correct: 0 };
      return { data: view(), error: null };
    }
    if (fn === DAILY_QUIZ_RPC.ANSWER) {
      if (!run || run.status !== "ACTIVE" || args.p_question_id !== QUESTIONS[run.answered])
        return { data: null, error: { message: "QUIZ_ALREADY_ANSWERED" } };
      const correct = CORRECT[args.p_question_id] === args.p_answer_index;
      const index = run.answered;
      run.answered += 1;
      run.correct += correct ? 1 : 0;
      if (run.answered === 3) run.status = run.correct >= 2 ? "PASSED" : "FAILED";
      const lastAnswer = { questionId: args.p_question_id, index, selectedIndex: args.p_answer_index, correct };
      return { data: view({ lastAnswer, ...(run.status === "PASSED" ? { reward } : {}) }), error: null };
    }
    throw new Error(`unexpected ${fn}`);
  };
  return { rpc, calls, get run() { return run; } };
}
function harness(server = fakeServer()) {
  const rewards = [];
  const quiz = createDailyQuizClient({ getClient: () => ({ rpc: server.rpc }), onReward: r => rewards.push(r) });
  return { quiz, rewards, server };
}

test("start: AVAILABLE → ACTIVE question 1, and the request carries no date, user or reward", async () => {
  const { quiz, server } = harness();
  await quiz.setAccount("user-a");
  assert.equal(quiz.state, DAILY_QUIZ_STATE.READY);
  assert.equal(quiz.snapshot.status, "AVAILABLE");
  const result = await quiz.start();
  assert.equal(result.outcome, "OK");
  assert.equal(quiz.snapshot.status, "ACTIVE");
  assert.equal(quiz.snapshot.question.index, 0);
  await quiz.answer(0);
  for (const { args } of server.calls) {
    if (!args) continue;
    assert.deepEqual(Object.keys(args).sort(), ["p_answer_index", "p_question_id", "p_run_id"]);
  }
});

test("resume ACTIVE: a new client for the same account reads the open run", async () => {
  const server = fakeServer();
  await harness(server).quiz.setAccount("user-a").then(() => undefined);
  const first = harness(server);
  await first.quiz.setAccount("user-a");
  await first.quiz.start();
  await first.quiz.answer(0);
  const second = harness(server);
  await second.quiz.setAccount("user-a");
  assert.equal(second.quiz.snapshot.status, "ACTIVE");
  assert.equal(second.quiz.snapshot.question.index, 1);
});

test("correct / wrong feedback, then PASS with exactly one reward callback", async () => {
  const { quiz, rewards } = harness();
  await quiz.setAccount("user-a");
  await quiz.start();
  await quiz.answer(0);
  assert.equal(quiz.snapshot.lastAnswer.correct, true);
  await quiz.answer(0);
  assert.equal(quiz.snapshot.lastAnswer.correct, false);
  assert.equal(rewards.length, 0);
  const last = await quiz.answer(2);
  assert.equal(last.outcome, "OK");
  assert.equal(quiz.snapshot.status, "PASSED");
  assert.equal(rewards.length, 1);
  assert.deepEqual(rewards[0], reward, "the server result is passed through unchanged");
  await quiz.refresh();
  await quiz.start();
  assert.equal(rewards.length, 1, "refresh and a repeated start never call onReward");
});

test("FAIL: 1/3 correct ends the day without a reward", async () => {
  const { quiz, rewards } = harness();
  await quiz.setAccount("user-a");
  await quiz.start();
  await quiz.answer(0);
  await quiz.answer(0);
  await quiz.answer(0);
  assert.equal(quiz.snapshot.status, "FAILED");
  assert.equal(quiz.snapshot.progress.correct, 1);
  assert.equal(rewards.length, 0);
  assert.equal((await quiz.answer(1)).code, "NO_ACTIVE_QUESTION");
});

test("duplicate click lock: a second answer while one is in flight is BUSY and never sent", async () => {
  let release;
  const server = fakeServer();
  const gate = new Promise(resolve => { release = resolve; });
  const slowRpc = async (fn, args) => { if (fn === DAILY_QUIZ_RPC.ANSWER) await gate; return server.rpc(fn, args); };
  const quiz = createDailyQuizClient({ getClient: () => ({ rpc: slowRpc }) });
  await quiz.setAccount("user-a");
  await quiz.start();
  const first = quiz.answer(0);
  assert.equal(quiz.pending, true);
  assert.equal((await quiz.answer(1)).outcome, "BUSY");
  release();
  assert.equal((await first).outcome, "OK");
  assert.equal(server.calls.filter(c => c.fn === DAILY_QUIZ_RPC.ANSWER).length, 1);
});

test("logout / account switch: no late state or reward from the old account", async () => {
  let release;
  const server = fakeServer();
  const gate = new Promise(resolve => { release = resolve; });
  const rewards = [];
  let hold = false;
  const rpc = async (fn, args) => { if (hold && fn === DAILY_QUIZ_RPC.ANSWER) await gate; return server.rpc(fn, args); };
  const quiz = createDailyQuizClient({ getClient: () => ({ rpc }), onReward: r => rewards.push(r) });
  await quiz.setAccount("user-a");
  await quiz.start();
  await quiz.answer(0);
  await quiz.answer(1);
  hold = true;
  const last = quiz.answer(2);
  await quiz.setAccount(null);
  release();
  assert.equal((await last).outcome, "STALE");
  assert.equal(rewards.length, 0, "the old account's reward is not shown");
  assert.equal(quiz.state, DAILY_QUIZ_STATE.SIGNED_OUT);
  assert.equal(quiz.snapshot, null);
});

test("malformed responses are rejected: no callback, no fake PASSED", async () => {
  assert.equal(parseDailyQuiz({ status: "ACTIVE", rewardDate: "2026-09-29", runId: RUN, rewardPreview: preview,
    progress: { answered: 0, total: 3, correct: 0 }, question: { ...question(0), options: ["a", "b", "c"] } }), null);
  assert.equal(parseDailyQuiz({ status: "WON", rewardDate: "2026-09-29", rewardPreview: preview, progress: { answered: 0, total: 3, correct: 0 } }), null);
  assert.equal(parseDailyQuiz({ status: "PASSED", rewardDate: "2026-09-29", runId: RUN, rewardPreview: preview,
    progress: { answered: 2, total: 3, correct: 2 } }), null, "PASSED needs 3 answers");
  const bad = { rpc: async (fn) => fn === DAILY_QUIZ_RPC.READ
    ? { data: { status: "ACTIVE", rewardDate: "2026-09-29", runId: RUN, rewardPreview: preview, progress: { answered: 0, total: 3, correct: 0 }, question: question(0) }, error: null }
    : { data: { status: "PASSED", rewardDate: "2026-09-29", runId: RUN, rewardPreview: preview, progress: { answered: 3, total: 3, correct: 3 },
        reward: { ...reward, status: "FAILED" } }, error: null } };
  const rewards = [];
  const quiz = createDailyQuizClient({ getClient: () => bad, onReward: r => rewards.push(r) });
  await quiz.setAccount("user-a");
  const result = await quiz.answer(0);
  assert.equal(result.code, "MALFORMED_RESPONSE");
  assert.equal(rewards.length, 0);
});

test("refused answers (already answered) re-read the server state", async () => {
  const server = fakeServer();
  const quiz = createDailyQuizClient({ getClient: () => ({ rpc: async (fn, args) => fn === DAILY_QUIZ_RPC.ANSWER
    ? { data: null, error: { message: "QUIZ_ALREADY_ANSWERED" } } : server.rpc(fn, args) }) });
  await quiz.setAccount("user-a");
  await quiz.start();
  const reads = server.calls.filter(c => c.fn === DAILY_QUIZ_RPC.READ).length;
  const result = await quiz.answer(0);
  assert.deepEqual([result.outcome, result.code], ["REFUSED", "QUIZ_ALREADY_ANSWERED"]);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(server.calls.filter(c => c.fn === DAILY_QUIZ_RPC.READ).length, reads + 1);
});

test("toast and panel text come from the server reward / preview", () => {
  assert.equal(rewardToastMessage({ status: "CLAIMED", rewardResult: { status: "SUCCESS", entries: reward.entries } }).text,
    "🎁 보상 획득\n+50 인덕코인\n+25 EXP");
  assert.deepEqual(rewardLines(preview), ["🪙 50 인덕코인", "✨ 25 EXP"]);
  assert.deepEqual(rewardLines(preview, { earned: true }), ["+50 인덕코인", "+25 EXP"]);
  assert.equal(DAILY_QUIZ_TEXT.rule, "3문제 중 2개 정답 시 보상");
});

// Minimal DOM for the panel.
function fakeDoc() {
  const make = (tag) => {
    const node = { tagName: tag, children: [], dataset: {}, hidden: false, disabled: false, textContent: "", className: "",
      listeners: {}, attributes: {},
      append(...kids) { this.children.push(...kids); }, replaceChildren(...kids) { this.children = kids; },
      addEventListener(type, fn) { this.listeners[type] = fn; }, setAttribute(k, v) { this.attributes[k] = v; },
      focus() {}, click() { this.listeners.click?.(); } };
    return node;
  };
  return { createElement: make, addEventListener() {} , make };
}
const all = (node) => [node, ...node.children.flatMap(all)];
const text = (node) => all(node).map(n => n.textContent).filter(Boolean).join("|");

test("panel: AVAILABLE → start → question with 4 options → PASSED card", async () => {
  const doc = fakeDoc();
  const panel = doc.make("section");
  const { quiz } = harness();
  const ui = createDailyQuizPanel({ panel, quiz, doc });
  await quiz.setAccount("user-a");
  ui.setOpen(true);
  assert.match(text(panel), /📚 오늘의 캠퍼스 퀴즈\|×\|오늘의 퀴즈\|3문제 중 2개 정답 시 보상\|🪙 50 인덕코인\|✨ 25 EXP\|퀴즈 시작/);
  all(panel).find(n => n.textContent === "퀴즈 시작").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.match(text(panel), /문제 1 \/ 3/);
  const options = () => all(panel).filter(n => n.className.split(" ").includes("daily-quiz-option"));
  assert.equal(options().length, 4);
  for (const pick of [0, 1, 2]) {
    options()[pick].click();
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  assert.match(text(panel), /정답이에요!\|오늘의 퀴즈 완료!\|3 \/ 3 정답\|\+50 인덕코인\|\+25 EXP/);
});

test("main.js wiring: HUD menu entry, own input owner, account binding, toast + authority re-reads only", async () => {
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const inputRuntime = await readFile(new URL("../src/input/world-input-runtime.js", import.meta.url), "utf8");
  const html = await readFile(new URL("../campus/index.html", import.meta.url), "utf8");
  assert.match(html, /id="hud-menu"[\s\S]*id="open-daily-quiz"[^>]*>📚 오늘의 퀴즈<\/button>/);
  assert.match(html, /id="daily-quiz-panel"[^>]*role="dialog"/);
  assert.match(inputRuntime, /"daily-quiz", INPUT_FOCUS_POLICY\.BLOCKING_UI/);
  assert.match(main, /void dailyQuiz\.setAccount\(identity \? online\?\.userId \?\? null : null\)/);
  const block = main.slice(main.indexOf("const dailyQuiz = createDailyQuizClient"), main.indexOf("\n});", main.indexOf("const dailyQuiz = createDailyQuizClient")));
  assert.match(block, /mcmEventUi\.showReward\(/);
  assert.match(block, /progression\.refresh\("reward"\)/);
  assert.match(block, /grantType === "CURRENCY"\)\) void wallet\.refresh\("reward"\)/);
  assert.doesNotMatch(block, /\+ *(25|50)\b|level|balance|Date\.now|new Date/i, "no client coin, EXP, Level or date math");
  const client = await readFile(new URL("../src/daily-quiz/daily-quiz-client.js", import.meta.url), "utf8");
  assert.doesNotMatch(client, /Date\.now|new Date|localStorage|Intl\./, "the client never decides the day");
});
