// INHA WORLD P0-F3b · Student Center Shop client.
// The server is the only authority (P0-D Shop + P0-F2 Level gate): price, required Level,
// purchasability and the reason an offer cannot be bought all come from get_world_shop_v1, and every
// purchase is re-validated by purchase_world_shop_listing_v1. This module never decides whether a
// player may buy something; it fetches, validates the documented shape and forwards purchases.
//
// Account-scoped like P0-F3a progression: every account change bumps a generation counter, drops the
// previous snapshot and discards responses (reads and purchases) that belong to an older generation.

export const SHOP_STUDENT_CENTER = "shop.student_center";
export const SHOP_READ_RPC = "get_world_shop_v1";
export const SHOP_PURCHASE_RPC = "purchase_world_shop_listing_v1";

export const SHOP_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

// Stable server refusal codes (the exception message of the P0-D / P0-F2 RPCs).
export const SHOP_ERROR_CODES = Object.freeze([
  "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "INVALID_IDEMPOTENCY_KEY", "IDEMPOTENCY_CONFLICT",
  "INVALID_LISTING", "SHOP_NOT_FOUND", "SHOP_INACTIVE", "LISTING_INACTIVE", "LISTING_LOCKED",
  "LISTING_NOT_STARTED", "LISTING_EXPIRED", "LEVEL_REQUIRED", "ITEM_UNAVAILABLE",
  "PURCHASE_LIMIT_REACHED", "ITEM_ALREADY_OWNED", "INSUFFICIENT_FUNDS"
]);
const KNOWN_ERRORS = new Set(SHOP_ERROR_CODES);
// Refusals that mean the open snapshot is out of date, so the panel re-reads the shop.
const STALE_SNAPSHOT_ERRORS = new Set([
  "LEVEL_REQUIRED", "ITEM_ALREADY_OWNED", "PURCHASE_LIMIT_REACHED", "INVALID_LISTING", "SHOP_INACTIVE",
  "LISTING_INACTIVE", "LISTING_LOCKED", "LISTING_NOT_STARTED", "LISTING_EXPIRED", "ITEM_UNAVAILABLE"
]);

const isText = (value) => typeof value === "string" && value.length > 0 && value.length <= 120;
const isPositiveInt = (value) => Number.isSafeInteger(value) && value >= 1;
const isOptionalPositiveInt = (value) => value === null || isPositiveInt(value);
const isOptionalText = (value) => value === null || isText(value);

/** One server offer → frozen offer, or null when it is not the documented contract. */
export function parseShopOffer(raw) {
  if (!raw || typeof raw !== "object") return null;
  const { listingId, itemId, currencyId, price, quantity, requiredLevel, purchaseLimit, startAt, endAt,
    status, purchasable, unavailableReason } = raw;
  if (!isText(listingId) || !isText(itemId) || !isText(currencyId) || !isText(status)) return null;
  if (!isPositiveInt(price) || !isPositiveInt(quantity)) return null;
  if (!isOptionalPositiveInt(requiredLevel) || !isOptionalPositiveInt(purchaseLimit)) return null;
  if (typeof purchasable !== "boolean" || !isOptionalText(unavailableReason)) return null;
  return Object.freeze({
    listingId, itemId, currencyId, price, quantity, requiredLevel, purchaseLimit,
    startAt: typeof startAt === "string" ? startAt : null,
    endAt: typeof endAt === "string" ? endAt : null,
    status, purchasable, unavailableReason
  });
}

/** The shop read → frozen snapshot, or null. Malformed offers are dropped, never repaired. */
export function parseShopSnapshot(raw, shopId) {
  if (!raw || typeof raw !== "object" || raw.shopId !== shopId || !Array.isArray(raw.offers)) return null;
  if (!isText(raw.status) || !isPositiveInt(raw.playerLevel)) return null;
  return Object.freeze({
    shopId: raw.shopId,
    displayName: isText(raw.displayName) ? raw.displayName : null,
    status: raw.status,
    playerLevel: raw.playerLevel,
    offers: Object.freeze(raw.offers.map(parseShopOffer).filter(Boolean))
  });
}

/** Supabase error → stable code, never the raw message. */
export function shopErrorCode(error) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return KNOWN_ERRORS.has(message) ? message : "FAILED";
}

const defaultKey = () => `shop:${globalThis.crypto.randomUUID()}`;

/**
 * @param {{ getClient: () => ({ rpc: Function } | null), shopId?: string, createKey?: () => string }} options
 *   getClient returns the signed-in permanent-account Supabase client (online.supabase), or null.
 */
export function createShopClient({ getClient, shopId = SHOP_STUDENT_CENTER, createKey = defaultKey } = {}) {
  if (typeof getClient !== "function") throw new Error("Shop client requires getClient");

  let accountId = null;
  let generation = 0;
  let state = SHOP_STATE.SIGNED_OUT;
  let snapshot = null;
  let inFlight = null;
  let rerun = false;
  const pending = new Set();
  // A key whose outcome is unknown (transport failure) is reused so a retry replays, never re-buys.
  const unresolvedKeys = new Map();
  const listeners = new Set();

  function publish(reason) {
    const change = { state, snapshot, accountId, reason, pending: new Set(pending) };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Shop listener failed:", error); }
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
      if (gen === generation) set(SHOP_STATE.SIGNED_OUT, null, reason);
      return;
    }
    let next = null;
    try {
      const { data, error } = await client.rpc(SHOP_READ_RPC, { p_shop_id: shopId });
      if (error) throw error;
      next = parseShopSnapshot(data, shopId);
    } catch (error) {
      console.warn("World shop unavailable:", shopErrorCode(error));
    }
    if (gen !== generation || account !== accountId) return;
    if (next) set(SHOP_STATE.READY, next, reason);
    else set(SHOP_STATE.UNAVAILABLE, null, reason);
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
      return gen === generation && state === SHOP_STATE.READY;
    })();
    inFlight = run;
    return run;
  }

  function setAccount(nextAccountId) {
    const next = typeof nextAccountId === "string" && nextAccountId ? nextAccountId : null;
    if (next === accountId) return;
    generation += 1;
    accountId = next;
    rerun = false;
    inFlight = null;
    pending.clear();
    unresolvedKeys.clear();
    set(next ? SHOP_STATE.LOADING : SHOP_STATE.SIGNED_OUT, null, "account");
  }

  /**
   * Always asks the server; the client never pre-judges eligibility. Resolves to
   * { outcome: "SUCCESS" | "REFUSED" | "FAILED" | "SIGNED_OUT" | "STALE", code, result, offer }.
   * STALE means the account changed while the purchase was in flight: nothing may be shown.
   */
  async function purchase(listingId) {
    const gen = generation;
    const account = accountId;
    const client = getClient();
    const offer = snapshot?.offers.find((candidate) => candidate.listingId === listingId) ?? null;
    if (!account || !client?.rpc) return { outcome: "SIGNED_OUT", code: "PERMANENT_ACCOUNT_REQUIRED", offer };
    if (!isText(listingId) || pending.has(listingId)) return { outcome: "FAILED", code: "BUSY", offer };
    const key = unresolvedKeys.get(listingId) ?? createKey();
    unresolvedKeys.set(listingId, key);
    pending.add(listingId);
    publish("purchase");
    let response;
    try {
      const { data, error } = await client.rpc(SHOP_PURCHASE_RPC, { p_listing_id: listingId, p_idempotency_key: key });
      if (error) {
        const code = shopErrorCode(error);
        response = { outcome: code === "FAILED" ? "FAILED" : "REFUSED", code, offer };
      } else if (data?.status === "SUCCESS") {
        response = { outcome: "SUCCESS", code: null, result: data, offer };
      } else {
        response = { outcome: "FAILED", code: "FAILED", offer };
      }
    } catch (error) {
      response = { outcome: "FAILED", code: shopErrorCode(error), offer };
    }
    if (gen !== generation || account !== accountId) return { outcome: "STALE", code: null, offer };
    // Only the owning generation may retire its key; unknown outcomes keep it for a safe retry.
    if (response.outcome === "SUCCESS" || response.outcome === "REFUSED") unresolvedKeys.delete(listingId);
    pending.delete(listingId);
    publish("purchase");
    if (response.outcome === "SUCCESS" || STALE_SNAPSHOT_ERRORS.has(response.code)) await refresh("purchase");
    // Readback can outlive its account; do not release an old result to UI callbacks.
    if (gen !== generation || account !== accountId) return { outcome: "STALE", code: null, offer };
    return response;
  }

  return {
    shopId,
    setAccount,
    refresh,
    purchase,
    get state() { return state; },
    get snapshot() { return snapshot; },
    get accountId() { return accountId; },
    isPending: (listingId) => pending.has(listingId),
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    status() {
      return { state, accountBound: accountId !== null, offers: snapshot?.offers.length ?? 0, pending: pending.size };
    }
  };
}
