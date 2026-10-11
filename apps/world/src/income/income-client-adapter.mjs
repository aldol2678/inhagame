import { getIncomeQuestCandidate } from './income-catalog.mjs';
const SHIFT_ID = 'quest.side.convenience_help';
const STATES = new Set(['ACTIVE', 'READY_TO_SETTLE', 'SETTLED', 'EXPIRED']);
function nonnegative(value) { return Number.isSafeInteger(value) && value >= 0; }
// Converts only server readback to UI. No actor, reward, result or account cache is sent.
export function normalizeConvenienceIncomeSnapshot(raw) {
  const definition = getIncomeQuestCandidate(SHIFT_ID);
  if (!raw || typeof raw !== 'object' || (raw.questId != null && raw.questId !== SHIFT_ID) ||
      !raw.budget || !nonnegative(raw.budget.remainingCoin) ||
      ![0, 1].includes(raw.budget.remainingShifts) ||
      typeof raw.budget.budgetDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.budget.budgetDate) ||
      typeof raw.enabled !== 'boolean' || !nonnegative(raw.coin)) throw new Error('INVALID_INCOME_SNAPSHOT');
  let session = null;
  if (raw.sessionId != null) {
    if (typeof raw.sessionId !== 'string' || !STATES.has(raw.state) ||
        !Number.isInteger(raw.revision) || raw.revision < 0 || raw.revision > 3) throw new Error('INVALID_INCOME_SNAPSHOT');
    const step = raw.nextChallenge;
    if (raw.state === 'ACTIVE' && (!step || step.id !== `${raw.sessionId}:${raw.revision}` ||
      !['stock', 'checkout', 'tidy'].includes(step.action) || typeof step.prompt !== 'string' ||
      !Array.isArray(step.choices) || step.choices.length < 2 || step.choices.some(choice =>
        typeof choice.id !== 'string' || typeof choice.label !== 'string') ||
      new Set(step.choices.map(choice => choice.id)).size !== step.choices.length || 'answer' in step)) throw new Error('INVALID_INCOME_SNAPSHOT');
    session = {
      id: raw.sessionId, revision: raw.revision, status: raw.state, completedSteps: raw.revision, totalSteps: 3,
      step: raw.state === 'ACTIVE' ? { id: step.id, kind: step.action.toUpperCase(), prompt: step.prompt,
        choices: step.choices.map(choice => ({ id: choice.id, label: choice.label })) } : null
    };
  }
  let receipt = null;
  if (raw.receipt != null) {
    if (raw.state !== 'SETTLED' || raw.receipt.committed !== true || raw.receipt.sessionId !== raw.sessionId ||
      typeof raw.receipt.settlementId !== 'string' || !nonnegative(raw.receipt.coin)) throw new Error('INVALID_INCOME_SNAPSHOT');
    receipt = { sessionId: raw.receipt.sessionId, settlementId: raw.receipt.settlementId, coin: raw.receipt.coin, committed: true };
  }
  if (raw.state === 'SETTLED' && !receipt) throw new Error('INVALID_INCOME_SNAPSHOT');
  return {
    enabled: raw.enabled, candidate: true,
    posting: { id: SHIFT_ID, title: definition.title, locationLabel: definition.locationLabel,
      npcLabel: definition.npcLabel, baseCoin: raw.coin, remainingCoin: raw.budget.remainingCoin,
      remainingShifts: raw.budget.remainingShifts, budgetDate: raw.budget.budgetDate },
    session, receipt
  };
}
// request() is an injected authenticated transport; the supplied route is loopback-only and denies Production.
export function createConvenienceIncomeTransport({ request }) {
  return {
    status: async ({ sessionId } = {}) => normalizeConvenienceIncomeSnapshot(await request({ op: 'status', questId: SHIFT_ID, ...(sessionId ? { sessionId } : {}) })),
    start: ({ requestId }) => request({ op: 'start', questId: SHIFT_ID, requestId }),
    step: ({ sessionId, stepId, choiceId, requestId, revision }) => request({ op: 'step', sessionId, stepId, choiceId, requestId, revision }),
    complete: ({ sessionId, requestId }) => request({ op: 'complete', sessionId, requestId })
  };
}
