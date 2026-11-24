// INHA WORLD P0-F3b · Student Center Shop client.
// The server is the only authority (P0-D Shop + P0-F2 Level gate): price, required Level,
// purchasability and the reason an offer cannot be bought all come from get_world_shop_v1, and every
// purchase is re-validated by purchase_world_shop_listing_v1. This module never decides whether a
// player may buy something; it fetches, validates the documented shape and forwards purchases.
//
// Account-scoped like P0-F3a progression: every account change bumps a generation counter, drops the
// previous snapshot and discards responses (reads and purchases) that belong to an older generation.
//
// AUTH (migrated 2026-11-13, Tier 4 guest-open — READ + PURCHASE, A-2): both paths authenticate
// with the v0.1 guest session id in the `X-Session-Id` header only — no other credential header
// is sent. The id is read lazily by readGuestSessionId() (fishing-reporter-wiring.js: localStorage
// 'inha-v01:sync-session', fallback 'inha-v01:server-session'; null when absent — never
// fabricated). The account bound by setAccount IS that session id. The shop id travels as the
// `shop_id` query parameter on reads.
// Purchase: POST /api/world-shop-purchase { listingId, idempotencyKey, shopId? } — shopId present
// means the scoped v2 RPC, absent means the legacy v1 RPC (the Worker decides, same rule as the
// origin). The server answers 200 + the purchase result, or an HTTP status with
// { error: <server refusal code> }.
// Before (A-1): reads already used this transport; purchase() still used the legacy client.rpc
// transport via the optional getClient. That path is gone; only the transport changed — the
// v1/v2 choice, key freezing and snapshot refresh rules are unchanged.

import { readGuestSessionId } from "../activity/session-id.js";

export const SHOP_STUDENT_CENTER = "shop.student_center";
export const SHOP_READ_RPC = "get_world_shop_v1";
export const SHOP_API_PATH = "/api/world-shop";
export const SHOP_PURCHASE_API_PATH = "/api/world-shop-purchase";
export const SHOP_PURCHASE_RPC = "purchase_world_shop_listing_v1";
export const SHOP_SCOPED_PURCHASE_RPC = "purchase_world_shop_listing_v2";

export const SHOP_STATE = Object.freeze({
  SIGNED_OUT: "SIGNED_OUT",
  LOADING: "LOADING",
  READY: "READY",
  UNAVAILABLE: "UNAVAILABLE"
});

// Stable server refusal codes (the exception message of the P0-D / P0-F2 RPCs).
export const SHOP_ERROR_CODES = Object.freeze([
  "PERMANENT_ACCOUNT_REQUIRED", "ACCOUNT_UNAVAILABLE", "INVALID_IDEMPOTENCY_KEY", "IDEMPOTENCY_CONFLICT",
  "INVALID_LISTING", "SHOP_LISTING_MISMATCH", "SHOP_NOT_FOUND", "SHOP_INACTIVE", "LISTING_INACTIVE", "LISTING_LOCKED",
  "LISTING_NOT_STARTED", "LISTING_EXPIRED", "LEVEL_REQUIRED", "ITEM_UNAVAILABLE",
  "PURCHASE_LIMIT_REACHED", "ITEM_ALREADY_OWNED", "INSUFFICIENT_FUNDS"
]);
const KNOWN_ERRORS = new Set(SHOP_ERROR_CODES);
// Refusals that mean the open snapshot is out of date, so the panel re-reads the shop.
const STALE_SNAPSHOT_ERRORS = new Set([
  "LEVEL_REQUIRED", "ITEM_ALREADY_OWNED", "PURCHASE_LIMIT_REACHED", "INVALID_LISTING", "SHOP_LISTING_MISMATCH", "SHOP_INACTIVE",
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

/** Error → stable code, never the raw message. */
export function shopErrorCode(error) {
  const message = typeof error?.message === "string" ? error.message.trim() : "";
  return KNOWN_ERRORS.has(message) ? message : "FAILED";
}

/** POST the purchase body; throws Error(<server refusal code>) on a non-200 answer. */
async function postPurchase(fetcher, endpoint, sessionId, body) {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof data?.error === "string" && data.error ? data.error : `HTTP_${response.status}`);
  return data;
}

const defaultKey = () => `shop:${globalThis.crypto.randomUUID()}`;

/**
 * @param {{ getSessionId?: () => (string | null | Promise<string | null>), fetcher?: Function, endpoint?: string, purchaseEndpoint?: string, shopId?: string, createKey?: () => string, scopedPurchase?: boolean, getPurchaseRpc?: Function }} options
 *   getSessionId supplies the v0.1 guest session id for BOTH paths (defaults to
 *   readGuestSessionId from the reporter wiring module — the single source; never copied).
 *   fetcher defaults to global fetch. endpoint defaults to the same-host Tier 4 read path;
 *   purchaseEndpoint defaults to the same-host Tier 4 purchase path. shopId keeps the
 *   original constructor-option shape and travels as the `shop_id` query parameter on reads
 *   and as `shopId` in the purchase body only for scoped (v2) purchases.
 */
export function createShopClient({
  getSessionId = readGuestSessionId,
  fetcher = (...args) => globalThis.fetch(...args),
  endpoint = SHOP_API_PATH,
  purchaseEndpoint = SHOP_PURCHASE_API_PATH,
  shopId = SHOP_STUDENT_CENTER, createKey = defaultKey, scopedPurchase = false, getPurchaseRpc = null
} = {}) {

  let accountId = null;
  let generation = 0;
  let state = SHOP_STATE.SIGNED_OUT;
  let snapshot = null;
  let inFlight = null;
  let rerun = false;
  const pending = new Set();
  // A key whose outcome is unknown (transport failure) is reused so a retry replays, never re-buys.
  const unresolvedKeys = new Map();
  const unresolvedOffers = new Map();
  const unresolvedRpcs = new Map();
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
      if (gen === generation) set(SHOP_STATE.SIGNED_OUT, null, reason);
      return;
    }
    const sessionId = await resolveSessionId();
    if (!sessionId) {
      if (gen === generation && account === accountId) set(SHOP_STATE.UNAVAILABLE, null, reason);
      return;
    }
    let next = null;
    try {
      const url = `${endpoint.replace(/\/$/, "")}?shop_id=${encodeURIComponent(shopId)}`;
      const response = await fetcher(url, { headers: { "X-Session-Id": sessionId } });
      if (!response.ok) throw new Error(`shop HTTP ${response.status}`);
      next = parseShopSnapshot(await response.json(), shopId);
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
    unresolvedOffers.clear();
    unresolvedRpcs.clear();
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
    const offer = snapshot?.offers.find((candidate) => candidate.listingId === listingId) ?? unresolvedOffers.get(listingId) ?? null;
    if (!account) return { outcome: "SIGNED_OUT", code: "PERMANENT_ACCOUNT_REQUIRED", offer };
    if (!isText(listingId) || pending.has(listingId)) return { outcome: "FAILED", code: "BUSY", offer };
    // Freeze the API contract with the key. Capability changes never reissue through
    // another API, and only a preflight (not a failed purchase) chooses legacy v1.
    const rpc = unresolvedRpcs.get(listingId) ?? (getPurchaseRpc
      ? getPurchaseRpc() : scopedPurchase ? SHOP_SCOPED_PURCHASE_RPC : SHOP_PURCHASE_RPC);
    if (![SHOP_PURCHASE_RPC, SHOP_SCOPED_PURCHASE_RPC].includes(rpc)) {
      return { outcome: "REFUSED", code: "SHOP_UNAVAILABLE", offer };
    }
    const key = unresolvedKeys.get(listingId) ?? createKey();
    unresolvedRpcs.set(listingId, rpc);
    unresolvedKeys.set(listingId, key);
    if (offer) unresolvedOffers.set(listingId, offer);
    pending.add(listingId);
    publish("purchase");
    const sessionId = await resolveSessionId();
    if (gen !== generation || account !== accountId) {
      unresolvedKeys.delete(listingId); unresolvedOffers.delete(listingId); unresolvedRpcs.delete(listingId);
      pending.delete(listingId);
      return { outcome: "STALE", code: null, offer };
    }
    if (!sessionId) {
      unresolvedKeys.delete(listingId); unresolvedOffers.delete(listingId); unresolvedRpcs.delete(listingId);
      pending.delete(listingId);
      publish("purchase");
      return { outcome: "SIGNED_OUT", code: "PERMANENT_ACCOUNT_REQUIRED", offer };
    }
    let response;
    try {
      // The Worker decides v1 vs v2 by shopId presence: scoped (v2) sends it, legacy (v1) omits it.
      const data = await postPurchase(fetcher, purchaseEndpoint, sessionId, {
        listingId, idempotencyKey: key,
        ...(rpc === SHOP_SCOPED_PURCHASE_RPC ? { shopId } : {})
      });
      if (data?.status === "SUCCESS") {
        response = { outcome: "SUCCESS", code: null, result: data, offer };
      } else {
        response = { outcome: "FAILED", code: "FAILED", offer };
      }
    } catch (error) {
      const code = shopErrorCode(error);
      response = { outcome: code === "FAILED" ? "FAILED" : "REFUSED", code, offer };
    }
    if (gen !== generation || account !== accountId) return { outcome: "STALE", code: null, offer };
    // Only the owning generation may retire its key; unknown outcomes keep it for a safe retry.
    if (response.outcome === "SUCCESS" || response.outcome === "REFUSED") {
      unresolvedKeys.delete(listingId); unresolvedOffers.delete(listingId); unresolvedRpcs.delete(listingId);
    }
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
    get unresolvedOffers() { return [...unresolvedOffers.values()]; },
    hasUnresolved: listingId => unresolvedKeys.has(listingId),
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
