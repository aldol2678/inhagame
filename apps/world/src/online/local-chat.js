// Social S1-B2 · Local chat. Pure and engine-free: policy, proximity, feed and bubbles.
//
// Trust boundary (be honest about it):
// - Messages ride the current place-zone channel (world:campus:<AREA_ID>). Everyone in that
//   Place Zone RECEIVES every message; the 15 m radius is a client presentation filter, not
//   network-level geographic privacy.
// - The sender name shown is the Presence display name (INHAGAME profile nickname) of the
//   sending session; the chat payload carries no name. Realtime does not authenticate the
//   session id inside a broadcast, so a modified client could still impersonate another
//   present session. This is a social client feature, not a secure chat server.
// - Rate limit, repeat suppression and the moderation hook are client-side UX/spam mitigation,
//   not a security boundary. Nothing is persisted (no DB, no localStorage).

import { CHAT_MAX_LENGTH, normalizeChatText } from "../network/protocol.js";
import { METERS_PER_WORLD_UNIT } from "../world-scale.js";

export { CHAT_MAX_LENGTH, normalizeChatText };

// Campus projection: 1 world unit ≈ 2 m (shared constant in world-scale.js).
export { METERS_PER_WORLD_UNIT };
// Visible if distance <= radius (inclusive). 3D distance between the receiver now and the
// sender at send time.
export const LOCAL_CHAT_RADIUS_M = 15;
export const CHAT_BUBBLE_MS = 4000;
export const CHAT_FEED_LIMIT = 30;
export const CHAT_RATE_LIMIT_COUNT = 3;
export const CHAT_RATE_LIMIT_WINDOW_MS = 5000;
// The same normalized text may be sent at most this many times within the window.
export const CHAT_REPEAT_LIMIT = 2;
export const CHAT_REPEAT_WINDOW_MS = 10000;

export function distanceMeters(a, b) {
  return Math.hypot(a.x - b.x, (a.y ?? 0) - (b.y ?? 0), a.z - b.z) * METERS_PER_WORLD_UNIT;
}

export function withinChatRadius(receiver, sender, radiusM = LOCAL_CHAT_RADIUS_M) {
  return distanceMeters(receiver, sender) <= radiusM;
}

// Moderation hook. No project-owned word list exists yet, so the default passes everything;
// a future approved filter (and block/report) plugs in here without touching the transport.
export const passThroughModeration = Object.freeze({
  check: () => ({ ok: true }),
  isBlocked: () => false
});

// Outgoing policy. `send(text)` is the network hook and returns true only when it went out.
export class ChatComposer {
  constructor({ clock, send, moderation = passThroughModeration, canSend = () => true }) {
    this.clock = clock;
    this.send = send;
    this.moderation = moderation;
    this.canSend = canSend;
    this.sentAt = [];
    this.recent = [];
    this.stats = { sent: 0, rejected: 0, rateLimited: 0, repeated: 0, offline: 0, moderated: 0 };
  }

  // Returns { result, text? }: "sent" | "empty" | "too_long" | "malformed" | "signed_out" |
  // "offline" | "rate_limited" | "repeated" | "moderated".
  submit(input) {
    const now = this.clock.now();
    const access = this.canSend();
    if (access !== true) { this.stats.offline += 1; return { result: access || "offline" }; }
    const normalized = normalizeChatText(input);
    if (!normalized.ok) { this.stats.rejected += 1; return { result: normalized.reason }; }
    const { text } = normalized;
    const verdict = this.moderation.check(text);
    if (!verdict?.ok) { this.stats.moderated += 1; return { result: "moderated" }; }
    this.sentAt = this.sentAt.filter((t) => now - t < CHAT_RATE_LIMIT_WINDOW_MS);
    if (this.sentAt.length >= CHAT_RATE_LIMIT_COUNT) { this.stats.rateLimited += 1; return { result: "rate_limited" }; }
    const key = text.toLocaleLowerCase("ko");
    this.recent = this.recent.filter((r) => now - r.at < CHAT_REPEAT_WINDOW_MS);
    if (this.recent.filter((r) => r.key === key).length >= CHAT_REPEAT_LIMIT) { this.stats.repeated += 1; return { result: "repeated" }; }
    let sent = false;
    try { sent = this.send(text) === true; } catch { sent = false; }
    // No queue: a message that could not go out now is dropped, never replayed later.
    if (!sent) { this.stats.offline += 1; return { result: "offline" }; }
    this.sentAt.push(now);
    this.recent.push({ key, at: now });
    this.stats.sent += 1;
    return { result: "sent", text };
  }
}

// Incoming + own messages for the current Place Zone. Ephemeral, capped, zone-scoped.
export class ChatFeed {
  constructor({ clock, limit = CHAT_FEED_LIMIT, bubbleMs = CHAT_BUBBLE_MS, moderation = passThroughModeration }) {
    this.clock = clock;
    this.limit = limit;
    this.bubbleMs = bubbleMs;
    this.moderation = moderation;
    this.entries = [];
    this.bubbles = new Map(); // sessionId -> { text, until }
    this.placeZoneId = null;
    this.nextId = 1;
    this.listeners = new Set();
    this.stats = { shown: 0, outOfRange: 0, unknownSender: 0, otherZone: 0, blocked: 0 };
  }

  onChange(handler) {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  #emit() {
    for (const listener of this.listeners) {
      try { listener(this.entries); } catch { /* UI never breaks the feed */ }
    }
  }

  #add({ sessionId, userId = null, name, text, self }) {
    const at = this.clock.now();
    this.entries.push({ id: this.nextId++, sessionId, userId, name, text, at, self });
    if (this.entries.length > this.limit) this.entries.splice(0, this.entries.length - this.limit);
    // A newer message from the same player replaces the bubble instead of stacking.
    this.bubbles.set(sessionId, { text, until: at + this.bubbleMs });
    this.stats.shown += 1;
    this.#emit();
  }

  // New Place Zone, sign-out or session end: nothing from the old zone survives.
  setPlaceZone(placeZoneId) {
    if (placeZoneId === this.placeZoneId) return;
    this.placeZoneId = placeZoneId;
    this.clear();
  }

  clear() {
    this.entries = [];
    this.bubbles.clear();
    this.#emit();
  }

  addOwn({ sessionId, name, text }) {
    this.#add({ sessionId, name, text, self: true });
  }

  // `sender` comes from Presence (never from the payload): { sessionId, userId, displayName, placeZoneId }.
  receive({ sender, placeZoneId, text, position, receiverPosition }) {
    if (!sender) { this.stats.unknownSender += 1; return "unknown_sender"; }
    if (placeZoneId !== this.placeZoneId || sender.placeZoneId !== placeZoneId) { this.stats.otherZone += 1; return "other_zone"; }
    if (this.moderation.isBlocked(sender.userId)) { this.stats.blocked += 1; return "blocked"; }
    if (!receiverPosition || !withinChatRadius(receiverPosition, position)) { this.stats.outOfRange += 1; return "out_of_range"; }
    this.#add({ sessionId: sender.sessionId, userId: sender.userId, name: sender.displayName, text, self: false });
    return "shown";
  }

  // Social S1-C1 block: drop what this user already said here (feed entries and bubbles).
  removeSender(userId) {
    const sessions = new Set(this.entries.filter((e) => e.userId === userId).map((e) => e.sessionId));
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.userId !== userId);
    for (const sessionId of sessions) this.bubbles.delete(sessionId);
    if (this.entries.length !== before || sessions.size) this.#emit();
  }

  forget(sessionId) {
    if (this.bubbles.delete(sessionId)) this.#emit();
  }

  bubbleFor(sessionId) {
    const bubble = this.bubbles.get(sessionId);
    if (!bubble) return null;
    if (this.clock.now() >= bubble.until) { this.bubbles.delete(sessionId); return null; }
    return bubble.text;
  }
}
