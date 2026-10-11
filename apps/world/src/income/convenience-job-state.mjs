// CLOSED candidate. This is presentation validation, never gameplay/reward authority.
export const JOB_PHASE = Object.freeze({
  CLOSED: 'CLOSED', SIGNED_OUT: 'SIGNED_OUT', LOADING: 'LOADING',
  POSTING: 'POSTING', WORKING: 'WORKING', CHECKOUT: 'CHECKOUT',
  CONFIRMED: 'CONFIRMED', RECOVERY: 'RECOVERY'
});
const text = (v, max = 500) => typeof v === 'string' && v.length > 0 && v.length <= max;
const count = (v, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && v >= 0 && v <= max;
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

/** Allowlist only server presentation data. Never retain server seed, answers or arbitrary HTML. */
export function parseConvenienceJobStatus(raw) {
  if (!raw || typeof raw.enabled !== 'boolean') return null;
  if (!raw.enabled && raw.posting == null && raw.session == null && raw.receipt == null)
    return freeze({ enabled: false, posting: null, session: null, receipt: null });
  const p = raw.posting;
  if (!p || !text(p.id, 120) || !text(p.title, 120) || !text(p.locationLabel, 120) || !text(p.npcLabel, 120) ||
      !count(p.baseCoin) || !count(p.remainingCoin) || !count(p.remainingShifts, 1) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(p.budgetDate)) return null;
  const posting = { id: p.id, title: p.title, locationLabel: p.locationLabel, npcLabel: p.npcLabel,
    baseCoin: p.baseCoin, remainingCoin: p.remainingCoin, remainingShifts: p.remainingShifts, budgetDate: p.budgetDate };
  let session = null, receipt = null;
  if (raw.session != null) {
    const s = raw.session;
    if (!text(s.id, 120) || !count(s.revision) || !['ACTIVE', 'READY_TO_SETTLE', 'SETTLED', 'EXPIRED'].includes(s.status) ||
        !count(s.totalSteps, 5) || s.totalSteps < 2 || !count(s.completedSteps, s.totalSteps)) return null;
    let step = null;
    if (s.status === 'ACTIVE') {
      const t = s.step;
      if (s.completedSteps >= s.totalSteps || !t || !text(t.id, 120) ||
          !['STOCK', 'CHECKOUT', 'TIDY', 'INCIDENT'].includes(t.kind) || !text(t.prompt) ||
          !Array.isArray(t.choices) || t.choices.length < 2 || t.choices.length > 8 ||
          !t.choices.every(c => c && text(c.id, 120) && text(c.label, 240)) ||
          new Set(t.choices.map(c => c.id)).size !== t.choices.length ||
          (t.feedback != null && !text(t.feedback))) return null;
      step = { id: t.id, kind: t.kind, prompt: t.prompt,
        choices: t.choices.map(c => ({ id: c.id, label: c.label })), feedback: t.feedback ?? null };
    } else if (s.step != null || (s.status !== 'EXPIRED' && s.completedSteps !== s.totalSteps)) return null;
    session = { id: s.id, revision: s.revision, status: s.status, completedSteps: s.completedSteps, totalSteps: s.totalSteps, step };
  }
  if (raw.receipt != null) {
    const r = raw.receipt;
    if (!session || session.status !== 'SETTLED' || r.sessionId !== session.id ||
        !text(r.settlementId, 160) || !count(r.coin) || r.committed !== true) return null;
    receipt = { sessionId: r.sessionId, settlementId: r.settlementId, coin: r.coin, committed: true };
  }
  if (session?.status === 'SETTLED' && !receipt) return null;
  return freeze({ enabled: raw.enabled, posting, session, receipt });
}

export function convenienceJobPhase({ enabled, accountId, snapshot, error }) {
  if (!enabled) return JOB_PHASE.CLOSED;
  if (!accountId) return JOB_PHASE.SIGNED_OUT;
  if (error) return JOB_PHASE.RECOVERY;
  if (!snapshot) return JOB_PHASE.LOADING;
  if (snapshot.receipt) return JOB_PHASE.CONFIRMED;
  if (snapshot.enabled === false) return JOB_PHASE.CLOSED;
  if (snapshot.session?.status === 'EXPIRED') return JOB_PHASE.POSTING;
  if (snapshot.session?.status === 'READY_TO_SETTLE') return JOB_PHASE.CHECKOUT;
  if (snapshot.session) return JOB_PHASE.WORKING;
  return JOB_PHASE.POSTING;
}
