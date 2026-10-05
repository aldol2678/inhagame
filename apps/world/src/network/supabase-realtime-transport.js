// NetworkTransport over Supabase Realtime (Presence + Broadcast) on private place-zone channels.
// The supabase-js client is injected; this file never creates clients, reads keys or touches
// PlayerController, PlaceZoneRegistry or rendering. See README.md for the channel contract.

import { TransportStatus } from "./transport.js";
import { placeZoneTopic } from "./protocol.js";

export const REALTIME_EVENTS = Object.freeze({ POSE: "pose", ACTION: "action" });

// A Realtime subscribe status that means the channel is no longer usable.
const FAILED = new Set(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

function flattenPresenceState(state) {
  const out = [];
  for (const metas of Object.values(state ?? {})) {
    for (const meta of metas ?? []) out.push(stripMeta(meta));
  }
  return out;
}

// Realtime adds presence_ref; the core validates everything else against its allowlist.
function stripMeta(meta) {
  if (!meta || typeof meta !== "object") return meta;
  const { presence_ref: _ref, ...rest } = meta;
  return rest;
}

export class SupabaseRealtimeTransport {
  // allowGuest: accept an anonymous (guest) session. Members-only callers leave it false.
  // topicFor: zone id → Realtime topic. Campus uses world:campus:AREA_*; a Personal Room Session
  // (rooms/room-session.js) maps its single zone to world:room:<room uuid>.
  constructor(client, { windowTarget = globalThis.window, allowGuest = false, topicFor = placeZoneTopic } = {}) {
    if (!client?.channel || !client?.auth) throw new TypeError("SupabaseRealtimeTransport needs a supabase-js client");
    this.client = client;
    this.allowGuest = allowGuest === true;
    this.topicFor = topicFor;
    this.windowTarget = windowTarget;
    this.handlers = { status: new Set(), presence: new Set(), pose: new Set(), action: new Set() };
    this.channels = new Map();
    this.connectEpoch = 0;
    this.connected = false;
    this.sessionId = null;
    this.onOffline = () => this.#lost("browser_offline");
    this.windowTarget?.addEventListener?.("offline", this.onOffline);
  }

  #emit(kind, event) {
    for (const handler of this.handlers[kind]) handler(event);
  }

  #subscribe(kind, handler) {
    this.handlers[kind].add(handler);
    return () => this.handlers[kind].delete(handler);
  }

  #lost(reason) {
    if (!this.connected) return;
    this.connected = false;
    this.#emit("status", { status: TransportStatus.DISCONNECTED, reason });
  }

  // Verifies a signed-in session (permanent, or anonymous when allowGuest) and hands its token to
  // Realtime (private channels).
  // `credentials` is unused: the injected client already owns the session.
  connect({ sessionId } = {}) {
    const epoch = ++this.connectEpoch;
    this.sessionId = sessionId;
    return (async () => {
      try {
        const { data, error } = await this.client.auth.getSession();
        const session = data?.session;
        const user = session?.user;
        if (error || !session?.access_token || !user?.id || (user.is_anonymous === true && !this.allowGuest)) {
          throw new Error(error?.message ?? "permanent sign-in required");
        }
        await this.client.realtime?.setAuth?.(session.access_token);
        if (epoch !== this.connectEpoch) return;
        this.connected = true;
        this.#emit("status", { status: TransportStatus.CONNECTED });
      } catch (error) {
        if (epoch !== this.connectEpoch) return;
        this.connected = false;
        this.#emit("status", { status: TransportStatus.ERROR, reason: String(error?.message ?? error) });
      }
    })();
  }

  disconnect() {
    this.connectEpoch += 1;
    this.connected = false;
    for (const placeZoneId of [...this.channels.keys()]) this.leavePlaceZone(placeZoneId);
  }

  joinPlaceZone(placeZoneId, presence) {
    const topic = this.topicFor(placeZoneId);
    // Idempotent: a re-join replaces the old channel so there is never more than one live subscription.
    if (this.channels.has(placeZoneId)) this.leavePlaceZone(placeZoneId);
    const channel = this.client.channel(topic, {
      config: {
        private: true,
        presence: { key: presence.sessionId },
        broadcast: { self: false, ack: false }
      }
    });
    const entry = { channel, placeZoneId, presence, subscribed: false, closedByUs: false };
    this.channels.set(placeZoneId, entry);

    const emitPresence = (type, presences) => this.#emit("presence", { type, placeZoneId, presences });
    channel
      .on("presence", { event: "sync" }, () => emitPresence("sync", flattenPresenceState(channel.presenceState())))
      .on("presence", { event: "join" }, ({ newPresences } = {}) => emitPresence("join", (newPresences ?? []).map(stripMeta)))
      .on("presence", { event: "leave" }, ({ key, leftPresences } = {}) => {
        // A re-track (publishPresence, e.g. an equipment change) arrives as join(new meta) then
        // leave(old meta) for the same key. The session is still present, so it is an update, not a
        // leave: drop metas whose key still has a live presence. A real leave empties the key.
        const live = channel.presenceState?.() ?? {};
        const left = (leftPresences ?? []).map(stripMeta)
          .filter((presence) => !(live[presence?.sessionId ?? key]?.length > 0));
        if (left.length) emitPresence("leave", left);
      })
      .on("broadcast", { event: REALTIME_EVENTS.POSE }, ({ payload } = {}) =>
        this.#emit("pose", { placeZoneId, sessionId: payload?.sid, packet: payload?.p }))
      .on("broadcast", { event: REALTIME_EVENTS.ACTION }, ({ payload } = {}) =>
        this.#emit("action", { placeZoneId, sessionId: payload?.sid, packet: payload?.p }));

    channel.subscribe((status) => {
      if (this.channels.get(placeZoneId) !== entry || entry.closedByUs) return;
      if (status === "SUBSCRIBED") {
        entry.subscribed = true;
        Promise.resolve(channel.track(entry.presence)).catch(() => this.#lost("track_failed"));
      } else if (FAILED.has(status)) {
        entry.subscribed = false;
        this.#lost(`channel_${status.toLowerCase()}`);
      }
    });
  }

  leavePlaceZone(placeZoneId) {
    const entry = this.channels.get(placeZoneId);
    if (!entry) return;
    this.channels.delete(placeZoneId);
    entry.closedByUs = true;
    // Best effort: Presence also drops us when the socket goes away.
    try { Promise.resolve(entry.channel.untrack?.()).catch(() => {}); } catch { /* ignore */ }
    try { Promise.resolve(this.client.removeChannel(entry.channel)).catch(() => {}); } catch { /* ignore */ }
  }

  publishPresence(placeZoneId, presence) {
    const entry = this.channels.get(placeZoneId);
    if (!entry) return;
    entry.presence = presence;
    if (entry.subscribed) return entry.channel.track(presence);
  }

  #send(event, placeZoneId, packet) {
    const entry = this.channels.get(placeZoneId);
    if (!entry?.subscribed) return;
    return entry.channel.send({ type: "broadcast", event, payload: { sid: this.sessionId, p: packet } });
  }

  publishPose(placeZoneId, packet) { return this.#send(REALTIME_EVENTS.POSE, placeZoneId, packet); }
  publishAction(placeZoneId, packet) { return this.#send(REALTIME_EVENTS.ACTION, placeZoneId, packet); }

  subscribePresence(handler) { return this.#subscribe("presence", handler); }
  subscribePose(handler) { return this.#subscribe("pose", handler); }
  subscribeAction(handler) { return this.#subscribe("action", handler); }
  subscribeStatus(handler) { return this.#subscribe("status", handler); }

  get liveChannelCount() { return this.channels.size; }

  destroy() {
    this.disconnect();
    this.windowTarget?.removeEventListener?.("offline", this.onOffline);
  }
}

