import {
  FLAG_DISABLED,
  FLAG_ENABLED,
  FLAG_UNAVAILABLE,
  probeFeatureFlag
} from "./npc-feature-flags.js";

export const ASSET_CANARY_REMOTE_URL = "/api/asset-canary-flag";
export const ASSET_CANARY_REMOTE_POLL_MS = 15000;
export const ASSET_CANARY_REMOTE_TIMEOUT_MS = 1500;

export function createAssetCanaryRemoteControl({
  url = ASSET_CANARY_REMOTE_URL,
  fetcher = globalThis.fetch,
  pollMs = ASSET_CANARY_REMOTE_POLL_MS,
  timeoutMs = ASSET_CANARY_REMOTE_TIMEOUT_MS,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) {
  let state = FLAG_UNAVAILABLE;
  let started = false;
  let stopped = false;
  let paused = false;
  let generation = 0;
  let pending = null;
  let timer = null;
  const listeners = new Set();

  function publish(next) {
    state = next;
    for (const listener of listeners) {
      try { listener(next); } catch {}
    }
    return next;
  }

  async function check() {
    if (stopped || paused) return state;
    if (pending) return pending;
    const currentGeneration = generation;
    pending = (async () => {
      try {
        const next = await probeFeatureFlag(url, {
          fetcher,
          timeoutMs,
          setTimer,
          clearTimer
        });
        // A read started before pagehide must not publish into a restored or disposed page.
        if (currentGeneration !== generation || stopped || paused) return state;
        return publish(next);
      } finally {
        if (currentGeneration === generation) pending = null;
      }
    })();
    return pending;
  }

  function schedule(currentGeneration) {
    if (currentGeneration !== generation || !started || stopped || paused || timer !== null ||
        !Number.isFinite(pollMs) || pollMs <= 0) return;
    timer = setTimer(async () => {
      if (currentGeneration !== generation || stopped || paused) return;
      timer = null;
      await check();
      schedule(currentGeneration);
    }, pollMs);
  }

  async function start() {
    if (stopped) return state;
    if (started) return pending ?? state;
    started = true;
    paused = false;
    const currentGeneration = generation;
    const initial = await check();
    schedule(currentGeneration);
    return initial;
  }

  function pause() {
    paused = true;
    started = false;
    generation += 1;
    pending = null;
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== "function") throw new TypeError("listener required");
    listeners.add(listener);
    if (emitCurrent) listener(state);
    return () => listeners.delete(listener);
  }

  function stop() {
    pause();
    stopped = true;
    listeners.clear();
  }

  return Object.freeze({
    start,
    pause,
    check,
    subscribe,
    stop,
    get state() { return state; },
    get enabled() { return state === FLAG_ENABLED; },
    status: () => Object.freeze({
      state,
      enabled: state === FLAG_ENABLED,
      failClosed: state === FLAG_DISABLED || state === FLAG_UNAVAILABLE,
      pollMs,
      timeoutMs
    })
  });
}
