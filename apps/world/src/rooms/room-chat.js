// Ephemeral room chat. Only the server RPC publishes to a user's private inbox; clients never
// broadcast chat. Each send rechecks sender, every recipient, room admission and both block edges.
// No fallback to campus/pose broadcasts when the server contract is absent. No app history.
// Provider DB Broadcast retains delivery payloads temporarily; see ROOM_CHAT_CANDIDATE.md.
import { createInboxAuthority } from './inbox-authority.js';
import { ChatFeed, normalizeChatText } from '../online/local-chat.js';
import { normalizeDisplayName } from '../network/protocol.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROOM_CHAT_EVENT = 'room_chat_v1';
export const ROOM_CHAT_RENEW_MS = 10_000;
export const ROOM_CHAT_LEASE_MS = 30_000;
export const ROOM_CHAT_RETRY_MS = 5_000;
const contextKey = (c) => `${c.kind}:${c.roomId}:${c.sessionId}`;
export function validRoomChatContext(c) {
  return !!c && UUID.test(c.sessionId ?? '') && (c.kind === 'personal' && UUID.test(c.roomId ?? '') ||
    c.kind === 'club' && c.roomId === 'ROOM_CLUBHOUSE_01');
}

export function parseRoomChatMessage(raw, context) {
  if (!raw || raw.v !== 1 || raw.kind !== context?.kind || raw.roomId !== context?.roomId ||
    !UUID.test(raw.id ?? '') || !UUID.test(raw.userId ?? '') || !UUID.test(raw.sessionId ?? '')) return null;
  const text = normalizeChatText(raw.text);
  if (!text.ok || text.text !== raw.text || typeof raw.name !== 'string' || raw.name.length > 80) return null;
  return Object.freeze({ id: raw.id, userId: raw.userId, sessionId: raw.sessionId,
    name: normalizeDisplayName(raw.name), text: text.text });
}

// Same interface as online.chat, except submit may return a Promise. Source switches invalidate
// every pending UI action. Leases expire even if an offline browser cannot send leave().
export function createRoomChat({ getClient, getIdentity, clock = { now: () => Date.now() },
  isBlocked = () => false, onChange = () => {}, windowTarget = globalThis.window } = {}) {
  const feed = new ChatFeed({ clock, moderation: { check: () => ({ ok: true }), isBlocked } });
  let current = null, epoch = 0, phase = 'IDLE';
  let joinTail = Promise.resolve();
  const inbox = createInboxAuthority(clock, ROOM_CHAT_LEASE_MS);
  const seen = new Set();
  // Presence session IDs are not identity credentials. Bind every bubble to the certified user too.
  const trustedBubbles = new Map();
  const bubbleKey = (sessionId, userId) => `${userId}:${sessionId}`;
  function trustedBubble(sessionId, userId) {
    const key = bubbleKey(sessionId, userId), bubble = trustedBubbles.get(key);
    if (!bubble || clock.now() >= bubble.until) { trustedBubbles.delete(key); return null; }
    return bubble;
  }
  const identityMatches = (c) => current === c && getIdentity?.()?.userId === c.userId;
  const emit = () => { try { onChange(status()); } catch { /* UI cannot break cleanup */ } };
  const status = () => Object.freeze({ active: !!current, phase, kind: current?.kind ?? null,
    roomId: current?.roomId ?? null, sessionId: current?.sessionId ?? null, ready: canChat(),
    reason: current?.reason ?? null });
  function canChat() {
    return !!current && identityMatches(current) && phase === 'READY' &&
      current.subscribed && clock.now() < current.validUntil;
  }
  function closeChannel(c) {
    const channel = c?.channel;
    if (c) { c.channel = null; c.subscribed = false; }
    if (channel) { try { Promise.resolve(c.client.removeChannel(channel)).catch(() => {}); } catch { /* best effort */ } }
  }
  function clear() { inbox.clear(); seen.clear(); trustedBubbles.clear(); feed.clear(); }
  function stop() {
    epoch += 1;
    const c = current; current = null; phase = 'IDLE';
    closeChannel(c); clear(); feed.setPlaceZone(null); emit();
    // No identity is supplied: the server checks auth.uid against the lease owner.
    if (c?.leaseId) { try { Promise.resolve(c.client.rpc('leave_world_room_chat_v1', { p_lease: c.leaseId })).catch(() => {}); } catch { /* expires server-side */ } }
    return !!c;
  }
  function degrade(c, reason = 'unavailable') {
    if (!identityMatches(c)) return;
    epoch += 1; // Fence pending auth/join/send work from this failed connection.
    c.reason = reason; c.validUntil = 0; c.retryAt = clock.now() + ROOM_CHAT_RETRY_MS;
    phase = 'UNAVAILABLE'; closeChannel(c); clear(); emit();
  }
  function receive(c, raw) {
    if (!canChat() || !identityMatches(c)) return false;
    const m = parseRoomChatMessage(raw, c);
    if (!m || seen.has(m.id) || isBlocked(m.userId)) return false;
    seen.add(m.id); if (seen.size > 100) seen.delete(seen.values().next().value);
    trustedBubbles.set(bubbleKey(m.sessionId, m.userId), { ...m, until: clock.now() + 4000 });
    if (trustedBubbles.size > 60) trustedBubbles.delete(trustedBubbles.keys().next().value);
    // Server-certified sender names are used for feed and bubbles. No Presence nickname is trusted.
    if (m.userId === c.userId && m.sessionId === c.sessionId) feed.addOwn({ ...m });
    else feed.receive({ sender: { sessionId: m.sessionId, userId: m.userId, displayName: m.name,
      placeZoneId: contextKey(c) }, placeZoneId: contextKey(c), text: m.text,
      position: { x: 0, y: 0, z: 0 }, receiverPosition: { x: 0, y: 0, z: 0 } });
    return true;
  }
  async function rpc(c, name, args) {
    const response = await c.client.rpc(name, args);
    if (response?.error) throw response.error;
    return response?.data;
  }
  function acceptLease(c, data) {
    if (data?.version !== 1 || data?.allowed !== true || data.kind !== c.kind || data.roomId !== c.roomId ||
      data.userId !== c.userId || data.sessionId !== c.sessionId || !UUID.test(data.leaseId ?? '') ||
      data.topic !== `world:room-chat:${data.leaseId}` || data.ttlMs !== ROOM_CHAT_LEASE_MS) return false;
    if (!inbox.admit(data.inboxNonce, c.requestAt + ROOM_CHAT_LEASE_MS)) return false;
    c.leaseId = data.leaseId; c.topic = data.topic;
    // Do not trust the client clock versus server wall time; bound the local lease from request start.
    c.validUntil = c.requestAt + ROOM_CHAT_LEASE_MS;
    c.lastCheck = c.requestAt; c.reason = null;
    return clock.now() < c.validUntil;
  }
  async function renew(c = current) {
    if (!c || !identityMatches(c) || c.checking || !c.leaseId || !c.channel || !c.subscribed) return false;
    c.checking = true; c.requestAt = clock.now(); emit();
    try {
      const data = await rpc(c, 'renew_world_room_chat_v1', { p_lease: c.leaseId });
      if (!identityMatches(c) || !c.channel || !c.subscribed) return false;
      if (!acceptLease(c, data)) { degrade(c, 'denied'); return false; }
      phase = c.subscribed ? 'READY' : 'CONNECTING'; return true;
    } catch { degrade(c); return false; }
    finally { c.checking = false; if (identityMatches(c)) emit(); }
  }
  async function connect(c) {
    const myEpoch = epoch;
    c.checking = true; c.requestAt = clock.now(); phase = 'CHECKING'; emit();
    try {
      // Serialize joins across room switches. An older in-flight join must finish and revoke its
      // own lease before the latest room asks for the account's replacement lease.
      const joining = joinTail.catch(() => {}).then(async () => {
        if (myEpoch !== epoch || !identityMatches(c)) return null;
        const data = await rpc(c, 'join_world_room_chat_v1', {
          p_kind: c.kind, p_room: c.roomId, p_session: c.sessionId
        });
        if (myEpoch !== epoch || !identityMatches(c)) {
          if (UUID.test(data?.leaseId ?? '')) {
            try { await rpc(c, 'leave_world_room_chat_v1', { p_lease: data.leaseId }); } catch { /* server lease expires */ }
          }
          return null;
        }
        return data;
      });
      joinTail = joining.catch(() => {});
      const data = await joining;
      if (myEpoch !== epoch || !identityMatches(c)) return false;
      if (!acceptLease(c, data)) { degrade(c, 'denied'); return false; }
      const auth = await c.client.auth.getSession();
      if (myEpoch !== epoch || !identityMatches(c)) return false;
      if (auth?.error || auth?.data?.session?.user?.id !== c.userId ||
        auth?.data?.session?.user?.is_anonymous === true || !auth?.data?.session?.access_token) throw new Error('IDENTITY');
      await c.client.realtime?.setAuth?.(auth.data.session.access_token);
      if (myEpoch !== epoch || !identityMatches(c)) return false;
      const channel = c.client.channel(c.topic, { config: { private: true, broadcast: { self: false } } });
      c.channel = channel; phase = 'CONNECTING';
      channel.on('broadcast', { event: ROOM_CHAT_EVENT }, ({ payload } = {}) => {
        if (myEpoch === epoch && c.channel === channel && inbox.accepts(payload?.inboxNonce)) receive(c, payload);
      });
      c.checking = false;
      channel.subscribe((state) => {
        if (!identityMatches(c) || c.channel !== channel) return;
        if (state === 'SUBSCRIBED') {
          // Reconnect gets a fresh access check before receiving/sending again.
          c.subscribed = true; c.validUntil = 0;
          void renew(c);
        } else if (['CLOSED', 'CHANNEL_ERROR', 'TIMED_OUT'].includes(state)) degrade(c, 'offline');
      });
      return true;
    } catch { degrade(c); return false; }
    finally { if (!c.subscribed) c.checking = false; if (identityMatches(c)) emit(); }
  }
  async function enter(context) {
    if (!validRoomChatContext(context)) { stop(); return false; }
    const userId = getIdentity?.()?.userId;
    if (current && contextKey(current) === contextKey(context) && userId === current.userId) return true;
    stop();
    const client = getClient?.();
    if (!client?.rpc || !UUID.test(userId ?? '')) return false;
    current = { ...context, userId, client, leaseId: null, validUntil: 0, lastCheck: 0,
      checking: false, sending: false, subscribed: false, channel: null, retryAt: 0 };
    feed.setPlaceZone(contextKey(current));
    return connect(current);
  }
  async function submit(input) {
    const c = current;
    if (!getIdentity?.()?.userId) return { result: 'signed_out' };
    if (!canChat()) return { result: 'room_unavailable' };
    if (c.sending) return { result: 'pending' };
    const normalized = normalizeChatText(input);
    if (!normalized.ok) return { result: normalized.reason };
    c.sending = true;
    const sendEpoch = epoch, leaseId = c.leaseId;
    try {
      const data = await rpc(c, 'send_world_room_chat_v1', { p_lease: leaseId, p_text: normalized.text });
      if (sendEpoch !== epoch || c.leaseId !== leaseId || !identityMatches(c) || !canChat()) return { result: 'cancelled' };
      if (data?.ok !== true) {
        if (['rate_limited', 'repeated', 'too_long', 'empty', 'malformed'].includes(data?.reason)) return { result: data.reason };
        degrade(c, 'denied'); return { result: 'room_unavailable' };
      }
      if (!parseRoomChatMessage(data.message, c) || data.message.userId !== c.userId || data.message.sessionId !== c.sessionId)
        { degrade(c); return { result: 'room_unavailable' }; }
      receive(c, data.message); // server acknowledgement only; no optimistic send or replay queue
      return { result: 'sent', text: normalized.text };
    } catch { if (sendEpoch === epoch && c.leaseId === leaseId) degrade(c); return { result: 'room_unavailable' }; }
    finally { c.sending = false; }
  }
  function update() {
    const c = current; if (!c) return;
    if (!identityMatches(c)) { stop(); return; }
    if (['READY', 'CONNECTING'].includes(phase) && clock.now() >= (c.validUntil || c.requestAt + ROOM_CHAT_LEASE_MS)) { degrade(c, 'expired'); return; }
    if (c.checking) return;
    if (phase === 'UNAVAILABLE' && clock.now() >= c.retryAt) { void connect(c); return; }
    if (phase === 'READY' && clock.now() - c.lastCheck >= ROOM_CHAT_RENEW_MS) void renew(c);
  }
  const onOffline = () => { if (current) degrade(current, 'offline'); };
  windowTarget?.addEventListener?.('offline', onOffline);
  windowTarget?.addEventListener?.('pagehide', stop);
  return { enter, stop, update, submit, feed, status, revalidateNow: () => renew(),
    get canChat() { return canChat(); }, get signedIn() { return !!getIdentity?.()?.userId; },
    ownBubble: () => current ? trustedBubble(current.sessionId, current.userId)?.text ?? null : null,
    bubbleFor(sessionId, userId) {
      const bubble = trustedBubble(sessionId, userId);
      return bubble ? `${bubble.name}: ${bubble.text}` : null;
    },
    removeSender(userId) {
      for (const [key, bubble] of trustedBubbles) if (bubble.userId === userId) trustedBubbles.delete(key);
      feed.removeSender(userId);
    },
    destroy() { stop(); windowTarget?.removeEventListener?.('offline', onOffline); windowTarget?.removeEventListener?.('pagehide', stop); }
  };
}
