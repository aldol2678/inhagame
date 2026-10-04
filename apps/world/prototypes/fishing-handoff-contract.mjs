// Executable DESIGN reference, not a transport/auth/DB or PlayerController adapter.
// receive* accepts only messages from the future authenticated server channel.
import { FISHING_SPOTS } from '../src/activity/fishing-spots.js';
import { PLAYER_ORIGIN_Y } from '../src/player-dimensions.js';
import { roadviewGroundHeight } from '../src/roadview-layout.js';

export const FISHING_HANDOFF_PROTOCOL = 'fishing.handoff.v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const uint = n => Number.isSafeInteger(n) && n >= 0;

export function fishingTransferPoint(sourceRef) {
  const index = FISHING_SPOTS.findIndex(spot => spot.sourceRef === sourceRef);
  if (index < 0) throw Error('INVALID_BANK');
  const spot = FISHING_SPOTS[index], x = spot.position.x, z = spot.position.z + (index === 0 ? 6 : -6);
  return Object.freeze({ x, y: PLAYER_ORIGIN_Y + roadviewGroundHeight(x, z), z });
}

export function createFishingHandoffReference({ accountId, mapVersion, sourceRef, requestId, generation }) {
  if (!UUID.test(accountId ?? '') || !UUID.test(requestId ?? '') ||
      typeof mapVersion !== 'string' || !mapVersion || !uint(generation) || generation === 0) throw Error('INVALID_CONTEXT');
  const point = fishingTransferPoint(sourceRef), spot = FISHING_SPOTS.find(s => s.sourceRef === sourceRef);
  let phase = 'ENTERING', admissionId = null, sessionId = null, pose = null, sentSeq = 0, exitRequestId = null;
  const common = message => message?.protocol === FISHING_HANDOFF_PROTOCOL &&
    message.accountId === accountId && message.mapVersion === mapVersion && message.sourceRef === sourceRef &&
    message.requestId === requestId && message.generation === generation;
  const bound = message => common(message) && message.admissionId === admissionId && message.sessionId === sessionId;
  const snapshot = raw => {
    if (!raw || !uint(raw.snapshotSeq) || raw.snapshotSeq === 0 || !uint(raw.simulationTick) ||
        !uint(raw.lastAcceptedInputSeq) || raw.lastAcceptedInputSeq > sentSeq ||
        ![raw.x, raw.y, raw.z].every(Number.isFinite) || raw.y < -1 || raw.y > 4 ||
        Math.hypot(raw.x-spot.position.x, raw.z-spot.position.z) > 8 ||
        !['ON_FOOT', 'INELIGIBLE'].includes(raw.mode)) throw Error('INVALID_SERVER_SNAPSHOT');
    return Object.freeze({ snapshotSeq: raw.snapshotSeq, simulationTick: raw.simulationTick,
      lastAcceptedInputSeq: raw.lastAcceptedInputSeq, x: raw.x, y: raw.y, z: raw.z, mode: raw.mode });
  };
  const newer = next => !pose || next.snapshotSeq > pose.snapshotSeq &&
    next.simulationTick >= pose.simulationTick && next.lastAcceptedInputSeq >= pose.lastAcceptedInputSeq;
  const atTransferPoint = p => ['x','y','z'].every(k => Math.abs(p[k]-point[k]) < 1e-9);
  return Object.freeze({
    state: () => Object.freeze({ phase, generation, admissionId, sessionId, pose, sentSeq,
      // Advisory client UX flags only. Real F3 position/lease checks still own grants.
      localWriterAllowed: phase === 'LOCAL', directionInputAllowed: phase === 'ACTIVE',
      fishingCommandAllowed: phase === 'ACTIVE' }),
    receiveOffer(message) {
      if (phase !== 'ENTERING' || !common(message) || message.status !== 'OFFERED') return false;
      if (!UUID.test(message.admissionId ?? '') || !UUID.test(message.sessionId ?? '')) throw Error('INVALID_SERVER_OFFER');
      const next = snapshot(message.snapshot);
      if (next.mode !== 'INELIGIBLE' || next.lastAcceptedInputSeq !== 0 || !atTransferPoint(next)) throw Error('INVALID_SERVER_OFFER');
      admissionId = message.admissionId; sessionId = message.sessionId; pose = next; phase = 'READY_PENDING';
      return true; // Adapter applies root, suppresses all local writers, then sends READY.
    },
    receiveActive(message) {
      if (phase !== 'READY_PENDING' || !bound(message) || message.status !== 'ACTIVE') return false;
      const next = snapshot(message.snapshot);
      if (next.mode !== 'ON_FOOT' || !newer(next) || !atTransferPoint(next)) throw Error('INVALID_SERVER_ACTIVATION');
      pose = next; phase = 'ACTIVE'; return true;
    },
    noteInputSent(seq) {
      if (phase !== 'ACTIVE' || !uint(seq) || seq !== sentSeq+1) throw Error('INPUT_NOT_ALLOWED');
      sentSeq = seq;
    },
    receiveSnapshot(message) {
      if (phase !== 'ACTIVE' || !bound(message) || message.status !== 'SNAPSHOT') return false;
      const next = snapshot(message.snapshot);
      if (!newer(next)) return false;
      pose = next;
      if (next.mode === 'INELIGIBLE') phase = 'RECOVERING';
      return true;
    },
    beginExit(id) {
      if (!UUID.test(id ?? '') || !['READY_PENDING','ACTIVE','RECOVERING','EXITING'].includes(phase)) throw Error('EXIT_NOT_ALLOWED');
      if (exitRequestId && exitRequestId !== id) throw Error('EXIT_REQUEST_CONFLICT');
      exitRequestId = id; phase = 'EXITING';
      return id; // Retry the same id; a lost response does not enable local movement.
    },
    receiveExited(message) {
      if (phase !== 'EXITING' || !bound(message) || message.status !== 'EXITED' || message.exitRequestId !== exitRequestId) return false;
      const next = snapshot(message.snapshot);
      if (!newer(next) || next.mode !== 'INELIGIBLE' || !atTransferPoint(next)) throw Error('INVALID_SERVER_EXIT');
      pose = next; phase = 'LOCAL'; return true;
    },
    connectionLost() { if (phase !== 'LOCAL') phase = 'RECOVERING'; }
  });
}
