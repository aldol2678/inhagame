// Browser client for the Inkyung fishing endpoint (POST /api/world-fishing, Fishing F2).
// The server owns availability, timing, the result and every reward. The client sends only
// ids (spot, attempt, nonce, action) and renders what the server returned.
import { FISHING_ACTIVITY_ID, FISHING_SOURCES } from "./fishing-core.js";

export const FISHING_API_PATH = "/api/world-fishing";
export const FISHING_CLIENT_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  CHECKING: "CHECKING",
  READY: "READY",
  // The endpoint is switched off (404) or refused the account. No 🎣 action is offered.
  UNAVAILABLE: "UNAVAILABLE"
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["ACTIVE", "SUCCEEDED", "FAILED", "CANCELLED", "EXPIRED"]);
const SETTLEMENTS = new Set(["NOT_REQUIRED", "PENDING", "SETTLED"]);
const ms = value => (Number.isSafeInteger(value) && value >= 0 ? value : null);

function parseCatch(raw) {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const quantity = ms(raw.quantity), lifeXp = ms(raw.lifeXp);
  if (typeof raw.itemId !== "string" || typeof raw.skillId !== "string" ||
      typeof raw.collectionEntryId !== "string" || quantity === null || lifeXp === null) return undefined;
  return Object.freeze({ itemId: raw.itemId, quantity, lifeXp, skillId: raw.skillId,
    collectionEntryId: raw.collectionEntryId });
}

function parseResult(raw, status) {
  if (raw === null) return status === "ACTIVE" ? null : undefined;
  if (!raw || typeof raw !== "object" || raw.status !== status || typeof raw.reason !== "string") return undefined;
  const fish = parseCatch(raw.catch ?? null);
  if (fish === undefined || (status === "SUCCEEDED") !== (fish !== null)) return undefined;
  return Object.freeze({ status, reason: raw.reason, catch: fish });
}

/** Projected attempt from the server, or null when it does not satisfy the contract. */
export function parseFishingAttempt(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { attemptId, nonce, sourceRef, status } = raw;
  const startedAtMs = ms(raw.startedAtMs), biteAtMs = ms(raw.biteAtMs);
  const hookDeadlineMs = ms(raw.hookDeadlineMs), expiresAtMs = ms(raw.expiresAtMs);
  if (raw.activityId !== FISHING_ACTIVITY_ID || !UUID.test(attemptId ?? "") || !UUID.test(nonce ?? "") ||
      !FISHING_SOURCES.includes(sourceRef) || !STATUSES.has(status) ||
      startedAtMs === null || biteAtMs === null || hookDeadlineMs === null || expiresAtMs === null ||
      !(startedAtMs <= biteAtMs && biteAtMs < hookDeadlineMs && hookDeadlineMs < expiresAtMs)) return null;
  const result = parseResult(raw.result ?? null, status);
  if (result === undefined) return null;
  return Object.freeze({ attemptId: attemptId.toLowerCase(), nonce: nonce.toLowerCase(), sourceRef, status,
    startedAtMs, biteAtMs, hookDeadlineMs, expiresAtMs, result });
}

/** Self read: latest/requested attempt plus the current carp, discovery and Fishing skill. */
export function parseFishingRead(raw) {
  if (!raw || typeof raw !== "object" || !SETTLEMENTS.has(raw.settlement)) return null;
  const attempt = raw.attempt === null ? null : parseFishingAttempt(raw.attempt);
  if (raw.attempt !== null && !attempt) return null;
  const quantity = ms(raw.inventory?.quantity);
  const skill = raw.lifeSkill;
  const level = ms(skill?.level), totalXp = ms(skill?.totalXp);
  const nextLevelXp = skill?.nextLevelXp === null ? null : ms(skill?.nextLevelXp);
  if (quantity === null || raw.inventory.itemId !== "material.fish_carp" ||
      skill?.skillId !== "life.fishing" || level === null || level < 1 || totalXp === null) return null;
  return Object.freeze({
    attempt,
    settlement: raw.settlement,
    carpQuantity: quantity,
    discovered: raw.discovery?.discovered === true,
    skill: Object.freeze({ level, totalXp, nextLevelXp })
  });
}

export function createFishingClient({
  getToken,
  fetcher = (...args) => globalThis.fetch(...args),
  now = () => Date.now(),
  uuid = () => globalThis.crypto.randomUUID(),
  endpoint = FISHING_API_PATH
} = {}) {
  let accountId = null;
  let generation = 0;
  let state = FISHING_CLIENT_STATE.SIGNED_OUT;
  let read = null;
  let attempt = null;
  let busy = null;
  let lastError = null;
  // Server clock minus local clock, estimated around the start request (server samples startedAtMs).
  let offsetMs = 0;
  // Start key whose outcome is unknown (transport failure): a retry replays the same attempt.
  let unsettledStart = null;
  let probing = null;
  let lastProbeAt = -Infinity;
  const listeners = new Set();

  function emit(reason) {
    const change = { state, attempt, read, busy, lastError, reason };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Fishing listener failed:", error); }
    }
  }

  async function post(body) {
    const token = await getToken?.();
    if (!token) return { status: 401, error: "AUTH_REQUIRED" };
    try {
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
      });
      if (response.status === 404) return { status: 404, error: "FISHING_DISABLED" };
      let payload = null;
      try { payload = await response.json(); } catch { /* empty body */ }
      if (!response.ok) return { status: response.status, error: typeof payload?.error === "string" ? payload.error : "FISHING_UNAVAILABLE" };
      return { status: response.status, data: payload };
    } catch {
      return { status: 0, error: "NETWORK" };
    }
  }

  function adopt(next) {
    if (next && (!attempt || attempt.attemptId !== next.attemptId || attempt.status === "ACTIVE")) attempt = next;
  }

  async function doRead(attemptId = null, gen = generation) {
    const reply = await post(attemptId ? { op: "read", attemptId } : { op: "read" });
    if (gen !== generation) return null;
    if (reply.status === 404 || reply.status === 401 || reply.status === 403) {
      state = FISHING_CLIENT_STATE.UNAVAILABLE;
      lastError = reply.error;
      return null;
    }
    const parsed = reply.error ? null : parseFishingRead(reply.data);
    if (!parsed) { lastError = reply.error ?? "MALFORMED_RESPONSE"; return null; }
    state = FISHING_CLIENT_STATE.READY;
    read = parsed;
    if (parsed.attempt) adopt(parsed.attempt);
    return parsed;
  }

  async function run(kind, task) {
    if (!accountId) return { outcome: "SIGNED_OUT" };
    if (busy) return { outcome: "BUSY" };
    const gen = generation;
    busy = kind;
    lastError = null;
    emit(kind);
    try {
      const result = await task(gen);
      if (gen !== generation) return { outcome: "STALE" };
      if (result.error) lastError = result.error;
      return result;
    } finally {
      if (gen === generation) {
        busy = null;
        emit(kind);
      }
    }
  }

  // A committed SUCCEEDED outcome is settled (items / discovery / XP) in its own request; replay-safe.
  async function settleIfNeeded(gen) {
    if (attempt?.status !== "SUCCEEDED") return { outcome: "DONE" };
    const reply = await post({ op: "settle", attemptId: attempt.attemptId });
    if (gen !== generation) return { outcome: "STALE" };
    await doRead(attempt.attemptId, gen);
    if (reply.error) return { outcome: "FAILED", error: reply.error };
    return { outcome: "SETTLED" };
  }

  /** Casts at a spot. The server samples the timing; the client only learns it from the reply. */
  function start(sourceRef) {
    if (!FISHING_SOURCES.includes(sourceRef)) return Promise.resolve({ outcome: "FAILED", error: "INVALID_SPOT" });
    return run("start", async gen => {
      const key = unsettledStart?.sourceRef === sourceRef ? unsettledStart.key : uuid();
      const sentAt = now();
      const reply = await post({ op: "start", activityId: FISHING_ACTIVITY_ID, sourceRef, clientAttemptKey: key });
      const receivedAt = now();
      if (gen !== generation) return { outcome: "STALE" };
      if (reply.status === 0) { unsettledStart = { sourceRef, key }; return { outcome: "FAILED", error: "NETWORK" }; }
      unsettledStart = null;
      if (reply.status === 404) { state = FISHING_CLIENT_STATE.UNAVAILABLE; return { outcome: "FAILED", error: reply.error }; }
      if (reply.error) {
        // One attempt per account across both spots: recover the active one instead of failing.
        if (reply.error === "ATTEMPT_ALREADY_ACTIVE") await doRead(null, gen);
        return { outcome: "REFUSED", error: reply.error };
      }
      const next = parseFishingAttempt(reply.data?.attempt);
      if (!next) return { outcome: "FAILED", error: "MALFORMED_RESPONSE" };
      if (reply.data.status === "STARTED") offsetMs = next.startedAtMs - Math.round((sentAt + receivedAt) / 2);
      attempt = next;
      return { outcome: reply.data.status === "STARTED" ? "STARTED" : "REPLAYED", attempt: next };
    });
  }

  function input(action) {
    return run(action === "HOOK" ? "hook" : "cancel", async gen => {
      if (attempt?.status !== "ACTIVE") return { outcome: "FAILED", error: "NO_ACTIVE_ATTEMPT" };
      const reply = await post({ op: "input", attemptId: attempt.attemptId, sourceRef: attempt.sourceRef,
        nonce: attempt.nonce, action });
      if (gen !== generation) return { outcome: "STALE" };
      if (reply.error) {
        // Unknown or refused: the stored result is the truth.
        await doRead(attempt.attemptId, gen);
        return { outcome: "FAILED", error: reply.error };
      }
      const next = parseFishingAttempt(reply.data?.attempt);
      if (!next) return { outcome: "FAILED", error: "MALFORMED_RESPONSE" };
      attempt = next;
      return settleIfNeeded(gen);
    });
  }

  /** Re-reads the latest attempt and finishes a pending settlement (after reload or a lost reply). */
  function refresh() {
    return run("refresh", async gen => {
      const parsed = await doRead(null, gen);
      if (!parsed) return { outcome: "FAILED", error: lastError ?? "FISHING_UNAVAILABLE" };
      if (parsed.settlement === "PENDING") return settleIfNeeded(gen);
      return { outcome: "DONE" };
    });
  }

  /** Retries availability after a transient failure (throttled); a switched-off endpoint stays off. */
  function probe({ minIntervalMs = 30000 } = {}) {
    if (!accountId || state === FISHING_CLIENT_STATE.READY || probing || busy) return probing ?? Promise.resolve(false);
    if (lastError === "FISHING_DISABLED" || now() - lastProbeAt < minIntervalMs) return Promise.resolve(false);
    lastProbeAt = now();
    const gen = generation;
    probing = doRead(null, gen).then(parsed => {
      if (gen === generation) emit("probe");
      return parsed !== null;
    }).finally(() => { probing = null; });
    return probing;
  }

  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === FISHING_CLIENT_STATE.READY);
    generation += 1;
    accountId = next;
    busy = null; read = null; attempt = null; lastError = null; unsettledStart = null; offsetMs = 0;
    probing = null; lastProbeAt = now();
    state = next ? FISHING_CLIENT_STATE.CHECKING : FISHING_CLIENT_STATE.SIGNED_OUT;
    emit("account");
    if (!next) return Promise.resolve(false);
    const gen = generation;
    return doRead(null, gen).then(parsed => {
      if (gen !== generation) return false;
      if (!parsed && state === FISHING_CLIENT_STATE.CHECKING) state = FISHING_CLIENT_STATE.UNAVAILABLE;
      emit("account");
      return parsed !== null;
    });
  }

  return {
    setAccount,
    refresh,
    probe,
    start,
    hook: () => input("HOOK"),
    cancel: () => input("CANCEL"),
    /** Clears a finished attempt from the view so the panel offers a new cast. */
    dismiss() {
      if (attempt && attempt.status !== "ACTIVE") { attempt = null; emit("dismiss"); }
    },
    /** Estimated server time, for presenting the server's own bite window. */
    serverNow: () => now() + offsetMs,
    get state() { return state; },
    get available() { return state === FISHING_CLIENT_STATE.READY; },
    get attempt() { return attempt; },
    get read() { return read; },
    get busy() { return busy; },
    get lastError() { return lastError; },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return { state, accountBound: accountId !== null, attempt: attempt?.status ?? null,
        busy, lastError, skill: read?.skill ?? null };
    }
  };
}
