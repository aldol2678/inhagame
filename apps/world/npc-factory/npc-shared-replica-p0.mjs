import {
  SHARED_NPC_AUTHORITY_REVISION
} from './npc-shared-authority-p0.mjs';

const PLACE_ZONE_PATTERN = /^AREA_[A-Z0-9_]{1,60}$/u;

function validateSnapshot(snapshot) {
  if (!snapshot || snapshot.authorityRevision !== SHARED_NPC_AUTHORITY_REVISION)
    throw new Error('INVALID_SHARED_NPC_AUTHORITY_REVISION');
  if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0)
    throw new Error('INVALID_SHARED_NPC_REVISION');
  if (!Number.isSafeInteger(snapshot.authoritativeTimeMs))
    throw new Error('INVALID_SHARED_NPC_TIME');
  if (snapshot.placeZoneId !== null && !PLACE_ZONE_PATTERN.test(snapshot.placeZoneId))
    throw new Error('INVALID_SHARED_NPC_PLACE_ZONE');
  if (!Array.isArray(snapshot.npcs))
    throw new Error('INVALID_SHARED_NPC_SNAPSHOT');

  const ids = new Set();
  for (const npc of snapshot.npcs) {
    if (!npc || typeof npc.id !== 'string' || ids.has(npc.id) ||
        npc.revision !== snapshot.revision || npc.placeZoneId !== snapshot.placeZoneId)
      throw new Error('INVALID_SHARED_NPC_RECORD');
    ids.add(npc.id);
  }
  return snapshot;
}

export function createSharedNpcReplicaP0() {
  let latestRevision = -1;
  let placeZoneId = null;
  let authoritativeTimeMs = null;
  let npcs = new Map();

  function applySnapshot(snapshot) {
    validateSnapshot(snapshot);
    if (snapshot.revision <= latestRevision) return false;
    latestRevision = snapshot.revision;
    placeZoneId = snapshot.placeZoneId;
    authoritativeTimeMs = snapshot.authoritativeTimeMs;
    npcs = new Map(snapshot.npcs.map(npc => [npc.id, Object.freeze({
      ...npc,
      position: npc.position ? Object.freeze({ ...npc.position }) : null
    })]));
    return true;
  }

  function reset() {
    latestRevision = -1;
    placeZoneId = null;
    authoritativeTimeMs = null;
    npcs = new Map();
  }

  function status() {
    return Object.freeze({
      revision: latestRevision,
      placeZoneId,
      authoritativeTimeMs,
      npcs: Object.freeze([...npcs.values()])
    });
  }

  return Object.freeze({
    applySnapshot,
    reset,
    status
  });
}
