// INHA WORLD · Appearance loadout client (Wardrobe UI P0).
// The server is the only authority on what an account wears (Appearance / Loadout Authority P0):
// get_my_world_appearance_loadout_v1() reads it, equip_my_world_item_v1 / unequip_my_world_item_v1
// change it after re-checking ownership, slot, category and catalog status. This module fetches and
// validates the read, forwards writes and re-reads after a change. It never decides that an item may be
// worn, never marks a slot as worn by itself and keeps nothing in local storage. No DOM.
//
// Account-scoped like progression / shop / wallet / inventory: every account change bumps a
// generation counter, drops the snapshot at once and discards reads and writes of an older generation.
//
// AUTH (migrated 2026-11-13, Tier 4 guest-open — READ + WRITE, A-2): both paths authenticate
// with the v0.1 guest session id in the `X-Session-Id` header only — no other credential header
// is sent. The id is read lazily by readGuestSessionId() (fishing-reporter-wiring.js: localStorage
// 'inha-v01:sync-session', fallback 'inha-v01:server-session'; null when absent — never
// fabricated). The account bound by setAccount IS that session id.
// Reads: GET /api/world-loadout. Writes: POST /api/world-loadout { action: 'equip' | 'unequip',
// slot, itemId?, idempotencyKey }. The server answers 200 + the RPC result, or an HTTP status
// with { error: <server refusal code> }; the code is mapped to the outcome below.
// Before (A-1): reads already used this transport; equip/unequip still used the legacy
// client.rpc transport via the optional getClient. That path is gone; only the transport
// changed — parsing, state, generation and the idempotency-key reuse are unchanged.

import { readGuestSessionId } from "../activity/session-id.js";
import { APPEARANCE_SLOTS } from "../collection/item-catalog.js";

export const LOADOUT_READ_RPC = "get_my_world_appearance_loadout_v1";
export const LOADOUT_API_PATH = "/api/world-loadout";
export const LOADOUT_EQUIP_RPC = "equip_my_world_item_v1";
export const LOADOUT_UNEQUIP_RPC = "unequip_my_world_item_v1";
export { APPEARANCE_SLOTS };

export const LOADOUT_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

// Stable server refusal codes (exception messages of the loadout RPCs).
export const LOADOUT_ERROR_CODES = Object.freeze([
  "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "INVALID_IDEMPOTENCY_KEY", "INVALID_APPEARANCE_SLOT",
  "INVALID_ITEM_ID", "UNKNOWN_ITEM", "ITEM_NOT_EQUIPPABLE", "SLOT_MISMATCH", "ITEM_UNAVAILABLE", "ITEM_NOT_OWNED",
  "IDEMPOTENCY_CONFLICT"
]);
const KNOWN_ERRORS = new Set(LOADOUT_ERROR_CODES);
const SLOTS = new Set(APPEARANCE_SLOTS);
const ITEM_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const isText = (value, max) => typeof value === "string" && value.length > 0 && value.length <= max;

/** One slot value → frozen entry, null for an empty slot, or undefined when malformed. */
function parseSlotEntry(raw) {
  if (raw === null) return null;
  if (!raw || typeof raw !== "object") return undefined;
  const { itemId, catalogStatus, equippedAt } = raw;
  if (!isText(itemId, 80) || !ITEM_ID.test(itemId) || !isText(catalogStatus, 40)) return undefined;
  if (equippedAt !== null && equippedAt !== undefined && !isText(equippedAt, 64)) return undefined;
  return Object.freeze({ itemId, catalogStatus, equippedAt: equippedAt ?? null });
}

/**
 * Server read → frozen { slots } with exactly the nine appearance slots, or null when the read is not
 * the documented contract (a missing, extra or malformed slot rejects the whole read).
 */
export function parseLoadoutSnapshot(raw) {
  const slots = raw?.slots;
  if (!slots || typeof slots !== "object" || Array.isArray(slots)) return null;
  const keys = Object.keys(slots);
  if (keys.length !== SLOTS.size || keys.some((key) => !SLOTS.has(key))) return null;
  const parsed = {};
  for (const slot of APPEARANCE_SLOTS) {
    const entry = parseSlotEntry(slots[slot]);
    if (entry === undefined) return null;
    parsed[slot] = entry;
  }
  return Object.freeze({ slots: Object.freeze(parsed) });
}

/** Error message → stable code, never the raw message. */
export function loadoutErrorCode(error) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return KNOWN_ERRORS.has(message) ? message : "FAILED";
}

/** POST the write body; throws Error(<server refusal code>) on a non-200 answer. */
async function postWrite(fetcher, endpoint, sessionId, body) {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" && data.error ? data.error : `HTTP_${response.status}`);
  return data;
}

const defaultKey = () => `appearance:${globalThis.crypto.randomUUID()}`;

/**
 * @param {{ getSessionId?: () => (string | null | Promise<string | null>), fetcher?: Function, endpoint?: string, createKey?: () => string }} options
 *   getSessionId supplies the v0.1 guest session id for BOTH paths (defaults to
 *   readGuestSessionId from the reporter wiring module — the single source; never copied).
 *   fetcher defaults to global fetch. endpoint defaults to the same-host Tier 4 path.
 */
export function createLoadoutClient({
  getSessionId = readGuestSessionId,
  fetcher = (...args) => globalThis.fetch(...args),
  endpoint = LOADOUT_API_PATH,
  createKey = defaultKey
} = {}) {

  let accountId = null;
  let generation = 0;
  let state = LOADOUT_STATE.SIGNED_OUT;
  let snapshot = null;
  let inFlight = null;
  let rerun = false;
  // One write per slot at a time (a double click never sends two writes for one slot).
  const pending = new Set();
  // A key whose outcome is unknown (transport failure) is reused for the same intent, so a retry replays.
  const unresolvedKeys = new Map();
  const listeners = new Set();

  function publish(reason) {
    const change = { state, snapshot, accountId, reason, pending: new Set(pending) };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Loadout listener failed:", error); }
    }
  }
  function set(nextState, nextSnapshot, reason) {
    state = nextState;
    snapshot = nextSnapshot;
    publish(reason);
  }

  async function resolveSessionId() {
    try {
      const id = await getSessionId?.();
      return typeof id === "string" && id ? id : null;
    } catch { return null; }
  }

  async function fetchOnce(reason) {
    const gen = generation;
    const account = accountId;
    if (!account) {
      if (gen === generation) set(LOADOUT_STATE.SIGNED_OUT, null, reason);
      return;
    }
    const sessionId = await resolveSessionId();
    if (!sessionId) {
      if (gen === generation && account === accountId) set(LOADOUT_STATE.UNAVAILABLE, null, reason);
      return;
    }
    let next = null;
    try {
      const response = await fetcher(endpoint, { headers: { "X-Session-Id": sessionId } });
      if (!response.ok) throw new Error(`loadout HTTP ${response.status}`);
      next = parseLoadoutSnapshot(await response.json());
    } catch (error) {
      console.warn("World loadout unavailable:", loadoutErrorCode(error));
    }
    if (gen !== generation || account !== accountId) return;
    if (next) set(LOADOUT_STATE.READY, next, reason);
    else set(LOADOUT_STATE.UNAVAILABLE, null, reason);
  }

  function refresh(reason = "refresh") {
    if (!accountId) return Promise.resolve(false);
    if (inFlight) { rerun = true; return inFlight; }
    const gen = generation;
    const run = (async () => {
      try {
        do {
          rerun = false;
          await fetchOnce(reason);
        } while (rerun && gen === generation);
      } finally {
        if (inFlight === run) inFlight = null;
      }
      return gen === generation && state === LOADOUT_STATE.READY;
    })();
    inFlight = run;
    return run;
  }

  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === LOADOUT_STATE.READY);
    generation += 1;
    accountId = next;
    rerun = false;
    inFlight = null;
    pending.clear();
    unresolvedKeys.clear();
    if (!next) {
      set(LOADOUT_STATE.SIGNED_OUT, null, "account");
      return Promise.resolve(false);
    }
    set(LOADOUT_STATE.LOADING, null, "account");
    return refresh("account");
  }

  /**
   * Always asks the server; the client never pre-judges ownership, slot or status. Resolves to
   * { outcome: "SUCCESS" | "REFUSED" | "FAILED" | "SIGNED_OUT" | "STALE", code, result, slot, itemId }.
   * STALE means the account changed while the write was in flight: nothing may be shown.
   * After a SUCCESS (or a refusal that means the shown state is out of date) the loadout is re-read;
   * the write response is not used as the new state.
   */
  async function write(action, slot, itemId) {
    const gen = generation;
    const account = accountId;
    const base = { slot, itemId };
    if (!account) return { outcome: "SIGNED_OUT", code: "PERMANENT_ACCOUNT_REQUIRED", ...base };
    if (!SLOTS.has(slot) || (action === "EQUIP" && !isText(itemId, 80))) return { outcome: "FAILED", code: "INVALID", ...base };
    if (pending.has(slot)) return { outcome: "FAILED", code: "BUSY", ...base };
    const intent = `${action}:${slot}:${itemId ?? ""}`;
    const key = unresolvedKeys.get(intent) ?? createKey();
    unresolvedKeys.set(intent, key);
    pending.add(slot);
    publish(action === "EQUIP" ? "equip" : "unequip");
    const sessionId = await resolveSessionId();
    if (gen !== generation || account !== accountId) {
      unresolvedKeys.delete(intent);
      pending.delete(slot);
      return { outcome: "STALE", code: null, ...base };
    }
    if (!sessionId) {
      unresolvedKeys.delete(intent);
      pending.delete(slot);
      publish(action === "EQUIP" ? "equip" : "unequip");
      return { outcome: "SIGNED_OUT", code: "PERMANENT_ACCOUNT_REQUIRED", ...base };
    }
    let response;
    try {
      const data = await postWrite(fetcher, endpoint, sessionId, {
        action: action === "EQUIP" ? "equip" : "unequip",
        slot, ...(action === "EQUIP" ? { itemId } : {}), idempotencyKey: key
      });
      if (data?.status === "SUCCESS") {
        response = { outcome: "SUCCESS", code: null, result: data, ...base };
      } else {
        response = { outcome: "FAILED", code: "FAILED", ...base };
      }
    } catch (error) {
      const code = loadoutErrorCode(error);
      response = { outcome: code === "FAILED" ? "FAILED" : "REFUSED", code, ...base };
    }
    if (gen !== generation || account !== accountId) return { outcome: "STALE", code: null, ...base };
    // Only the owning generation may retire its key; unknown outcomes keep it for a safe retry.
    if (response.outcome === "SUCCESS" || response.outcome === "REFUSED") unresolvedKeys.delete(intent);
    pending.delete(slot);
    publish(action === "EQUIP" ? "equip" : "unequip");
    if (response.outcome !== "FAILED") await refresh(action === "EQUIP" ? "equip" : "unequip");
    // Readback can outlive its account; do not release an old result to UI callbacks.
    if (gen !== generation || account !== accountId) return { outcome: "STALE", code: null, ...base };
    return response;
  }

  return {
    setAccount,
    refresh,
    equip: (slot, itemId) => write("EQUIP", slot, itemId),
    unequip: (slot) => write("UNEQUIP", slot, null),
    get state() { return state; },
    get snapshot() { return snapshot; },
    get accountId() { return accountId; },
    isPending: (slot) => pending.has(slot),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return {
        state, accountBound: accountId !== null, pending: pending.size,
        equipped: snapshot ? APPEARANCE_SLOTS.filter((slot) => snapshot.slots[slot]).length : 0
      };
    }
  };
}
