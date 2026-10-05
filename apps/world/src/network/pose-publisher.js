// Decides when the local pose is worth sending. Pure: time comes from the caller, no timers.

import { normalizeYaw } from "./protocol.js";

export const POSE_PUBLISH_DEFAULTS = Object.freeze({
  // 250 ms floor → at most 4 Hz; frame quantisation lands a moving player at ~3.75 Hz on 60 fps.
  minIntervalMs: 250,
  minDistanceM: 0.15,
  minYawDeg: 8
});

export function yawDelta(a, b) {
  return Math.abs(normalizeYaw(a - b));
}

export class PosePublisher {
  constructor(config = {}) {
    this.config = { ...POSE_PUBLISH_DEFAULTS, ...config };
    this.last = null;
    this.lastSentAt = -Infinity;
    this.forced = false;
  }

  // Next evaluation sends regardless of thresholds or rate (join, teleport, reconnect, new peer).
  forceSnapshot() {
    this.forced = true;
  }

  reset() {
    this.last = null;
    this.lastSentAt = -Infinity;
    this.forced = false;
  }

  // Returns the reason to send, or null to stay quiet.
  evaluate(nowMs, sample) {
    if (this.forced || !this.last) return this.forced ? "forced" : "first";
    if (nowMs - this.lastSentAt < this.config.minIntervalMs) return null;
    const { last, config } = this;
    if (sample.anim !== last.anim || (sample.mount ?? null) !== last.mount) return "anim";
    if (Math.hypot(sample.x - last.x, sample.y - last.y, sample.z - last.z) > config.minDistanceM) return "moved";
    if (yawDelta(sample.yaw, last.yaw) > config.minYawDeg) return "turned";
    return null;
  }

  markSent(nowMs, sample) {
    this.last = { x: sample.x, y: sample.y, z: sample.z, yaw: sample.yaw, anim: sample.anim, mount: sample.mount ?? null };
    this.lastSentAt = nowMs;
    this.forced = false;
  }
}
