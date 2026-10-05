import { Relationship } from "./social-client.js";
import { ACCOMPANY_POIS } from "./accompany-client.js";
import { worldToMeters } from "../world-scale.js";
import { ACCOMPANY_ZONE_GRACE_MS, FOLLOW_TELEPORT_JUMP_METERS } from "./follow-controller.js";

const POI_NAMES = new Map(ACCOMPANY_POIS);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Server owns consent; this controller owns only local guidance and assisted movement.
export class AccompanyController {
  constructor({ client, getSelfUserId, getZoneId, getRemote, getPosition, getMounted, getSeated = () => false,
    relationshipOf, verifyFriend, follow, prepareFollow = () => {}, resolveTarget, navigation,
    notify = () => {}, clock = { now: () => Date.now() } }) {
    Object.assign(this, { client, getSelfUserId, getZoneId, getRemote, getPosition, getMounted, getSeated,
      relationshipOf, verifyFriend, follow, prepareFollow, resolveTarget, navigation, notify, clock });
    this.session = null;
    this.target = null;
    this.priorDestination = null;
    this.arrivalSince = null;
    this.peerMissingSince = null;
    this.lastLocalPos = null;
    this.ignoredId = null;
    this.pendingEndId = null;
    this.ending = false;
    this.loading = false;
    this.listeners = new Set();
    this.lastPollAt = -Infinity;
    this.epoch = 0;
  }
  onChange(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  #emit() { for (const listener of this.listeners) { try { listener(this.status()); } catch { /* UI is best effort */ } } }
  status() { return { session: this.session, target: this.target, loading: this.loading,
    canRestore: !!this.priorDestination && !this.session }; }
  get active() { return this.session?.state === "active"; }
  get offered() { return this.session?.state === "offered"; }
  get peerId() { return this.session?.peerId ?? null; }
  get poiName() { return POI_NAMES.get(this.session?.poiId) ?? "목적지"; }

  canPropose(userId) {
    const remote = this.getRemote(userId);
    return !!this.getSelfUserId() && !this.session && this.relationshipOf(userId) === Relationship.FRIENDS
      && !this.getMounted() && !this.getSeated() && !!this.getZoneId() && remote?.presence === "present"
      && remote.placeZoneId === this.getZoneId() && !["fly", "sit"].includes(remote.anim) && !!remote.pose
      && worldToMeters(distance(this.getPosition(), remote.pose)) <= 15;
  }
  async propose(userId, poiId) {
    if (!this.canPropose(userId) || !this.resolveTarget(poiId)) return false;
    await this.client.propose(userId, poiId, this.getZoneId());
    await this.refresh();
    return true;
  }
  async respond(accept) {
    const s = this.session;
    if (!s || s.state !== "offered" || s.inviteeId !== this.getSelfUserId()) return false;
    if (accept && (!this.resolveTarget(s.poiId) || !this.#sameZonePeer(s)
      || worldToMeters(distance(this.getPosition(), this.getRemote(s.peerId).pose)) > 15)) return false;
    await this.client.respond(s.id, accept);
    if (!accept) this.#clear("declined");
    await this.refresh();
    return true;
  }
  async end(reason = "participant") {
    const s = this.session;
    if (!s) return false;
    this.ignoredId = s.id;
    this.pendingEndId = s.id;
    this.#clear(reason);
    await this.#flushEnd();
    return true;
  }
  async #flushEnd() {
    if (!this.pendingEndId || this.ending) return;
    const id = this.pendingEndId;
    this.ending = true;
    try { await this.client.end(id); if (this.pendingEndId === id) this.pendingEndId = null; }
    catch { /* retry on the next poll, without restarting local movement */ }
    finally { this.ending = false; }
  }
  reset() {
    this.epoch += 1;
    this.ignoredId = null;
    this.pendingEndId = null;
    this.priorDestination = null;
    this.#clear("reset");
    this.#emit();
  }
  #clear(reason) {
    if (this.session && this.follow.isFollowing(this.session.peerId)) {
      this.follow.stop("explicit", { silent: true });
    }
    if (this.target && this.navigation.snapshot()?.destination?.id === this.target.id) {
      this.navigation.clear();
    }
    const had = !!this.session;
    this.session = null; this.target = null; this.arrivalSince = null; this.peerMissingSince = null;
    this.lastLocalPos = null;
    if (had) { this.#emit(); if (reason === "arrived") this.notify("함께 목적지에 도착했어요."); }
  }
  #sameZonePeer(s) {
    const remote = this.getRemote(s.peerId);
    return !!this.getZoneId() && !!remote?.pose && remote.presence === "present"
      && remote.placeZoneId === this.getZoneId()
      && (s.state === "active" || s.placeZoneId === this.getZoneId())
      && !["fly", "sit"].includes(remote.anim);
  }
  async refresh() {
    if (!this.getSelfUserId() || this.loading) return false;
    this.loading = true;
    const epoch = this.epoch;
    try {
      const sessions = await this.client.mine();
      if (epoch !== this.epoch) return false;
      const next = sessions.find(s => s.id !== this.ignoredId && s.state === "active")
        ?? sessions.find(s => s.id !== this.ignoredId && s.state === "offered") ?? null;
      if (!sessions.some(s => s.id === this.ignoredId)) this.ignoredId = null;
      if (!next) { if (this.session) this.#clear("ended"); return true; }
      if (!this.#sameZonePeer(next)) {
        if (next.state === "offered" && this.session?.id === next.id) void this.end("peer_left");
        return false;
      }
      if (next.state === "active" && (!this.session || this.session.id !== next.id || this.session.state !== "active")) {
        if ((await this.verifyFriend(next.peerId)) !== true) { void this.client.end(next.id); return false; }
        const target = this.resolveTarget(next.poiId);
        if (!target) { void this.client.end(next.id); return false; }
        this.priorDestination = this.navigation.snapshot()?.destination ?? null;
        this.target = target;
        const position = this.getPosition();
        this.lastLocalPos = { x: position.x, z: position.z };
        this.navigation.set(target);
        if (next.inviterId === this.getSelfUserId() && this.follow.active) this.follow.stop("replaced");
        if (next.inviteeId === this.getSelfUserId()) {
          this.prepareFollow();
          const result = this.follow.start(next.peerId, { formation: true });
          if (!result.ok) { void this.client.end(next.id); this.target = null; return false; }
        }
      }
      this.session = next;
      this.#emit();
      return true;
    } catch { return false; }
    finally { this.loading = false; }
  }
  update() {
    const now = this.clock.now();
    if (now - this.lastPollAt >= 5000) {
      this.lastPollAt = now;
      void this.#flushEnd();
      void this.refresh();
    }
    const s = this.session;
    if (!s) return;
    if (now >= s.expiresAt || this.getMounted() || this.getSeated() || !this.getZoneId()) {
      void this.end("unavailable"); return;
    }
    if (s.state === "active") {
      const current = this.getPosition();
      if (this.lastLocalPos && worldToMeters(distance(this.lastLocalPos, current)) > FOLLOW_TELEPORT_JUMP_METERS) {
        void this.end("teleport"); return;
      }
      this.lastLocalPos = { x: current.x, z: current.z };
    }
    if (!this.#sameZonePeer(s)) {
      if (s.state !== "active") { void this.end("peer_left"); return; }
      this.peerMissingSince ??= now;
      if (now - this.peerMissingSince >= ACCOMPANY_ZONE_GRACE_MS) void this.end("peer_left");
      return;
    }
    this.peerMissingSince = null;
    if (s.state !== "active" || !this.target) return;
    if (s.inviteeId === this.getSelfUserId() && !this.follow.isFollowing(s.peerId)) { void this.end("interrupted"); return; }
    if (this.navigation.snapshot()?.destination?.id !== this.target.id) { void this.end("navigation_changed"); return; }
    const peer = this.getRemote(s.peerId);
    const me = this.getPosition();
    const here = distance(me, this.target.approach) <= this.target.arrivalRadius;
    const there = distance(peer.pose, this.target.approach) <= this.target.arrivalRadius;
    if (here && there) {
      this.arrivalSince ??= now;
      if (now - this.arrivalSince >= 2000) void this.end("arrived");
    } else this.arrivalSince = null;
  }
  restorePrior() {
    if (!this.priorDestination) return false;
    this.navigation.set(this.priorDestination);
    this.priorDestination = null;
    this.#emit();
    return true;
  }
}
