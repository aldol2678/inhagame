// Isolated read-only shop snapshots for acquisition guidance. Never selects a shop or purchases.
import { SHOP_READ_RPC, parseShopSnapshot } from '../shop/shop-client.js';
import { SHOP_ROUTE_IDS } from '../shop/shop-routes.js';
const LEGACY = new Set(['shop.student_center', 'shop.dorm_furniture']);
export function createInventoryAcquisitionClient({ getClient, timeoutMs = 10000 } = {}) {
  let accountId = null, accountEpoch = 0, capabilityMode = 'checking', capabilityChecking = true;
  let shopSnapshots = [], inFlight = null;
  const listeners = new Set();
  const emit = () => { for (const listener of listeners) listener(); };
  return {
    setScope(scope) {
      const nextAccount = scope.accountId ?? null;
      const nextChecking = scope.capabilityChecking === true;
      const nextMode = scope.capabilityMode ?? 'checking';
      if (nextAccount === accountId && nextMode === capabilityMode && nextChecking === capabilityChecking) return false;
      accountEpoch += 1;
      accountId = nextAccount; capabilityMode = nextMode; capabilityChecking = nextChecking;
      shopSnapshots = []; inFlight = null; emit();
      return true;
    },
    context() { return { accountId, accountEpoch, capabilityMode, capabilityChecking, shopSnapshots }; },
    refresh() {
      if (inFlight) return inFlight;
      if (!accountId || capabilityChecking || !['legacy', 'split'].includes(capabilityMode)) return Promise.resolve(false);
      const epoch = accountEpoch, account = accountId;
      const client = getClient();
      if (!client?.rpc) { shopSnapshots = []; emit(); return Promise.resolve(false); }
      const ids = SHOP_ROUTE_IDS.filter(id => capabilityMode === 'split' || LEGACY.has(id));
      shopSnapshots = []; emit();
      const run = Promise.all(ids.map(async shopId => {
        let snapshot = null, timer;
        try {
          const response = await Promise.race([
            (async () => client.rpc(SHOP_READ_RPC, { p_shop_id: shopId }))(),
            new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })
          ]);
          if (response && !response.error) snapshot = parseShopSnapshot(response.data, shopId);
        } catch { /* Failed guidance is unknown; never expose backend errors. */ }
        finally { clearTimeout(timer); }
        if (epoch !== accountEpoch || account !== accountId) return;
        const row = Object.freeze({ accountId: account, accountEpoch: epoch, state: snapshot ? 'READY' : 'UNAVAILABLE', snapshot });
        // A stalled vendor must not hide the other shops' successful reads.
        shopSnapshots = Object.freeze([...shopSnapshots, row]); emit();
      })).then(() => epoch === accountEpoch && account === accountId)
        .finally(() => { if (inFlight === run) inFlight = null; });
      inFlight = run;
      return run;
    },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
