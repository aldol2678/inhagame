// INHA WORLD · Main Lobby "오늘의 캠퍼스" card (P2). Presentation only: it summarises what the Campus
// Attendance (P1f) and Campus Daily Quiz (P1e) clients already hold and opens their existing panels.
// No RPC, date, reward or wallet logic lives here, and a card press never claims or starts anything.

import { ATTENDANCE_STATE } from "../attendance/attendance-client.js";
import { DAILY_QUIZ_STATE, DAILY_QUIZ_STATUS } from "../daily-quiz/daily-quiz-client.js";

export const LOBBY_DAILY_STATUS = Object.freeze({
  LOADING: "LOADING",
  ACTIONABLE: "ACTIONABLE",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETE: "COMPLETE",
  CLOSED: "CLOSED",
  UNAVAILABLE: "UNAVAILABLE"
});
const S = LOBBY_DAILY_STATUS;

export const LOBBY_DAILY_TEXT = Object.freeze({
  title: "오늘의 캠퍼스",
  loadingAll: "오늘 상태 불러오는 중…",
  loading: "불러오는 중…",
  unavailable: "확인하지 못했어요",
  allChecked: "오늘 할 일 확인 완료",
  attendanceLabel: "📅 출석",
  quizLabel: "📚 퀴즈",
  attendanceOpen: "출석부 열기",
  quizOpen: "오늘의 퀴즈 열기"
});

const attendanceRow = (state, snapshot) => {
  const base = { id: "attendance", label: LOBBY_DAILY_TEXT.attendanceLabel };
  if (state === ATTENDANCE_STATE.LOADING) return { ...base, status: S.LOADING, text: LOBBY_DAILY_TEXT.loading };
  if (state === ATTENDANCE_STATE.READY && typeof snapshot?.claimedToday === "boolean" && Number.isSafeInteger(snapshot.attendedDays)) {
    return snapshot.claimedToday
      ? { ...base, status: S.COMPLETE, text: `오늘 완료 · 이번 달 ${snapshot.attendedDays}일` }
      : { ...base, status: S.ACTIONABLE, text: "오늘 출석 전" };
  }
  return { ...base, status: S.UNAVAILABLE, text: LOBBY_DAILY_TEXT.unavailable };
};

const quizRow = (state, snapshot) => {
  const base = { id: "quiz", label: LOBBY_DAILY_TEXT.quizLabel };
  if (state === DAILY_QUIZ_STATE.LOADING) return { ...base, status: S.LOADING, text: LOBBY_DAILY_TEXT.loading };
  if (state === DAILY_QUIZ_STATE.READY) {
    switch (snapshot?.status) {
      case DAILY_QUIZ_STATUS.AVAILABLE: return { ...base, status: S.ACTIONABLE, text: "오늘 퀴즈 가능" };
      case DAILY_QUIZ_STATUS.ACTIVE:
        return { ...base, status: S.IN_PROGRESS, text: `진행 중 · ${snapshot.progress.answered}/${snapshot.progress.total}` };
      case DAILY_QUIZ_STATUS.PASSED: return { ...base, status: S.COMPLETE, text: "오늘 완료" };
      case DAILY_QUIZ_STATUS.FAILED: return { ...base, status: S.CLOSED, text: "오늘 종료" };
      default: break;
    }
  }
  return { ...base, status: S.UNAVAILABLE, text: LOBBY_DAILY_TEXT.unavailable };
};

/**
 * Two client reads → the card model, or null when the card stays hidden: a guest / signed-out player (either
 * client SIGNED_OUT) or both clients unavailable. The client state is the only account signal: a switched
 * account drops its snapshot inside the clients, so nothing stale can be read here.
 */
export function selectLobbyDailyLoop({ attendanceState, attendance = null, quizState, quiz = null } = {}) {
  if (attendanceState === ATTENDANCE_STATE.SIGNED_OUT || quizState === DAILY_QUIZ_STATE.SIGNED_OUT) return null;
  const rows = [attendanceRow(attendanceState, attendance), quizRow(quizState, quiz)];
  if (rows.every((row) => row.status === S.UNAVAILABLE)) return null;
  let note = "";
  if (rows.every((row) => row.status === S.LOADING)) note = LOBBY_DAILY_TEXT.loadingAll;
  else if (rows.every((row) => row.status === S.COMPLETE || row.status === S.CLOSED)) note = LOBBY_DAILY_TEXT.allChecked;
  return { rows, note };
}

export function createLobbyDailyLoop({
  root,
  noteElement,
  attendanceButton,
  quizButton,
  attendance,
  quiz,
  onOpenAttendance = () => {},
  onOpenQuiz = () => {}
} = {}) {
  const buttons = { attendance: attendanceButton, quiz: quizButton };
  const actions = { attendance: onOpenAttendance, quiz: onOpenQuiz };
  const openLabels = { attendance: LOBBY_DAILY_TEXT.attendanceOpen, quiz: LOBBY_DAILY_TEXT.quizOpen };
  let current = null;
  let lastKey = null;

  const update = () => {
    const next = selectLobbyDailyLoop({
      attendanceState: attendance?.state, attendance: attendance?.snapshot,
      quizState: quiz?.state, quiz: quiz?.snapshot
    });
    const key = JSON.stringify(next);
    if (key === lastKey) return current;
    lastKey = key;
    current = next;
    if (root) root.hidden = !next;
    if (!next) return null;
    if (noteElement) {
      noteElement.textContent = next.note;
      noteElement.hidden = !next.note;
    }
    for (const row of next.rows) {
      const button = buttons[row.id];
      if (!button) continue;
      button.dataset.status = row.status;
      button.querySelector(".world-lobby-daily-row-label").textContent = row.label;
      button.querySelector(".world-lobby-daily-row-status").textContent = row.text;
      button.setAttribute("aria-label", `${openLabels[row.id]} · ${row.text}`);
    }
    return next;
  };

  // A launcher only: the panel owns the open state, the claim button and the quiz start button.
  for (const id of Object.keys(buttons)) buttons[id]?.addEventListener("click", () => actions[id]());
  const offAttendance = attendance?.onChange?.(update);
  const offQuiz = quiz?.onChange?.(update);
  update();

  return {
    update,
    /** Mirrors the panel's own open state onto its launcher (aria-expanded). */
    setPanelOpen(id, open) { buttons[id]?.setAttribute("aria-expanded", String(open === true)); },
    status: () => current ? { note: current.note, rows: current.rows.map((row) => ({ ...row })) } : null,
    destroy() { offAttendance?.(); offQuiz?.(); }
  };
}
