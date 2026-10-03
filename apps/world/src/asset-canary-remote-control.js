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
    if (stopped) return state;
    const next = await probeFeatureFlag(url, {
      fetcher,
      timeoutMs,
      setTimer,
      clearTimer
    });
    return publish(next);
  }

  function schedule() {
    if (stopped || !Number.isFinite(pollMs) || pollMs <= 0) return;
    timer = setTimer(async () => {
      timer = null;
      await check();
      schedule();
    }, pollMs);
  }

  async function start() {
    if (started) return state;
    started = true;
    const initial = await check();
    schedule();
    return initial;
  }

  function subscribe(listener, { emitCurrent = false } = {}) {
    if (typeof listener !== "function") throw new TypeError("listener required");
    listeners.add(listener);
    if (emitCurrent) listener(state);
    return () => listeners.delete(listener);
  }

  function stop() {
    stopped = true;
    if (timer !== null) clearTimer(timer);
    timer = null;
    listeners.clear();
  }

  return Object.freeze({
    start,
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
