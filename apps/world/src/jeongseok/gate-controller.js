// JSL-A gate state machine. Engine and DOM free, so Node tests drive it with fakes.
//
//   IDLE → CHECKING → SCANNING → GRANTED → OPENING → READY_TO_ENTER
//   refusals: NEEDS_PASS · EXPIRED · INSUFFICIENT_FUNDS · AUTH_REQUIRED · ACCOUNT_BLOCKED · UNKNOWN · DISABLED
//   guide: fresh check / purchase → refreshed guidance (no tag or open-gate animation)
//
// The green light is presentation only. Every grant comes from a fresh server read, and entering
// asks the server again; a READY_TO_ENTER state is never a credential. The interior is not part of
// JSL-A: `onEnter` receives only a server-verified snapshot and the caller decides what that opens.

export const GATE_STATE = Object.freeze({
  IDLE: "IDLE", CHECKING: "CHECKING", SCANNING: "SCANNING", GRANTED: "GRANTED", OPENING: "OPENING",
  READY_TO_ENTER: "READY_TO_ENTER", NEEDS_PASS: "NEEDS_PASS", PURCHASING: "PURCHASING",
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS", EXPIRED: "EXPIRED", AUTH_REQUIRED: "AUTH_REQUIRED",
  ACCOUNT_BLOCKED: "ACCOUNT_BLOCKED", UNKNOWN: "UNKNOWN", DISABLED: "DISABLED"
});
export const GATE_TIMINGS = Object.freeze({ scanMs: 700, grantedMs: 600, openingMs: 900, readyMs: 20000 });
const REFUSAL = Object.freeze({ NEEDS_PASS: GATE_STATE.NEEDS_PASS, EXPIRED: GATE_STATE.EXPIRED,
  AUTH_REQUIRED: GATE_STATE.AUTH_REQUIRED, ACCOUNT_BLOCKED: GATE_STATE.ACCOUNT_BLOCKED,
  DISABLED: GATE_STATE.DISABLED, COMING_SOON: GATE_STATE.DISABLED });
const BUSY = new Set([GATE_STATE.CHECKING, GATE_STATE.SCANNING, GATE_STATE.GRANTED, GATE_STATE.OPENING, GATE_STATE.PURCHASING]);
const PURCHASABLE = new Set([GATE_STATE.NEEDS_PASS, GATE_STATE.EXPIRED, GATE_STATE.INSUFFICIENT_FUNDS]);

export function createJeongseokGateController({ access, isEnabled = () => true, hasAccount = () => access.accountId !== null,
  canTag = () => true, canGuide = () => true, canPurchase = () => true,
  onEnter = () => ({ status: "UNAVAILABLE" }), onChange = () => {}, onCue = () => {},
  setTimer = setTimeout, clearTimer = clearTimeout, timings = GATE_TIMINGS } = {}) {
  if (!access?.verifyEntry || !access?.purchase) throw new Error("Gate controller requires the Jeongseok access client");
  let state = GATE_STATE.IDLE, epoch = 0, timer = null, decision = null, notice = null, purchaseRecovery = false;
  const listeners = new Set();
  const snapshot = () => {
    const s = access.snapshot;
    return Object.freeze({ state, decision, notice, purchaseRecovery,
      via: state === GATE_STATE.IDLE ? null : s?.via ?? null, pass: s?.pass ?? null, offer: s?.offer ?? null,
      inhaMailVerified: s?.inhaMailVerified ?? null, purchaseError: access.view().purchaseError,
      busy: BUSY.has(state), canPurchase: PURCHASABLE.has(state) && s?.offer?.status === "ACTIVE" && s.offer.canPurchase === true,
      canEnter: state === GATE_STATE.READY_TO_ENTER, canCancel: state !== GATE_STATE.IDLE && state !== GATE_STATE.PURCHASING,
      canRetry: [GATE_STATE.UNKNOWN, GATE_STATE.INSUFFICIENT_FUNDS].includes(state) || purchaseRecovery });
  };
  function set(next, extra = {}) {
    state = next;
    if ("decision" in extra) decision = extra.decision;
    if ("notice" in extra) notice = extra.notice;
    const view = snapshot();
    for (const listener of [onChange, ...listeners]) {
      try { listener(view); } catch (error) { console.warn("Jeongseok gate listener failed:", error); }
    }
  }
  const cue = name => { try { onCue(name); } catch { /* sound and light never block the gate */ } };
  function clear() { if (timer !== null) clearTimer(timer); timer = null; }
  function after(ms, gen, run) { clear(); timer = setTimer(() => { timer = null; if (gen === epoch) run(); }, ms); }
  function refuse(nextState, extra = {}) { clear(); cue("deny"); set(nextState, extra); }

  function tagSequence(gen, snapshotNow) {
    set(GATE_STATE.SCANNING, { decision: snapshotNow.decision });
    cue("scan");
    after(timings.scanMs, gen, () => {
      cue("grant");
      set(GATE_STATE.GRANTED);
      after(timings.grantedMs, gen, () => {
        cue("open");
        set(GATE_STATE.OPENING);
        after(timings.openingMs, gen, () => {
          set(GATE_STATE.READY_TO_ENTER);
          // The open gate closes again; a later entry needs another server check anyway.
          after(timings.readyMs, gen, () => set(GATE_STATE.IDLE, { decision: null, notice: null }));
        });
      });
    });
  }
  function apply(gen, result, { tag = true } = {}) {
    if (gen !== epoch) return false;
    if (!result) { refuse(GATE_STATE.UNKNOWN, { decision: null }); return false; }
    if (result.granted) {
      if (tag) tagSequence(gen, result);
      else set(GATE_STATE.IDLE, { decision: result.decision });
      return true;
    }
    refuse(REFUSAL[result.decision] ?? GATE_STATE.UNKNOWN, { decision: result.decision });
    return false;
  }

  /** F / Context Action at the reader. */
  async function start() {
    if (BUSY.has(state) || !canTag()) return false;
    const gen = ++epoch;
    clear(); notice = null;
    if (!isEnabled()) { refuse(GATE_STATE.DISABLED, { decision: "DISABLED" }); return false; }
    if (!hasAccount()) { refuse(GATE_STATE.AUTH_REQUIRED, { decision: "AUTH_REQUIRED" }); return false; }
    set(GATE_STATE.CHECKING, { decision: null });
    let result = null;
    try { result = await access.verifyEntry(); } catch { result = null; }
    if (gen === epoch && !canTag()) { reset(); return false; }
    return apply(gen, result);
  }

  /** The public-side guide shows eligibility without tagging or opening the reader. */
  async function guide() {
    if (BUSY.has(state) || !canGuide()) return false;
    const gen = ++epoch;
    clear(); notice = null;
    if (!isEnabled()) { refuse(GATE_STATE.DISABLED, { decision: "DISABLED" }); return false; }
    if (!hasAccount()) { refuse(GATE_STATE.AUTH_REQUIRED, { decision: "AUTH_REQUIRED" }); return false; }
    set(GATE_STATE.CHECKING, { decision: null });
    let result = null;
    try { result = await access.verifyEntry(); } catch { result = null; }
    if (gen === epoch && !canGuide()) { reset(); return false; }
    return apply(gen, result, { tag: false });
  }

  async function purchase() {
    // A reload recreates the controller but the access client restores an unresolved purchase key.
    // Replay that exact key even when this controller is still IDLE, never mint a second charge.
    if (!isEnabled() || !hasAccount() || !canPurchase()) return false;
    const hasPendingKey = access.view().pendingKey === true;
    if (state === GATE_STATE.PURCHASING || (!PURCHASABLE.has(state) && !hasPendingKey)) return false;
    if (!hasPendingKey && !snapshot().canPurchase) return false;
    const gen = ++epoch;
    clear();
    set(GATE_STATE.PURCHASING, { notice: null });
    let result = null;
    try { result = await access.purchase(); } catch { result = null; }
    if (gen !== epoch) return false;
    if (result) {
      purchaseRecovery = false;
      set(GATE_STATE.CHECKING, { notice: result.status === "ALREADY_PROCESSED" ? "RECOVERED" : "ISSUED" });
      let fresh = null;
      try { fresh = await access.verifyEntry(); } catch { fresh = null; }
      return apply(gen, fresh, { tag: false });
    }
    const code = access.view().purchaseError;
    purchaseRecovery = access.view().pendingKey === true;
    if (code === "INSUFFICIENT_FUNDS") { refuse(GATE_STATE.INSUFFICIENT_FUNDS, { notice: code }); return false; }
    if (code === "PASS_ALREADY_ACTIVE" || code === "FREE_ACCESS_ELIGIBLE") {
      // The server says entry is already allowed; read it again instead of guessing.
      set(GATE_STATE.CHECKING, { notice: code });
      let fresh = null;
      try { fresh = await access.verifyEntry(); } catch { fresh = null; }
      return apply(gen, fresh, { tag: false });
    }
    if (code === "PERMANENT_ACCOUNT_REQUIRED") { refuse(GATE_STATE.AUTH_REQUIRED, { decision: "AUTH_REQUIRED", notice: code }); return false; }
    if (code === "ACCOUNT_UNAVAILABLE") { refuse(GATE_STATE.ACCOUNT_BLOCKED, { decision: "ACCOUNT_BLOCKED", notice: code }); return false; }
    if (code === "JEONGSEOK_GATE_UNAVAILABLE" || code === "PASS_UNAVAILABLE") { refuse(GATE_STATE.DISABLED, { decision: "DISABLED", notice: code }); return false; }
    refuse(GATE_STATE.UNKNOWN, { notice: code ?? "UNKNOWN" });
    return false;
  }

  /** Entry asks the server again; only a fresh grant for the same account reaches onEnter. */
  async function enter() {
    if (state !== GATE_STATE.READY_TO_ENTER || !isEnabled() || !hasAccount() || !canTag()) return null;
    const gen = ++epoch;
    clear();
    set(GATE_STATE.CHECKING, { notice: null });
    let fresh = null;
    try { fresh = await access.verifyEntry(); } catch { fresh = null; }
    if (gen !== epoch) return null;
    if (!canTag() || !isEnabled() || !hasAccount()) { reset(); return null; }
    if (!fresh?.granted) { apply(gen, fresh); return null; }
    let outcome = null;
    try { outcome = await onEnter(fresh); } catch { outcome = { status: "FAILED" }; }
    if (gen !== epoch) return null;
    set(GATE_STATE.READY_TO_ENTER, { notice: outcome?.status ?? "FAILED" });
    after(timings.readyMs, gen, () => set(GATE_STATE.IDLE, { decision: null, notice: null }));
    return outcome;
  }

  /** Cancel / walk away / account switch. A pending purchase keeps its key in the access client. */
  function reset() {
    if (state === GATE_STATE.PURCHASING) return false;
    epoch++; clear(); purchaseRecovery = access.view().pendingKey === true;
    set(GATE_STATE.IDLE, { decision: null, notice: null });
    return true;
  }
  function accountChanged() { epoch++; clear(); purchaseRecovery = false; set(GATE_STATE.IDLE, { decision: null, notice: null }); }

  return { start, guide, purchase, enter, reset, accountChanged, snapshot,
    get state() { return state; },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    destroy() { epoch++; clear(); listeners.clear(); } };
}
