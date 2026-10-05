// Social S1-B1 expression: five emotes, their timing, local control and the procedural pose used
// by both the local and remote character. Engine-free; the character model applies the offsets.
//
// Priority (highest first): teleport / lifecycle  >  locomotion (walk, run, jump, mount)  >  emote.
// Emotes never own movement: they observe PlayerController state and step aside.

import { EMOTE_IDS, isValidEmoteId } from "../network/protocol.js";

export { EMOTE_IDS, isValidEmoteId };

// durationMs: one-shot length; dance loops until cancelled but is capped so a lost cancel can
// never leave a remote avatar dancing forever. airborneOk: may continue through a jump.
export const EMOTES = Object.freeze({
  wave: Object.freeze({ id: "wave", label: "인사", emoji: "👋", key: "Digit1", durationMs: 1600, airborneOk: true }),
  clap: Object.freeze({ id: "clap", label: "박수", emoji: "👏", key: "Digit2", durationMs: 1800, airborneOk: true }),
  laugh: Object.freeze({ id: "laugh", label: "웃기", emoji: "😆", key: "Digit3", durationMs: 1700, airborneOk: true }),
  dance: Object.freeze({ id: "dance", label: "춤", emoji: "💃", key: "Digit4", durationMs: 12000, airborneOk: false, loop: true }),
  photo_pose: Object.freeze({ id: "photo_pose", label: "사진 포즈", emoji: "📸", key: "Digit5", durationMs: 4000, airborneOk: false })
});

// Minimum time between two emote starts: bounds Broadcast volume (≤ 1 action/s per player).
export const EMOTE_COOLDOWN_MS = 1000;
// Blend in/out so an emote never pops the pose.
export const EMOTE_BLEND_MS = 150;

// Remote/local rule in one place: is an emote still visible at `elapsedMs`?
export function emoteIsActive({ id, elapsedMs, moved = false, airborne = false }) {
  const def = EMOTES[id];
  if (!def || elapsedMs < 0 || elapsedMs >= def.durationMs) return false;
  if (moved) return false;
  if (airborne && !def.airborneOk) return false;
  return true;
}

// Degrees and world units added on top of the locomotion pose. All zero = rest pose.
export const REST_OFFSETS = Object.freeze({
  bodyY: 0, bodyPitch: 0, bodyYaw: 0, bodyRoll: 0,
  wingL: Object.freeze([0, 0, 0]), wingR: Object.freeze([0, 0, 0]),
  legL: 0, legR: 0
});

const rad = (hz, t) => (t / 1000) * hz * Math.PI * 2;

// Pure function of (emote, elapsed): identical on every client for the same action.
// Wing angles are [x, y, z] Euler deltas; wing index 0 is the left wing (base z = +22°).
export function emoteOffsets(id, elapsedMs) {
  const def = EMOTES[id];
  if (!def || elapsedMs < 0 || elapsedMs >= def.durationMs) return REST_OFFSETS;
  const t = elapsedMs;
  const blendIn = Math.min(1, t / EMOTE_BLEND_MS);
  const blendOut = def.loop ? 1 : Math.min(1, (def.durationMs - t) / EMOTE_BLEND_MS);
  const w = Math.max(0, Math.min(blendIn, blendOut));
  const s = (v) => v * w;
  switch (id) {
    case "wave": {
      // Right wing lifted high, waving side to side.
      const swing = Math.sin(rad(2.2, t)) * 28;
      return { ...REST_OFFSETS, bodyRoll: s(4), wingL: [0, 0, 0], wingR: [0, 0, s(-118 + swing)] };
    }
    case "clap": {
      // Both wings forward, meeting in front of the chest.
      const beat = (Math.sin(rad(3.2, t)) + 1) / 2;
      return { ...REST_OFFSETS, bodyPitch: s(-4), wingL: [0, s(-55 - 30 * beat), s(-40)], wingR: [0, s(55 + 30 * beat), s(40)] };
    }
    case "laugh": {
      // Head-back bounce with shaking wings.
      const bounce = Math.abs(Math.sin(rad(4.5, t)));
      const shake = Math.sin(rad(9, t)) * 10;
      return { ...REST_OFFSETS, bodyY: s(0.05 * bounce), bodyPitch: s(-12), wingL: [0, 0, s(18 + shake)], wingR: [0, 0, s(-18 - shake)] };
    }
    case "dance": {
      // Hip sway, hop and alternating wing / leg beats.
      const beat = Math.sin(rad(2, t));
      return {
        ...REST_OFFSETS,
        bodyY: s(0.045 * Math.abs(Math.sin(rad(4, t)))),
        bodyYaw: s(24 * beat), bodyRoll: s(9 * beat),
        wingL: [0, 0, s(-70 + 45 * beat)], wingR: [0, 0, s(70 + 45 * beat)],
        legL: s(18 * beat), legR: s(-18 * beat)
      };
    }
    case "photo_pose": {
      // Ease into a held V-sign: right wing up, left wing on hip, slight tilt.
      const hold = Math.min(1, t / 300);
      return { ...REST_OFFSETS, bodyRoll: s(-9 * hold), bodyYaw: s(12 * hold), wingL: [0, 0, s(-30 * hold)], wingR: [0, 0, s(-132 * hold)] };
    }
    default:
      return REST_OFFSETS;
  }
}

// Local emote state for the player's own avatar. Movement, jumps (for incompatible emotes) and
// mounting cancel; the controller never touches physics. `send(id)` is the network hook and may
// return false (guest/offline): the local expression still plays.
export class EmoteController {
  constructor({ clock, send = () => false, cooldownMs = EMOTE_COOLDOWN_MS } = {}) {
    this.clock = clock;
    this.send = send;
    this.cooldownMs = cooldownMs;
    this.current = null; // { id, startedAt }
    this.lastStartAt = -Infinity;
    this.listeners = new Set();
    this.stats = { started: 0, sent: 0, rejected: 0, throttled: 0, cancelled: 0, finished: 0 };
  }

  onChange(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  #emit(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* UI listeners never break emotes */ }
    }
  }

  // Returns "started" | "invalid" | "cooldown" | "busy" (moving, airborne or mounted).
  request(id, locomotion = {}) {
    const now = this.clock.now();
    if (!isValidEmoteId(id)) { this.stats.rejected += 1; return "invalid"; }
    if (locomotion.moving || locomotion.mounted || locomotion.grounded === false) { this.stats.rejected += 1; return "busy"; }
    if (now - this.lastStartAt < this.cooldownMs) { this.stats.throttled += 1; this.#emit({ type: "cooldown", id }); return "cooldown"; }
    this.lastStartAt = now;
    this.current = { id, startedAt: now };
    this.stats.started += 1;
    // Local first: the network is told afterwards and never delays the expression.
    let sent = false;
    try { sent = this.send(id) === true; } catch { sent = false; }
    if (sent) this.stats.sent += 1;
    this.#emit({ type: "start", id, sent });
    return "started";
  }

  cancel(reason = "cancel") {
    if (!this.current) return false;
    const { id } = this.current;
    this.current = null;
    this.stats.cancelled += 1;
    this.#emit({ type: "end", id, reason });
    return true;
  }

  // Call once per frame after PlayerController.update.
  update({ moving = false, grounded = true, mounted = false } = {}) {
    if (!this.current) return null;
    const def = EMOTES[this.current.id];
    if (moving) { this.cancel("move"); return null; }
    if (mounted) { this.cancel("mount"); return null; }
    if (!grounded && !def.airborneOk) { this.cancel("jump"); return null; }
    const elapsedMs = this.clock.now() - this.current.startedAt;
    if (elapsedMs >= def.durationMs) {
      const { id } = this.current;
      this.current = null;
      this.stats.finished += 1;
      this.#emit({ type: "end", id, reason: "finished" });
      return null;
    }
    return { id: this.current.id, elapsedMs };
  }

  get active() {
    return this.current ? { id: this.current.id, elapsedMs: this.clock.now() - this.current.startedAt } : null;
  }
}

// Locomotion pose + emote offsets → final pose. Pure, so "back to rest" is exact: with
// REST_OFFSETS the result equals the locomotion pose field for field.
export function composeEmotePose(base, offsets = REST_OFFSETS) {
  const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  return {
    bodyY: base.bodyY + offsets.bodyY,
    bodyEuler: add3(base.bodyEuler, [offsets.bodyPitch, offsets.bodyYaw, offsets.bodyRoll]),
    wings: [add3(base.wings[0], offsets.wingL), add3(base.wings[1], offsets.wingR)],
    legs: [base.legs[0] + offsets.legL, base.legs[1] + offsets.legR]
  };
}
