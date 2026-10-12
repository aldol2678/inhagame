// INHA WORLD · JSL-A Jeongseok access read + visitor pass purchase client.
// The server is the only authority: get_jeongseok_access_v1() decides entry from the caller's
// session, the existing Inha mail badge, the stored pass and the DB clock; purchase_jeongseok_pass_v1()
// prices, debits and issues on the server. This module validates those replies and never derives
// a right, price, balance or expiry locally. The browser clock is used for display only.
//
// Account scoped like the Wallet client: every account change bumps a generation, drops the old
// snapshot and discards older replies. A purchase key is kept per account until a definitive
// answer arrives, so a lost reply is recovered with the same key instead of paying again.

export const ACCESS_RPC = "get_jeongseok_access_v1";
export const PURCHASE_RPC = "purchase_jeongseok_pass_v1";
export const DAY_PASS = "jeongseok.visitor.day";

export const ACCESS_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT", LOADING: "LOADING", READY: "READY", UNKNOWN: "UNKNOWN"
});
export const DECISIONS = Object.freeze(["GRANTED", "NEEDS_PASS", "EXPIRED", "AUTH_REQUIRED", "ACCOUNT_BLOCKED",
  "DISABLED", "COMING_SOON"]);
export const PURCHASE_ERRORS = Object.freeze({
  INSUFFICIENT_FUNDS: "인덕코인이 부족해요.",
  PASS_ALREADY_ACTIVE: "이미 유효한 방문증이 있어요.",
  FREE_ACCESS_ELIGIBLE: "인하대 이메일 인증 계정은 무료로 출입해요.",
  PASS_UNAVAILABLE: "방문증 발급이 아직 열리지 않았어요.",
  JEONGSEOK_GATE_UNAVAILABLE: "정석학술정보관 출입이 현재 닫혀 있어요.",
  PERMANENT_ACCOUNT_REQUIRED: "정식 계정으로 로그인해야 방문증을 발급받을 수 있어요.",
  ACCOUNT_UNAVAILABLE: "현재 계정 상태로는 방문증을 발급받을 수 없어요.",
  IDEMPOTENCY_CONFLICT: "요청을 확인하지 못했어요. 새로고침 후 다시 확인해 주세요.",
  UNKNOWN: "결과를 확인하지 못했어요. 다시 확인하면 같은 요청으로 안전하게 조회해요."
});
// Refusals that prove nothing was charged for this key; anything else keeps the key for recovery.
const DEFINITIVE = new Set(["INSUFFICIENT_FUNDS", "PASS_ALREADY_ACTIVE", "FREE_ACCESS_ELIGIBLE", "PASS_UNAVAILABLE",
  "JEONGSEOK_GATE_UNAVAILABLE", "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "IDEMPOTENCY_CONFLICT",
  "INVALID_PASS_TYPE", "INVALID_IDEMPOTENCY_KEY"]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const isTime = value => typeof value === "string" && Number.isFinite(Date.parse(value));
const isCoins = value => Number.isSafeInteger(value) && value >= 0;

function parsePass(raw) {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || typeof raw.passType !== "string" || !isTime(raw.issuedAt) ||
      !isTime(raw.expiresAt) || typeof raw.active !== "boolean" || Date.parse(raw.expiresAt) <= Date.parse(raw.issuedAt)) return undefined;
  return Object.freeze({ passType: raw.passType, issuedAt: raw.issuedAt, expiresAt: raw.expiresAt, active: raw.active });
}
function parseOffer(raw) {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object" || typeof raw.canPurchase !== "boolean" ||
      !["ACTIVE", "COMING_SOON", "DISABLED"].includes(raw.status)) return undefined;
  if (raw.status !== "ACTIVE") {
    // A closed product must not carry a price. Treat one that does as a malformed reply.
    if (raw.price !== null || raw.canPurchase) return undefined;
    return Object.freeze({ status: raw.status, passType: null, price: null, currencyId: null, durationSeconds: null,
      balance: null, canPurchase: false, shortfall: null });
  }
  if (typeof raw.passType !== "string" || !Number.isSafeInteger(raw.price) || raw.price <= 0 || typeof raw.currencyId !== "string" ||
      !Number.isSafeInteger(raw.durationSeconds) || raw.durationSeconds <= 0 || !isCoins(raw.balance) || !isCoins(raw.shortfall) ||
      raw.canPurchase !== (raw.balance >= raw.price) || raw.shortfall !== Math.max(raw.price - raw.balance, 0)) return undefined;
  return Object.freeze({ status: "ACTIVE", passType: raw.passType, price: raw.price, currencyId: raw.currencyId,
    durationSeconds: raw.durationSeconds, balance: raw.balance, canPurchase: raw.canPurchase, shortfall: raw.shortfall });
}

/** Server read → frozen snapshot, or null when it is not the documented contract for this account. */
export function parseAccessSnapshot(raw, accountId) {
  if (!raw || typeof raw !== "object" || raw.version !== 1 || !DECISIONS.includes(raw.decision) || !isTime(raw.serverNow)) return null;
  if (raw.granted !== (raw.decision === "GRANTED")) return null;
  if (raw.granted && !["INHA_MAIL", "VISITOR_PASS"].includes(raw.via)) return null;
  if (!raw.granted && raw.via !== null) return null;
  // Decisions that are about an identified account must be about this one.
  const identified = ["GRANTED", "NEEDS_PASS", "EXPIRED", "ACCOUNT_BLOCKED"].includes(raw.decision);
  if (identified && raw.userId !== accountId) return null;
  if (!identified && raw.userId !== null) return null;
  const pass = parsePass(raw.pass ?? null), offer = parseOffer(raw.offer ?? null);
  if (pass === undefined || offer === undefined) return null;
  if (raw.via === "VISITOR_PASS" && !pass?.active) return null;
  if (["NEEDS_PASS", "EXPIRED"].includes(raw.decision) !== (offer !== null)) return null;
  if (raw.decision === "EXPIRED" && (!pass || pass.active)) return null;
  const verified = raw.inhaMailVerified;
  if (identified && raw.decision !== "ACCOUNT_BLOCKED" && typeof verified !== "boolean") return null;
  if (raw.via === "INHA_MAIL" && verified !== true) return null;
  return Object.freeze({ decision: raw.decision, granted: raw.granted, via: raw.via, gateStatus: raw.gateStatus,
    serverNow: raw.serverNow, userId: raw.userId, inhaMailVerified: typeof verified === "boolean" ? verified : null, pass, offer,
    // Display-only skew so countdowns follow the server clock, never the device clock.
    clockOffsetMs: Date.parse(raw.serverNow) - Date.now() });
}

export function parsePurchaseResult(raw, { accountId, key, passType }) {
  if (!raw || typeof raw !== "object" || !["SUCCESS", "ALREADY_PROCESSED"].includes(raw.status)) return null;
  if (raw.userId !== accountId || raw.idempotencyKey !== key || raw.passType !== passType || !UUID.test(raw.purchaseId ?? "") ||
      !UUID.test(raw.walletTransactionId ?? "") || !Number.isSafeInteger(raw.price) || raw.price <= 0 ||
      !isCoins(raw.balanceBefore) || !isCoins(raw.balanceAfter) || raw.balanceAfter !== raw.balanceBefore - raw.price ||
      !isTime(raw.issuedAt) || !isTime(raw.expiresAt) || Date.parse(raw.expiresAt) <= Date.parse(raw.issuedAt)) return null;
  const access = parseAccessSnapshot(raw.access, accountId);
  if (!access) return null;
  return Object.freeze({ status: raw.status, purchaseId: raw.purchaseId, price: raw.price, balanceAfter: raw.balanceAfter,
    issuedAt: raw.issuedAt, expiresAt: raw.expiresAt, access });
}

const errorCode = error => {
  const message = typeof error?.message === "string" ? error.message : "";
  return Object.hasOwn(PURCHASE_ERRORS, message) || DEFINITIVE.has(message) ? message : "UNKNOWN";
};

/**
 * @param {{ getClient: () => ({ rpc: Function } | null), storage?: () => Storage | null, newKey?: () => string }} options
 */
export function createJeongseokAccessClient({ getClient, storage = () => null,
  newKey = () => `jsl:${globalThis.crypto.randomUUID()}` } = {}) {
  if (typeof getClient !== "function") throw new Error("Jeongseok access client requires getClient");
  let accountId = null, generation = 0, state = ACCESS_STATE.SIGNED_OUT, snapshot = null;
  let inFlight = null, purchasing = null, lastPurchase = null, purchaseError = null;
  const listeners = new Set();
  const pendingKeyName = () => `inha-world:jeongseok-pass-key:${accountId}`;
  function readPendingKey() {
    if (!accountId) return null;
    try { const value = storage()?.getItem(pendingKeyName()); return KEY.test(value ?? "") ? value : null; } catch { return null; }
  }
  function writePendingKey(value) {
    if (!accountId) return;
    try { const s = storage(); if (value) s?.setItem(pendingKeyName(), value); else s?.removeItem(pendingKeyName()); } catch { /* memory only */ }
  }
  let pendingKey = null;
  const view = () => ({ state, snapshot, accountId, purchasing: purchasing !== null, pendingKey: pendingKey !== null,
    lastPurchase, purchaseError });
  function emit(reason) {
    const change = { ...view(), reason };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Jeongseok access listener failed:", error); }
    }
  }

  async function fetchOnce() {
    const gen = generation, account = accountId, client = getClient();
    if (!account || !client?.rpc) { if (gen === generation) { state = account ? ACCESS_STATE.UNKNOWN : ACCESS_STATE.SIGNED_OUT; snapshot = null; } return; }
    let next = null;
    try {
      const { data, error } = await client.rpc(ACCESS_RPC);
      if (error) throw error;
      next = parseAccessSnapshot(data, account);
    } catch (error) { console.warn("Jeongseok access unavailable:", error?.message ?? error); }
    if (gen !== generation || account !== accountId) return;
    // A failed or malformed read is UNKNOWN, never "not verified" and never a stale grant.
    state = next ? ACCESS_STATE.READY : ACCESS_STATE.UNKNOWN; snapshot = next;
  }
  function refresh(reason = "refresh") {
    if (!accountId) return Promise.resolve(null);
    if (inFlight) return inFlight.then(() => refresh(reason));
    const gen = generation;
    state = ACCESS_STATE.LOADING; emit(reason);
    const run = (async () => {
      try { await fetchOnce(); }
      finally { if (inFlight === run) inFlight = null; }
      if (gen !== generation) return null;
      emit(reason);
      return state === ACCESS_STATE.READY ? snapshot : null;
    })();
    inFlight = run;
    return run;
  }

  async function purchase(passType = DAY_PASS) {
    if (!accountId || purchasing) return purchasing ?? null;
    const gen = generation, account = accountId;
    // Reuse an unresolved key: a lost reply is recovered, never paid twice.
    pendingKey ??= readPendingKey() ?? newKey();
    if (!KEY.test(pendingKey)) { pendingKey = null; purchaseError = "UNKNOWN"; emit("purchase"); return null; }
    const key = pendingKey;
    writePendingKey(key);
    purchaseError = null;
    const run = (async () => {
      await null; // `purchasing` is assigned before any outcome can be handled.
      // The live client may now carry another session. Never dispatch an old account request
      // through it; the old key remains account-scoped and can be recovered after switching back.
      if (gen !== generation || account !== accountId) return null;
      let result = null, code = null;
      try {
        const client = getClient();
        if (!client?.rpc) throw Error("UNKNOWN");
        const { data, error } = await client.rpc(PURCHASE_RPC, { p_pass_type: passType, p_idempotency_key: key });
        if (error) throw error;
        result = parsePurchaseResult(data, { accountId: account, key, passType });
        if (!result) throw Error("UNKNOWN");
      } catch (error) { code = errorCode(error); }
      if (gen !== generation || account !== accountId) return null;
      purchasing = null;
      if (result) {
        pendingKey = null; writePendingKey(null);
        lastPurchase = result; state = ACCESS_STATE.READY; snapshot = result.access;
        emit("purchase");
        return result;
      }
      purchaseError = code;
      if (DEFINITIVE.has(code)) { pendingKey = null; writePendingKey(null); }
      emit("purchase");
      // Re-read the authority after every refusal so balance/pass/gate reflect the server.
      void refresh("purchase-refused");
      return null;
    })();
    purchasing = run;
    emit("purchase");
    return run;
  }

  /** Account boundary. Any change drops the snapshot, the in-memory key and older replies. */
  function setAccount(next) {
    const id = typeof next === "string" && next ? next : null;
    if (id === accountId) return Promise.resolve(snapshot);
    generation += 1;
    accountId = id; snapshot = null; inFlight = null; purchasing = null; lastPurchase = null; purchaseError = null;
    pendingKey = readPendingKey();
    state = id ? ACCESS_STATE.LOADING : ACCESS_STATE.SIGNED_OUT;
    emit("account");
    return id ? refresh("account") : Promise.resolve(null);
  }

  return {
    setAccount, refresh, purchase,
    /** Fresh server decision for an entry attempt; null unless READY for the same account. */
    async verifyEntry() {
      const account = accountId;
      const result = await refresh("verify-entry");
      // parseAccessSnapshot already binds identified decisions to this account.
      return result && account === accountId ? result : null;
    },
    clearPurchaseFeedback() { purchaseError = null; lastPurchase = null; emit("feedback"); },
    view,
    get state() { return state; }, get snapshot() { return snapshot; }, get accountId() { return accountId; },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
