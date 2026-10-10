// Browser adapter for the authenticated Duck Companion observation Edge Function.
// It owns no progression authority: it only invokes server verification and caches the returned snapshot.

export const DUCK_OBSERVATION_FUNCTION = 'world-duck-observe';

const STOP_STATES = new Set(['BOND_ELIGIBLE', 'OWNED']);

export function createDuckObservationClient({
  getClient = () => null,
  onChange = () => {},
  claimKeyFactory = () => globalThis.crypto?.randomUUID?.() ?? null
} = {}) {
  let snapshot = null;
  let lastError = null;
  let bondPending = false;
  const pending = new Set();

  const publish = () => {
    try { onChange(snapshot); } catch { /* UI observers never break the adapter. */ }
  };

  function setSnapshot(next) {
    snapshot = next && typeof next === 'object' ? Object.freeze({ ...next }) : null;
    publish();
    return snapshot;
  }

  return Object.freeze({
    canObserve() {
      const client = getClient?.();
      return !!client?.functions?.invoke && !STOP_STATES.has(snapshot?.state);
    },
    canBond() {
      const client = getClient?.();
      return !!client?.rpc && snapshot?.state === 'BOND_ELIGIBLE' && !bondPending;
    },
    async refresh() {
      const client = getClient?.();
      if (!client?.rpc) {
        setSnapshot(null);
        return null;
      }
      try {
        const { data, error } = await client.rpc('get_my_duck_companion_v1');
        if (error) throw error;
        lastError = null;
        return setSnapshot(data ?? null);
      } catch (error) {
        lastError = String(error?.message ?? error);
        return null;
      }
    },
    async observe(duckId) {
      const client = getClient?.();
      if (!client?.functions?.invoke) return { status: 'UNAVAILABLE', companion: snapshot };
      const id = String(duckId ?? '');
      if (!id || pending.has(id)) return { status: pending.has(id) ? 'PENDING' : 'INVALID', companion: snapshot };

      pending.add(id);
      try {
        const { data, error } = await client.functions.invoke(DUCK_OBSERVATION_FUNCTION, {
          body: { duckId: id }
        });
        if (error) throw error;
        const companion = data?.companion ?? null;
        if (companion) setSnapshot(companion);
        lastError = null;
        return { ...(data ?? {}), companion: companion ?? snapshot };
      } catch (error) {
        lastError = String(error?.message ?? error);
        return { status: 'FAILED', companion: snapshot, error: lastError };
      } finally {
        pending.delete(id);
      }
    },
    async bond() {
      const client = getClient?.();
      if (!client?.rpc) return { status: 'UNAVAILABLE', companion: snapshot };
      if (bondPending) return { status: 'PENDING', companion: snapshot };
      if (snapshot?.state !== 'BOND_ELIGIBLE') return { status: 'NOT_ELIGIBLE', companion: snapshot };

      const rawKey = claimKeyFactory?.();
      const claimKey = rawKey ? `duck-bond:${String(rawKey)}` : null;
      if (!claimKey) return { status: 'UNAVAILABLE', companion: snapshot };

      bondPending = true;
      try {
        const { data, error } = await client.rpc('bond_my_duck_companion_v1', {
          p_claim_key: claimKey
        });
        if (error) throw error;
        const companion = data?.companion ?? null;
        if (companion) setSnapshot(companion);
        lastError = null;
        return { ...(data ?? {}), companion: companion ?? snapshot };
      } catch (error) {
        lastError = String(error?.message ?? error);
        return { status: 'FAILED', companion: snapshot, error: lastError };
      } finally {
        bondPending = false;
      }
    },
    reset() {
      pending.clear();
      bondPending = false;
      lastError = null;
      setSnapshot(null);
    },
    status() {
      return Object.freeze({
        snapshot,
        pending: Object.freeze([...pending]),
        bondPending,
        lastError
      });
    }
  });
}
