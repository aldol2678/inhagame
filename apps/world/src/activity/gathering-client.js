export const GATHERING_API_PATH = "/api/world-gathering";
export const GATHERING_CLIENT_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  CHECKING: "CHECKING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});
const SOURCE_REF = "gathering.campus.leaf_pile_01";

export function createGatheringClient({
  getToken,
  fetcher = (...args) => globalThis.fetch(...args),
  uuid = () => globalThis.crypto.randomUUID(),
  now = () => Date.now(),
  endpoint = GATHERING_API_PATH
} = {}) {
  let accountId = null;
  let generation = 0;
  let state = GATHERING_CLIENT_STATE.SIGNED_OUT;
  let busy = false;
  let lastError = null;
  let lastRead = null;
  let unsettled = null;
  let lastProbeAt = -Infinity;
  const listeners = new Set();

  function emit(reason) {
    const snapshot = { state, busy, lastError, lastRead, reason };
    for (const listener of listeners) {
      try { listener(snapshot); } catch (error) { console.warn("Gathering listener failed:", error); }
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
      if (response.status === 404) return { status: 404, error: "GATHERING_DISABLED" };
      let payload = null;
      try { payload = await response.json(); } catch {}
      if (!response.ok) return {
        status: response.status,
        error: typeof payload?.error === "string" ? payload.error : "GATHERING_UNAVAILABLE"
      };
      return { status: response.status, data: payload };
    } catch {
      return { status: 0, error: "NETWORK" };
    }
  }

  async function read(gen = generation) {
    const reply = await post({ op: "read" });
    if (gen !== generation) return false;
    if (reply.status === 401 || reply.status === 403 || reply.status === 404) {
      state = GATHERING_CLIENT_STATE.UNAVAILABLE;
      lastError = reply.error;
      lastRead = null;
      return false;
    }
    if (reply.error || typeof reply.data?.available !== "boolean") {
      state = GATHERING_CLIENT_STATE.UNAVAILABLE;
      lastError = reply.error ?? "MALFORMED_RESPONSE";
      lastRead = null;
      return false;
    }
    lastRead = Object.freeze({
      available: reply.data.available,
      sourceRef: reply.data.sourceRef ?? null,
      reason: reply.data.reason ?? null
    });
    state = reply.data.available ? GATHERING_CLIENT_STATE.READY : GATHERING_CLIENT_STATE.UNAVAILABLE;
    lastError = reply.data.available ? null : (reply.data.reason ?? "GATHERING_UNAVAILABLE");
    return reply.data.available;
  }

  async function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return state === GATHERING_CLIENT_STATE.READY;
    generation += 1;
    accountId = next;
    busy = false;
    lastError = null;
    lastRead = null;
    unsettled = null;
    lastProbeAt = now();
    state = next ? GATHERING_CLIENT_STATE.CHECKING : GATHERING_CLIENT_STATE.SIGNED_OUT;
    emit("account");
    if (!next) return false;
    const gen = generation;
    const ok = await read(gen);
    if (gen === generation) emit("account");
    return ok;
  }

  async function probe({ minIntervalMs = 30000 } = {}) {
    if (!accountId || busy || now() - lastProbeAt < minIntervalMs) return false;
    lastProbeAt = now();
    const gen = generation;
    const ok = await read(gen);
    if (gen === generation) emit("probe");
    return ok;
  }

  async function harvest(sourceRef = SOURCE_REF) {
    if (!accountId || sourceRef !== SOURCE_REF || busy) {
      return { outcome: busy ? "BUSY" : "FAILED", error: "GATHERING_UNAVAILABLE" };
    }
    const gen = generation;
    busy = true;
    lastError = null;
    emit("harvest");
    const key = unsettled?.sourceRef === sourceRef ? unsettled.key : uuid();
    try {
      const reply = await post({ op: "harvest", sourceRef, clientAttemptKey: key });
      if (gen !== generation) return { outcome: "STALE" };
      if (reply.status === 0) {
        unsettled = { sourceRef, key };
        lastError = "NETWORK";
        return { outcome: "FAILED", error: lastError };
      }
      unsettled = null;
      if (reply.error) {
        lastError = reply.error;
        return { outcome: "REFUSED", error: reply.error };
      }
      if (!reply.data || !["HARVESTED", "ALREADY_PROCESSED"].includes(reply.data.status) ||
          reply.data.sourceRef !== SOURCE_REF || reply.data.output?.itemId !== "material.campus_leaf" ||
          reply.data.output?.quantity !== 1 || !Number.isSafeInteger(reply.data.output?.lifeXp)) {
        lastError = "MALFORMED_RESPONSE";
        return { outcome: "FAILED", error: lastError };
      }
      return { outcome: reply.data.status, data: reply.data };
    } finally {
      if (gen === generation) {
        busy = false;
        emit("harvest");
      }
    }
  }

  return {
    setAccount, probe, harvest,
    get state() { return state; },
    get available() { return state === GATHERING_CLIENT_STATE.READY; },
    get busy() { return busy; },
    get lastError() { return lastError; },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    status() { return { state, busy, lastError, available: state === GATHERING_CLIENT_STATE.READY }; }
  };
}
