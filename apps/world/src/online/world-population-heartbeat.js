// Best-effort operational heartbeat for total INHAGAME Campus population.
// Unlike Place Zone Realtime Presence, this includes signed-out/guest visitors.
// It stores only an ephemeral session UUID, optional auth uid, coarse space/zone, and timestamps.

export const WORLD_HEARTBEAT_MS = 20_000;
export const WORLD_HEARTBEAT_TIMEOUT_MS = 10_000;
export const WORLD_VISITOR_STORAGE_KEY = "inhagame-hub-visitor-v1";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function persistentVisitorId(storage, randomId) {
  try {
    const stored = storage?.getItem?.(WORLD_VISITOR_STORAGE_KEY);
    if (UUID_RE.test(String(stored || ""))) return stored;
    const created = randomId?.();
    if (!UUID_RE.test(String(created || ""))) return null;
    storage?.setItem?.(WORLD_VISITOR_STORAGE_KEY, created);
    return created;
  } catch {
    return null;
  }
}

function validZone(value) {
  return typeof value === "string" && /^AREA_[A-Z0-9_]{1,60}$/.test(value) ? value : null;
}
function validSpace(value) {
  return ["lobby", "campus", "club_room", "housing_lobby", "personal_room"].includes(value) ? value : "campus";
}

export const WORLD_SESSION_REVOKED = "WORLD_SESSION_REVOKED";
export const WORLD_SESSION_OWNER_MISMATCH = "WORLD_SESSION_OWNER_MISMATCH";
export const WORLD_HEARTBEAT_TIMEOUT = "WORLD_HEARTBEAT_TIMEOUT";

// PostgREST puts the raise-exception text in `message`; keep `details` as a fallback.
const errorText = error => String(error?.message ?? error?.details ?? error ?? "");
const isRevoked = error => !!error && errorText(error).includes(WORLD_SESSION_REVOKED);
const isOwnerMismatch = error => !!error && errorText(error).includes(WORLD_SESSION_OWNER_MISMATCH);

// Terminal states are only: operator revocation, pagehide (not BFCache), and explicit stop().
// A slow or failed request is NOT terminal: the server serializes writes per account and rejects a
// session UUID owned by another account, so a late or repeated write can neither resurrect a kicked
// account nor take over another account's row. Aborting just abandons the request.
export function startWorldPopulationHeartbeat({
  client,
  getSnapshot = () => ({}),
  randomId = () => globalThis.crypto?.randomUUID?.(),
  visitorStorage = globalThis.localStorage,
  scheduler = globalThis,
  windowTarget = globalThis.window,
  intervalMs = WORLD_HEARTBEAT_MS,
  onRevoked = () => {}
} = {}) {
  if (!client?.rpc) return null;
  let sessionId = randomId?.();
  if (!sessionId) return null;
  const visitorId = persistentVisitorId(visitorStorage, randomId);

  let stopped = false;
  let paused = false;
  let revoked = false;
  let timer = null;
  let lastSentAt = null;
  let lastError = null;
  let consecutiveFailures = 0;
  let generation = 0; // page lifecycle: pause / resume / stop
  let authEpoch = 0; // account identity: bumped when the signed-in account changes
  let knownUid; // undefined until the first auth event; null = signed out
  let ownerRetryUsed = false;
  let inFlight = null;
  let resumePending = false;
  let cancelPending = null;
  let authSubscription = null;
  const deadlineScheduler = scheduler?.setTimeout && scheduler?.clearTimeout ? scheduler : globalThis;

  function revoke() {
    if (revoked) return;
    revoked = true;
    lastError = WORLD_SESSION_REVOKED;
    stopLocal();
    try { onRevoked(); } catch (callbackError) { console.warn("World session ejection callback failed:", callbackError); }
  }

  function pulse() {
    if (stopped || paused) return Promise.resolve(false);
    // Keep client writes sequential; a superseded request is abandoned (aborted), never overlapped.
    if (inFlight) return inFlight;
    const startedGeneration = generation;
    const startedEpoch = authEpoch;
    const startedSessionId = sessionId;
    const sameAccount = () => !stopped && startedEpoch === authEpoch;
    const isCurrent = () => sameAccount() && !paused && startedGeneration === generation;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let deadline = null;
    let finished = false;
    let timedOut = false;
    let consumed = false;
    const clearDeadline = () => {
      finished = true;
      if (deadline !== null) deadlineScheduler.clearTimeout(deadline);
      deadline = null;
    };
    let cancel;
    const cancelled = new Promise(resolve => {
      cancel = () => { clearDeadline(); controller?.abort(); resolve(null); };
    });
    cancelPending = cancel;
    const run = (async () => {
      try {
        const snapshot = getSnapshot?.() ?? {};
        let request = client.rpc("touch_world_online_session_v2", {
          p_session_id: startedSessionId,
          p_visitor_id: visitorId,
          p_place_zone_id: validZone(snapshot.placeZoneId),
          p_space: validSpace(snapshot.space)
        });
        if (controller && request?.abortSignal) request = request.abortSignal(controller.signal);
        // A response that arrives after this request was abandoned (timeout, auth switch, BFCache) is
        // ignored, with one exception: a revocation for the SAME account is authoritative whenever it
        // arrives and must still end the session.
        void Promise.resolve(request).then(
          late => { if (!consumed && isRevoked(late?.error) && sameAccount()) revoke(); },
          late => { if (!consumed && isRevoked(late) && sameAccount()) revoke(); }
        );
        deadline = deadlineScheduler.setTimeout(() => {
          if (finished || stopped) return;
          timedOut = true;
          cancel();
        }, WORLD_HEARTBEAT_TIMEOUT_MS);
        const result = await Promise.race([request, cancelled]);
        // null means the request was abandoned (timeout / auth switch / stop): keep watching it.
        if (result !== null) consumed = true;
        if (result?.error && isRevoked(result.error) && sameAccount()) { revoke(); return false; }
        if (!isCurrent()) return false;
        if (timedOut) {
          consecutiveFailures += 1;
          lastError = WORLD_HEARTBEAT_TIMEOUT;
          return false;
        }
        if (result?.error) throw result.error;
        lastError = null;
        lastSentAt = Date.now();
        consecutiveFailures = 0;
        ownerRetryUsed = false;
        return true;
      } catch (error) {
        consumed = true;
        if (isRevoked(error) && sameAccount()) { revoke(); return false; }
        if (!isCurrent()) return false;
        consecutiveFailures += 1;
        lastError = errorText(error);
        if (isOwnerMismatch(error)) {
          // This UUID belongs to another account (account switched without a clean auth event).
          // Take a fresh UUID; retry once immediately, then fall back to the normal cadence.
          rotateSession();
          if (!ownerRetryUsed) { ownerRetryUsed = true; resumePending = true; }
        }
        return false;
      } finally {
        clearDeadline();
        if (cancelPending === cancel) cancelPending = null;
      }
    })();
    inFlight = run;
    void run.then(() => {
      if (inFlight === run) inFlight = null;
      if (resumePending && !stopped && !paused) {
        resumePending = false;
        void pulse();
      }
    });
    return run;
  }

  // A new UUID is the only safe way to continue as a different account: the old row stays owned by
  // the old account and simply ages out (<= 70 s), exactly like a closed tab.
  function rotateSession() {
    const next = randomId?.();
    if (!UUID_RE.test(String(next || "")) || next === sessionId) return false;
    sessionId = next;
    authEpoch++;
    return true;
  }

  function onAuthChange(_event, authSession) {
    if (stopped) return;
    const uid = authSession?.user?.id ?? null;
    if (knownUid === undefined) { knownUid = uid; return; }
    if (uid === knownUid) return;
    knownUid = uid;
    if (!rotateSession()) return;
    ownerRetryUsed = false;
    // Abandon the request that carries the previous identity, then write once for the new one.
    cancelPending?.();
    if (inFlight) resumePending = true;
    else if (!paused) void pulse();
  }

  function schedule() {
    if (stopped || paused || timer !== null || !scheduler?.setInterval) return;
    const scheduledGeneration = generation;
    timer = scheduler.setInterval(() => {
      if (scheduledGeneration === generation) void pulse();
    }, intervalMs);
  }

  function clearTimer() {
    if (timer !== null) scheduler?.clearInterval?.(timer);
    timer = null;
  }

  function stopLocal() {
    if (stopped) return;
    stopped = true;
    paused = false;
    resumePending = false;
    generation++;
    clearTimer();
    cancelPending?.();
    cancelPending = null;
    try { authSubscription?.unsubscribe?.(); } catch { /* best effort */ }
    authSubscription = null;
    windowTarget?.removeEventListener?.("pagehide", onPageHide);
    windowTarget?.removeEventListener?.("pageshow", onPageShow);
  }

  // Closed tabs simply age out server-side. This avoids exposing a destructive public RPC.
  // BFCache retains this instance, so preserve its IDs and resume only its own suspension.
  const onPageHide = event => {
    if (!event?.persisted) { stopLocal(); return; }
    if (stopped || paused) return;
    paused = true;
    resumePending = false;
    generation++;
    clearTimer();
  };
  const onPageShow = event => {
    if (!event?.persisted || stopped || !paused) return;
    paused = false;
    if (inFlight) resumePending = true;
    else void pulse();
    schedule();
  };
  windowTarget?.addEventListener?.("pagehide", onPageHide);
  windowTarget?.addEventListener?.("pageshow", onPageShow);
  try {
    authSubscription = client.auth?.onAuthStateChange?.(onAuthChange)?.data?.subscription ?? null;
  } catch (error) {
    console.warn("World heartbeat auth listener unavailable:", error);
  }

  const initialPulse = pulse();
  schedule();

  return {
    get sessionId() { return sessionId; },
    visitorId,
    initialPulse,
    pulse,
    status: () => ({
      sessionId, visitorId, lastSentAt, lastError, stopped, paused, revoked, consecutiveFailures
    }),
    stop: stopLocal
  };
}


export const WORLD_POPULATION_REFRESH_MS = 20_000;
export const WORLD_POPULATION_RPC = "get_world_online_count_v1";

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

export function parseWorldPopulationSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { online, signedIn, guests, lobby, campus, clubRoom, asOf } = raw;
  if (![online, signedIn, guests, lobby, campus, clubRoom].every(isCount)) return null;
  if (signedIn + guests !== online) return null;
  return Object.freeze({
    online,
    signedIn,
    guests,
    lobby,
    campus,
    clubRoom,
    asOf: typeof asOf === "string" ? asOf : null
  });
}

export function startWorldPopulationCount({
  client,
  scheduler = globalThis,
  intervalMs = WORLD_POPULATION_REFRESH_MS,
  onChange = () => {}
} = {}) {
  if (!client?.rpc) return null;

  let state = "LOADING";
  let snapshot = null;
  let lastError = null;
  let stopped = false;
  let timer = null;
  let inFlight = null;

  const publish = () => {
    try { onChange({ state, snapshot, lastError }); }
    catch (error) { console.warn("World population listener failed:", error); }
  };

  async function refresh() {
    if (stopped) return false;
    if (inFlight) return inFlight;
    const run = (async () => {
      try {
        const { data, error } = await client.rpc(WORLD_POPULATION_RPC);
        if (error) throw error;
        const next = parseWorldPopulationSnapshot(data);
        if (!next) throw new Error("INVALID_WORLD_POPULATION");
        if (stopped) return false;
        snapshot = next;
        state = "READY";
        lastError = null;
        publish();
        return true;
      } catch (error) {
        if (stopped) return false;
        state = "UNAVAILABLE";
        lastError = String(error?.message ?? error);
        publish();
        return false;
      } finally {
        if (inFlight === run) inFlight = null;
      }
    })();
    inFlight = run;
    return run;
  }

  void refresh();
  if (scheduler?.setInterval) timer = scheduler.setInterval(() => { void refresh(); }, intervalMs);

  return {
    refresh,
    status: () => ({ state, snapshot, lastError, stopped }),
    stop() {
      if (stopped) return;
      stopped = true;
      if (timer !== null) scheduler?.clearInterval?.(timer);
      timer = null;
    }
  };
}
