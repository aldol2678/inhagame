// Client presentation follows the negotiated server contract. No timeout or generic
// RPC failure can promote an unknown server to the legacy purchase path.
export function createShopEntryCompatibility({ shop, getAvailable = () => false,
  getBlocked = () => true, openLegacy = () => false, guideSplit = () => false, openRecovery = () => false,
  onStatus = () => {} } = {}) {
  let generation = 0;
  async function enter({ canAccess = () => true } = {}) {
    const own = ++generation;
    if (getAvailable() !== true) { onStatus('로그인 후 상점 정보를 확인할 수 있어요.'); return false; }
    if (getBlocked() !== false || !canAccess()) return false;
    const account = shop.accountId;
    onStatus('상점 정보를 확인하고 있어요.');
    let completed = false;
    try { await shop.refresh('entry'); completed = true; } catch { /* A thrown read never licenses legacy purchase. */ }
    if (own !== generation || account !== shop.accountId || getAvailable() !== true ||
        getBlocked() !== false || !canAccess()) return false;
    if (shop.mode === 'unavailable' && shop.unresolvedOffers?.length) return openRecovery() === true;
    if (!completed) { onStatus('상점 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'); return false; }
    if (shop.mode === 'legacy') return openLegacy() === true;
    if (shop.mode === 'split') return guideSplit() === true;
    onStatus('상점 정보를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    return false;
  }
  return { enter, cancel: () => { generation += 1; } };
}
