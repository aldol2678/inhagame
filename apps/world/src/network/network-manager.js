// Online P0 orchestrator: connection state, place-zone membership, presence, pose/action publishing
// and the remote-player model, behind a transport-agnostic NetworkTransport.
//
// Ownership rule: the local player belongs to PlayerController. This class only reads plain pose
// samples handed to update() and never holds, pauses or moves the controller. Every transport call
// is contained, so a failing network can at worst stop remote updates — never local play.

import { ConnectionState, ConnectionStateMachine } from "./connection-state.js";
import { ActionType, buildPresence, encodeAction, encodePose, equipmentKey, isGuestAction, isValidId, isValidPlaceZoneId,
  sanitizeEquipment, validateAction, validatePose } from "./protocol.js";
import { PosePublisher } from "./pose-publisher.js";
import { RemotePlayerManager } from "./remote-player-manager.js";
import { TransportStatus, assertNetworkTransport } from "./transport.js";
import { findPrivateDataViolations } from "./privacy.js";

export class NetworkManager {
  constructor({ transport, clock, identity, credentials = null, retry, publish, interpolation, remote } = {}) {
    if (!isValidId(identity?.sessionId) || !isValidId(identity?.userId)) {
      throw new TypeError("NetworkManager needs identity.sessionId and identity.userId");
    }
    this.transport = assertNetworkTransport(transport);
    this.clock = clock;
    // Copy only public identity; the caller may pass a full auth user/session object.
    this.identity = { sessionId: identity.sessionId, userId: identity.userId, displayName: identity.displayName };
    // An anonymous guest session may only move and jump (see GUEST_ACTION_TYPES).
    this.guest = identity.guest === true;
    this.credentials = credentials;
    this.connection = new ConnectionStateMachine({ retry });
    this.publisher = new PosePublisher(publish);
    this.remotes = new RemotePlayerManager({
      localSessionId: identity.sessionId, localUserId: identity.userId, interpolation, config: remote
    });
    this.desiredPlaceZoneId = null;
    this.joinedPlaceZoneId = null;
    this.joinedAt = null;
    this.poseSeq = 0;
    this.actionId = 0;
    this.connectDeadline = null;
    this.errors = [];
    // Multiplayer Equipment Projection P0: the public, visual-only equipment carried by our Presence.
    // Not game authority; the world hands it in from the server loadout read. Guests never carry one.
    this.equipment = sanitizeEquipment(null);
    this.equipmentKey = "";
    // presence = every join + republish; equipment = the republishes caused by an equipment change.
    this.sent = { pose: 0, action: 0, presence: 0, equipment: 0 };
    this.unsubscribes = [];
    this.stateListeners = new Set();
    this.connection.onChange((change) => this.#onStateChange(change));
  }

  get state() { return this.connection.state; }
  get isOnline() { return this.connection.state === ConnectionState.ONLINE; }
  get placeZoneId() { return this.desiredPlaceZoneId; }
  get isGuest() { return this.guest; }
  // HUD "● ONLINE · N명": remotes in our place zone plus ourselves.
  get onlineCount() {
    return this.isOnline && this.joinedPlaceZoneId ? this.remotes.inZone(this.joinedPlaceZoneId).length + 1 : 0;
  }

  onStateChange(handler) {
    this.stateListeners.add(handler);
    return () => this.stateListeners.delete(handler);
  }

  onRemoteEvent(handler) {
    return this.remotes.onEvent(handler);
  }

  #now() { return this.clock.now(); }

  // Contain every transport call: sync throws and async rejections are recorded, never rethrown.
  #call(method, ...args) {
    try {
      const result = this.transport[method](...args);
      if (result && typeof result.then === "function") {
        result.then(undefined, (error) => this.#recordError(method, error));
      }
      return true;
    } catch (error) {
      this.#recordError(method, error);
      return false;
    }
  }

  #recordError(method, error) {
    this.errors.push({ method, message: String(error?.message ?? error), at: this.#now() });
    if (this.errors.length > 50) this.errors.shift();
  }

  start() {
    if (!this.connection.start(this.#now())) return false;
    if (!this.unsubscribes.length) this.#subscribe();
    this.#attemptConnect();
    return true;
  }

  stop() {
    const wasJoined = this.joinedPlaceZoneId;
    if (wasJoined) this.#call("leavePlaceZone", wasJoined);
    this.joinedPlaceZoneId = null;
    this.connectDeadline = null;
    this.connection.stop(this.#now());
    this.#call("disconnect");
    this.remotes.clearAll("offline");
    for (const unsubscribe of this.unsubscribes.splice(0)) {
      try { unsubscribe?.(); } catch { /* ignore */ }
    }
  }

  #subscribe() {
    const wrap = (fn) => (event) => {
      try { fn(event); } catch (error) { this.#recordError("handler", error); }
    };
    for (const [method, handler] of [
      ["subscribeStatus", wrap((event) => this.#onStatus(event))],
      ["subscribePresence", wrap((event) => this.#onPresence(event))],
      ["subscribePose", wrap((event) => this.#onPose(event))],
      ["subscribeAction", wrap((event) => this.#onAction(event))]
    ]) {
      try { this.unsubscribes.push(this.transport[method](handler)); } catch (error) { this.#recordError(method, error); }
    }
  }

  #attemptConnect() {
    this.connectDeadline = this.#now() + this.connection.retry.connectTimeoutMs;
    if (!this.#call("connect", { sessionId: this.identity.sessionId, credentials: this.credentials })) {
      this.#connectionLost();
    }
  }

  #connectionLost() {
    this.connectDeadline = null;
    this.joinedPlaceZoneId = null;
    this.connection.lost(this.#now());
  }

  #onStatus({ status } = {}) {
    const state = this.connection.state;
    if (status === TransportStatus.CONNECTED) {
      if (state !== ConnectionState.CONNECTING && state !== ConnectionState.RECONNECTING) return;
      this.connectDeadline = null;
      // Retries reset only after the zone syncs, so connect-then-fail cannot loop forever.
      this.connection.connected(this.#now(), { resetRetries: false });
      this.#joinDesiredZone();
    } else if (status === TransportStatus.DISCONNECTED || status === TransportStatus.ERROR) {
      if (state === ConnectionState.OFFLINE) return;
      // A failure report for an attempt already timed out and rescheduled is not a new failure.
      if (state === ConnectionState.RECONNECTING && this.connectDeadline === null) return;
      this.#connectionLost();
    }
  }

  #onStateChange(change) {
    if (change.state === ConnectionState.RECONNECTING) this.remotes.markAllSuspect();
    if (change.state === ConnectionState.OFFLINE) this.remotes.clearAll("offline");
    for (const listener of this.stateListeners) {
      try { listener(change); } catch { /* ignore */ }
    }
  }

  // Place Zone integration point. The spatial layer (PR #87) calls this with semantic IDs only.
  setPlaceZone(placeZoneId) {
    if (placeZoneId !== null && !isValidPlaceZoneId(placeZoneId)) return false;
    if (placeZoneId === this.desiredPlaceZoneId) return true;
    this.desiredPlaceZoneId = placeZoneId;
    // Remotes from the zone we are leaving disappear now, even while reconnecting.
    this.remotes.retainZone(placeZoneId, "zone_left");
    if (this.isOnline) this.#joinDesiredZone();
    return true;
  }

  handlePlaceZoneChanged(_previousId, nextId) {
    return this.setPlaceZone(nextId ?? null);
  }

  #presence(placeZoneId) {
    return buildPresence({ ...this.identity, guest: this.guest, placeZoneId, joinedAt: this.joinedAt, equipment: this.equipment });
  }

  /**
   * Sets the equipment our Presence shows (sparse slot → { itemId, catalogStatus }). Stored even while no
   * zone is joined, so the next join, rejoin or reconnect carries the latest value. Presence is
   * republished only when the canonical value changes and we are in a zone: an identical refresh sends
   * nothing. Guests never publish equipment. Returns true when a republish went out.
   */
  setEquipment(snapshot) {
    if (this.guest) return false;
    const next = sanitizeEquipment(snapshot);
    const key = equipmentKey(next);
    if (key === this.equipmentKey) return false;
    this.equipment = next;
    this.equipmentKey = key;
    if (!this.isOnline || !this.joinedPlaceZoneId) return false;
    const presence = this.#presence(this.joinedPlaceZoneId);
    if (findPrivateDataViolations(presence).length) return false;
    if (!this.#call("publishPresence", this.joinedPlaceZoneId, presence)) return false;
    this.sent.presence += 1;
    this.sent.equipment += 1;
    return true;
  }

  #joinDesiredZone() {
    const next = this.desiredPlaceZoneId;
    const previous = this.joinedPlaceZoneId;
    if (previous && previous !== next) this.#call("leavePlaceZone", previous);
    this.joinedPlaceZoneId = null;
    this.zoneSynced = false;
    if (!next) return;
    this.joinedAt = Math.round(this.#now());
    const presence = this.#presence(next);
    const leaks = findPrivateDataViolations(presence);
    if (leaks.length) {
      this.#recordError("presence", new Error(`private data blocked: ${leaks.join("; ")}`));
      return;
    }
    if (this.#call("joinPlaceZone", next, presence)) {
      this.joinedPlaceZoneId = next;
      this.sent.presence += 1;
      this.publisher.forceSnapshot();
    }
  }

  #onPresence({ type, placeZoneId, presences = [] } = {}) {
    if (!this.joinedPlaceZoneId || placeZoneId !== this.joinedPlaceZoneId) return;
    const now = this.#now();
    if (type === "sync") {
      // The first sync proves the channel is live (a pose forced at join time may have been
      // dropped by a transport that was still subscribing); new members also need our pose.
      const joined = this.remotes.reconcileZone(placeZoneId, presences, now);
      if (joined > 0 || !this.zoneSynced) this.publisher.forceSnapshot();
      this.zoneSynced = true;
      this.connection.confirmHealthy();
      return;
    }
    for (const presence of presences) {
      if (type === "leave") {
        const player = this.remotes.get(presence?.sessionId);
        if (player && player.placeZoneId === placeZoneId) this.remotes.removePresence(player.sessionId, "left");
      } else if (type === "join") {
        const event = this.remotes.upsertPresence(presence, now);
        // A newcomer has no pose for us yet; send one on the next update instead of waiting for movement.
        if (event?.type === "playerJoined") this.publisher.forceSnapshot();
      }
    }
  }

  #onPose({ placeZoneId, sessionId, packet } = {}) {
    if (!this.joinedPlaceZoneId || placeZoneId !== this.joinedPlaceZoneId) return;
    this.remotes.receivePose(sessionId, packet, this.#now(), placeZoneId);
  }

  #onAction({ placeZoneId, sessionId, packet } = {}) {
    if (!this.joinedPlaceZoneId || placeZoneId !== this.joinedPlaceZoneId) return;
    this.remotes.receiveAction(sessionId, packet, this.#now());
  }

  // Called once per frame by the world with a plain, read-only pose sample
  // ({ x, y, z, yaw, vx, vz, anim }) or null. Never throws.
  update(sample = null) {
    try {
      const now = this.#now();
      if (this.connectDeadline !== null && now >= this.connectDeadline) this.#connectionLost();
      if (this.connection.takeDueRetry(now)) this.#attemptConnect();
      if (sample && this.isOnline && this.joinedPlaceZoneId) this.#maybePublishPose(now, sample);
    } catch (error) {
      this.#recordError("update", error);
    }
  }

  #maybePublishPose(now, sample) {
    if (!this.publisher.evaluate(now, sample)) return;
    const packet = encodePose(this.poseSeq, sample);
    // Never put local physics glitches (NaN, Infinity) on the wire.
    if (!validatePose(packet).ok) return;
    this.poseSeq += 1;
    this.publisher.markSent(now, sample);
    if (this.#call("publishPose", this.joinedPlaceZoneId, packet)) this.sent.pose += 1;
  }

  // Transient actions go out immediately instead of waiting for the next pose snapshot.
  publishAction(type, payload = {}) {
    if (!this.isOnline || !this.joinedPlaceZoneId) return false;
    if (this.guest && !isGuestAction(type)) return false;
    const packet = encodeAction(this.actionId, type, payload);
    if (!validateAction(packet).ok) return false;
    this.actionId += 1;
    const sent = this.#call("publishAction", this.joinedPlaceZoneId, packet);
    if (sent) this.sent.action += 1;
    return sent;
  }

  reportJump() {
    return this.publishAction(ActionType.JUMP);
  }

  // The next pose (sequence poseSeq) is forced out right after, so receivers can drop older poses.
  reportTeleport({ x, y, z, yaw }) {
    this.publisher.forceSnapshot();
    return this.publishAction(ActionType.TELEPORT, { x, y, z, yaw, poseSeq: this.poseSeq });
  }

  // Transient expression (Social S1-B1). Not part of the pose tick; dropped when not online.
  reportEmote(emote) {
    return this.publishAction(ActionType.EMOTE, { emote });
  }

  // Social S1-B2 local chat. `text` must already be normalized; position is where we stand now.
  // Not online: false, and nothing is queued for later.
  reportChat(text, { x, y, z }) {
    return this.publishAction(ActionType.CHAT, { text, x, y, z });
  }

  sampleRemotes() {
    return this.remotes.sample(this.#now());
  }
}
