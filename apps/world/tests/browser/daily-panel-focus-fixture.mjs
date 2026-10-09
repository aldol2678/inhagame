// Synthetic RPC transport only; the production panels and account-scoped clients run unchanged.
import { createAttendanceClient, ATTENDANCE_RPC } from '../../src/attendance/attendance-client.js';
import { createDailyQuizClient, DAILY_QUIZ_RPC } from '../../src/daily-quiz/daily-quiz-client.js';
import { createAttendancePanel } from '../../src/attendance/attendance-panel.js';
import { createDailyQuizPanel } from '../../src/daily-quiz/daily-quiz-panel.js';

export const attendanceView = (done = false, date = '2026-10-07') => ({
  rewardDate: date, month: date.slice(0, 7), claimedToday: done, attendedDays: Number(done),
  attendedDates: done ? [date] : [], dailyCoin: 10, nextMilestone: { days: 3, bonusCoin: 30 },
  milestones: [3, 7, 14, 21].map(days => ({ days, bonusCoin: 30, claimed: false }))
});
export const quizView = (index = 0, { status = 'ACTIVE', runId = '11111111-2222-4333-8444-555555555555', date = '2026-10-07' } = {}) => ({
  rewardDate: date, status, runId: status === 'AVAILABLE' ? null : runId,
  progress: { answered: ['PASSED', 'FAILED'].includes(status) ? 3 : index, correct: 0, total: 3 }, rewardPreview: [],
  question: status === 'ACTIVE' ? { questionId: `fixture-question-${index}`, index,
    prompt: `합성 퀴즈 ${index + 1}: 서버 응답을 기다려도 선택 위치를 유지합니다.`,
    options: ['첫 번째 선택지', '두 번째 선택지', '세 번째 선택지', '네 번째 선택지'] } : null
});
export const ok = data => ({ data, error: null });
export const failed = { data: null, error: { message: 'SYNTHETIC_UNAVAILABLE' } };

export function createDailyPanelFocusFixture({ kind, root, doc = globalThis.document, onOpenChange = () => {} }) {
  if (!['attendance', 'quiz'].includes(kind)) throw new Error('Unknown fixture kind');
  const make = (tag, id, text) => { const node = doc.createElement(tag); node.id = id; if (text) node.textContent = text; return node; };
  const opener = make('button', 'opener', '창 열기'), outside = make('button', 'outside', '다른 화면');
  opener.type = outside.type = 'button';
  const panel = make('section', 'daily-panel');
  panel.className = 'profile-panel shop-panel inventory-panel'; panel.hidden = true;
  panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', kind === 'attendance' ? 'attendance-panel-title' : 'daily-quiz-panel-title');
  root.replaceChildren(opener, outside, panel);
  const requests = [], changes = [];
  const transport = { rpc(fn, args) { return new Promise(resolve => requests.push({ fn, args, resolve, settled: false })); } };
  const client = kind === 'attendance' ? createAttendanceClient({ getClient: () => transport }) : createDailyQuizClient({ getClient: () => transport });
  client.onChange(change => changes.push(change));
  const ui = kind === 'attendance' ? createAttendancePanel({ panel, attendance: client, doc, onOpenChange })
    : createDailyQuizPanel({ panel, quiz: client, doc, onOpenChange });
  opener.addEventListener('click', () => ui.setOpen(true));
  const readRpc = kind === 'attendance' ? ATTENDANCE_RPC.READ : DAILY_QUIZ_RPC.READ;
  return { kind, panel, opener, outside, client, ui, requests, changes, readRpc,
    view: kind === 'attendance' ? attendanceView : quizView,
    settle(index, response) { const request = requests[index]; if (!request || request.settled) throw new Error(`No pending request ${index}`); request.settled = true; request.resolve(response); },
    snapshot: () => ({ open: ui.open, state: client.state, pending: client.pending, requests: requests.map(({ fn, args, settled }) => ({ fn, args, settled })) })
  };
}
