// In-process experiment only. No HTTP route, browser import or production issuer.
import { randomUUID } from 'node:crypto';
import { FISHING_SPOTS } from '../src/activity/fishing-spots.js';
import { WORLD_BOUNDS } from '../src/campus-layout.js';
import { canOccupy, moveAroundObstacles } from '../src/world-collision.js';
import { constrainPondWalk, overPondWater } from '../src/landmark-detail-layout.js';
import { roadviewGroundHeight } from '../src/roadview-layout.js';
import { PLAYER_ORIGIN_Y, WALK_SHAPE } from '../src/player-dimensions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const POSITION_PROTOTYPE_LIMITS = Object.freeze({
  walkSpeed: 7, tickMs: 50, inputLifetimeMs: 250, maxTickGapMs: 250,
  observationIntervalMs: 250, enclaveRadius: 8
});

function command(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).length !== 3 || Object.keys(value).some(k => !['seq', 'moveX', 'moveZ'].includes(k)) ||
      !Number.isSafeInteger(value.seq) || value.seq < 1 ||
      !Number.isFinite(value.moveX) || !Number.isFinite(value.moveZ) ||
      Math.abs(value.moveX) > 1 || Math.abs(value.moveZ) > 1) throw Error('INVALID_COMMAND');
  return Object.freeze({ seq: value.seq, moveX: value.moveX, moveZ: value.moveZ });
}

function ground(x, z) { return { x, y: PLAYER_ORIGIN_Y + roadviewGroundHeight(x, z), z }; }
function safe(p, spot) {
  return [p.x, p.y, p.z].every(Number.isFinite) && p.y >= -1 && p.y <= 4 &&
    Math.hypot(p.x - spot.position.x, p.z - spot.position.z) <= POSITION_PROTOTYPE_LIMITS.enclaveRadius &&
    p.x >= WORLD_BOUNDS.minX + WALK_SHAPE.radius && p.x <= WORLD_BOUNDS.maxX - WALK_SHAPE.radius &&
    p.z >= WORLD_BOUNDS.minZ + WALK_SHAPE.radius && p.z <= WORLD_BOUNDS.maxZ - WALK_SHAPE.radius &&
    !overPondWater(p.x, p.z) && canOccupy(p);
}

// bank is SERVER configuration. connect accepts only an authorization header; no
// client spawn, identity, session, pose, clock, speed, eligibility or dt exists.
// A transport would keep each returned capability on the authenticated server
// connection, never dispatch by a user/session field supplied in a message.
export function createPositionAuthorityPrototype({ verifyUser, rpc, bank = FISHING_SPOTS[0].sourceRef,
  monotonicNow = () => performance.now(), wallNow = () => Date.now() }) {
  const spot = FISHING_SPOTS.find(s => s.sourceRef === bank);
  if (!spot || typeof verifyUser !== 'function' || typeof rpc !== 'function') throw Error('INVALID_CONFIGURATION');
  const spawn = ground(spot.position.x, spot.position.z + (spot === FISHING_SPOTS[0] ? 6 : -6));
  if (!safe(spawn, spot)) throw Error('UNSAFE_SPAWN');
  // Deliberately memory-only. This is NOT a durable cross-worker revision allocator.
  const accounts = new Map(), connecting = new Set();
  return Object.freeze({
    async connect(authorization) {
      const verified = await verifyUser(authorization);
      if (typeof verified !== 'string' || !UUID.test(verified)) throw Error('AUTH_REQUIRED');
      const actor = verified.toLowerCase(), previous = accounts.get(actor);
      if (connecting.has(actor) || previous?.connected || previous?.pending || previous?.inFlight || previous?.fenced) {
        throw Error('ACCOUNT_OWNERSHIP_UNAVAILABLE');
      }
      connecting.add(actor);
      try {
        const now = monotonicNow();
        if (!Number.isFinite(now)) throw Error('CLOCK_UNAVAILABLE');
        const state = { actor, session: randomUUID(), revision: previous?.revision ?? 0,
          position: { ...spawn }, connected: true, fenced: false, lastTick: now,
          lastObservation: -Infinity, inputAt: -Infinity, input: null, seq: 0,
          pending: null, inFlight: null };
        if (previous) previous.fenced = true; // Retired transport capabilities cannot publish again.
        accounts.set(actor, state);
        const snapshot = () => Object.freeze({ sessionId: state.session, acknowledgedSeq: state.seq,
          ...state.position, space: 'CAMPUS', mode: state.connected && !state.fenced ? 'ON_FOOT' : 'INELIGIBLE' });
        const close = () => { state.connected = false; state.input = null; state.lastObservation = -Infinity; };
        return Object.freeze({
          snapshot,
          input(body) {
            if (!state.connected || state.fenced) throw Error('SESSION_CLOSED');
            const next = command(body);
            if (next.seq === state.seq) {
              if (next.moveX !== state.input?.moveX || next.moveZ !== state.input?.moveZ) throw Error('INPUT_CONFLICT');
              return 'ALREADY_PROCESSED'; // Never renew input lifetime on retry.
            }
            if (next.seq < state.seq) return 'STALE';
            if (next.seq !== state.seq + 1) throw Error('INPUT_SEQUENCE_GAP');
            const now = monotonicNow();
            if (!Number.isFinite(now) || now < state.lastTick || now - state.lastTick > POSITION_PROTOTYPE_LIMITS.maxTickGapMs) {
              close(); throw Error('SESSION_CLOCK_LOST');
            }
            state.seq = next.seq; state.input = next; state.inputAt = now;
            return 'ACCEPTED';
          },
          // Called by the SERVER scheduler, not by client command arrival.
          advance() {
            if (state.fenced) throw Error('ISSUER_FENCED');
            const now = monotonicNow(), elapsed = now - state.lastTick;
            if (!Number.isFinite(now) || elapsed < 0 || elapsed > POSITION_PROTOTYPE_LIMITS.maxTickGapMs) close();
            else if (state.connected && elapsed >= POSITION_PROTOTYPE_LIMITS.tickMs) {
              // Fixed substeps; no catch-up beyond the bounded gap. Input received
              // after the prior tick cannot move the actor retroactively.
              for (let at = state.lastTick; at + POSITION_PROTOTYPE_LIMITS.tickMs <= now; at += POSITION_PROTOTYPE_LIMITS.tickMs) {
                if (!state.input || at < state.inputAt || at - state.inputAt >= POSITION_PROTOTYPE_LIMITS.inputLifetimeMs) continue;
                const { moveX, moveZ } = state.input, length = Math.max(1, Math.hypot(moveX, moveZ));
                const distance = POSITION_PROTOTYPE_LIMITS.walkSpeed * POSITION_PROTOTYPE_LIMITS.tickMs / 1000;
                const swept = moveAroundObstacles(state.position, moveX / length * distance, moveZ / length * distance);
                const constrained = constrainPondWalk(state.position, swept), candidate = ground(constrained.x, constrained.z);
                if (safe(candidate, spot)) state.position = candidate;
              }
            }
            // Retain a fractional step rather than letting command spam buy time.
            if (Number.isFinite(now)) state.lastTick = elapsed >= 0 && elapsed <= POSITION_PROTOTYPE_LIMITS.maxTickGapMs
              ? state.lastTick + Math.floor(elapsed / POSITION_PROTOTYPE_LIMITS.tickMs) * POSITION_PROTOTYPE_LIMITS.tickMs : now;
            if (!state.pending && Number.isFinite(now) && now - state.lastObservation >= POSITION_PROTOTYPE_LIMITS.observationIntervalMs) {
              const wall = wallNow();
              if (!Number.isFinite(wall) || !Number.isSafeInteger(state.revision + 1)) { close(); throw Error('CLOCK_OR_REVISION_UNAVAILABLE'); }
              state.pending = Object.freeze({ p_user: actor, p_session_id: state.session, p_revision: ++state.revision,
                p_x: state.position.x, p_y: state.position.y, p_z: state.position.z,
                p_space: 'CAMPUS', p_mode: state.connected ? 'ON_FOOT' : 'INELIGIBLE',
                p_observed_at: new Date(wall).toISOString() });
              state.lastObservation = now;
            }
            return snapshot();
          },
          disconnect: close,
          // One immutable outbox record. Unknown transport failures retain the
          // original full tuple AND timestamp; retries cannot renew freshness.
          async flush() {
            if (state.fenced) throw Error('ISSUER_FENCED');
            if (state.inFlight) return state.inFlight;
            if (!state.pending) return null;
            const payload = state.pending;
            state.inFlight = Promise.resolve().then(() => rpc('world_fishing_observe_position_v1', payload)).then(result => {
              if (!['OBSERVED', 'ALREADY_PROCESSED'].includes(result?.status)) {
                state.fenced = true; close(); throw Error('ISSUER_FENCED');
              }
              state.pending = null;
              return result;
            }).finally(() => { state.inFlight = null; });
            return state.inFlight;
          }
        });
      } finally { connecting.delete(actor); }
    }
  });
}
