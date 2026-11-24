// Isolated read-only shop snapshots for acquisition guidance. Never selects a shop or purchases.
import { readGuestSessionId } from "../activity/session-id.js";
import { SHOP_API_PATH, parseShopSnapshot } from '../shop/shop-client.js';
import { SHOP_ROUTE_IDS } from '../shop/shop-routes.js';

// AUTH (migrated 2026-11-13, Tier 4 guest-open): each shop read authenticates with the v0.1
// guest session id in the `X-Session-Id` header only — no other credential header is sent. The
// id is read lazily by readGuestSessionId() (fishing-reporter-wiring.js: localStorage
// 'inha-v01:sync-session', fallback 'inha-v01:server-session'; null when absent — never
// fabricated). The shop id travels as the `shop_id` query parameter.
// Before: getClient() returned the signed-in permanent-account client and reads went through
// its rpc(). That path is gone; only the transport changed — scope, timeout race and
// per-shop rows are unchanged.
const LEGACY = new Set(['shop.student_center', 'shop.dorm_furniture']);
export function createInventoryAcquisitionClient({
  getSessionId = readGuestSessionId,
  fetcher = (...args) => globalThis.fetch(...args),
  endpoint = SHOP_API_PATH,
  timeoutMs = 10000
} = {}) {
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
      const run = (async () => {
        let sessionId = null;
        try {
          const id = await getSessionId?.();
          sessionId = typeof id === "string" && id ? id : null;
        } catch { /* No session: every shop stays unknown, never fabricated. */ }
        if (!sessionId) { shopSnapshots = []; emit(); return false; }
        const ids = SHOP_ROUTE_IDS.filter(id => capabilityMode === 'split' || LEGACY.has(id));
        shopSnapshots = []; emit();
        await Promise.all(ids.map(async shopId => {
          let snapshot = null, timer;
          try {
            const url = `${endpoint.replace(/\/$/, "")}?shop_id=${encodeURIComponent(shopId)}`;
            const response = await Promise.race([
              (async () => fetcher(url, { headers: { "X-Session-Id": sessionId } }))(),
              new Promise(resolve => { timer = setTimeout(() => resolve(null), timeoutMs); })
            ]);
            if (response && response.ok) snapshot = parseShopSnapshot(await response.json(), shopId);
          } catch { /* Failed guidance is unknown; never expose backend errors. */ }
          finally { clearTimeout(timer); }
          if (epoch !== accountEpoch || account !== accountId) return;
          const row = Object.freeze({ accountId: account, accountEpoch: epoch, state: snapshot ? 'READY' : 'UNAVAILABLE', snapshot });
          // A stalled vendor must not hide the other shops' successful reads.
          shopSnapshots = Object.freeze([...shopSnapshots, row]); emit();
        }));
        return epoch === accountEpoch && account === accountId;
      })().finally(() => { if (inFlight === run) inFlight = null; });
      inFlight = run;
      return run;
    },
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }
  };
}
