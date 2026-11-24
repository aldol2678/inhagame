// INHA WORLD · Shop capabilities read (Tier 4 guest-open).
// Decides which purchase RPC the shop router may use (legacy v1 vs scoped v2) and which catalog
// layout the shops are in. The server is the only authority; this module only fetches and
// validates the documented shape.
//
// AUTH (migrated 2026-11-13, Tier 4 guest-open): the read authenticates with the v0.1 guest
// session id in the `X-Session-Id` header only — no other credential header is sent. The id is
// read lazily by readGuestSessionId() (fishing-reporter-wiring.js: localStorage
// 'inha-v01:sync-session', fallback 'inha-v01:server-session'; null when absent — never
// fabricated).
// Before: readShopCapabilities(client) called client.rpc() on the signed-in permanent-account
// client, and a PostgREST function-cache miss (PGRST202) meant "legacy". That path is gone.
// The 404 fallback below preserves the same meaning over HTTP: the capabilities endpoint is
// absent, so the client assumes the legacy database shape. Never interpret auth, network or
// other server errors as permission to resend a purchase.
// A-2 note (2026-11-13): the Tier 4 Worker now serves the capabilities endpoint and the
// ported purchase RPCs, so a deployed Worker answers { purchaseRpc: 'purchase_world_shop_listing_v2',
// catalogLayout: 'split' } and the 404 fallback is unreachable in practice; it stays only as a
// defensive guard for a Worker deployed without the A-2 endpoints.

import { readGuestSessionId } from "../activity/session-id.js";
import { SHOP_PURCHASE_RPC, SHOP_SCOPED_PURCHASE_RPC } from './shop-client.js';

export const SHOP_CAPABILITIES_RPC = 'get_world_shop_capabilities_v1';
export const SHOP_CAPABILITIES_API_PATH = '/api/world-shop-capabilities';

export function parseShopCapabilities(data) {
  if (data?.version !== 1) return null;
  const { purchaseRpc, catalogLayout } = data;
  if (![SHOP_PURCHASE_RPC, SHOP_SCOPED_PURCHASE_RPC].includes(purchaseRpc)) return null;
  if (!['legacy', 'split'].includes(catalogLayout)) return null;
  if (catalogLayout === 'split' && purchaseRpc !== SHOP_SCOPED_PURCHASE_RPC) return null;
  return Object.freeze({ mode: catalogLayout, purchaseRpc });
}

/**
 * Reads the shop capabilities for the current guest session.
 * Returns the parsed capabilities, the legacy fallback when the endpoint answers 404
 * (capabilities not deployed — same meaning as the old function-cache miss), or null when
 * there is no session, the server refuses (401/403), or the read fails or is malformed.
 * A null session sends nothing and never fabricates an id.
 */
export async function readShopCapabilities({
  getSessionId = readGuestSessionId,
  fetcher = (...args) => globalThis.fetch(...args),
  endpoint = SHOP_CAPABILITIES_API_PATH
} = {}) {
  let sessionId = null;
  try {
    const id = await getSessionId?.();
    sessionId = typeof id === "string" && id ? id : null;
  } catch { return null; }
  if (!sessionId) return null;
  try {
    const response = await fetcher(endpoint, { headers: { "X-Session-Id": sessionId } });
    if (response.status === 404) return { mode: 'legacy', purchaseRpc: SHOP_PURCHASE_RPC };
    if (!response.ok) return null;
    return parseShopCapabilities(await response.json());
  } catch { return null; }
}
