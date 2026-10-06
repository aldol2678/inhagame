import { SHARED_NPC_P0_IDS } from './npc-shared-authority-p0.mjs';
import { createSharedNpcReplicaP0 } from './npc-shared-replica-p0.mjs';

const PLACE_ZONE_PATTERN = /^AREA_[A-Z0-9_]{1,60}$/u;
const pilotIds = new Set(SHARED_NPC_P0_IDS);

export function createSharedNpcAuthorityConsumerP0({
  enabled = false,
  endpoint = '/api/npc-shared-state',
  getPlaceZoneId = () => null,
  fetcher = fetch,
  now = () => performance.now(),
  pollIntervalMs = 250
} = {}) {
  if (typeof getPlaceZoneId !== 'function') throw new Error('SHARED_NPC_CONSUMER_ZONE_REQUIRED');
  if (typeof fetcher !== 'function') throw new Error('SHARED_NPC_CONSUMER_FETCH_REQUIRED');
  if (!Number.isFinite(pollIntervalMs) || pollIntervalMs < 100) throw new Error('INVALID_SHARED_NPC_POLL_INTERVAL');

  const replica = createSharedNpcReplicaP0();
  let active = Boolean(enabled);
  let inFlight = null;
  let zone = null;
  let lastAttemptAt = -Infinity;
  let lastAppliedAt = null;
  let lastError = null;

  function currentZone() {
    const next = getPlaceZoneId?.() ?? null;
    return PLACE_ZONE_PATTERN.test(next ?? '') ? next : null;
  }

  function ensureZone() {
    const next = currentZone();
    if (next === zone) return next;
    zone = next;
    replica.reset();
    lastAttemptAt = -Infinity;
    lastAppliedAt = null;
    lastError = null;
    return next;
  }

  async function sync({ force = false } = {}) {
    if (!active) return false;
    const requestZone = ensureZone();
    if (!requestZone) return false;
    const startedAt = now();
    if (!force && startedAt - lastAttemptAt < pollIntervalMs) return false;
    if (inFlight) return inFlight;
    lastAttemptAt = startedAt;

    inFlight = (async () => {
      try {
        const response = await fetcher(`${endpoint}?placeZoneId=${encodeURIComponent(requestZone)}`, {
          method: 'GET',
          cache: 'no-store',
          headers: { Accept: 'application/json' }
        });
        if (response.status === 404) {
          active = false;
          replica.reset();
          lastError = 'DISABLED';
          return false;
        }
        if (!response.ok) throw new Error(`SHARED_NPC_HTTP_${response.status}`);
        const snapshot = await response.json();
        if (requestZone !== currentZone()) return false;
        if (snapshot?.placeZoneId !== requestZone) throw new Error('SHARED_NPC_ZONE_MISMATCH');
        const applied = replica.applySnapshot(snapshot);
        if (applied) lastAppliedAt = now();
        lastError = null;
        return applied;
      } catch (error) {
        lastError = error?.message ?? 'SHARED_NPC_FETCH_FAILED';
        return false;
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  function update() {
    if (!active) return false;
    ensureZone();
    void sync();
    return true;
  }

  function stateFor(id) {
    if (!active || !pilotIds.has(id)) return null;
    const current = ensureZone();
    const status = replica.status();
    if (!current || status.placeZoneId !== current || status.revision < 0) {
      return Object.freeze({ authoritative: true, ready: false, visible: false, id });
    }
    const npc = status.npcs.find(item => item.id === id) ?? null;
    if (!npc) return Object.freeze({
      authoritative: true, ready: true, visible: false, id,
      revision: status.revision, placeZoneId: current
    });
    return Object.freeze({ authoritative: true, ready: true, ...npc });
  }

  function setEnabled(value) {
    const next = Boolean(value);
    if (active === next) return active;
    active = next;
    replica.reset();
    zone = null;
    lastAttemptAt = -Infinity;
    lastAppliedAt = null;
    lastError = null;
    return active;
  }

  function status() {
    const snapshot = replica.status();
    return Object.freeze({
      enabled: active,
      placeZoneId: zone,
      revision: snapshot.revision,
      authoritativeTimeMs: snapshot.authoritativeTimeMs,
      npcIds: Object.freeze(snapshot.npcs.map(npc => npc.id)),
      lastAppliedAt,
      lastError,
      inFlight: Boolean(inFlight)
    });
  }

  return Object.freeze({ update, sync, stateFor, setEnabled, status });
}
