// Pure remote-player model. No PlayCanvas entities: a world adapter renders `sample()` later.
// Keys by sessionId, allows one visible session per userId (newest join wins), never includes the local player.

import { ActionType, Anim, isGuestAction, mountOf, sanitizeEquipment, validateAction, validatePose, validatePresence } from "./protocol.js";
import { SnapshotInterpolator } from "./interpolation.js";

// Locomotion that interrupts an expression on a remote avatar.
const MOVING_ANIMS = new Set([Anim.WALK, Anim.RUN, Anim.FLY]);

export const RemotePresence = Object.freeze({
  PRESENT: "present",
  // Our own connection is down: keep the last known state frozen until presence reconciles.
  SUSPECT: "suspect"
});

export const REMOTE_DEFAULTS = Object.freeze({
  // Pose that arrives before its presence join is kept this long, then dropped.
  orphanPoseTtlMs: 2000,
  maxOrphanPoses: 32,
  // How long a JUMP action keeps the avatar in the air animation without waiting for a pose.
  jumpVisualMs: 600
});

const counters = () => ({
  poseAccepted: 0, poseStale: 0, poseDuplicate: 0, poseInvalid: 0, poseUnknownSession: 0, poseWrongZone: 0,
  actionAccepted: 0, actionStale: 0, actionDuplicate: 0, actionInvalid: 0, actionUnknownSession: 0, actionGuestBlocked: 0,
  presenceInvalid: 0, presenceSelf: 0, superseded: 0
});

export class RemotePlayerManager {
  constructor({ localSessionId, localUserId, interpolation = {}, config = {} }) {
    this.localSessionId = localSessionId;
    this.localUserId = localUserId;
    this.interpolation = interpolation;
    this.config = { ...REMOTE_DEFAULTS, ...config };
    this.players = new Map();
    this.orphanPoses = new Map();
    this.listeners = new Set();
    this.stats = counters();
  }

  onEvent(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  #emit(event) {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* a broken listener never breaks the model */ }
    }
    return event;
  }

  get size() { return this.players.size; }
  get(sessionId) { return this.players.get(sessionId) ?? null; }
  list() { return [...this.players.values()]; }
  inZone(placeZoneId) { return this.list().filter((p) => p.placeZoneId === placeZoneId); }

  #isSelf(presence) {
    return presence.sessionId === this.localSessionId || presence.userId === this.localUserId;
  }

  // Presence join/update. Returns the emitted event, or null when ignored.
  upsertPresence(raw, nowMs) {
    const result = validatePresence(raw);
    if (!result.ok) { this.stats.presenceInvalid += 1; return null; }
    const presence = result.presence;
    if (this.#isSelf(presence)) { this.stats.presenceSelf += 1; return null; }

    for (const other of this.players.values()) {
      if (other.userId !== presence.userId || other.sessionId === presence.sessionId) continue;
      // A reload or second tab: the newest join is the one on screen, the other is a ghost.
      const incomingIsNewer = presence.joinedAt > other.joinedAt
        || (presence.joinedAt === other.joinedAt && presence.sessionId > other.sessionId);
      if (!incomingIsNewer) { this.stats.superseded += 1; return null; }
      this.stats.superseded += 1;
      this.removePresence(other.sessionId, "superseded");
    }

    const existing = this.players.get(presence.sessionId);
    if (existing) {
      const zoneChanged = existing.placeZoneId !== presence.placeZoneId;
      Object.assign(existing, {
        displayName: presence.displayName,
        guest: presence.guest === true,
        placeZoneId: presence.placeZoneId,
        joinedAt: presence.joinedAt,
        // A Presence re-track (e.g. an equipment change) updates the same player: never a re-join.
        equipment: sanitizeEquipment(presence.equipment),
        presence: RemotePresence.PRESENT
      });
      if (zoneChanged) existing.interpolator = new SnapshotInterpolator(this.interpolation);
      return this.#emit({ type: "playerUpdated", player: existing });
    }

    const player = {
      sessionId: presence.sessionId,
      userId: presence.userId,
      displayName: presence.displayName,
      // Anonymous guest: shown and moving, but never a chat/emote sender or a social target.
      guest: presence.guest === true,
      placeZoneId: presence.placeZoneId,
      joinedAt: presence.joinedAt,
      // Visual-only, client-declared equipment (frozen, sanitized; guests always empty).
      equipment: sanitizeEquipment(presence.equipment),
      presence: RemotePresence.PRESENT,
      lastSeq: -1,
      // Poses below this sequence predate a teleport and are stale even if never seen.
      minSeq: 0,
      lastActionId: -1,
      latestPose: null,
      anim: Anim.IDLE,
      lastPoseAt: null,
      lastJumpAt: null,
      lastEmote: null,
      interpolator: new SnapshotInterpolator(this.interpolation)
    };
    this.players.set(player.sessionId, player);
    const orphan = this.orphanPoses.get(player.sessionId);
    this.orphanPoses.delete(player.sessionId);
    if (orphan && nowMs - orphan.at <= this.config.orphanPoseTtlMs) {
      this.receivePose(player.sessionId, orphan.packet, orphan.at, orphan.placeZoneId);
    }
    return this.#emit({ type: "playerJoined", player });
  }

  removePresence(sessionId, reason = "left") {
    const player = this.players.get(sessionId);
    if (!player) return null;
    this.players.delete(sessionId);
    return this.#emit({ type: "playerLeft", player, reason });
  }

  // Full zone membership from the transport ("sync"): drop anyone absent, upsert everyone present.
  // Returns how many players newly joined.
  reconcileZone(placeZoneId, presences, nowMs) {
    const present = new Set(presences.map((p) => p?.sessionId));
    for (const player of this.inZone(placeZoneId)) {
      if (!present.has(player.sessionId)) this.removePresence(player.sessionId, "left");
    }
    let joined = 0;
    for (const presence of presences) {
      if (this.upsertPresence(presence, nowMs)?.type === "playerJoined") joined += 1;
    }
    return joined;
  }

  receivePose(sessionId, packet, nowMs, placeZoneId = null) {
    const result = validatePose(packet);
    if (!result.ok) { this.stats.poseInvalid += 1; return { accepted: false, reason: result.reason }; }
    const pose = result.pose;
    const player = this.players.get(sessionId);
    if (!player) {
      if (sessionId === this.localSessionId) return { accepted: false, reason: "self" };
      this.stats.poseUnknownSession += 1;
      this.#keepOrphan(sessionId, packet, nowMs, placeZoneId);
      return { accepted: false, reason: "unknown_session" };
    }
    if (placeZoneId && placeZoneId !== player.placeZoneId) {
      this.stats.poseWrongZone += 1;
      return { accepted: false, reason: "wrong_zone" };
    }
    if (pose.seq < player.minSeq) { this.stats.poseStale += 1; return { accepted: false, reason: "stale" }; }
    if (pose.seq === player.lastSeq) { this.stats.poseDuplicate += 1; return { accepted: false, reason: "duplicate" }; }
    if (pose.seq < player.lastSeq) { this.stats.poseStale += 1; return { accepted: false, reason: "stale" }; }

    player.lastSeq = pose.seq;
    player.latestPose = pose;
    const emote = player.lastEmote;
    if (emote && emote.movedAt === null && MOVING_ANIMS.has(pose.anim)) emote.movedAt = nowMs;
    if (emote && emote.airAt === null && pose.anim === Anim.AIR) emote.airAt = nowMs;
    player.anim = pose.anim;
    player.lastPoseAt = nowMs;
    const mode = player.interpolator.push(pose, nowMs);
    this.stats.poseAccepted += 1;
    return { accepted: true, reason: mode };
  }

  #keepOrphan(sessionId, packet, nowMs, placeZoneId) {
    const existing = this.orphanPoses.get(sessionId);
    if (existing && existing.packet.seq >= packet.seq) return;
    this.orphanPoses.delete(sessionId);
    this.orphanPoses.set(sessionId, { packet, at: nowMs, placeZoneId });
    while (this.orphanPoses.size > this.config.maxOrphanPoses) {
      this.orphanPoses.delete(this.orphanPoses.keys().next().value);
    }
  }

  receiveAction(sessionId, packet, nowMs) {
    const result = validateAction(packet);
    if (!result.ok) { this.stats.actionInvalid += 1; return { accepted: false, reason: result.reason }; }
    const action = result.action;
    const player = this.players.get(sessionId);
    if (!player) { this.stats.actionUnknownSession += 1; return { accepted: false, reason: "unknown_session" }; }
    if (action.id === player.lastActionId) { this.stats.actionDuplicate += 1; return { accepted: false, reason: "duplicate" }; }
    if (action.id < player.lastActionId) { this.stats.actionStale += 1; return { accepted: false, reason: "stale" }; }
    if (player.guest && !isGuestAction(action.type)) {
      this.stats.actionGuestBlocked += 1;
      return { accepted: false, reason: "guest_not_allowed" };
    }
    player.lastActionId = action.id;

    if (action.type === ActionType.JUMP) {
      player.lastJumpAt = nowMs;
      if (player.lastEmote && player.lastEmote.airAt === null) player.lastEmote.airAt = nowMs;
    } else if (action.type === ActionType.TELEPORT) {
      const { x, y, z, yaw, poseSeq } = action.payload;
      player.lastEmote = null;
      player.interpolator.teleport({ x, y, z, yaw }, nowMs);
      // Poses sent before the teleport must not drag the avatar back.
      player.minSeq = Math.max(player.minSeq, poseSeq);
    } else if (action.type === ActionType.EMOTE) {
      // Interruptions are recorded here; presentation decides what they cancel.
      player.lastEmote = { emote: action.payload.emote, at: nowMs, movedAt: null, airAt: null };
    }
    this.stats.actionAccepted += 1;
    this.#emit({ type: "playerAction", player, action });
    return { accepted: true, reason: action.type };
  }

  // Our connection is in doubt: freeze remotes instead of deleting them.
  markAllSuspect() {
    for (const player of this.players.values()) player.presence = RemotePresence.SUSPECT;
  }

  clearZone(placeZoneId, reason = "zone_left") {
    for (const player of this.inZone(placeZoneId)) this.removePresence(player.sessionId, reason);
    for (const [sessionId, orphan] of this.orphanPoses) {
      if (orphan.placeZoneId === placeZoneId) this.orphanPoses.delete(sessionId);
    }
  }

  // Keep only players in `placeZoneId` (null keeps nobody).
  retainZone(placeZoneId, reason = "zone_left") {
    for (const player of this.list()) {
      if (player.placeZoneId !== placeZoneId) this.removePresence(player.sessionId, reason);
    }
    for (const [sessionId, orphan] of this.orphanPoses) {
      if (orphan.placeZoneId !== placeZoneId) this.orphanPoses.delete(sessionId);
    }
  }

  clearAll(reason = "offline") {
    for (const sessionId of [...this.players.keys()]) this.removePresence(sessionId, reason);
    this.orphanPoses.clear();
  }

  // Render-ready view for a future world adapter.
  sample(nowMs) {
    return this.list().map((player) => {
      player.interpolator.prune(nowMs);
      const pose = player.interpolator.sample(nowMs);
      const jumping = player.lastJumpAt !== null && nowMs - player.lastJumpAt < this.config.jumpVisualMs;
      const anim = jumping && pose?.anim !== Anim.FLY ? Anim.AIR : pose?.anim ?? player.anim;
      return {
        sessionId: player.sessionId,
        userId: player.userId,
        displayName: player.displayName,
        guest: player.guest,
        placeZoneId: player.placeZoneId,
        presence: player.presence,
        // Frozen sanitized snapshot shared read-only; a Presence update replaces it, never mutates it.
        equipment: player.equipment,
        pose,
        anim,
        // bike | dragon | null, from the same snapshot as anim (legacy FLY without mount → dragon).
        mount: mountOf(anim, pose ? pose.mount : player.latestPose?.mount),
        emote: player.lastEmote ? {
          id: player.lastEmote.emote,
          elapsedMs: nowMs - player.lastEmote.at,
          moved: player.lastEmote.movedAt !== null,
          airborne: player.lastEmote.airAt !== null
        } : null
      };
    });
  }
}
