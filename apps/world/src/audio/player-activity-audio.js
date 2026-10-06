import { resolveDoorCue, resolveFootstepSurface } from './activity-surfaces.js';
import { createActivityCueRenderer } from './activity-cues.js';

// Tunable prototype distances (world units), not biomechanical/asset production constants.
export const FOOTSTEP_STRIDE = Object.freeze({ WALK: 2.6, RUN: 3.2 });
const SUCCESSFUL_ROOM_EVENTS = new Set(['enter', 'enter-nested', 'exit', 'exit-nested']);
const finitePose = pose => pose && ['x', 'y', 'z'].every(axis => Number.isFinite(pose[axis]));

export function createPlayerActivityAudio({
  audio, documentLike = globalThis.document, windowLike = globalThis.window,
  resolveSurface = resolveFootstepSurface, renderer = createActivityCueRenderer({ audio }), initialSpace = 'campus'
} = {}) {
  let progress = 0, foot = 0, roomSpace = initialSpace, disposed = false, pageHidden = false;
  let lastSurface = null, lastGait = null, steps = 0, doors = 0;
  const audible = () => {
    if (disposed || pageHidden || documentLike?.visibilityState === 'hidden') return false;
    const state = audio?.status?.();
    return state?.context === 'running' && state.volume > 0;
  };
  const reset = () => { progress = 0; lastSurface = null; lastGait = null; };
  const stop = () => { reset(); renderer.stop(); };
  const onVisibility = () => stop();
  const onPageHide = () => { pageHidden = true; stop(); };
  const onPageShow = () => { pageHidden = false; reset(); };
  documentLike?.addEventListener?.('visibilitychange', onVisibility);
  windowLike?.addEventListener?.('pagehide', onPageHide);
  windowLike?.addEventListener?.('pageshow', onPageShow);
  return {
    // Sample only the controller's completed move, before knockback or any other pose writer.
    // Input intent alone is insufficient: collisions can keep moving=true while position is fixed.
    observeMove({ from, to, dt, space = 'campus', groundedBefore, grounded, moving,
      inputEnabled, mounted = false, swimming = false, seated = false, blocked = false,
      walkSpeed = 7, maxSpeed = 12 } = {}) {
      if (!audible() || !groundedBefore || !grounded || !moving || !inputEnabled || mounted || swimming || seated || blocked ||
          !finitePose(from) || !finitePose(to) || !Number.isFinite(dt) || dt <= 0 || dt > .15) { reset(); return false; }
      const moved = Math.hypot(to.x - from.x, to.z - from.z);
      if (moved < .0001 || moved > Math.max(walkSpeed, maxSpeed) * Math.min(dt, .05) * 1.1) { reset(); return false; }
      const surface = resolveSurface({ space, position: to });
      if (!surface) { reset(); return false; }
      const speed = moved / Math.min(dt, .05);
      const gait = speed > walkSpeed * 1.15 ? 'RUN' : 'WALK';
      lastSurface = surface; lastGait = gait;
      // Keep the contact phase across material and WALK/RUN changes. Short rugs
      // and rapid sprint toggles must not erase all progress toward the next step.
      progress += moved / FOOTSTEP_STRIDE[gait];
      if (progress + 1e-8 < 1) return false;
      progress = Math.max(0, progress - 1);
      const played = renderer.play({ kind: 'footstep', surface, gait, foot });
      foot = 1 - foot;
      if (played) steps++;
      return played;
    },
    onRoomChange(status, event) {
      if (disposed || !SUCCESSFUL_ROOM_EVENTS.has(event)) return false;
      const next = status?.space;
      const cue = resolveDoorCue(roomSpace, next);
      roomSpace = next;
      reset();
      if (!cue || !audible()) return false;
      const played = renderer.play(cue);
      if (played) doors++;
      return played;
    },
    reset,
    status: () => ({ ...renderer.status(), steps, doors, surface: lastSurface, gait: lastGait }),
    dispose() {
      if (disposed) return;
      disposed = true; reset(); renderer.dispose();
      documentLike?.removeEventListener?.('visibilitychange', onVisibility);
      windowLike?.removeEventListener?.('pagehide', onPageHide);
      windowLike?.removeEventListener?.('pageshow', onPageShow);
    }
  };
}
