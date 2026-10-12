import { getIncomeQuestCandidate } from './income-catalog.mjs';
const QUEST = 'quest.side.taerin_carp';
const uuid = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
export function normalizeDeliveryIncomeSnapshot(raw) {
  if (!raw || raw.questId !== QUEST || typeof raw.enabled !== 'boolean' || !Number.isSafeInteger(raw.coin) || raw.coin < 0 ||
      !raw.budget || !Number.isSafeInteger(raw.budget.remainingCoin) || raw.budget.remainingCoin < 0 ||
      ![0, 1].includes(raw.budget.remainingDeliveries) || !/^\d{4}-\d{2}-\d{2}$/.test(raw.budget.budgetDate) ||
      raw.inventory?.itemId !== 'material.fish_carp' || raw.inventory.requiredQuantity !== 1 ||
      !Number.isSafeInteger(raw.inventory.ownedQuantity) || raw.inventory.ownedQuantity < 0) throw new Error('INVALID_INCOME_SNAPSHOT');
  if (raw.sessionId != null && (!uuid(raw.sessionId) || !['READY_TO_SETTLE', 'SETTLED', 'EXPIRED'].includes(raw.state))) throw new Error('INVALID_INCOME_SNAPSHOT');
  if (raw.receipt != null && (raw.state !== 'SETTLED' || raw.receipt.sessionId !== raw.sessionId || !uuid(raw.receipt.settlementId) ||
      raw.receipt.committed !== true || raw.receipt.coin !== raw.coin)) throw new Error('INVALID_INCOME_SNAPSHOT');
  if (raw.state === 'SETTLED' && !raw.receipt) throw new Error('INVALID_INCOME_SNAPSHOT');
  const definition = getIncomeQuestCandidate(QUEST);
  return Object.freeze({ enabled: raw.enabled, questId: QUEST, title: definition.title, giverId: definition.giverId,
    npcLabel: definition.npcLabel, coin: raw.coin, budgetDate: raw.budget.budgetDate,
    remainingCoin: raw.budget.remainingCoin, remainingDeliveries: raw.budget.remainingDeliveries,
    ownedQuantity: raw.inventory.ownedQuantity, requiredQuantity: 1,
    sessionId: raw.sessionId ?? null, status: raw.state ?? null,
    receipt: raw.receipt ? Object.freeze({ sessionId: raw.receipt.sessionId, settlementId: raw.receipt.settlementId, coin: raw.receipt.coin, committed: true }) : null });
}
export function createDeliveryIncomeClient({ request, enabled = false, makeRequestId = () => globalThis.crypto.randomUUID(), onCommitted = () => {} }) {
  let accountId = null, generation = 0, snapshot = null, pending = false, error = null, notice = null, uncertain = null, run = null;
  const listeners = new Set(), notified = new Set();
  const state = () => Object.freeze({ accountId, enabled, snapshot, pending, error, notice });
  const publish = () => { for (const fn of listeners) { try { fn(state()); } catch {} } };
  async function read(gen) {
    try {
      const next = normalizeDeliveryIncomeSnapshot(await request({ op: 'status', questId: QUEST }));
      if (gen !== generation) return false;
      if (snapshot?.sessionId && next.sessionId === snapshot.sessionId &&
          ['SETTLED', 'EXPIRED'].includes(snapshot.status) && next.status !== snapshot.status) throw new Error('STALE_INCOME_SNAPSHOT');
      snapshot = next;
      if (uncertain && (uncertain.op === 'start' ? next.sessionId && next.sessionId !== uncertain.previous
        : next.sessionId === uncertain.sessionId && (next.receipt || next.status === 'EXPIRED'))) uncertain = null;
      error = uncertain ? 'OUTCOME_UNKNOWN' : null;
      if (next.receipt) {
        const key = `${accountId}:${next.receipt.settlementId}`;
        if (!notified.has(key)) { notified.add(key); try { onCommitted(next.receipt); } catch {} }
      }
      return true;
    } catch { if (gen === generation) error = 'STATUS_UNCONFIRMED'; return false; }
  }
  function execute(op = null) {
    if (!enabled || !accountId) return Promise.resolve(false);
    if (run) return run;
    const gen = generation, previous = snapshot?.sessionId, sessionId = snapshot?.sessionId;
    pending = true; notice = null; publish();
    const work = (async () => {
      if (op) {
        let requestId;
        try { requestId = makeRequestId(); if (!uuid(requestId)) throw new Error(); }
        catch { error = 'REQUEST_ID_UNAVAILABLE'; return false; }
        try { await request({ op, ...(op === 'start' ? { questId: QUEST } : { sessionId }), requestId }); }
        catch (failure) {
          if (gen !== generation) return false;
          if (failure?.status >= 400 && failure.status < 500) notice = failure.code ?? failure.message;
          else uncertain = { op, previous, sessionId };
        }
      }
      if (gen !== generation) return false;
      return read(gen);
    })().finally(() => { if (gen === generation && run === work) { pending = false; run = null; publish(); } });
    run = work; return work;
  }
  return {
    state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setAccount(id) { const next = typeof id === 'string' && id ? id : null; if (next !== accountId) {
      generation++; accountId = next; snapshot = null; pending = false; error = null; notice = null; uncertain = null; run = null; publish();
    } return execute(); },
    refresh: () => execute(),
    accept() {
      if (pending || error || !snapshot?.enabled || snapshot.remainingDeliveries < 1 || snapshot.remainingCoin < snapshot.coin || snapshot.status === 'READY_TO_SETTLE') return Promise.resolve(false);
      return execute('start');
    },
    submit() {
      if (pending || error || !snapshot?.enabled || snapshot.status !== 'READY_TO_SETTLE' || snapshot.ownedQuantity < 1) return Promise.resolve(false);
      return execute('complete');
    }
  };
}
