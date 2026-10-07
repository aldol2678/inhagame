// Local, presentation-only adapter for the existing server-authored fishing client.
// No input, account, reward or timing authority lives here. Closing/hiding only clears visuals.
import { fishingPhase, FISHING_PHASE } from './fishing-panel.js';
import { getFishingSpot } from './fishing-spots.js';
import { getCanonicalLandmark, projectPolygon, buildPolygonSurfaceGeometry } from '../reality-adapter.js';
import { overPondWater } from '../landmark-detail-layout.js';
import { metersToWorld } from '../world-scale.js';

export const FISHING_ASSETS = Object.freeze({
  rod: Object.freeze({ url: '/assets/fishing-v1/fishing_rod_v1.glb', socket: 'Line_Tip', surfaces: 3,
    sha256: '96629053cb58e715d8d1a9f25b9c5ba8d84e3f7900116b6a7e76d52c86c61abe' }),
  float: Object.freeze({ url: '/assets/fishing-v1/fishing_float_v1.glb', socket: 'Line_Attach', surfaces: 1,
    sha256: '81c679d596028cd4e2bb8a90e2ebafd9c9428b02071572214a076ec3f47fa26d' }),
  fish: Object.freeze({ url: '/assets/fishing-v1/crucian_fish_v1.glb', socket: 'Catch_Line', surfaces: 2,
    sha256: '518f51d80392966dd73a90db19ab8b262c9478a5b6708dc25774479bdcfaeeee' }),
  ripple: Object.freeze({ url: '/assets/fishing-v1/water_ripple_atlas.png', sha256: 'e9b885d622576828d55d9b9f565bc37b309df683163d4dda8a52bc315612aac7' }),
  splash: Object.freeze({ url: '/assets/fishing-v1/water_splash_atlas.png', sha256: '78580ce1554eb279a8764982d28ab1e1e8da6c19ab1fff3634303af66fde3b5b' })
});
export const FISHING_MODEL_REGISTRY = Object.freeze(Object.fromEntries(
  ['rod', 'float', 'fish'].map(key => [key, FISHING_ASSETS[key].url])));
// Same geometry producer/default elevation as central-blockout, never a second pond height.
const WATER_Y = buildPolygonSurfaceGeometry(projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon)).positions[1];
export function fishingWaterTarget(spot) {
  if (!spot) return null;
  const distance = metersToWorld(4.6);
  const target = { x: spot.position.x + Math.sin(spot.facingYaw) * distance,
    y: WATER_Y, z: spot.position.z + Math.cos(spot.facingYaw) * distance };
  return overPondWater(target.x, target.z) ? target : null;
}
const clamp = value => Math.max(0, Math.min(1, value));

/** A tiny observer of existing client state; createView owns only its temporary render resources. */
export function createFishingPresentation({ fishing, createView } = {}) {
  let open = false, suppressed = false, destroyed = false, view = null;
  let currentId = null, phase = FISHING_PHASE.IDLE, lastBusy = null;
  let castAt = null, splashAt = null, reelAt = null, bitePlayed = false, catchVisible = false;
  let viewFailed = false;

  function release() { view?.destroy(); view = null; }
  function reset() {
    release(); currentId = null; phase = FISHING_PHASE.IDLE; castAt = splashAt = reelAt = null;
    bitePlayed = false; catchVisible = false; viewFailed = false;
  }
  function update(change = null) {
    if (destroyed) return;
    const previousBusy = lastBusy;
    lastBusy = fishing.busy;
    if (change?.reason === 'account') reset();
    if (!open || suppressed || fishing.state !== 'READY' || fishing.busy === 'cancel') { reset(); return; }
    const attempt = fishing.attempt;
    if (!attempt) { reset(); return; }
    const now = fishing.serverNow();
    const nextPhase = fishingPhase(attempt, now);
    const newAttempt = attempt.attemptId !== currentId;
    if (newAttempt) {
      reset(); currentId = attempt.attemptId;
      phase = nextPhase;
      bitePlayed = nextPhase !== FISHING_PHASE.WAITING;
      // Refresh, replay/recovery and already-active errors never replay a cast.
      if (change?.reason === 'start' && change.outcome === 'STARTED' && previousBusy === 'start' && !fishing.busy && !fishing.lastError &&
          nextPhase === FISHING_PHASE.WAITING && now - attempt.startedAtMs < 1000) castAt = now;
    }
    if (nextPhase === FISHING_PHASE.BITE && phase === FISHING_PHASE.WAITING && !bitePlayed) {
      bitePlayed = true; splashAt = now; castAt = null;
    }
    if (nextPhase === FISHING_PHASE.RESULT && phase !== FISHING_PHASE.RESULT) {
      catchVisible = (change?.reason === 'hook' || fishing.busy === 'hook') && attempt.status === 'SUCCEEDED' &&
        attempt.result?.catch?.itemId === 'material.fish_carp';
      if (catchVisible) reelAt = now;
    }
    phase = nextPhase;
    if (phase === FISHING_PHASE.RESULT && !catchVisible) { release(); return; }
    const spot = getFishingSpot(attempt.sourceRef), target = fishingWaterTarget(spot);
    if (!target) { release(); return; }
    if (!view && !viewFailed) {
      try { view = createView(); }
      catch { viewFailed = true; return; } // Cosmetic failure cannot block the panel or server action.
    }
    if (!view) return;
    let castProgress = castAt === null ? 1 : clamp((now - castAt) / 350);
    if (castAt !== null && castProgress >= 1) { splashAt = castAt + 350; castAt = null; }
    const splashFrame = splashAt === null || now - splashAt >= 8 / 12 * 1000 ? null
      : Math.max(0, Math.floor((now - splashAt) / 1000 * 12));
    try { view.render({ phase, spot, target, showFish: catchVisible,
      castProgress, reelProgress: reelAt === null ? 0 : clamp((now - reelAt) / 600),
      rippleFrame: Math.floor(now / 1000 * 8) % 8, splashFrame,
      floatOffset: phase === FISHING_PHASE.BITE ? -metersToWorld(0.04)
        : Math.sin(now / 1000 * (phase === FISHING_PHASE.LATE ? 7 : 2)) * metersToWorld(0.006) }); }
    catch { release(); viewFailed = true; }
  }
  const unsubscribe = fishing.onChange(update);
  return Object.freeze({
    update: () => update(),
    setOpen(value) { const next = Boolean(value); if (next === open) return; open = next; reset(); update(); },
    setSuppressed(value) { const next = Boolean(value); if (next === suppressed) return; suppressed = next; reset(); update(); },
    status: () => ({ open, suppressed, destroyed, phase, attached: Boolean(view), failed: viewFailed, resources: view?.status?.() ?? null }),
    destroy() { if (destroyed) return; destroyed = true; unsubscribe?.(); reset(); }
  });
}
