// Each shop retains its own read generation, pending purchases and uncertain receipt keys.
// Selecting another NPC changes presentation only; it never cancels or reissues a purchase.
import { createShopClient, SHOP_STUDENT_CENTER } from './shop-client.js';

export function createShopRouter({ getClient, shopIds, initialShopId = SHOP_STUDENT_CENTER, createKey } = {}) {
  if (!Array.isArray(shopIds) || !shopIds.includes(initialShopId)) throw new Error('Known initial shop required');
  const clients = new Map();
  const listeners = new Set();
  let selected = initialShopId;
  let accountId = null;
  let accountRevision = 0;
  for (const shopId of new Set(shopIds)) {
    const client = createShopClient({ getClient, shopId, createKey, scopedPurchase: true });
    clients.set(shopId, client);
    client.onChange(change => {
      if (shopId === selected) emit(change.reason);
    });
  }
  const current = () => clients.get(selected);
  function emit(reason) {
    const client = current();
    const change = { state: client.state, snapshot: client.snapshot, accountId, shopId: selected, reason };
    for (const listener of listeners) {
      try { listener(change); } catch (error) { console.warn("Shop router listener failed:", error); }
    }
  }
  return {
    get shopId() { return selected; },
    get accountId() { return accountId; },
    get state() { return current().state; },
    get snapshot() { return current().snapshot; },
    get unresolvedOffers() { return current().unresolvedOffers; },
    select(shopId) {
      if (!clients.has(shopId)) return false;
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
      // Publish only after every shop has dropped the previous account's state.
      const saved = selected;
      selected = null;
      for (const client of clients.values()) client.setAccount(next);
      selected = saved;
      emit('account');
    },
    refresh: reason => current().refresh(reason),
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
      if (result.outcome === 'SUCCESS' && current() !== client &&
          current().snapshot?.offers.some(offer => offer.listingId === listingId)) await current().refresh('purchase');
      if (revision !== accountRevision) return { outcome: 'STALE', code: null, offer: result.offer };
      return result;
    },
    isPending: listingId => [...clients.values()].some(client => client.isPending(listingId)),
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    status: () => ({ ...current().status(), shopId: selected })
  };
}
