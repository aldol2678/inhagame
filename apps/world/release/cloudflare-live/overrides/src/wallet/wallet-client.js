// INHA WORLD · Wallet balance read client (read-model on the P0-A player read).
// The server is the only authority: get_my_world_wallet_v1() returns the caller's balances from the
// wallet ledger (0 for a currency without a wallet row). This module only fetches and validates that
// snapshot. It never computes a balance: no price subtraction, no reward addition, no local storage,
// no optimistic value. After anything that may move money the caller re-reads the server.
//
// Account-scoped like P0-F3a progression / P0-F3b shop: every account change bumps a generation
// counter, drops the previous snapshot and discards any response from an older generation.
//
// AUTH (migrated 2026-11-13, Tier 4 guest-open): the client authenticates with the v0.1 guest
// session id in the `X-Session-Id` header only — no other credential header is sent. The id is
// read lazily by readGuestSessionId() (fishing-reporter-wiring.js: localStorage
// 'inha-v01:sync-session', fallback 'inha-v01:server-session'; null when absent — never
// fabricated). The account bound by setAccount IS that session id.
// Before: getClient() returned the signed-in permanent-account client and the read went through
// its rpc() with that account's session. That path is gone; only the transport changed — parsing,
// state, generation and the reward readback retry are unchanged.

import { readGuestSessionId } from "../activity/session-id.js";

export const WALLET_RPC = "get_my_world_wallet_v1";
export const WALLET_API_PATH = "/api/world-wallet";
export const INDUCK_COIN = "currency.induck_coin";

export const WALLET_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

const isCurrencyId = (value) => typeof value === "string" && value.length > 0 && value.length <= 120;
const isBalance = (value) => Number.isSafeInteger(value) && value >= 0;

/**
 * Server read → frozen snapshot { balances: { [currencyId]: balance } }, or null when the shape is not
 * the documented contract. Money is not repaired: one malformed entry rejects the whole read.
 * Currencies this client does not know are kept but never shown by a UI that asks for a specific id.
 */
export function parseWalletSnapshot(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.currencies)) return null;
  const balances = {};
  for (const entry of raw.currencies) {
    if (!entry || typeof entry !== "object" || !isCurrencyId(entry.id) || !isBalance(entry.balance)) return null;
    if (Object.hasOwn(balances, entry.id)) return null;
    balances[entry.id] = entry.balance;
  }
  return Object.freeze({ balances: Object.freeze(balances) });
}

/** The server balance of one currency in a snapshot, or null when the server did not report it. */
export function walletBalance(snapshot, currencyId = INDUCK_COIN) {
  const balances = snapshot?.balances;
  return balances && Object.hasOwn(balances, currencyId) ? balances[currencyId] : null;
}

/**
 * @param {{ getSessionId?: () => (string | null | Promise<string | null>), fetcher?: Function, endpoint?: string, setTimer?: Function, clearTimer?: Function, rewardRetryDelays?: number[] }} options
 *   getSessionId supplies the v0.1 guest session id (defaults to readGuestSessionId from the
 *   reporter wiring module — the single source; never copied). fetcher defaults to global fetch.
 *   endpoint defaults to the same-host Tier 4 path; pass an absolute origin only for isolated tests.
 */
export function createWalletClient({
  getSessionId = readGuestSessionId,
  fetcher = (...args) => globalThis.fetch(...args),
  endpoint = WALLET_API_PATH,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  rewardRetryDelays = [1000, 3000, 8000]
} = {}) {

  let accountId = null;
  let generation = 0;
  let state = WALLET_STATE.SIGNED_OUT;
  let snapshot = null;
  let inFlight = null;
  let rerun = false;
  let rerunReason = null;
  let rewardRetryTimer = null;
  let rewardRetryAttempt = 0;
  const listeners = new Set();

  const isRecovery = reason => reason === "daily-reward-recovery";
  const strongerReason = (a, b) => isRecovery(a) ? a : b ?? a;

  function clearRewardRetry({ resetAttempt = false } = {}) {
    if (rewardRetryTimer !== null) clearTimer(rewardRetryTimer);
    rewardRetryTimer = null;
    if (resetAttempt) rewardRetryAttempt = 0;
  }

  // Match Progression's bounded readback retries; never retry the reward mutation.
  function scheduleRewardRetry(reason, gen) {
    if (!isRecovery(reason) || !accountId || gen !== generation || rewardRetryTimer !== null) return;
    const delay = rewardRetryDelays[rewardRetryAttempt];
    if (!Number.isFinite(delay) || delay < 0) return;
    rewardRetryAttempt += 1;
    rewardRetryTimer = setTimer(() => {
      rewardRetryTimer = null;
      if (gen === generation && accountId) void refresh(reason);
    }, delay);
  }

  function set(nextState, nextSnapshot, reason) {
    state = nextState;
    snapshot = nextSnapshot;
    const change = { state, snapshot, accountId, reason };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Wallet listener failed:", error); }
    }
  }

  async function resolveSessionId() {
    try {
      const id = await getSessionId?.();
      return typeof id === "string" && id ? id : null;
    } catch { return null; }
  }

  async function fetchOnce(reason) {
    const gen = generation;
    const account = accountId;
    if (!account) {
      if (gen === generation) set(WALLET_STATE.SIGNED_OUT, null, reason);
      return;
    }
    const sessionId = await resolveSessionId();
    if (!sessionId) {
      if (gen === generation && account === accountId) set(WALLET_STATE.UNAVAILABLE, null, reason);
      return;
    }
    let next = null;
    try {
      const response = await fetcher(endpoint, { headers: { "X-Session-Id": sessionId } });
      if (!response.ok) throw new Error(`wallet HTTP ${response.status}`);
      next = parseWalletSnapshot(await response.json());
    } catch (error) {
      // The raw server / transport message is logged, never shown.
      console.warn("World wallet unavailable:", error?.message ?? error);
    }
    // A newer account change (sign-out, switch) happened while this request was in flight.
    if (gen !== generation || account !== accountId) return;
    if (next) {
      clearRewardRetry({ resetAttempt: true });
      set(WALLET_STATE.READY, next, reason);
    }
    else set(WALLET_STATE.UNAVAILABLE, null, reason);
  }

  function refresh(reason = "refresh") {
    if (!accountId) return Promise.resolve(false);
    // Coalesce: while a request runs, remember one more and run it after, never in parallel.
    if (inFlight) {
      rerun = true;
      rerunReason = strongerReason(rerunReason, reason);
      return inFlight;
    }
    const gen = generation;
    const run = (async () => {
      let currentReason = reason;
      try {
        do {
          rerun = false;
          rerunReason = null;
          await fetchOnce(currentReason);
          if (rerun && gen === generation) currentReason = strongerReason(currentReason, rerunReason);
        } while (rerun && gen === generation);
      } finally {
        if (inFlight === run) inFlight = null;
      }
      if (gen === generation && state !== WALLET_STATE.READY) scheduleRewardRetry(currentReason, gen);
      return gen === generation && state === WALLET_STATE.READY;
    })();
    inFlight = run;
    return run;
  }

  /** Account boundary. Same id is a no-op; any change drops the old snapshot and old responses. */
  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === WALLET_STATE.READY);
    generation += 1;
    clearRewardRetry({ resetAttempt: true });
    accountId = next;
    rerun = false;
    rerunReason = null;
    inFlight = null;
    if (!next) {
      set(WALLET_STATE.SIGNED_OUT, null, "account");
      return Promise.resolve(false);
    }
    set(WALLET_STATE.LOADING, null, "account");
    return refresh("account");
  }

  return {
    setAccount,
    refresh,
    get state() { return state; },
    get snapshot() { return snapshot; },
    get accountId() { return accountId; },
    balance: (currencyId = INDUCK_COIN) => (state === WALLET_STATE.READY ? walletBalance(snapshot, currencyId) : null),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return { state, accountBound: accountId !== null, currencies: snapshot ? Object.keys(snapshot.balances).length : 0 };
    }
  };
}
