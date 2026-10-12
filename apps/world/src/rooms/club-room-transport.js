// Server-only recipient inboxes: clients cannot broadcast or track a forged club identity.
// Every publication authenticates the sender and rechecks every recipient's live server lease.
// This avoids treating Supabase's cached channel RLS decision as a continuing admission.
import { createInboxAuthority } from "./inbox-authority.js";
import { TransportStatus } from "../network/transport.js";
import { sanitizeEquipment } from "../network/protocol.js";
import { CLUB_ROOM_ID } from "./club-room-seats.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FAILED = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);
export const CLUB_POSE_INTERVAL_MS = 120;
export function clubRoomTopic(roomId, admissionId) {
  if (roomId !== CLUB_ROOM_ID || !UUID.test(admissionId ?? "")) throw new TypeError("Invalid club admission");
  return `world:club:${roomId}:${admissionId.toLowerCase()}`;
}

export class ClubRoomTransport {
  constructor(client, { roomId, sessionId, admissionId, userId, clock = { now: () => Date.now() },
    onSnapshot = () => {}, onDenied = () => {}, windowTarget = globalThis.window } = {}) {
    if (!client?.rpc || !client?.channel || !client?.auth) throw new TypeError("Club transport needs a Supabase client");
    clubRoomTopic(roomId, admissionId);
    this.client = client; this.roomId = roomId; this.sessionId = sessionId; this.userId = userId;
    this.admissionId = admissionId;
    this.inbox = createInboxAuthority(clock, 20_000);
    this.clock = clock; this.onSnapshot = onSnapshot; this.onDenied = onDenied; this.windowTarget = windowTarget;
    this.handlers = { status: new Set(), presence: new Set(), pose: new Set(), action: new Set() };
    this.epoch = 0; this.entry = null; this.connected = false; this.snapshot = null;
    this.poseBusy = false; this.poseAt = -Infinity; this.pendingPose = null;
    this.onOffline = () => this.lost("browser_offline");
    windowTarget?.addEventListener?.("offline", this.onOffline);
  }
  emit(kind, value) { for (const fn of this.handlers[kind]) fn(value); }
  subscribe(kind, fn) { this.handlers[kind].add(fn); return () => this.handlers[kind].delete(fn); }
  subscribeStatus(fn) { return this.subscribe("status", fn); }
  subscribePresence(fn) { return this.subscribe("presence", fn); }
  subscribePose(fn) { return this.subscribe("pose", fn); }
  subscribeAction(fn) { return this.subscribe("action", fn); }
  lost(reason) {
    if (!this.connected) return;
    this.connected = false; this.pendingPose = null; this.inbox.clear();
    this.emit("status", { status: TransportStatus.DISCONNECTED, reason });
  }
  setSnapshot(snapshot, validUntil) {
    if (snapshot.admissionId !== this.admissionId || snapshot.topic !== clubRoomTopic(this.roomId, this.admissionId)) return;
    if (validUntil !== undefined && !this.inbox.admit(snapshot.inboxNonce, validUntil)) return;
    this.snapshot = snapshot;
    if (!this.entry?.subscribed) return;
    this.emit("presence", { type: "sync", placeZoneId: this.roomId, presences: snapshot.participants });
    for (const pose of snapshot.poses ?? []) this.emit("pose", {
      placeZoneId: this.roomId, sessionId: pose.sessionId, packet: pose.packet
    });
  }
  async connect({ sessionId } = {}) {
    const epoch = ++this.epoch;
    try {
      if (sessionId !== this.sessionId) throw new Error("IDENTITY");
      const { data, error } = await this.client.auth.getSession();
      if (epoch !== this.epoch) return;
      const auth = data?.session;
      if (error || auth?.user?.id !== this.userId || auth.user.is_anonymous === true || !auth.access_token) {
        this.onDenied("IDENTITY"); return;
      }
      // Revalidate before every reconnect. An expired UUID is never re-admitted by a transport.
      const requestedAt = this.clock.now();
      const result = await this.client.rpc("heartbeat_world_club_room_v1", { p_room: this.roomId, p_admission: this.admissionId });
      if (epoch !== this.epoch) return;
      if (result.error) throw result.error;
      if (!this.onSnapshot(result.data, requestedAt)) { this.onDenied(result.data?.reason ?? "DENIED"); return; }
      await this.client.realtime?.setAuth?.(auth.access_token);
      if (epoch !== this.epoch) return;
      this.connected = true;
      this.emit("status", { status: TransportStatus.CONNECTED });
    } catch (error) {
      if (epoch === this.epoch) this.emit("status", { status: TransportStatus.ERROR, reason: String(error?.message ?? error) });
    }
  }
  joinPlaceZone(placeZoneId, presence) {
    if (placeZoneId !== this.roomId || !this.connected) return;
    this.leavePlaceZone();
    const channel = this.client.channel(clubRoomTopic(this.roomId, this.admissionId), {
      config: { private: true, broadcast: { self: false, ack: false } }
    });
    const entry = this.entry = { channel, subscribed: false };
    channel.on("broadcast", { event: "club-packet" }, ({ payload } = {}) => {
      if (this.entry !== entry || !this.connected || !entry.subscribed || !this.inbox.accepts(payload?.inboxNonce) || payload?.roomId !== this.roomId ||
          !UUID.test(payload.sid ?? "") || payload.sid === this.sessionId ||
          payload.presence?.sessionId !== payload.sid || payload.presence?.placeZoneId !== this.roomId) return;
      this.emit("presence", { type: "join", placeZoneId: this.roomId, presences: [payload.presence] });
      if (["pose", "action"].includes(payload.event)) this.emit(payload.event, {
        placeZoneId: this.roomId, sessionId: payload.sid, packet: payload.p
      });
    }).subscribe(status => {
      if (this.entry !== entry) return;
      if (status === "SUBSCRIBED") {
        entry.subscribed = true;
        if (this.snapshot) this.setSnapshot(this.snapshot);
        void this.publishPresence(placeZoneId, presence);
      } else if (FAILED.has(status)) {
        entry.subscribed = false;
        this.lost(`channel_${status.toLowerCase()}`);
      }
    });
  }
  leavePlaceZone() {
    const entry = this.entry; this.entry = null;
    if (entry) try { Promise.resolve(this.client.removeChannel(entry.channel)).catch(() => {}); } catch { /* best effort */ }
  }
  disconnect() { this.epoch += 1; this.connected = false; this.pendingPose = null; this.inbox.clear(); this.leavePlaceZone(); }
  async publish(event, packet) {
    if (!this.connected || !this.entry?.subscribed) return;
    const epoch = this.epoch;
    try {
      const { data, error } = await this.client.rpc("publish_world_club_room_v1", {
        p_room: this.roomId, p_admission: this.admissionId, p_event: event, p_packet: packet
      });
      if (epoch !== this.epoch) return;
      if (error) throw error;
      if (data?.allowed !== true) this.onDenied(data?.reason ?? "DENIED");
    } catch (error) { if (epoch === this.epoch) this.lost(String(error?.message ?? "publish_failed")); }
  }
  publishPresence(placeZoneId, presence) {
    if (placeZoneId !== this.roomId) return;
    return this.publish("presence", { equipment: sanitizeEquipment(presence?.equipment) });
  }
  publishPose(placeZoneId, packet) {
    if (placeZoneId !== this.roomId || !this.connected) return;
    // NetworkManager marks a pose published before the async channel is necessarily subscribed.
    // Keep only the latest snapshot: a dropped first/forced idle pose otherwise never retries.
    this.pendingPose = packet;
    return this.flushPose();
  }
  flushPose() {
    if (!this.pendingPose || !this.connected || !this.entry?.subscribed || this.poseBusy ||
        this.clock.now() - this.poseAt < CLUB_POSE_INTERVAL_MS) return;
    const packet = this.pendingPose; this.pendingPose = null;
    this.poseAt = this.clock.now(); this.poseBusy = true;
    return this.publish("pose", packet).finally(() => { this.poseBusy = false; });
  }
  publishAction(placeZoneId, packet) {
    if (placeZoneId !== this.roomId || !["jump", "emote"].includes(packet?.type)) return;
    return this.publish("action", packet);
  }
  get liveChannelCount() { return this.entry ? 1 : 0; }
  destroy() { this.disconnect(); this.windowTarget?.removeEventListener?.("offline", this.onOffline); }
}
