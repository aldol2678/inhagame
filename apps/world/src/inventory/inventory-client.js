// INHA WORLD · Inventory read client (read-model on the P0-B player read).
// The server is the only ownership authority: get_my_world_inventory_v1() returns the caller's owned
// items, most recent first. This module only fetches and validates that snapshot. It never adds,
// removes or merges an item on its own: no optimistic ownership after a purchase or a reward, no local
// storage, no catalog-based filtering. After anything that may grant an item the caller re-reads.
//
// Account-scoped like P0-F3a progression / shop / wallet: every account change bumps a generation
// counter, drops the previous snapshot at once and discards responses from an older generation, so
// one account's items are never shown under another account.

export const INVENTORY_RPC = "get_my_world_inventory_v1";

export const INVENTORY_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

const ITEM_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+$/;
const isText = (value, max = 200) => typeof value === "string" && value.length > 0 && value.length <= max;
const isOptionalText = (value, max) => value === null || value === undefined || isText(value, max);
const isQuantity = (value) => Number.isSafeInteger(value) && value >= 1;

/** One owned row → frozen item, or null when it is not the documented shape. */
export function parseInventoryItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { itemId, quantity, acquiredAt, updatedAt, sourceType, sourceRef, eventId, catalogStatus } = raw;
  if (!isText(itemId, 120) || !ITEM_ID.test(itemId) || !isQuantity(quantity)) return null;
  if (!isText(acquiredAt, 64) || !isOptionalText(updatedAt, 64)) return null;
  if (!isText(sourceType, 40) || !isText(sourceRef) || !isOptionalText(eventId, 120) || !isText(catalogStatus, 40)) return null;
  return Object.freeze({
    itemId, quantity, acquiredAt, updatedAt: updatedAt ?? null, sourceType, sourceRef,
    eventId: eventId ?? null, catalogStatus
  });
}

/**
 * Server read → frozen snapshot { items } in the server's order, or null when the read is not the
 * documented contract. Ownership is not repaired: a malformed row or a duplicate itemId (the server
 * keeps one row per item) rejects the whole read rather than showing a partial or doubled inventory.
 * Items the local catalog does not know are kept: a catalog miss never means "not owned".
 */
export function parseInventorySnapshot(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return null;
  const seen = new Set();
  const items = [];
  for (const entry of raw.items) {
    const item = parseInventoryItem(entry);
    if (!item || seen.has(item.itemId)) return null;
    seen.add(item.itemId);
    items.push(item);
  }
  return Object.freeze({ items: Object.freeze(items) });
}

/**
 * @param {{ getClient: () => ({ rpc: Function } | null) }} options
 *   getClient returns the signed-in permanent-account Supabase client (online.supabase), or null.
 */
export function createInventoryClient({ getClient } = {}) {
  if (typeof getClient !== "function") throw new Error("Inventory client requires getClient");

  let accountId = null;
  let generation = 0;
  let state = INVENTORY_STATE.SIGNED_OUT;
  let snapshot = null;
  let inFlight = null;
  let rerun = false;
  const listeners = new Set();

  function set(nextState, nextSnapshot, reason) {
    state = nextState;
    snapshot = nextSnapshot;
    const change = { state, snapshot, accountId, reason };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Inventory listener failed:", error); }
    }
  }

  async function fetchOnce(reason) {
    const gen = generation;
    const account = accountId;
    const client = getClient();
    if (!account || !client?.rpc) {
      if (gen === generation) set(INVENTORY_STATE.SIGNED_OUT, null, reason);
      return;
    }
    let next = null;
    try {
      const { data, error } = await client.rpc(INVENTORY_RPC);
      if (error) throw error;
      next = parseInventorySnapshot(data);
    } catch (error) {
      // The raw server / transport message is logged, never shown.
      console.warn("World inventory unavailable:", error?.message ?? error);
    }
    // A newer account change (sign-out, switch) happened while this request was in flight.
    if (gen !== generation || account !== accountId) return;
    if (next) set(INVENTORY_STATE.READY, next, reason);
    else set(INVENTORY_STATE.UNAVAILABLE, null, reason);
  }

  function refresh(reason = "refresh") {
    if (!accountId) return Promise.resolve(false);
    // Coalesce: while a request runs, remember one more and run it after, never in parallel.
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
      return gen === generation && state === INVENTORY_STATE.READY;
    })();
    inFlight = run;
    return run;
  }

  /** Account boundary. Same id is a no-op; any change drops the old snapshot and old responses. */
  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return Promise.resolve(state === INVENTORY_STATE.READY);
    generation += 1;
    accountId = next;
    rerun = false;
    inFlight = null;
    if (!next) {
      set(INVENTORY_STATE.SIGNED_OUT, null, "account");
      return Promise.resolve(false);
    }
    set(INVENTORY_STATE.LOADING, null, "account");
    return refresh("account");
  }

  return {
    setAccount,
    refresh,
    get state() { return state; },
    get snapshot() { return snapshot; },
    get accountId() { return accountId; },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return { state, accountBound: accountId !== null, items: snapshot?.items.length ?? 0 };
    }
  };
}
