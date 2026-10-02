// INHA WORLD · Appearance loadout client (Wardrobe UI P0).
// The server is the only authority on what an account wears (Appearance / Loadout Authority P0):
// get_my_world_appearance_loadout_v1() reads it, equip_my_world_item_v1 / unequip_my_world_item_v1
// change it after re-checking ownership, slot, category and catalog status. This module fetches and
// validates the read, forwards writes and re-reads after a change. It never decides that an item may be
// worn, never marks a slot as worn by itself and keeps nothing in local storage. No DOM.
//
// Account-scoped like progression / shop / wallet / inventory: every account change bumps a
// generation counter, drops the snapshot at once and discards reads and writes of an older generation.

import { APPEARANCE_SLOTS } from "../collection/item-catalog.js";

export const LOADOUT_READ_RPC = "get_my_world_appearance_loadout_v1";
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

/** Supabase error → stable code, never the raw message. */
export function loadoutErrorCode(error) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return KNOWN_ERRORS.has(message) ? message : "FAILED";
}

const defaultKey = () => `appearance:${globalThis.crypto.randomUUID()}`;

/**
 * @param {{ getClient: () => ({ rpc: Function } | null), createKey?: () => string }} options
 *   getClient returns the signed-in permanent-account Supabase client (online.supabase), or null.
 */
export function createLoadoutClient({ getClient, createKey = defaultKey } = {}) {
  if (typeof getClient !== "function") throw new Error("Loadout client requires getClient");

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

  async function fetchOnce(reason) {
    const gen = generation;
    const account = accountId;
    const client = getClient();
    if (!account || !client?.rpc) {
      if (gen === generation) set(LOADOUT_STATE.SIGNED_OUT, null, reason);
      return;
    }
    let next = null;
    try {
      const { data, error } = await client.rpc(LOADOUT_READ_RPC);
      if (error) throw error;
      next = parseLoadoutSnapshot(data);
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
    const client = getClient();
    const base = { slot, itemId };
    if (!account || !client?.rpc) return { outcome: "SIGNED_OUT", code: "PERMANENT_ACCOUNT_REQUIRED", ...base };
    if (!SLOTS.has(slot) || (action === "EQUIP" && !isText(itemId, 80))) return { outcome: "FAILED", code: "INVALID", ...base };
    if (pending.has(slot)) return { outcome: "FAILED", code: "BUSY", ...base };
    const intent = `${action}:${slot}:${itemId ?? ""}`;
    const key = unresolvedKeys.get(intent) ?? createKey();
    unresolvedKeys.set(intent, key);
    pending.add(slot);
    publish(action === "EQUIP" ? "equip" : "unequip");
    let response;
    try {
      const { data, error } = action === "EQUIP"
        ? await client.rpc(LOADOUT_EQUIP_RPC, { p_slot: slot, p_item_id: itemId, p_idempotency_key: key })
        : await client.rpc(LOADOUT_UNEQUIP_RPC, { p_slot: slot, p_idempotency_key: key });
      if (error) {
        const code = loadoutErrorCode(error);
        if (code !== "FAILED") unresolvedKeys.delete(intent);
        response = { outcome: code === "FAILED" ? "FAILED" : "REFUSED", code, ...base };
      } else if (data?.status === "SUCCESS") {
        unresolvedKeys.delete(intent);
        response = { outcome: "SUCCESS", code: null, result: data, ...base };
      } else {
        response = { outcome: "FAILED", code: "FAILED", ...base };
      }
    } catch (error) {
      response = { outcome: "FAILED", code: loadoutErrorCode(error), ...base };
    }
    if (gen !== generation || account !== accountId) return { outcome: "STALE", code: null, ...base };
    pending.delete(slot);
    publish(action === "EQUIP" ? "equip" : "unequip");
    if (response.outcome !== "FAILED") await refresh(action === "EQUIP" ? "equip" : "unequip");
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
