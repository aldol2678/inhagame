import { parseConvenienceJobStatus, convenienceJobPhase, JOB_PHASE } from './convenience-job-state.mjs';

/**
 * Dependency-injected, CLOSED by default. No direct HTTP, wallet write, storage or world entry point.
 * Transport is authenticated externally; accountId is NEVER transmitted as actor authority.
 * Server persists session/seed/validated steps. Local state is disposable presentation only.
 */
export function createConvenienceJobClient({ transport, enabled = false,
  makeRequestId = () => globalThis.crypto.randomUUID(), onCommitted = () => {} } = {}) {
  if (!transport || !['status', 'start', 'step', 'complete'].every(k => typeof transport[k] === 'function'))
    throw new TypeError('Convenience job requires status/start/step/complete transport');
  let accountId = null, generation = 0, snapshot = null, error = null, notice = null, pending = false;
  let reading = null, mutation = null, readSerial = 0, uncertain = null;
  const listeners = new Set(), notified = new Set();
  const state = () => Object.freeze({ accountId, enabled, snapshot, error, notice, pending,
    phase: convenienceJobPhase({ accountId, enabled, snapshot, error }) });
  const publish = () => { const s = state(); for (const fn of listeners) { try { fn(s); } catch {} } };
  async function read(gen) {
    const serial = ++readSerial;
    try {
      const raw = await transport.status();
      if (generation !== gen || serial !== readSerial) return false;
      const next = parseConvenienceJobStatus(raw);
      if (!next || (snapshot?.session && next.session?.id === snapshot.session.id && next.session.revision < snapshot.session.revision))
        throw new Error('INVALID_STATUS');
      snapshot = next;
      if (uncertain) {
        const resolved = uncertain.method === 'start' ? !!next.session && next.session.id !== uncertain.previousSessionId
          : next.session?.id === uncertain.sessionId && next.session.status === 'EXPIRED' ? true
          : uncertain.method === 'complete' ? next.receipt?.sessionId === uncertain.sessionId
          : next.session?.id === uncertain.sessionId && next.session.revision > uncertain.revision;
        if (resolved) uncertain = null;
      }
      error = uncertain ? 'OUTCOME_UNKNOWN' : null;
      if (next.receipt) {
        const key = `${accountId}:${next.receipt.settlementId}`;
        if (!notified.has(key)) { notified.add(key); try { onCommitted(next.receipt); } catch {} }
      }
      return true;
    } catch {
      if (generation !== gen || serial !== readSerial) return false;
      error = 'STATUS_UNCONFIRMED'; return false;
    } finally { if (generation === gen && serial === readSerial) publish(); }
  }
  function refresh() {
    if (!enabled || !accountId) return Promise.resolve(false);
    // Never race a pre-commit read against a mutation's final readback.
    if (mutation) return mutation;
    if (reading) return reading;
    const gen = generation;
    pending = true; publish();
    const run = read(gen).finally(() => {
      if (gen === generation && reading === run) { reading = null; pending = false; publish(); }
    });
    reading = run; return run;
  }
  function mutate(method, payload, allowedPhase) {
    const s = state();
    if (!enabled || !snapshot?.enabled) return Promise.resolve({ outcome: 'REFUSED' });
    if (pending || mutation || reading) return Promise.resolve({ outcome: 'BUSY' });
    if (!(Array.isArray(allowedPhase) ? allowedPhase.includes(s.phase) : s.phase === allowedPhase)) return Promise.resolve({ outcome: 'REFUSED' });
    const gen = generation, previousSessionId = snapshot?.session?.id;
    pending = true; error = null; notice = null; ++readSerial; publish();
    const run = (async () => {
      let requestId;
      try { requestId = makeRequestId(); if (typeof requestId !== 'string' || !requestId) throw new Error(); }
      catch { error = 'REQUEST_ID_UNAVAILABLE'; return { outcome: 'REFUSED' }; }
      // A failed/lost acknowledgement is ambiguous. Read status; never auto-replay mutation.
      try {
        const ack = await transport[method]({ ...payload, requestId });
        if (ack?.error) throw ack.error;
      } catch (failure) {
        if (gen === generation) {
          // Only explicit, documented rejection codes prove the command did not commit.
          const code = String(failure?.code ?? failure?.message ?? '').replace(/^INCOME_/, '');
          if (['WRONG_CHOICE', 'STALE_REVISION', 'STEP_TOO_FAST', 'LIMIT_REACHED', 'NOT_READY', 'EXPIRED',
            'AUTH_CHANGED', 'SESSION_ACTIVE', 'CLOSED', 'GIVER_MISMATCH', 'DAILY_LIMIT', 'SESSION_EXPIRED', 'SESSION_NOT_FOUND',
            'STEP_MISMATCH', 'STEP_TOO_EARLY', 'DAILY_CAP', 'REWARD_UNAVAILABLE', 'REWARD_FAILED',
            'ACCOUNT_UNAVAILABLE', 'IDEMPOTENCY_CONFLICT'].includes(code))
            notice = code;
          else uncertain = { method, sessionId: payload.sessionId, revision: payload.revision, previousSessionId };
        }
      }
      if (gen !== generation) return { outcome: 'STALE' };
      const verified = await read(gen);
      return { outcome: gen !== generation ? 'STALE' : verified && !error ? 'READBACK' : 'UNCONFIRMED' };
    })().finally(() => {
      if (generation === gen && mutation === run) { mutation = null; pending = false; publish(); }
    });
    mutation = run; return run;
  }
  return {
    state,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    setAccount(id) {
      const next = typeof id === 'string' && id.length ? id : null;
      if (next === accountId) return refresh();
      generation += 1; readSerial += 1; accountId = next; snapshot = null; error = null; notice = null;
      pending = false; reading = null; mutation = null; uncertain = null; publish();
      return refresh();
    },
    refresh,
    start() {
      const p = snapshot?.posting;
      if (!p || p.remainingShifts < 1 || p.remainingCoin < p.baseCoin) return Promise.resolve({ outcome: 'REFUSED' });
      return mutate('start', { postingId: p.id }, [JOB_PHASE.POSTING, JOB_PHASE.CONFIRMED]);
    },
    choose(choiceId) {
      const s = snapshot?.session;
      if (!s?.step?.choices.some(c => c.id === choiceId)) return Promise.resolve({ outcome: 'REFUSED' });
      return mutate('step', { sessionId: s.id, revision: s.revision, stepId: s.step.id, choiceId }, JOB_PHASE.WORKING);
    },
    complete() {
      const s = snapshot?.session;
      return mutate('complete', { sessionId: s?.id, revision: s?.revision }, JOB_PHASE.CHECKOUT);
    }
  };
}
