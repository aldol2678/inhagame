import { SHOP_PURCHASE_RPC, SHOP_SCOPED_PURCHASE_RPC } from './shop-client.js';

export const SHOP_CAPABILITIES_RPC = 'get_world_shop_capabilities_v1';

// PostgREST's exact function-cache miss only. Never interpret auth, network,
// SQL errors or a missing purchase API as permission to resend a purchase.
export function isMissingShopCapabilities(error) {
  return error?.code === 'PGRST202' && typeof error.message === 'string' &&
    /^Could not find the function public\.get_world_shop_capabilities_v1(?:\(\)| without parameters) in the schema cache$/.test(error.message);
}

export function parseShopCapabilities(data) {
  if (data?.version !== 1) return null;
  const { purchaseRpc, catalogLayout } = data;
  if (![SHOP_PURCHASE_RPC, SHOP_SCOPED_PURCHASE_RPC].includes(purchaseRpc)) return null;
  if (!['legacy', 'split'].includes(catalogLayout)) return null;
  if (catalogLayout === 'split' && purchaseRpc !== SHOP_SCOPED_PURCHASE_RPC) return null;
  return Object.freeze({ mode: catalogLayout, purchaseRpc });
}

export async function readShopCapabilities(client) {
  try {
    const { data, error } = await client.rpc(SHOP_CAPABILITIES_RPC);
    if (error) return isMissingShopCapabilities(error)
      ? { mode: 'legacy', purchaseRpc: SHOP_PURCHASE_RPC } : null;
    return parseShopCapabilities(data);
  } catch { return null; }
}
