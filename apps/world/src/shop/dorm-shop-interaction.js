// Reuse the existing dorm-lobby reception counter, without inventing a vendor NPC.
export const DORM_SHOP_ENTRY = Object.freeze({
  shopId: 'shop.dorm_furniture', space: 'ROOM_DORM1_LOBBY',
  position: Object.freeze({ x: 0, z: 0.85 }), radius: 1.15
});
export function createDormShopInteraction({ getState, openShop, getMode = () => 'split' } = {}) {
  if (typeof getState !== 'function' || typeof openShop !== 'function') throw new Error('Dorm shop callbacks required');
  function candidate(ignoreBlocked = false) {
    const state = getState();
    if (getMode() !== 'split' || !state || state.space !== DORM_SHOP_ENTRY.space || (!ignoreBlocked && state.blocked) || state.grounded !== true) return null;
    const distance = Math.hypot(state.position?.x - DORM_SHOP_ENTRY.position.x, state.position?.z - DORM_SHOP_ENTRY.position.z);
    // Only the clear approach in front of the counter; no interaction through its desk.
    if (!Number.isFinite(distance) || distance > DORM_SHOP_ENTRY.radius || state.position.z > 1.3) return null;
    return { state, distance };
  }
  function open() {
    const next = candidate();
    if (!next || !next.state.available) return false;
    return openShop(DORM_SHOP_ENTRY.shopId) === true;
  }
  return {
    canAccess: () => candidate(true) !== null,
    contextAction() {
      const next = candidate();
      if (!next) return null;
      return { id: 'dorm-furniture-shop', icon: next.state.available ? '🪑' : '🔒',
        label: next.state.available ? '생활관 가구점' : '로그인 후 가구점', shortcut: 'F', priority: 190,
        distance: next.distance, disabled: !next.state.available, pressed: false, trigger: open };
    }
  };
}
