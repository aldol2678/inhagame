// INHA WORLD Lobby P2 · "오늘의 캠퍼스" card. The selector and the DOM card read the two existing clients
// (real Attendance / Daily Quiz clients over a fake rpc for the account-boundary cases); nothing here claims,
// starts, answers or computes a date.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createAttendanceClient, ATTENDANCE_STATE } from "../src/attendance/attendance-client.js";
import { createDailyQuizClient, DAILY_QUIZ_STATE } from "../src/daily-quiz/daily-quiz-client.js";
import { createLobbyDailyLoop, selectLobbyDailyLoop, LOBBY_DAILY_STATUS as S, LOBBY_DAILY_TEXT } from "../src/lobby/lobby-daily-loop.js";

const RUN = "11111111-2222-4333-8444-555555555555";
const att = (claimedToday, attendedDays = 8) => ({ claimedToday, attendedDays });
const quiz = (status, answered = 0) => ({ status, progress: { answered, total: 3, correct: answered } });
const ready = (attendance, q) => selectLobbyDailyLoop({
  attendanceState: ATTENDANCE_STATE.READY, attendance, quizState: DAILY_QUIZ_STATE.READY, quiz: q
});
const rowsOf = (model) => Object.fromEntries(model.rows.map((row) => [row.id, row]));

test("1. signed-out (either client) → card hidden", () => {
  assert.equal(selectLobbyDailyLoop({ attendanceState: ATTENDANCE_STATE.SIGNED_OUT, quizState: DAILY_QUIZ_STATE.SIGNED_OUT }), null);
  assert.equal(selectLobbyDailyLoop({}), null);
  assert.equal(selectLobbyDailyLoop({ attendanceState: ATTENDANCE_STATE.READY, attendance: att(true), quizState: DAILY_QUIZ_STATE.SIGNED_OUT }), null);
});

test("2. both loading → card shown, degraded text, no status claimed", () => {
  const model = selectLobbyDailyLoop({ attendanceState: ATTENDANCE_STATE.LOADING, quizState: DAILY_QUIZ_STATE.LOADING });
  assert.equal(model.note, "오늘 상태 불러오는 중…");
  assert.deepEqual(model.rows.map((row) => [row.status, row.text]), [[S.LOADING, "불러오는 중…"], [S.LOADING, "불러오는 중…"]]);
});

test("3. attendance not yet claimed → ACTIONABLE 오늘 출석 전", () => {
  const rows = rowsOf(ready(att(false, 3), quiz("AVAILABLE")));
  assert.deepEqual([rows.attendance.status, rows.attendance.text, rows.attendance.label], [S.ACTIONABLE, "오늘 출석 전", "📅 출석"]);
});

test("4. attendance claimed → COMPLETE with the server's attendedDays", () => {
  for (const days of [1, 8, 31]) {
    const rows = rowsOf(ready(att(true, days), quiz("AVAILABLE")));
    assert.deepEqual([rows.attendance.status, rows.attendance.text], [S.COMPLETE, `오늘 완료 · 이번 달 ${days}일`]);
  }
});

test("5. quiz AVAILABLE → ACTIONABLE 오늘 퀴즈 가능", () => {
  const rows = rowsOf(ready(att(false), quiz("AVAILABLE")));
  assert.deepEqual([rows.quiz.status, rows.quiz.text, rows.quiz.label], [S.ACTIONABLE, "오늘 퀴즈 가능", "📚 퀴즈"]);
});

test("6. quiz ACTIVE shows the server progress N/3", () => {
  for (const answered of [0, 1, 2]) {
    const rows = rowsOf(ready(att(false), quiz("ACTIVE", answered)));
    assert.deepEqual([rows.quiz.status, rows.quiz.text], [S.IN_PROGRESS, `진행 중 · ${answered}/3`]);
  }
});

test("7. quiz PASSED → COMPLETE 오늘 완료", () => {
  const rows = rowsOf(ready(att(true), quiz("PASSED", 3)));
  assert.deepEqual([rows.quiz.status, rows.quiz.text], [S.COMPLETE, "오늘 완료"]);
});

test("8. quiz FAILED → CLOSED 오늘 종료, never worded as success", () => {
  const model = ready(att(true), quiz("FAILED", 3));
  const rows = rowsOf(model);
  assert.deepEqual([rows.quiz.status, rows.quiz.text], [S.CLOSED, "오늘 종료"]);
  assert.notEqual(rows.quiz.status, S.COMPLETE);
  assert.doesNotMatch(rows.quiz.text, /완료|성공|실패/);
  assert.equal(model.note, LOBBY_DAILY_TEXT.allChecked, "both terminal → a neutral checked line, no score");
  assert.doesNotMatch(model.note, /성공|2\/2/);
});

test("aggregate note: only when both rows are terminal", () => {
  assert.equal(ready(att(true), quiz("PASSED", 3)).note, "오늘 할 일 확인 완료");
  assert.equal(ready(att(false), quiz("PASSED", 3)).note, "");
  assert.equal(ready(att(true), quiz("ACTIVE", 1)).note, "");
  assert.equal(ready(att(true), quiz("AVAILABLE")).note, "");
});

test("9. one unavailable / one ready; both unavailable hides the card", () => {
  const mixed = selectLobbyDailyLoop({ attendanceState: ATTENDANCE_STATE.UNAVAILABLE, quizState: DAILY_QUIZ_STATE.READY, quiz: quiz("AVAILABLE") });
  const rows = rowsOf(mixed);
  assert.deepEqual([rows.attendance.status, rows.attendance.text], [S.UNAVAILABLE, "확인하지 못했어요"]);
  assert.deepEqual([rows.quiz.status, rows.quiz.text], [S.ACTIONABLE, "오늘 퀴즈 가능"]);
  assert.equal(mixed.note, "");
  assert.equal(selectLobbyDailyLoop({ attendanceState: ATTENDANCE_STATE.UNAVAILABLE, quizState: DAILY_QUIZ_STATE.UNAVAILABLE }), null);
  const loadingAndFailed = selectLobbyDailyLoop({ attendanceState: ATTENDANCE_STATE.LOADING, quizState: DAILY_QUIZ_STATE.UNAVAILABLE });
  assert.deepEqual(loadingAndFailed.rows.map((row) => row.status), [S.LOADING, S.UNAVAILABLE]);
});

test("READY with an unusable snapshot is UNAVAILABLE, never guessed", () => {
  const rows = rowsOf(selectLobbyDailyLoop({ attendanceState: ATTENDANCE_STATE.READY, attendance: null, quizState: DAILY_QUIZ_STATE.READY, quiz: { status: "SOMETHING_ELSE" } }) ?? { rows: [] });
  assert.deepEqual(rows, {}, "both unusable → hidden");
  const one = rowsOf(ready({ claimedToday: "yes" }, quiz("PASSED", 3)));
  assert.equal(one.attendance.status, S.UNAVAILABLE);
});

function fakeNode() {
  const children = new Map();
  const node = {
    hidden: false, textContent: "", dataset: {}, attributes: {}, listeners: {},
    setAttribute(key, value) { this.attributes[key] = value; },
    addEventListener(type, fn) { this.listeners[type] = fn; },
    click() { this.listeners.click?.(); },
    querySelector(selector) { if (!children.has(selector)) children.set(selector, fakeNode()); return children.get(selector); }
  };
  return node;
}
function cardHarness({ attendanceRpc, quizRpc } = {}) {
  let attendanceData = attendanceRpc ?? null;
  let quizData = quizRpc ?? null;
  const calls = [];
  const rpcFor = (name, read) => async (rpc, args) => { calls.push([name, rpc, args]); const data = read(); return data ? { data, error: null } : { data: null, error: { message: "boom" } }; };
  const attendanceClient = createAttendanceClient({ getClient: () => ({ rpc: rpcFor("attendance", () => attendanceData) }) });
  const quizClient = createDailyQuizClient({ getClient: () => ({ rpc: rpcFor("quiz", () => quizData) }) });
  const els = { root: fakeNode(), note: fakeNode(), attendanceButton: fakeNode(), quizButton: fakeNode() };
  const opened = [];
  const card = createLobbyDailyLoop({
    root: els.root, noteElement: els.note, attendanceButton: els.attendanceButton, quizButton: els.quizButton,
    attendance: attendanceClient, quiz: quizClient,
    onOpenAttendance: () => opened.push("attendance"), onOpenQuiz: () => opened.push("quiz")
  });
  const label = (button) => [button.querySelector(".world-lobby-daily-row-label").textContent, button.querySelector(".world-lobby-daily-row-status").textContent];
  return { attendanceClient, quizClient, els, card, opened, calls, label,
    set(a, q) { attendanceData = a; quizData = q; } };
}
const serverAttendance = (claimedToday, attendedDays) => ({
  rewardDate: "2026-09-29", month: "2026-09", claimedToday, attendedDays, dailyCoin: 10,
  attendedDates: Array.from({ length: attendedDays }, (_, i) => `2026-09-${String(i + 1 + (claimedToday ? 0 : 0)).padStart(2, "0")}`)
    .map((d, i, all) => claimedToday && i === all.length - 1 ? "2026-09-29" : d),
  nextMilestone: attendedDays < 14 ? { days: attendedDays < 7 ? 7 : 14, bonusCoin: 70 } : null,
  milestones: [3, 7, 14, 21].map((days) => ({ days, claimed: attendedDays >= days, bonusCoin: days * 10 }))
});
const serverQuiz = (status, answered = 0) => ({
  status, rewardDate: "2026-09-29", runId: status === "AVAILABLE" ? null : RUN, progress: { answered, total: 3, correct: answered },
  question: status === "ACTIVE" ? { questionId: `q${answered}`, index: answered, prompt: "문제", options: ["가", "나", "다", "라"] } : null,
  rewardPreview: [{ grantType: "CURRENCY", targetId: "currency.inducoin", amount: 50 }], lastAnswer: null
});

test("DOM card: hidden for guests, then labels / statuses / aria follow the client change events", async () => {
  const h = cardHarness({ attendanceRpc: serverAttendance(false, 3), quizRpc: serverQuiz("AVAILABLE") });
  assert.equal(h.els.root.hidden, true, "no account bound yet → hidden");
  const loading = Promise.all([h.attendanceClient.setAccount("user-a"), h.quizClient.setAccount("user-a")]);
  assert.equal(h.els.root.hidden, false, "LOADING is shown degraded");
  assert.equal(h.els.note.textContent, "오늘 상태 불러오는 중…");
  await loading;
  assert.deepEqual(h.label(h.els.attendanceButton), ["📅 출석", "오늘 출석 전"]);
  assert.deepEqual(h.label(h.els.quizButton), ["📚 퀴즈", "오늘 퀴즈 가능"]);
  assert.equal(h.els.attendanceButton.dataset.status, "ACTIONABLE");
  assert.equal(h.els.attendanceButton.attributes["aria-label"], "출석부 열기 · 오늘 출석 전");
  assert.equal(h.els.quizButton.attributes["aria-label"], "오늘의 퀴즈 열기 · 오늘 퀴즈 가능");
  assert.equal(h.els.note.hidden, true);
  // Server-side change → refresh → card re-renders from the same event, no timer involved.
  h.set(serverAttendance(true, 8), serverQuiz("ACTIVE", 1));
  await Promise.all([h.attendanceClient.refresh("test"), h.quizClient.refresh("test")]);
  assert.deepEqual(h.label(h.els.attendanceButton), ["📅 출석", "오늘 완료 · 이번 달 8일"]);
  assert.deepEqual(h.label(h.els.quizButton), ["📚 퀴즈", "진행 중 · 1/3"]);
  h.set(serverAttendance(true, 8), serverQuiz("PASSED", 3));
  await h.quizClient.refresh("test");
  assert.deepEqual(h.label(h.els.quizButton), ["📚 퀴즈", "오늘 완료"]);
  assert.equal(h.els.note.textContent, "오늘 할 일 확인 완료");
  h.set(serverAttendance(true, 8), serverQuiz("FAILED", 3));
  await h.quizClient.refresh("test");
  assert.deepEqual(h.label(h.els.quizButton), ["📚 퀴즈", "오늘 종료"]);
});

test("10. account boundary: switching or signing out leaves no previous account's text", async () => {
  const h = cardHarness({ attendanceRpc: serverAttendance(true, 8), quizRpc: serverQuiz("PASSED", 3) });
  await Promise.all([h.attendanceClient.setAccount("user-a"), h.quizClient.setAccount("user-a")]);
  assert.equal(h.label(h.els.attendanceButton)[1], "오늘 완료 · 이번 달 8일");
  // Switch to user-b: both clients go LOADING (snapshot dropped) before any read returns.
  h.set(serverAttendance(false, 2), serverQuiz("AVAILABLE"));
  const switching = Promise.all([h.attendanceClient.setAccount("user-b"), h.quizClient.setAccount("user-b")]);
  assert.deepEqual([h.label(h.els.attendanceButton)[1], h.label(h.els.quizButton)[1]], ["불러오는 중…", "불러오는 중…"]);
  assert.doesNotMatch(JSON.stringify(h.card.status()), /8일|오늘 완료/);
  await switching;
  assert.deepEqual([h.label(h.els.attendanceButton)[1], h.label(h.els.quizButton)[1]], ["오늘 출석 전", "오늘 퀴즈 가능"]);
  // Sign out: hidden, model cleared.
  await Promise.all([h.attendanceClient.setAccount(null), h.quizClient.setAccount(null)]);
  assert.equal(h.els.root.hidden, true);
  assert.equal(h.card.status(), null);
});

test("row buttons only launch the existing panels: no RPC, no claim, no start", async () => {
  const h = cardHarness({ attendanceRpc: serverAttendance(false, 3), quizRpc: serverQuiz("AVAILABLE") });
  await Promise.all([h.attendanceClient.setAccount("user-a"), h.quizClient.setAccount("user-a")]);
  const callsBefore = h.calls.length;
  h.els.attendanceButton.click();
  h.els.quizButton.click();
  h.els.attendanceButton.click();
  assert.deepEqual(h.opened, ["attendance", "quiz", "attendance"]);
  assert.equal(h.calls.length, callsBefore, "a press performs no RPC at all");
  assert.equal(h.attendanceClient.snapshot.claimedToday, false);
  assert.equal(h.quizClient.snapshot.status, "AVAILABLE");
  h.card.setPanelOpen("quiz", true);
  assert.equal(h.els.quizButton.attributes["aria-expanded"], "true");
  h.card.setPanelOpen("quiz", false);
  assert.equal(h.els.quizButton.attributes["aria-expanded"], "false");
});

test("destroy unsubscribes from both clients", async () => {
  const h = cardHarness({ attendanceRpc: serverAttendance(false, 3), quizRpc: serverQuiz("AVAILABLE") });
  await Promise.all([h.attendanceClient.setAccount("user-a"), h.quizClient.setAccount("user-a")]);
  h.card.destroy();
  const before = h.label(h.els.quizButton)[1];
  h.set(serverAttendance(true, 8), serverQuiz("PASSED", 3));
  await h.quizClient.refresh("test");
  assert.equal(h.label(h.els.quizButton)[1], before);
});

test("module is presentation only: no RPC, Supabase, storage, timer or date logic", async () => {
  const source = await readFile(new URL("../src/lobby/lobby-daily-loop.js", import.meta.url), "utf8");
  const code = source.replace(/\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\.rpc\b|rpc\(|supabase|localStorage|sessionStorage|indexedDB/i);
  assert.doesNotMatch(code, /setInterval|setTimeout|requestAnimationFrame|new Date|Date\.now|Intl\./);
  assert.doesNotMatch(code, /\.(claim|start|answer|setAccount|refresh)\(/, "never calls a client action");
  assert.deepEqual([...code.matchAll(/^import .* from "(.+)";$/gm)].map((m) => m[1]).sort(),
    ["../attendance/attendance-client.js", "../daily-quiz/daily-quiz-client.js"]);
});

test("HTML + main.js wiring: reuses the two clients and panels, no new client / owner / poll", async () => {
  const html = await readFile(new URL("../campus/index.html", import.meta.url), "utf8");
  const main = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
  const slot = html.slice(html.indexOf('class="world-lobby-entry-slot"'), html.indexOf('id="back-gate-lock-dialog"'));
  assert.match(slot, /<aside id="lobby-daily-loop"[^>]*aria-label="오늘의 캠퍼스"[^>]*hidden>/);
  assert.match(slot, /<button id="lobby-daily-attendance"[^>]*type="button"[^>]*aria-controls="attendance-panel"[^>]*aria-expanded="false"/);
  assert.match(slot, /<button id="lobby-daily-quiz"[^>]*type="button"[^>]*aria-controls="daily-quiz-panel"[^>]*aria-expanded="false"/);
  assert.ok(slot.indexOf('id="main-gate-start"') < slot.indexOf('id="lobby-daily-loop"'), "under the Main Gate CTA");
  assert.ok(slot.indexOf('id="lobby-quest-highlight"') < slot.indexOf('id="main-gate-start"'), "quest highlight stays above the CTA");
  assert.ok(slot.indexOf('id="lobby-daily-loop"') < slot.indexOf('id="resume-last-location"'));
  const wiring = main.slice(main.indexOf("const lobbyDailyLoop = createLobbyDailyLoop({"));
  const block = wiring.slice(0, wiring.indexOf("});") + 3);
  assert.match(block, /attendance,\s*quiz: dailyQuiz,/);
  assert.match(block, /onOpenAttendance: \(\) => attendancePanel\.setOpen\(true\)/);
  assert.match(block, /onOpenQuiz: \(\) => dailyQuizPanel\.setOpen\(true\)/);
  assert.equal((main.match(/createDailyQuizClient\(/g) ?? []).length, 1, "one quiz client");
  assert.equal((main.match(/createAttendanceClient\(/g) ?? []).length, 1, "one attendance client");
  assert.match(main, /lobbyDailyLoop\.setPanelOpen\("quiz", open\)/);
  assert.match(main, /lobbyDailyLoop\.setPanelOpen\("attendance", open\)/);
  assert.doesNotMatch(main, /ownerId: "lobby-daily/, "no new InputFocus owner");
  const css = await readFile(new URL("../styles.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /body\[data-lobby-shell="true"\] > #(daily-quiz|attendance)-panel/, "the two panels stay openable in the lobby");
  assert.match(css, /body\[data-lobby-shell="true"\] > #shop-panel,\s*body\[data-lobby-shell="true"\] > #inventory-panel,\s*body\[data-lobby-shell="true"\] > #wardrobe-panel,/, "shop / inventory / wardrobe stay hidden in the lobby");
});
