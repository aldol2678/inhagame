// INHA WORLD · 온라인 인원 heartbeat client (Tier 4 BCD, C-group (b)).
// Tier 4 port of src/online/world-population-heartbeat.js. The origin
// called legacy RPCs (touch_world_online_session_v2 /
// get_world_online_count_v1) with an auth uid; this port calls the Tier 4
// Worker over HTTP with the v0.1 guest session id only. Parsing, timing
// and pause/resume rules are unchanged; only the transport changed.
//
// C-3 (decided): the heartbeat session id IS the guest session id —
// readGuestSessionId() (fishing-reporter-wiring.js: localStorage
// 'inha-v01:sync-session', fallback 'inha-v01:server-session'; null when
// absent — never fabricated). No separate heartbeat session is minted.
// C-1: heartbeat 20 s, server window 70 s. C-2: the count endpoint is
// cached 5 s server-side (Worker-local). The server rate-limits touch to
// 1 per 10 s per session (429 RATE_LIMITED); a 429 is recorded as the
// last error and the next 20 s pulse retries past the limit.
//
// Transport:
//   POST /api/world-online-touch { placeZoneId, space, visitorId }
//     → 200 { ok: true } | 400 INVALID_PLACE_ZONE / INVALID_SPACE |
//       429 RATE_LIMITED | 401 SESSION_ID_REQUIRED
//   GET /api/world-online-count → 200 { online, signedIn, guests,
//     lobby, campus, clubRoom, housingLobby, personalRoom, asOf }
//   signedIn is 0 in Tier 4 (user_id is always NULL); guests == online.
//   The count is sessionless — no header is sent for it.
//
// Closed tabs simply age out server-side (70 s window). BFCache retains
// this instance, so pause/resume preserves the session id and resumes
// only its own suspension, exactly like the origin.

import { readGuestSessionId } from "../activity/session-id.js";

export const WORLD_HEARTBEAT_MS = 20_000;
export const WORLD_HEARTBEAT_TIMEOUT_MS = 10_000;
export const WORLD_VISITOR_STORAGE_KEY = "inhagame-hub-visitor-v1";

export const WORLD_POPULATION_REFRESH_MS = 20_000;
export const WORLD_ONLINE_TOUCH_API_PATH = "/api/world-online-touch";
export const WORLD_ONLINE_COUNT_API_PATH = "/api/world-online-count";

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
  fetchImpl = globalThis.fetch,
  baseUrl = "",
  getSessionId = readGuestSessionId,
  getSnapshot = () => ({}),
  randomId = () => globalThis.crypto?.randomUUID?.(),
  visitorStorage = globalThis.localStorage,
  scheduler = globalThis,
  windowTarget = globalThis.window,
  intervalMs = WORLD_HEARTBEAT_MS,
  onRevoked = () => {}
} = {}) {
  const sessionId = getSessionId?.();
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
        deadline = deadlineScheduler.setTimeout(() => {
          // Aborting fetch cannot prove the server cancelled its write.
          // Stop until reload rather than race a replacement write.
          lastError = "WORLD_HEARTBEAT_TIMEOUT";
          stopLocal();
        }, WORLD_HEARTBEAT_TIMEOUT_MS);
        const response = await Promise.race([
          fetchImpl(`${baseUrl}${WORLD_ONLINE_TOUCH_API_PATH}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
            body: JSON.stringify({
              placeZoneId: validZone(snapshot.placeZoneId),
              space: validSpace(snapshot.space),
              visitorId
            }),
            signal: controller?.signal
          }),
          cancelled
        ]);
        if (!isCurrent()) return false;
        if (response === null) return false;
        if (!response.ok) {
          const body = await response.json().catch(() => null);
          throw new Error(String(body?.error ?? `HTTP_${response.status}`));
        }
        lastError = null;
        lastSentAt = Date.now();
        return true;
      } catch (error) {
        if (!isCurrent()) return false;
        lastError = String(error?.message ?? error);
        if (lastError.includes("WORLD_SESSION_REVOKED")) {
          stopLocal();
          try { onRevoked(); } catch (callbackError) { console.warn("World session ejection callback failed:", callbackError); }
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

const isCount = (value) => Number.isSafeInteger(value) && value >= 0;

/** Server count → frozen snapshot, or null when it is not the documented contract. (Verbatim from the origin.) */
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
  fetchImpl = globalThis.fetch,
  baseUrl = "",
  scheduler = globalThis,
  intervalMs = WORLD_POPULATION_REFRESH_MS,
  onChange = () => {}
} = {}) {
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
        const response = await fetchImpl(`${baseUrl}${WORLD_ONLINE_COUNT_API_PATH}`);
        if (!response.ok) throw new Error(`HTTP_${response.status}`);
        const next = parseWorldPopulationSnapshot(await response.json());
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
