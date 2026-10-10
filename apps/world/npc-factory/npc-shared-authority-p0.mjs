import {
  NPC_SCHEDULE_REVISION,
  NPC_WORLD_EPOCH_MS,
  NPC_WORLD_PERIOD_MS,
  worldScheduleAt
} from './npc-world-time-contract.mjs';

export const SHARED_NPC_AUTHORITY_REVISION = 'shared-npc-p0-v1';
export const SHARED_NPC_P0_IDS = Object.freeze(['INKYUNG-NPC-003', 'INKYUNG-NPC-012']);
export const SHARED_NPC_TICK_MS = 250;
export const SHARED_NPC_LOD = Object.freeze({
  ACTIVE: 'ACTIVE',
  COARSE: 'COARSE',
  SLEEP: 'SLEEP'
});

const PLACE_ZONE_PATTERN = /^AREA_[A-Z0-9_]{1,60}$/u;

function asZoneId(value) {
  if (typeof value === 'string') return value;
  if (value && typeof value.id === 'string') return value.id;
  return null;
}

function quantizedWorldTime(serverNowMs) {
  if (!Number.isFinite(serverNowMs) || serverNowMs < NPC_WORLD_EPOCH_MS)
    throw new Error('INVALID_SHARED_NPC_WORLD_TIME');
  const tick = Math.floor((serverNowMs - NPC_WORLD_EPOCH_MS) / SHARED_NPC_TICK_MS);
  return {
    tick,
    atMs: NPC_WORLD_EPOCH_MS + tick * SHARED_NPC_TICK_MS
  };
}

function publicNpcState(record) {
  const state = record.state;
  return Object.freeze({
    id: record.id,
    revision: record.revision,
    placeZoneId: record.placeZoneId,
    phase: state.phase,
    position: state.position ? Object.freeze({ x: state.position.x, z: state.position.z }) : null,
    heading: Number.isFinite(state.heading) ? state.heading : 0,
    visible: state.visible === true,
    moving: state.moving === true,
    activity: state.activity ?? null,
    destination: state.destination ?? null,
    scheduleIndex: Number.isInteger(state.scheduleIndex) ? state.scheduleIndex : null,
    slot: Number.isInteger(state.slot) ? state.slot : null,
    transfer: state.transfer === true,
    meetingId: state.meetingId ?? null,
    meetingLocation: state.meetingLocation ?? null,
    meetingPhase: state.meetingPhase ?? null
  });
}

export function createSharedNpcAuthorityP0({
  roster,
  getPlaceZoneId,
  pilotIds = null,
  criticalIds = []
} = {}) {
  if (!(roster instanceof Map) || roster.size === 0)
    throw new Error('SHARED_NPC_ROSTER_REQUIRED');
  if (typeof getPlaceZoneId !== 'function')
    throw new Error('SHARED_NPC_PLACE_ZONE_RESOLVER_REQUIRED');

  const ids = pilotIds ? [...pilotIds] : [...roster.keys()];
  if (!ids.length || ids.some(id => !roster.has(id)))
    throw new Error('INVALID_SHARED_NPC_PILOT_IDS');
  ids.sort();
  const critical = new Set(criticalIds);

  function evaluate({ placeZoneId = null, serverNowMs = Date.now() } = {}) {
    if (placeZoneId !== null && !PLACE_ZONE_PATTERN.test(placeZoneId))
      throw new Error('INVALID_SHARED_NPC_PLACE_ZONE');

    const { tick, atMs } = quantizedWorldTime(serverNowMs);
    const world = worldScheduleAt(atMs);
    const records = ids.map(id => {
      const member = roster.get(id);
      const state = member.controller.sample(atMs);
      const placeZone = state.visible && state.position
        ? asZoneId(getPlaceZoneId(state.position))
        : null;
      const observed = placeZoneId !== null && placeZone === placeZoneId && state.visible === true;
      const continuityRequired = critical.has(id) || state.moving === true ||
        state.transfer === true || state.meetingId != null;
      const lod = observed
        ? SHARED_NPC_LOD.ACTIVE
        : continuityRequired
          ? SHARED_NPC_LOD.COARSE
          : SHARED_NPC_LOD.SLEEP;
      return Object.freeze({
        id,
        revision: tick,
        lod,
        placeZoneId: placeZone,
        state
      });
    });

    return Object.freeze({
      authorityRevision: SHARED_NPC_AUTHORITY_REVISION,
      sourceRevision: NPC_SCHEDULE_REVISION,
      tick,
      authoritativeTimeMs: atMs,
      periodMs: NPC_WORLD_PERIOD_MS,
      period: world.period,
      scheduleSlot: world.slot,
      scheduleIndex: world.index,
      placeZoneId,
      records: Object.freeze(records)
    });
  }

  function snapshot(options = {}) {
    const evaluated = evaluate(options);
    const active = evaluated.records
      .filter(record => record.lod === SHARED_NPC_LOD.ACTIVE)
      .map(publicNpcState);
    const counts = evaluated.records.reduce((result, record) => {
      result[record.lod] += 1;
      return result;
    }, { ACTIVE: 0, COARSE: 0, SLEEP: 0 });

    return Object.freeze({
      authorityRevision: evaluated.authorityRevision,
      sourceRevision: evaluated.sourceRevision,
      revision: evaluated.tick,
      authoritativeTimeMs: evaluated.authoritativeTimeMs,
      period: evaluated.period,
      scheduleSlot: evaluated.scheduleSlot,
      scheduleIndex: evaluated.scheduleIndex,
      placeZoneId: evaluated.placeZoneId,
      lodCounts: Object.freeze(counts),
      npcs: Object.freeze(active)
    });
  }

  return Object.freeze({
    ids: Object.freeze([...ids]),
    evaluate,
    snapshot
  });
}
