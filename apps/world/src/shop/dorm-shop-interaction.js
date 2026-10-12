import { DORM_SHOP_VENDOR } from './dorm-shop-vendor.js';

// The existing desk's single shared F/mobile slot now introduces its room-local shopkeeper.
export const DORM_SHOP_ENTRY = Object.freeze({
  shopId: DORM_SHOP_VENDOR.shopId, space: DORM_SHOP_VENDOR.space,
  position: Object.freeze({ x: 0, z: 0.85 }), radius: 1.15
});
export function createDormShopInteraction({ getState, openShop, dialogue, getMode = () => 'split' } = {}) {
  if (typeof getState !== 'function' || typeof openShop !== 'function' || !dialogue?.show || !dialogue?.close)
    throw new Error('Dorm shop callbacks and dialogue required');
  let session = null;
  let disposed = false;
  function candidate(ignoreInputGate = false) {
    const state = getState();
    if (disposed || !['split', 'legacy'].includes(getMode()) || !state || state.space !== DORM_SHOP_ENTRY.space ||
        state.invalid || (!ignoreInputGate && state.blocked) || state.grounded !== true) return null;
    const distance = Math.hypot(state.position?.x - DORM_SHOP_ENTRY.position.x, state.position?.z - DORM_SHOP_ENTRY.position.z);
    // Only the clear approach in front of the counter; no interaction through its desk.
    if (!Number.isFinite(distance) || distance > DORM_SHOP_ENTRY.radius || state.position.z > 1.3) return null;
    return { state, distance };
  }
  function cancel({ restoreFocus = false } = {}) {
    if (!session) return false;
    session = null; // Invalidate retained buttons before releasing input/focus.
    dialogue.close({ restoreFocus });
    return true;
  }
  function valid(token) {
    const next = candidate(true);
    return session === token && next?.state.available === true &&
      next.state.accountId === token.accountId;
  }
  function open() {
    const next = candidate();
    if (session || !next || !next.state.available || !next.state.accountId) return false;
    const token = { accountId: next.state.accountId };
    session = token;
    dialogue.show({ vendor: DORM_SHOP_VENDOR,
      onClose: () => session === token && cancel({ restoreFocus: true }),
      onBrowse: () => {
        if (!valid(token)) { if (session === token) cancel(); return false; }
        // Restore the world trigger before the existing shop captures its opener. The hidden
        // dialogue's button must never become the shop's focus-return destination.
        cancel({ restoreFocus: true });
        return openShop(DORM_SHOP_ENTRY.shopId) === true;
      }
    });
    return true;
  }
  return {
    get open() { return session !== null; },
    canAccess: () => { const next = candidate(true); return next?.state.available === true && !!next.state.accountId; },
    cancel,
    // Call synchronously for every account event, including A → B → A without an intervening frame.
    invalidate: () => cancel(),
    update() { if (session && !valid(session)) cancel(); },
    destroy() { cancel(); disposed = true; dialogue.destroy?.(); },
    contextAction() {
      const next = candidate();
      if (!next || session) return null;
      const available = next.state.available === true && !!next.state.accountId;
      return { id: 'dorm-furniture-shop', icon: available ? '💬' : '🔒',
        label: available ? `${DORM_SHOP_VENDOR.name} · 가구점` : `${DORM_SHOP_VENDOR.name} · 로그인 후 가구점`,
        shortcut: 'F', priority: 190, distance: next.distance, disabled: !available, pressed: false, trigger: open };
    }
  };
}
