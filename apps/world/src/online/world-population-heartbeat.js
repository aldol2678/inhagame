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
  const sessionId = randomId?.();
  if (!sessionId) return null;
  const visitorId = persistentVisitorId(visitorStorage, randomId);

  let stopped = false;
  let paused = false;
  let timer = null;
  let lastSentAt = null;
  let lastError = null;
  let generation = 0;
  let inFlight = null;
  let resumePending = false;
  let cancelPending = null;
  const deadlineScheduler = scheduler?.setTimeout && scheduler?.clearTimeout ? scheduler : globalThis;

  function pulse() {
    if (stopped || paused) return Promise.resolve(false);
    // Keep client writes sequential across restore, including changes to auth-derived identity.
    if (inFlight) return inFlight;
    const startedGeneration = generation;
    const isCurrent = () => !stopped && !paused && startedGeneration === generation;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let deadline = null;
    let finished = false;
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
          p_session_id: sessionId,
          p_visitor_id: visitorId,
          p_place_zone_id: validZone(snapshot.placeZoneId),
          p_space: validSpace(snapshot.space)
        });
        if (controller && request?.abortSignal) request = request.abortSignal(controller.signal);
        deadline = deadlineScheduler.setTimeout(() => {
          if (finished || stopped) return;
          // Aborting fetch cannot prove the server cancelled its write. Stop until reload
          // rather than race a replacement write using potentially different auth state.
          lastError = "WORLD_HEARTBEAT_TIMEOUT";
          stopLocal();
        }, WORLD_HEARTBEAT_TIMEOUT_MS);
        const result = await Promise.race([request, cancelled]);
        if (!isCurrent()) return false;
        if (result.error) throw result.error;
        lastError = null;
        lastSentAt = Date.now();
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        lastError = String(error?.message ?? error);
        if (lastError.includes('WORLD_SESSION_REVOKED')) {
          stopLocal();
          try { onRevoked(); } catch (callbackError) { console.warn('World session ejection callback failed:', callbackError); }
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

  const initialPulse = pulse();
  schedule();

  return {
    sessionId,
    visitorId,
    initialPulse,
    pulse,
    status: () => ({ sessionId, visitorId, lastSentAt, lastError, stopped, paused }),
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
