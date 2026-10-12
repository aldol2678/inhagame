// Deterministic contract double, not PostgreSQL or live Supabase evidence.
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { CLUB_ROOM_ID } from "../../src/rooms/club-room-seats.js";
export function serverFixture() {
  let time = 10_000, revision = 0;
  const sessions = new Map(), used = new Set(), restricted = new Set(), channels = new Set(), calls = [];
  const clock = { now: () => time };
  const state = { failing: false };
  const prune = () => { for (const [key, s] of sessions) if (s.expires <= time || restricted.has(s.userId)) sessions.delete(key); };
  const presence = s => ({ v: 1, sessionId: s.sessionId, userId: s.userId, displayName: "인덕이", placeZoneId: CLUB_ROOM_ID, joinedAt: s.joinedAt });
  const snapshot = (userId, sessionId) => {
    const own = sessions.get(sessionId);
    if (!own || own.userId !== userId) return { allowed: false, reason: "SESSION_EXPIRED" };
    return { allowed: true, roomId: CLUB_ROOM_ID, sessionId, userId, capacity: 6, inboxNonce: own.inboxNonce, leaseMs: own.expires - time, revision: ++revision,
      participants: [...sessions.values()].map(presence),
      seats: [...sessions.values()].filter(s => s.seatId).map(s => ({ seatId: s.seatId, sessionId: s.sessionId, userId: s.userId })),
      poses: [...sessions.values()].filter(s => s.pose).map(s => ({ sessionId: s.sessionId, packet: s.pose })) };
  };
  const client = (userId, anonymous = false) => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: userId, is_anonymous: anonymous }, access_token: "synthetic-fixture" } } }) },
    realtime: { setAuth: async () => {} },
    removeChannel: async channel => { channels.delete(channel); },
    channel(topic, options) {
      const channel = { topic, options, receiver: null,
        on(kind, filter, fn) { assert.equal(kind, "broadcast"); assert.equal(filter.event, "club-packet"); this.receiver = fn; return this; },
        subscribe(fn) { this.status = fn; queueMicrotask(() => fn("SUBSCRIBED")); return this; },
        track() { throw new Error("Client cannot forge club presence"); },
        send() { throw new Error("Client cannot publish club packets"); }
      }; channels.add(channel); return channel;
    },
    async rpc(name, args) {
      calls.push({ name, args, userId });
      if (state.failing) return { data: null, error: { message: "network unavailable" } };
      prune();
      const key = args.p_session;
      if (name === "leave_world_club_room_v1") {
        if (sessions.get(key)?.userId === userId) sessions.delete(key);
        return { data: { allowed: true } };
      }
      if (args.p_room !== CLUB_ROOM_ID || restricted.has(userId) || anonymous) return { data: { allowed: false, reason: "DENIED" } };
      if (name === "join_world_club_room_v1") {
        if (!sessions.has(key)) {
          if (used.has(key)) return { data: { allowed: false, reason: "SESSION_REUSED" } };
          for (const [k, s] of sessions) if (s.userId === userId) sessions.delete(k);
          if (sessions.size >= 6) return { data: { allowed: false, reason: "ROOM_FULL" } };
          sessions.set(key, { inboxNonce: randomUUID(), userId, sessionId: key, expires: time + 20_000, joinedAt: time, seatId: null }); used.add(key);
        }
      }
      const own = sessions.get(key);
      if (!own || own.userId !== userId) return { data: { allowed: false, reason: "SESSION_REPLACED" } };
      if (name === "heartbeat_world_club_room_v1" || name === "join_world_club_room_v1") { own.expires = time + 20_000; own.inboxNonce = randomUUID(); }
      if (name === "claim_world_club_room_seat_v1") {
        const other = [...sessions.values()].some(s => s.sessionId !== key && s.seatId === args.p_seat);
        if (!other) own.seatId = args.p_seat;
        return { data: { ...snapshot(userId, key), claimed: !other, reason: other ? "SEAT_TAKEN" : null } };
      }
      if (name === "release_world_club_room_seat_v1" && own.seatId === args.p_seat) own.seatId = null;
      if (name === "publish_world_club_room_v1") {
        if (args.p_event === "pose") own.pose = args.p_packet;
        for (const channel of channels) {
          const recipient = sessions.get(channel.topic.split(":").at(-1));
          if (recipient && recipient.sessionId !== key && !restricted.has(recipient.userId)) channel.receiver?.({ payload: {
            inboxNonce: recipient.inboxNonce, roomId: CLUB_ROOM_ID, sid: key, p: args.p_packet, event: args.p_event, presence: presence(own)
          } });
        }
        return { data: { allowed: true, sent: true } };
      }
      return { data: snapshot(userId, key) };
    }
  });
  return { clock, sessions, channels, restricted, calls, state, client, snapshot,
    advance(ms) { time += ms; } };
}
