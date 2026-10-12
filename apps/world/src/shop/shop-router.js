// Each shop retains its own read generation, pending purchases and uncertain receipt keys.
// Selecting another NPC changes presentation only; it never cancels or reissues a purchase.
import { createShopClient, SHOP_STUDENT_CENTER } from './shop-client.js';
import { readShopCapabilities } from './shop-capabilities.js';

// Both shops already exist in the legacy database. This does not enable the
// separate fashion catalog or move any stock; v1 remains its price/ownership authority.
const LEGACY_SHOPS = new Set([SHOP_STUDENT_CENTER, 'shop.dorm_furniture']);

export function createShopRouter({ getClient, shopIds, initialShopId = SHOP_STUDENT_CENTER, createKey } = {}) {
  if (!Array.isArray(shopIds) || !shopIds.includes(initialShopId)) throw new Error('Known initial shop required');
  const clients = new Map();
  const listeners = new Set();
  let selected = initialShopId;
  let accountId = null;
  let accountRevision = 0;
  let capability = null;
  let mode = 'checking';
  let capabilityPending = null;
  const availableShop = shopId => mode === 'split' || (mode === 'legacy' && LEGACY_SHOPS.has(shopId));
  async function negotiate() {
    if (!accountId) return false;
    if (capabilityPending) return capabilityPending;
    const revision = accountRevision;
    const client = getClient();
    const run = (async () => {
      const next = client?.rpc ? await readShopCapabilities(client) : null;
      if (revision !== accountRevision) return false;
      capability = next;
      mode = next?.mode ?? 'unavailable';
      if (!availableShop(selected)) selected = SHOP_STUDENT_CENTER;
      emit('capability');
      return next !== null;
    })();
    capabilityPending = run;
    emit('capability-checking');
    try { return await run; }
    finally { if (capabilityPending === run) { capabilityPending = null; emit('capability-settled'); } }
  }
  for (const shopId of new Set(shopIds)) {
    const client = createShopClient({ getClient, shopId, createKey, scopedPurchase: true,
      getPurchaseRpc: () => !capabilityPending && capability &&
        availableShop(shopId)
        ? capability.purchaseRpc : null });
    clients.set(shopId, client);
    client.onChange(change => {
      if (shopId === selected) emit(change.reason);
    });
  }
  const current = () => clients.get(selected);
  function emit(reason) {
    const client = current();
    const change = { mode, state: client.state, snapshot: client.snapshot, accountId, shopId: selected, reason };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Shop router listener failed:", error); }
    }
  }
  return {
    get mode() { return mode; },
    get capabilityChecking() { return capabilityPending !== null; },
    get shopId() { return selected; },
    get accountId() { return accountId; },
    get state() { return current().state; },
    get snapshot() { return current().snapshot; },
    get unresolvedOffers() { return [...clients.values()].flatMap(client => client.unresolvedOffers); },
    hasUnresolved: listingId => [...clients.values()].some(client => client.hasUnresolved(listingId)),
    select(shopId) {
      if (!clients.has(shopId) || (mode === 'legacy' && !LEGACY_SHOPS.has(shopId)) ||
        (mode === 'unavailable' && shopId !== SHOP_STUDENT_CENTER)) return false;
      if (selected === shopId) return true;
      selected = shopId;
      emit('shop');
      return true;
    },
    setAccount(nextAccountId) {
      const next = typeof nextAccountId === 'string' && nextAccountId ? nextAccountId : null;
      if (next === accountId) return;
      accountId = next;
      accountRevision += 1;
      capability = null; mode = 'checking'; capabilityPending = null;
      // Publish only after every shop has dropped the previous account's state.
      const saved = selected;
      selected = null;
      for (const client of clients.values()) client.setAccount(next);
      selected = saved;
      emit('account');
    },
    async refresh(reason) {
      const revision = accountRevision;
      const requested = current();
      const available = await negotiate();
      if (revision !== accountRevision || !accountId) return false;
      // Legacy read remains useful when capability cannot be determined, but its
      // purchase authority is locked. Do not leak a previous split selection.
      const target = availableShop(requested.shopId) ? requested : clients.get(SHOP_STUDENT_CENTER);
      const read = await target.refresh(reason);
      return available && read;
    },
    async purchase(listingId) {
      const revision = accountRevision;
      // A listing may move while its outcome is unknown. Always resolve its original
      // shop/key before allowing a new purchase key from another NPC's shop.
      const client = [...clients.values()].find(candidate => candidate.hasUnresolved(listingId)) ?? current();
      if (!client.accountId) return client.purchase(listingId);
      if (!client.hasUnresolved(listingId) && !client.snapshot?.offers.some(offer => offer.listingId === listingId)) {
        return Promise.resolve({ outcome: 'REFUSED', code: 'INVALID_LISTING', offer: null });
      }
      const result = await client.purchase(listingId);
      if (result.code === 'SHOP_LISTING_MISMATCH' && revision === accountRevision) {
        await negotiate(); // No automatic retry, new shop, or replacement key.
      }
      if (result.outcome === 'SUCCESS' && current() !== client &&
          current().snapshot?.offers.some(offer => offer.listingId === listingId)) await current().refresh('purchase');
      if (revision !== accountRevision) return { outcome: 'STALE', code: null, offer: result.offer };
      return result;
    },
    isPending: listingId => [...clients.values()].some(client => client.isPending(listingId)),
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    status: () => ({ ...current().status(), shopId: selected, mode })
  };
}
