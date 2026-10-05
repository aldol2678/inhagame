// Snapshot interpolation for one remote player. Pure and clock-driven: the renderer samples it
// at any frame rate and gets the same answer for the same time.

import { normalizeYaw } from "./protocol.js";

export const INTERPOLATION_DEFAULTS = Object.freeze({
  // Render this far behind the newest snapshot (Notion target 150–250 ms).
  delayMs: 200,
  // A jump larger than this between consecutive snapshots snaps instead of sliding.
  // Normal 4 Hz steps top out near 4.5 m (18 m/s mounted flight).
  snapDistanceM: 10,
  // Past the newest snapshot, dead-reckon on its velocity for at most this long, then hold.
  maxExtrapolationMs: 250,
  maxSnapshots: 16
});

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Shortest-arc interpolation in degrees: 170 → -170 passes through 180, not 0.
export function lerpYaw(a, b, t) {
  return normalizeYaw(a + normalizeYaw(b - a) * t);
}

export class SnapshotInterpolator {
  constructor(config = {}) {
    this.config = { ...INTERPOLATION_DEFAULTS, ...config };
    this.buffer = [];
    this.snaps = 0;
  }

  get latest() {
    return this.buffer.at(-1) ?? null;
  }

  // `snapshot` is a validated pose; `atMs` is local receive time.
  push(snapshot, atMs) {
    const entry = { t: atMs, x: snapshot.x, y: snapshot.y, z: snapshot.z, yaw: snapshot.yaw,
      vx: snapshot.vx ?? 0, vz: snapshot.vz ?? 0, anim: snapshot.anim, mount: snapshot.mount ?? null };
    const last = this.latest;
    if (last && Math.hypot(entry.x - last.x, entry.y - last.y, entry.z - last.z) > this.config.snapDistanceM) {
      this.#snapTo(entry);
      return "snap";
    }
    // Receive times are monotonic per player; equal times keep arrival order.
    if (last && entry.t < last.t) entry.t = last.t;
    this.buffer.push(entry);
    if (this.buffer.length > this.config.maxSnapshots) this.buffer.shift();
    return "buffered";
  }

  // Explicit teleport, respawn or place-zone entry: no sliding from the old spot.
  teleport(snapshot, atMs) {
    this.#snapTo({ t: atMs, x: snapshot.x, y: snapshot.y, z: snapshot.z, yaw: snapshot.yaw,
      vx: 0, vz: 0, anim: snapshot.anim ?? this.latest?.anim,
      mount: snapshot.anim ? snapshot.mount ?? null : this.latest?.mount ?? null });
  }

  #snapTo(entry) {
    this.buffer = [entry];
    this.snaps += 1;
  }

  sample(nowMs) {
    const { buffer, config } = this;
    if (!buffer.length) return null;
    const renderAt = nowMs - config.delayMs;
    const first = buffer[0];
    if (renderAt <= first.t) return this.#state(first, 0, "hold");

    for (let i = buffer.length - 1; i > 0; i -= 1) {
      const a = buffer[i - 1];
      const b = buffer[i];
      if (renderAt >= a.t && renderAt <= b.t) {
        const t = b.t === a.t ? 1 : (renderAt - a.t) / (b.t - a.t);
        return {
          x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
          yaw: lerpYaw(a.yaw, b.yaw, t),
          // anim and mount always come from the same snapshot, so they never disagree.
          anim: t < 0.5 ? a.anim : b.anim,
          mount: t < 0.5 ? a.mount : b.mount,
          mode: "interpolate"
        };
      }
    }

    const last = buffer.at(-1);
    const aheadMs = Math.min(renderAt - last.t, config.maxExtrapolationMs);
    return this.#state(last, aheadMs, aheadMs < renderAt - last.t ? "hold" : "extrapolate");
  }

  #state(entry, aheadMs, mode) {
    const s = aheadMs / 1000;
    return { x: entry.x + entry.vx * s, y: entry.y, z: entry.z + entry.vz * s, yaw: entry.yaw, anim: entry.anim, mount: entry.mount ?? null, mode };
  }

  // Drop snapshots the render cursor has fully passed, keeping one anchor behind it.
  prune(nowMs) {
    const renderAt = nowMs - this.config.delayMs;
    while (this.buffer.length > 2 && this.buffer[1].t <= renderAt) this.buffer.shift();
  }
}
