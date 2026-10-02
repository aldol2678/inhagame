import { validWorldTime } from './npc-world-time-contract.mjs';

// Monotonic browser time is anchored to the server, never to the user's system clock.
export function createNpcWorldClock({ fetcher = globalThis.fetch,
  monotonicNow = () => performance.now(), endpoint = '/api/world-time',
  refreshMs = 60_000, maxAgeMs = 120_000, timeoutMs = 3000 } = {}) {
  let anchor = null, pending = null, lastNow = null, lastError = null, retryAt = -Infinity;
  let disposed = false;
  function now() {
    const local = monotonicNow();
    if (!anchor || local - anchor.local > maxAgeMs || disposed) return null;
    const estimated = anchor.server + local - anchor.local;
    lastNow = Math.max(lastNow ?? estimated, estimated);
    return lastNow;
  }
  async function request() {
    const start = monotonicNow();
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetcher(endpoint, { cache: 'no-store', signal: abort.signal });
      if (!response.ok) throw new Error('WORLD_TIME_UNAVAILABLE');
      const payload = await response.json(), end = monotonicNow();
      if (!validWorldTime(payload)) throw new Error('WORLD_TIME_CONTRACT_MISMATCH');
      if (end - start > 2000 || end < start) throw new Error('WORLD_TIME_LATENCY');
      if (!disposed) {
        anchor = { server: payload.serverNowMs + (end - start) / 2, local: end, rttMs: end - start };
        lastError = null;
        retryAt = end + refreshMs;
      }
    } catch (error) {
      if (!disposed) { lastError = error.message; retryAt = monotonicNow() + 5000; }
    } finally { clearTimeout(timer); }
    return status();
  }
  function sync() {
    if (disposed) return Promise.resolve(status());
    if (!pending) pending = request().finally(() => { pending = null; });
    return pending;
  }
  function refreshIfDue() { if (monotonicNow() >= retryAt) void sync(); }
  function status() {
    const serverNowMs = now();
    return { state: disposed ? 'DISPOSED' : serverNowMs === null ? 'UNAVAILABLE' : lastError ? 'HOLDOVER' : 'SYNCED',
      serverNowMs, ageMs: anchor ? monotonicNow() - anchor.local : null,
      rttMs: anchor?.rttMs ?? null, lastError };
  }
  return { sync, now, status, refreshIfDue, dispose() { disposed = true; } };
}
