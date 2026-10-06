import {
  INPUT_CURSOR,
  INPUT_FOCUS_CLASS,
  createInputPolicy
} from "../input/input-focus-manager.js";
import { createInputFocusOwner } from "../input/input-focus-owner.js";

export const CINEMATIC_INPUT_POLICY = createInputPolicy(INPUT_FOCUS_CLASS.SYSTEM_LOCK, {
  cursor: INPUT_CURSOR.HIDDEN
});

const clamp01 = value => Math.max(0, Math.min(1, Number(value) || 0));
const smooth = value => {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
const finitePoint = value => value &&
  Number.isFinite(value.x) && Number.isFinite(value.y) && Number.isFinite(value.z);

function cameraBasis(camera) {
  const from = camera?.getPosition?.();
  const forward = camera?.forward;
  if (!from || !forward) return null;
  return {
    pos: { x: from.x, y: from.y, z: -from.z },
    look: {
      x: from.x + forward.x * 10,
      y: from.y + forward.y * 10,
      z: -(from.z + forward.z * 10)
    }
  };
}

function sequencePose(sequence, time, camera = null) {
  const aspect = Number.isFinite(camera?.camera?.aspectRatio) ? camera.camera.aspectRatio : null;
  const pose = sequence?.poseAt?.(
    Math.max(0, Math.min(sequence.duration, time)),
    { aspect }
  );
  if (!finitePoint(pose?.pos) || !finitePoint(pose?.look)) return null;
  return pose;
}

export function createCinematicDirector({
  camera,
  inputFocus,
  root = globalThis.document?.body ?? null,
  skipButton = null,
  reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)") ?? { matches: false }
} = {}) {
  if (!camera?.camera || !camera?.setPosition || !camera?.lookAt) {
    throw new TypeError("CinematicDirector requires a camera entity");
  }
  if (!inputFocus?.claim || !inputFocus?.release) {
    throw new TypeError("CinematicDirector requires InputFocusManager");
  }

  const inputOwner = createInputFocusOwner({
    manager: inputFocus,
    ownerId: "cinematic-director",
    policy: CINEMATIC_INPUT_POLICY
  });

  let session = null;
  let last = Object.freeze({ sequenceId: null, reason: "idle" });

  function setSkipVisible(visible) {
    if (!skipButton) return;
    skipButton.hidden = !visible;
    skipButton.setAttribute?.("aria-hidden", visible ? "false" : "true");
  }

  function clearRoot() {
    if (root?.dataset) delete root.dataset.cinematic;
  }

  function finish(reason = "complete") {
    if (!session) return false;
    const ended = session;
    session = null;
    if (Number.isFinite(ended.originalFov)) camera.camera.fov = ended.originalFov;
    inputOwner.release();
    clearRoot();
    setSkipVisible(false);
    last = Object.freeze({ sequenceId: ended.sequence.id ?? null, reason });
    try {
      ended.onComplete?.(last);
    } catch (error) {
      console.warn("Cinematic completion callback failed:", error);
    }
    return true;
  }

  function start(sequence, { onComplete = null } = {}) {
    if (session || !sequence || !Number.isFinite(sequence.duration) || sequence.duration <= 0 ||
        typeof sequence.poseAt !== "function") return false;

    const id = String(sequence.id ?? "cinematic");
    if (reducedMotion?.matches) {
      setSkipVisible(false);
      last = Object.freeze({ sequenceId: id, reason: "reduced-motion" });
      try {
        onComplete?.(last);
      } catch (error) {
        console.warn("Cinematic completion callback failed:", error);
      }
      return true;
    }

    const originalFov = Number.isFinite(camera.camera.fov) ? camera.camera.fov : null;
    session = {
      sequence,
      elapsed: 0,
      originalFov,
      onComplete
    };
    inputOwner.acquire();
    if (root?.dataset) root.dataset.cinematic = id;
    setSkipVisible(sequence.skippable !== false);
    return true;
  }

  function update(dt = 0) {
    if (!session) return false;
    // Presentation time may advance faster than gameplay's 50 ms simulation cap.
    // Keep a bounded catch-up so low-FPS/SwiftShader sessions do not stretch a short reveal into minutes.
    session.elapsed += Math.max(0, Math.min(Number(dt) || 0, 0.25));
    if (session.elapsed >= session.sequence.duration) finish("complete");
    return true;
  }

  function blendWeight() {
    if (!session) return 0;
    const blend = Math.max(0.01, Number(session.sequence.blendSeconds) || 0.45);
    const enter = smooth(session.elapsed / blend);
    const exit = smooth((session.sequence.duration - session.elapsed) / blend);
    return Math.min(enter, exit);
  }

  function applyCamera() {
    if (!session) return false;
    const base = cameraBasis(camera);
    const pose = sequencePose(session.sequence, session.elapsed, camera);
    if (!base || !pose) return false;

    const weight = blendWeight();
    const pos = {
      x: lerp(base.pos.x, pose.pos.x, weight),
      y: lerp(base.pos.y, pose.pos.y, weight),
      z: lerp(base.pos.z, pose.pos.z, weight)
    };
    const look = {
      x: lerp(base.look.x, pose.look.x, weight),
      y: lerp(base.look.y, pose.look.y, weight),
      z: lerp(base.look.z, pose.look.z, weight)
    };
    camera.setPosition(pos.x, pos.y, -pos.z);
    camera.lookAt(look.x, look.y, -look.z);

    if (Number.isFinite(pose.fov) && Number.isFinite(session.originalFov)) {
      camera.camera.fov = lerp(session.originalFov, pose.fov, weight);
    }
    return true;
  }

  function streamingInterestPoints() {
    if (!session) return [];
    const lead = Math.max(0, Number(session.sequence.streamingLeadSeconds) || 0);
    const now = sequencePose(session.sequence, session.elapsed, camera);
    const ahead = lead > 0 ? sequencePose(session.sequence, session.elapsed + lead, camera) : null;
    const points = [];
    for (const pose of [now, ahead]) {
      if (!pose) continue;
      points.push({ x: pose.pos.x, y: pose.pos.y, z: pose.pos.z });
      points.push({ x: pose.look.x, y: pose.look.y, z: pose.look.z });
    }
    return points;
  }

  function skip() {
    if (!session || session.sequence.skippable === false) return false;
    return finish("skip");
  }

  function abort(reason = "abort") {
    return finish(reason);
  }

  function onSkipClick() {
    skip();
  }

  skipButton?.addEventListener?.("click", onSkipClick);

  function destroy() {
    if (session) finish("destroy");
    else inputOwner.release();
    setSkipVisible(false);
    skipButton?.removeEventListener?.("click", onSkipClick);
    clearRoot();
  }

  function status() {
    return Object.freeze({
      active: Boolean(session),
      sequenceId: session?.sequence.id ?? last.sequenceId,
      elapsed: session?.elapsed ?? 0,
      duration: session?.sequence.duration ?? 0,
      skippable: session ? session.sequence.skippable !== false : false,
      reason: session ? "running" : last.reason,
      reducedMotion: Boolean(reducedMotion?.matches),
      skipAvailable: Boolean(session && session.sequence.skippable !== false),
      streamingInterestCount: session ? streamingInterestPoints().length : 0
    });
  }

  return Object.freeze({
    start,
    update,
    applyCamera,
    streamingInterestPoints,
    skip,
    abort,
    destroy,
    status,
    get active() { return Boolean(session); }
  });
}
