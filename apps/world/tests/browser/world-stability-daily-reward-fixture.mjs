// Actual production panels/read-models and main composition; synthetic server only.
import { createAttendanceClient, ATTENDANCE_RPC } from '../../src/attendance/attendance-client.js';
import { createDailyQuizClient, DAILY_QUIZ_RPC } from '../../src/daily-quiz/daily-quiz-client.js';
import { createAttendancePanel } from '../../src/attendance/attendance-panel.js';
import { createDailyQuizPanel } from '../../src/daily-quiz/daily-quiz-panel.js';
import { createWalletClient, WALLET_RPC, INDUCK_COIN } from '../../src/wallet/wallet-client.js';
import { createProgressionClient, PROGRESSION_RPC } from '../../src/progression/progression-client.js';
import { createProgressionHud, levelUpMessage } from '../../src/progression/progression-hud.js';

export function extractDailyComposition(source) {
  const startMarker = 'const dailyQuiz = createDailyQuizClient({', endMarker = '// Wardrobe P0:';
  const start = source.indexOf(startMarker), end = source.indexOf(endMarker, start);
  if (start < 0 || end < start || source.indexOf(startMarker, start + 1) >= 0) throw new Error('Ambiguous or missing daily main composition');
  return source.slice(start, end);
}

const ok = data => ({ data, error: null });
const flush = async () => { for (let i = 0; i < 40; i++) await Promise.resolve(); };
const attendanceView = done => ({ rewardDate: '2026-10-05', month: '2026-10', claimedToday: done,
  attendedDays: Number(done), attendedDates: done ? ['2026-10-05'] : [], dailyCoin: 10,
  nextMilestone: { days: 3, bonusCoin: 30 }, milestones: [3, 7, 14, 21].map(days => ({ days, bonusCoin: 30, claimed: false })) });
const quizView = done => ({ rewardDate: '2026-10-05', status: done ? 'PASSED' : 'ACTIVE',
  runId: '11111111-2222-4333-8444-555555555555', progress: { answered: done ? 3 : 2, correct: done ? 3 : 2, total: 3 }, rewardPreview: [],
  ...(done ? {} : { question: { questionId: 'synthetic-final', index: 2, prompt: '마지막 문제 · 합성 서버 응답 유실 검증', options: ['정답 선택', '옵션 2', '옵션 3', '옵션 4'] } }) });
const progressionView = done => done
  ? { totalExp: 120, level: 2, currentLevelStartExp: 100, nextLevelExp: 300, progressExp: 20, progressRequired: 200, maxDefinedLevel: 10, isMaxLevel: false }
  : { totalExp: 90, level: 1, currentLevelStartExp: 0, nextLevelExp: 100, progressExp: 90, progressRequired: 100, maxDefinedLevel: 10, isMaxLevel: false };

export function createDailyRewardFixture({ root, mainComposition, kind, scenario, doc = globalThis.document, timerOptions = {} }) {
  if (!['attendance', 'quiz'].includes(kind) || !['lost-response', 'malformed-response', 'read-failure-retry', 'late-write', 'late-readback'].includes(scenario)) throw new Error('Unknown daily fixture case');
  const calls = [], changes = [], toasts = [], levelToasts = [], held = [], accounts = new Map(), failed = new Set();
  let account = null, generation = 0, serverCommits = 0, mutationOutcome = null, mutationClicks = 0, trustedMutationClicks = 0, retryClicks = 0, trustedRetryClicks = 0, disposed = false;
  const mutationRpc = kind === 'attendance' ? ATTENDANCE_RPC.CLAIM : DAILY_QUIZ_RPC.ANSWER;
  const statusRpc = kind === 'attendance' ? ATTENDANCE_RPC.READ : DAILY_QUIZ_RPC.READ;
  const el = (tag, className) => { const node = doc.createElement(tag); node.className = className; node.style ??= {}; return node; };
  const walletNode = el('div', 'daily-wallet'), hudRoot = el('div', 'daily-hud'), panel = el('section', 'daily-panel');
  const nodes = Object.fromEntries(['pill', 'pillLevel', 'pillExp', 'pillBar', 'pillFill', 'badge', 'badgeLevel', 'badgeBar', 'badgeFill', 'menuLine'].map(name => [name, el('span', `daily-${name}`)]));
  nodes.pillBar.append(nodes.pillFill); nodes.pill.append(nodes.pillLevel, nodes.pillExp, nodes.pillBar);
  nodes.badgeBar.append(nodes.badgeFill); nodes.badge.append(nodes.badgeLevel, nodes.badgeBar);
  hudRoot.append(nodes.pill, nodes.badge, nodes.menuLine); root.replaceChildren(walletNode, hudRoot, panel); root.hidden = false;
  panel.addEventListener('click', event => {
    if (disposed) return;
    const text = event.target?.textContent;
    if (text === (kind === 'attendance' ? '오늘 출석하기' : '정답 선택')) {
      mutationClicks++; if (event.isTrusted) trustedMutationClicks++;
    } else if (text === '다시 시도') { retryClicks++; if (event.isTrusted) trustedRetryClicks++; }
  }, true);
  const hold = () => new Promise(resolve => held.push(resolve));
  const rpc = async (fn, args) => {
    if (!account) throw new Error('Synthetic RPC without an account');
    const record = accounts.get(account), requestGeneration = generation;
    calls.push({ fn, args: args ?? null, account, generation: requestGeneration });
    if (fn === mutationRpc) {
      record.done = true; serverCommits++; // Commit before losing/mangling the reply.
      if (scenario === 'late-write') await hold();
      if (scenario === 'malformed-response') return ok({ ...(kind === 'attendance' ? attendanceView(true) : quizView(true)), rewardDate: ['2026-10-05'] });
      throw new Error('Synthetic mutation committed, response lost');
    }
    const done = record.done;
    if (done && scenario === 'read-failure-retry' && !failed.has(fn)) {
      failed.add(fn); return { error: { message: 'Synthetic recovery query unavailable' } };
    }
    const response = fn === statusRpc ? (kind === 'attendance' ? attendanceView(done) : quizView(done))
      : fn === WALLET_RPC ? { currencies: [{ id: INDUCK_COIN, balance: done ? 110 : 100 }] }
      : fn === PROGRESSION_RPC ? progressionView(done && kind === 'quiz') : null;
    if (!response) throw new Error(`Unexpected synthetic RPC ${fn}`);
    // Capture the old server view before delaying it; later account reads are independent.
    if (done && scenario === 'late-readback' && requestGeneration === 1) await hold();
    return ok(response);
  };
  const readOptions = { getClient: () => ({ rpc }), rewardRetryDelays: [250, 500, 1000], ...timerOptions };
  const wallet = createWalletClient(readOptions), progression = createProgressionClient(readOptions);
  const hud = createProgressionHud(nodes);
  wallet.onChange(change => { changes.push({ client: 'wallet', state: change.state, reason: change.reason, account: change.accountId }); walletNode.textContent = `지갑 · ${wallet.balance() ?? '조회 불가'} 인덕코인`; });
  progression.onChange(change => {
    changes.push({ client: 'progression', state: change.state, reason: change.reason, account: change.accountId });
    hud.render(change.state, change.snapshot); const message = levelUpMessage(change); if (message) levelToasts.push(message);
  });
  // This is the exact source slice read from the checked-out main.js by the Node runner.
  const composed = new Function('createDailyQuizClient', 'createAttendanceClient', 'online', 'wallet', 'progression', 'inventory', 'mcmEventUi', 'rewardLine',
    `${mainComposition}; return { dailyQuiz, attendance };`)(createDailyQuizClient, createAttendanceClient, { supabase: { rpc } }, wallet, progression,
    { refresh() { throw new Error('Daily recovery must not read inventory'); } }, { showReward: value => toasts.push(value), say: value => toasts.push(value) }, () => null);
  const daily = kind === 'attendance' ? composed.attendance : composed.dailyQuiz;
  daily.onChange(change => changes.push({ client: 'daily', state: change.state, reason: change.reason, account: change.accountId }));
  const method = kind === 'attendance' ? 'claim' : 'answer', original = daily[method];
  daily[method] = async (...args) => { const result = await original(...args); mutationOutcome = result.outcome; return result; };
  const ui = kind === 'attendance' ? createAttendancePanel({ panel, attendance: daily, doc }) : createDailyQuizPanel({ panel, quiz: daily, doc });
  const bind = async id => {
    account = id; generation++;
    if (id && !accounts.has(id)) accounts.set(id, { done: false });
    await Promise.all([wallet.setAccount(id), progression.setAccount(id), daily.setAccount(id)]); await flush();
  };
  return {
    bind, open: () => ui.setOpen(true),
    releaseHeld: async () => { held.splice(0).forEach(resolve => resolve()); await flush(); },
    snapshot: () => ({ kind, scenario, account, generation, state: daily.state, completed: daily.snapshot?.claimedToday ?? daily.snapshot?.status ?? null,
      wallet: wallet.balance(), exp: progression.snapshot?.totalExp ?? null, walletText: walletNode.textContent, hudText: nodes.menuLine.textContent,
      hudVisible: !nodes.menuLine.hidden, mutationOutcome, writes: calls.filter(call => call.fn === mutationRpc).length, serverCommits,
      rewardToasts: toasts.length, levelToasts: levelToasts.length, heldResponses: held.length, mutationClicks, trustedMutationClicks, retryClicks, trustedRetryClicks,
      calls: calls.map(call => ({ ...call })), changes: changes.map(change => ({ ...change })) }),
    dispose() { disposed = true; ui.setOpen(false); void wallet.setAccount(null); void progression.setAccount(null); void daily.setAccount(null); }
  };
}
