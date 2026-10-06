// INHA WORLD · Wallet balance read client (read-model on the P0-A player read).
// The server is the only authority: get_my_world_wallet_v1() returns the caller's balances from the
// wallet ledger (0 for a currency without a wallet row). This module only fetches and validates that
// snapshot. It never computes a balance: no price subtraction, no reward addition, no local storage,
// no optimistic value. After anything that may move money the caller re-reads the server.
//
// Account-scoped like P0-F3a progression / P0-F3b shop: every account change bumps a generation
// counter, drops the previous snapshot and discards any response from an older generation.

export const WALLET_RPC = "get_my_world_wallet_v1";
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
 * @param {{ getClient: () => ({ rpc: Function } | null) }} options
 *   getClient returns the signed-in permanent-account Supabase client (online.supabase), or null.
 */
export function createWalletClient({
  getClient,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  rewardRetryDelays = [1000, 3000, 8000]
} = {}) {
  if (typeof getClient !== "function") throw new Error("Wallet client requires getClient");

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

  async function fetchOnce(reason) {
    const gen = generation;
    const account = accountId;
    const client = getClient();
    if (!account || !client?.rpc) {
      if (gen === generation) set(WALLET_STATE.SIGNED_OUT, null, reason);
      return;
    }
    let next = null;
    try {
      const { data, error } = await client.rpc(WALLET_RPC);
      if (error) throw error;
      next = parseWalletSnapshot(data);
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
