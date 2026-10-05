// Social S1-C2 · 같이 가기 (Follow). Pure and engine-free: every dependency is injected, so Node
// tests drive it with fakes.
//
// Contract
// - Only accepted friends, never self, guests, blocked or unavailable players (followEligibility).
// - The target is a user UUID. Each frame resolves that user's CURRENT session from Presence
//   (one visible session per user), so a reload that supersedes the old session keeps following.
// - Follow is a local, ephemeral assist: it asks PlayerController for a world-space movement
//   intent and never writes the player position. Collision, terrain, stairs, pond and world
//   bounds stay with PlayerController. No DB state, no new network field or event.
// - Start moving beyond FOLLOW_START_DISTANCE_METERS, stop inside FOLLOW_STOP_DISTANCE_METERS,
//   keep the current moving/holding state in between (hysteresis, no jitter).
// - Human input wins: move keys, joystick, jump or mounting cancel at once. Sitting, emotes, a
//   Place Zone change on either side, the target leaving or teleporting, our connection dropping,
//   the friendship ending and getting stuck behind an obstacle also cancel. Nothing auto-resumes.

import { Relationship } from "./social-client.js";
import { metersToWorld, worldToMeters } from "../world-scale.js";

export const FOLLOW_START_DISTANCE_METERS = 2;
export const FOLLOW_STOP_DISTANCE_METERS = 1.5;
// Beyond this gap (or when the friend runs) the follower uses the normal sprint speed.
export const FOLLOW_CATCHUP_DISTANCE_METERS = 6;
// Actively moving but less progress than this within FOLLOW_STUCK_MS → blocked, stop.
export const FOLLOW_STUCK_MS = 2500;
export const FOLLOW_STUCK_PROGRESS_METERS = 0.5;
// A single-step jump of the friend's sampled position larger than this is a teleport.
export const FOLLOW_TELEPORT_JUMP_METERS = 16;
// While following, re-read the relationship from the database this often.
export const FOLLOW_RELATIONSHIP_RECHECK_MS = 15000;
export const ACCOMPANY_ZONE_GRACE_MS = 6000;

// Context Action (#140) priority: NPC dialogue 300 > seat 260–280 > Follow stop > mount 100–120.
export const FOLLOW_CONTEXT_PRIORITY = 200;

// Short feedback for stops the player did not cause. Never says who blocked whom.
export const FOLLOW_STOP_MESSAGES = Object.freeze({
  stuck: "길이 막혀 같이 가기를 멈췄어요.",
  target_left: "친구를 놓쳐 같이 가기를 멈췄어요.",
  target_zone: "친구를 놓쳐 같이 가기를 멈췄어요.",
  teleport: "친구를 놓쳐 같이 가기를 멈췄어요.",
  offline: "연결이 끊겨 같이 가기를 멈췄어요.",
  relationship: "같이 가기를 멈췄어요."
});

export const FollowState = Object.freeze({ IDLE: "idle", FOLLOWING: "following" });

export const FollowStopReason = Object.freeze({
  EXPLICIT: "explicit", REPLACED: "replaced", MANUAL: "manual", JUMP: "jump", MOUNT: "mount",
  SIT: "sit", EMOTE: "emote", TARGET_LEFT: "target_left", TARGET_ZONE: "target_zone",
  LOCAL_ZONE: "local_zone", TELEPORT: "teleport", OFFLINE: "offline", RELATIONSHIP: "relationship",
  BLOCKED: "blocked", STUCK: "stuck", ROOM: "room"
});

// Whether `userId` may be followed right now. Returns { ok, reason }.
export function followEligibility({ userId, selfUserId, signedIn, relationship, mounted = false, target = null, localPlaceZoneId = null }) {
  if (!signedIn || !selfUserId) return { ok: false, reason: "signed_out" };
  if (!userId || userId === selfUserId) return { ok: false, reason: "self" };
  if (relationship !== Relationship.FRIENDS) return { ok: false, reason: "not_friends" };
  if (mounted) return { ok: false, reason: "mounted" };
  if (!target || target.presence !== "present" || !target.pose) return { ok: false, reason: "not_present" };
  if (!localPlaceZoneId || target.placeZoneId !== localPlaceZoneId) return { ok: false, reason: "other_zone" };
  return { ok: true, reason: null };
}

const horizontal = (a, b) => Math.hypot(b.x - a.x, b.z - a.z);

export class FollowController {
  constructor({
    clock = { now: () => Date.now() },
    // (userId) → { userId, sessionId, placeZoneId, presence, anim, pose: { x, y, z } } | null
    getTarget,
    getLocalPosition,
    getLocalPlaceZoneId,
    isNetworkOnline,
    // (userId) → { ok, reason } — see followEligibility.
    canFollow,
    // → { move, jump, mount } from human input only (never from the assist).
    manualIntent,
    isSeated = () => false,
    // PlayerController assisted movement: set({ x, z, sprint }) world-space unit vector; clear().
    assist,
    // (userId) → Promise<boolean> still friends; optional low-frequency database re-check.
    checkRelationship = null
  }) {
    Object.assign(this, { clock, getTarget, getLocalPosition, getLocalPlaceZoneId, isNetworkOnline,
      canFollow, manualIntent, isSeated, assist, checkRelationship });
    this.state = FollowState.IDLE;
    this.targetUserId = null;
    this.moving = false;
    this.formation = false;
    this.tripMode = false;
    this.listeners = new Set();
    this.lastStop = null;
    this.stats = { started: 0, stopped: 0 };
    this.#reset();
  }

  #reset() {
    this.zone = null;
    this.lastTargetPos = null;
    this.heading = null;
    this.zoneLostSince = null;
    this.teleported = false;
    this.checkpoint = null;
    this.lastCheckAt = 0;
    this.epoch = (this.epoch ?? 0) + 1;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  #emit(reason) {
    for (const listener of this.listeners) {
      try { listener(this.status(), reason); } catch { /* a broken listener never breaks Follow */ }
    }
  }

  get active() { return this.state === FollowState.FOLLOWING; }
  isFollowing(userId) { return this.active && this.targetUserId === userId; }

  start(userId, { formation = false } = {}) {
    const verdict = this.canFollow(userId) ?? { ok: false, reason: "unknown" };
    if (!verdict.ok) return verdict;
    if (this.active && this.targetUserId !== userId) this.stop(FollowStopReason.REPLACED, { silent: true });
    if (this.isFollowing(userId)) { this.formation = formation; this.tripMode = formation; return { ok: true, reason: null }; }
    this.#reset();
    this.state = FollowState.FOLLOWING;
    this.targetUserId = userId;
    this.moving = false;
    this.formation = formation;
    this.tripMode = formation;
    this.zone = this.getLocalPlaceZoneId();
    this.lastCheckAt = this.clock.now();
    this.lastStop = null;
    this.stats.started += 1;
    this.#emit("start");
    return { ok: true, reason: null };
  }

  stop(reason = FollowStopReason.EXPLICIT, { silent = false } = {}) {
    if (!this.active) return false;
    this.assist.clear();
    const userId = this.targetUserId;
    this.state = FollowState.IDLE;
    this.targetUserId = null;
    this.moving = false;
    this.formation = false;
    this.tripMode = false;
    this.#reset();
    this.lastStop = { reason, userId };
    this.stats.stopped += 1;
    if (!silent) this.#emit(reason);
    return true;
  }

  toggle(userId) {
    if (this.isFollowing(userId)) { this.stop(FollowStopReason.EXPLICIT); return { ok: true, following: false }; }
    const result = this.start(userId);
    return { ...result, following: result.ok };
  }

  // The friend's session announced a TELEPORT action.
  notifyTeleport(userId) {
    if (this.isFollowing(userId)) this.teleported = true;
  }

  // Once per frame, BEFORE PlayerController.update.
  update() {
    if (!this.active) return this.status();
    const intent = this.manualIntent() ?? {};
    if (intent.mount) return this.#halt(FollowStopReason.MOUNT);
    if (intent.jump) return this.#halt(FollowStopReason.JUMP);
    if (intent.move) return this.#halt(FollowStopReason.MANUAL);
    if (this.isSeated()) return this.#halt(FollowStopReason.SIT);
    // A consented journey may cross a Place Zone boundary. The leader can briefly disappear
    // while both clients switch channels; continue toward the last visible point for six seconds.
    const zone = this.getLocalPlaceZoneId();
    if (!zone) return this.#halt(FollowStopReason.LOCAL_ZONE);
    if (zone !== this.zone) {
      if (!this.tripMode) return this.#halt(FollowStopReason.LOCAL_ZONE);
      this.zone = zone;
      this.zoneLostSince ??= this.clock.now();
    }
    if (this.teleported) return this.#halt(FollowStopReason.TELEPORT);
    if (!this.isNetworkOnline()) return this.tripMode ? this.#waitForZone(FollowStopReason.OFFLINE) : this.#halt(FollowStopReason.OFFLINE);
    const target = this.getTarget(this.targetUserId);
    if (!target || target.presence !== "present" || !target.pose) {
      return this.tripMode ? this.#waitForZone(FollowStopReason.TARGET_LEFT) : this.#halt(FollowStopReason.TARGET_LEFT);
    }
    if (target.placeZoneId !== zone) {
      return this.tripMode ? this.#waitForZone(FollowStopReason.TARGET_ZONE) : this.#halt(FollowStopReason.TARGET_ZONE);
    }
    const tp = target.pose;
    if (!this.zoneLostSince && this.lastTargetPos && worldToMeters(Math.hypot(tp.x - this.lastTargetPos.x, tp.y - this.lastTargetPos.y, tp.z - this.lastTargetPos.z)) > FOLLOW_TELEPORT_JUMP_METERS) {
      return this.#halt(FollowStopReason.TELEPORT);
    }
    this.zoneLostSince = null;
    const previousTarget = this.lastTargetPos;
    this.lastTargetPos = { x: tp.x, y: tp.y, z: tp.z };
    this.#maybeRecheck();

    const me = this.getLocalPosition();
    // A consented trip aims slightly beside and behind the leader. Ordinary friend Follow keeps
    // its original centre target. If the leader stands still we preserve the last heading.
    let aim = tp;
    if (this.formation) {
      const dx = previousTarget ? tp.x - previousTarget.x : 0;
      const dz = previousTarget ? tp.z - previousTarget.z : 0;
      if (Math.hypot(dx, dz) > 0.02) this.heading = { x: dx / Math.hypot(dx, dz), z: dz / Math.hypot(dx, dz) };
      if (this.heading) {
        aim = { x: tp.x + this.heading.z * metersToWorld(1.2) - this.heading.x * metersToWorld(0.5),
          z: tp.z - this.heading.x * metersToWorld(1.2) - this.heading.z * metersToWorld(0.5) };
      }
    }
    const gapUnits = horizontal(me, aim);
    const gap = worldToMeters(gapUnits);
    if (!this.moving && gap > FOLLOW_START_DISTANCE_METERS) this.moving = true;
    else if (this.moving && gap <= FOLLOW_STOP_DISTANCE_METERS) this.moving = false;

    if (!this.moving) {
      this.assist.clear();
      this.checkpoint = null;
      return this.status();
    }
    const now = this.clock.now();
    if (!this.checkpoint || horizontal(this.checkpoint, me) >= metersToWorld(FOLLOW_STUCK_PROGRESS_METERS)) {
      this.checkpoint = { x: me.x, z: me.z, at: now };
    } else if (now - this.checkpoint.at >= FOLLOW_STUCK_MS) {
      if (this.formation) {
        // The side slot may be blocked by a curb or planter; retry once at the usual centre.
        this.formation = false;
        this.checkpoint = { x: me.x, z: me.z, at: now };
        return this.status();
      }
      return this.#halt(FollowStopReason.STUCK);
    }
    const sprint = target.anim === "run" || gap > FOLLOW_CATCHUP_DISTANCE_METERS;
    this.assist.set({ x: (aim.x - me.x) / gapUnits, z: (aim.z - me.z) / gapUnits, sprint });
    return this.status();
  }

  #halt(reason) {
    this.stop(reason);
    return this.status();
  }

  #waitForZone(reason) {
    const now = this.clock.now();
    this.zoneLostSince ??= now;
    if (now - this.zoneLostSince >= ACCOMPANY_ZONE_GRACE_MS) return this.#halt(reason);
    const me = this.getLocalPosition();
    const last = this.lastTargetPos;
    const gap = last ? horizontal(me, last) : 0;
    if (gap > metersToWorld(FOLLOW_STOP_DISTANCE_METERS)) {
      this.assist.set({ x: (last.x - me.x) / gap, z: (last.z - me.z) / gap, sprint: false });
    } else this.assist.clear();
    return this.status();
  }

  #maybeRecheck() {
    if (!this.checkRelationship) return;
    const now = this.clock.now();
    if (now - this.lastCheckAt < FOLLOW_RELATIONSHIP_RECHECK_MS) return;
    this.lastCheckAt = now;
    const epoch = this.epoch;
    const userId = this.targetUserId;
    Promise.resolve()
      .then(() => this.checkRelationship(userId))
      .then((stillFriends) => {
        if (stillFriends === false && this.epoch === epoch && this.isFollowing(userId)) this.stop(FollowStopReason.RELATIONSHIP);
      })
      .catch(() => { /* a failed check keeps following; the next one retries */ });
  }

  status() {
    return {
      state: this.state,
      targetUserId: this.targetUserId,
      moving: this.moving,
      lastStop: this.lastStop
    };
  }
}
