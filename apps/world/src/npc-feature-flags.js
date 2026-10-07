// CORE-15: NPC feature flags (/api/npc-ai, /api/world-quest, /api/npc-relationship, etc.) answer GET with 200 {enabled:true} when on
// and 404 when off. Anything else (network error, 5xx, timeout, bad body) is UNAVAILABLE: a transient
// answer that must not switch the first quest off for the whole session.
export const FLAG_ENABLED = 'ENABLED';
export const FLAG_DISABLED = 'DISABLED';
export const FLAG_UNAVAILABLE = 'UNAVAILABLE';

export async function probeFeatureFlag(url, { fetcher = fetch, timeoutMs = 4000,
  setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  let timer = null;
  const timeout = new Promise(resolve => {
    timer = setTimer(() => { controller?.abort(); resolve(FLAG_UNAVAILABLE); }, timeoutMs);
  });
  const probe = (async () => {
    const response = await fetcher(url, { cache: 'no-store', signal: controller?.signal });
    if (response.status === 404) return FLAG_DISABLED;
    if (!response.ok) return FLAG_UNAVAILABLE;
    const body = await response.json();
    return body?.enabled === true ? FLAG_ENABLED : FLAG_DISABLED;
  })().catch(() => FLAG_UNAVAILABLE);
  try { return await Promise.race([probe, timeout]); }
  finally { clearTimer(timer); }
}

// Keeps probing an UNAVAILABLE flag on retryDelays and calls onResolved once with true/false when it
// settles (false also when the delays run out). Returns a cancel function.
export function retryFeatureFlag(url, { onResolved, retryDelays = [1000, 3000, 8000], fetcher = fetch,
  timeoutMs = 4000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let cancelled = false, timer = null, attempt = 0;
  const next = () => {
    const delay = retryDelays[attempt++];
    if (!Number.isFinite(delay) || delay < 0) { onResolved(false); return; }
    timer = setTimer(async () => {
      timer = null;
      if (cancelled) return;
      const result = await probeFeatureFlag(url, { fetcher, timeoutMs, setTimer, clearTimer });
      if (cancelled) return;
      if (result === FLAG_UNAVAILABLE) next();
      else onResolved(result === FLAG_ENABLED);
    }, delay);
  };
  next();
  return () => { cancelled = true; if (timer !== null) clearTimer(timer); };
}
