// INHA WORLD P0-F3a · Progression read client.
// The server is the only authority: get_my_world_progression_v1() derives Level from stored EXP and
// the immutable thresholds. This module only fetches and validates that snapshot. It never computes
// a Level, never keeps a threshold table and never writes progression.
//
// Account-scoped: every account change bumps a generation counter, drops the previous snapshot and
// discards any response that belongs to an older generation, so one account's result can never be
// shown (or compared for a level-up) under another account.

export const PROGRESSION_RPC = "get_my_world_progression_v1";

export const PROGRESSION_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;
const isLevel = (value) => Number.isSafeInteger(value) && value >= 1;

/** Server snapshot → frozen display snapshot, or null when the shape is not the documented contract. */
export function parseProgressionSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { totalExp, level, currentLevelStartExp, nextLevelExp, progressExp, progressRequired, maxDefinedLevel, isMaxLevel } = raw;
  if (!isCount(totalExp) || !isLevel(level) || !isCount(currentLevelStartExp) || !isCount(progressExp)) return null;
  if (!isLevel(maxDefinedLevel) || typeof isMaxLevel !== "boolean") return null;
  if (isMaxLevel) {
    if (nextLevelExp !== null || progressRequired !== null) return null;
  } else if (!isCount(nextLevelExp) || !Number.isSafeInteger(progressRequired) || progressRequired <= 0) {
    return null;
  }
  return Object.freeze({ totalExp, level, currentLevelStartExp, nextLevelExp, progressExp, progressRequired, maxDefinedLevel, isMaxLevel });
}

/**
 * @param {{ getClient: () => ({ rpc: Function } | null) }} options
 *   getClient returns the signed-in permanent-account Supabase client, or null (guest / signed out).
 */
export function createProgressionClient({
  getClient,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  rewardRetryDelays = [1000, 3000, 8000]
} = {}) {
  if (typeof getClient !== "function") throw new Error("Progression client requires getClient");

  let accountId = null;
  let generation = 0;
  let state = PROGRESSION_STATE.SIGNED_OUT;
  let snapshot = null;
  let lastReadySnapshot = null;
  let inFlight = null;
  let rerun = false;
  let rerunReason = null;
  let rewardRetryTimer = null;
  let rewardRetryAttempt = 0;
  const listeners = new Set();

  const reasonPriority = reason => reason === "core15-first-campus-reward" ? 3 : reason === "reward" ? 2 : 1;
  const isRewardReadbackReason = reason => reason === "reward" || reason === "core15-first-campus-reward";
  const strongerReason = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    return reasonPriority(b) >= reasonPriority(a) ? b : a;
  };

  function clearRewardRetry({ resetAttempt = false } = {}) {
    if (rewardRetryTimer !== null) clearTimer(rewardRetryTimer);
    rewardRetryTimer = null;
    if (resetAttempt) rewardRetryAttempt = 0;
  }

  function scheduleRewardRetry(reason, gen) {
    if (!isRewardReadbackReason(reason) || !accountId || gen !== generation || rewardRetryTimer !== null) return false;
    const delay = rewardRetryDelays[rewardRetryAttempt];
    if (!Number.isFinite(delay) || delay < 0) return false;
    rewardRetryAttempt += 1;
    rewardRetryTimer = setTimer(() => {
      rewardRetryTimer = null;
      if (gen !== generation || !accountId) return;
      void refresh(reason);
    }, delay);
    return true;
  }

  function publish(change) {
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Progression listener failed:", error); }
    }
  }

  function set(nextState, nextSnapshot, { reason, previous = snapshot, sameAccount = true } = {}) {
    state = nextState;
    snapshot = nextSnapshot;
    publish({ state, snapshot, previous: sameAccount ? previous : null, accountId, reason });
  }

  async function fetchOnce(reason) {
    const gen = generation;
    const account = accountId;
    const client = getClient();
    if (!account || !client?.rpc) {
      if (gen === generation) set(PROGRESSION_STATE.SIGNED_OUT, null, { reason, previous: null });
      return;
    }
    let next = null;
    try {
      const { data, error } = await client.rpc(PROGRESSION_RPC);
      if (error) throw error;
      next = parseProgressionSnapshot(data);
    } catch (error) {
      console.warn("World progression unavailable:", error?.message ?? error);
      next = null;
    }
    // A newer account change (sign-out, switch) happened while this request was in flight.
    if (gen !== generation || account !== accountId) return;
    if (next) {
      const previousReady = lastReadySnapshot;
      clearRewardRetry({ resetAttempt: true });
      set(PROGRESSION_STATE.READY, next, { reason, previous: previousReady });
      lastReadySnapshot = next;
    } else {
      set(PROGRESSION_STATE.UNAVAILABLE, null, { reason, previous: lastReadySnapshot });
    }
  }

  function refresh(reason = "refresh") {
    if (!accountId) return Promise.resolve(false);
    // Coalesce: while a request runs, remember one more and preserve the strongest semantic reason.
    // CORE-15 reward readback must not be downgraded to a generic account/resume refresh.
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
        // An account change replaced this run; never clear the newer one.
        if (inFlight === run) inFlight = null;
      }
      if (gen === generation && state !== PROGRESSION_STATE.READY && isRewardReadbackReason(currentReason)) {
        scheduleRewardRetry(currentReason, gen);
      }
      return gen === generation && state === PROGRESSION_STATE.READY;
    })();
    inFlight = run;
    return run;
  }

  /** Account boundary. Same id is a no-op; any change drops the old snapshot and old responses. */
  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === PROGRESSION_STATE.READY);
    generation += 1;
    clearRewardRetry({ resetAttempt: true });
    accountId = next;
    rerun = false;
    rerunReason = null;
    inFlight = null;
    lastReadySnapshot = null;
    if (!next) {
      set(PROGRESSION_STATE.SIGNED_OUT, null, { reason: "account", sameAccount: false });
      return Promise.resolve(false);
    }
    set(PROGRESSION_STATE.LOADING, null, { reason: "account", sameAccount: false });
    return refresh("account");
  }

  return {
    setAccount,
    refresh,
    get state() { return state; },
    get snapshot() { return snapshot; },
    get accountId() { return accountId; },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return { state, accountBound: accountId !== null, snapshot };
    }
  };
}
