// Social S1-D2 · Personal Room Session.
//
// One private Realtime channel per persistent room: world:room:<room uuid>. It never touches the
// campus world:campus:AREA_* namespace: the campus session stays paused (room-world-adapter) while
// this session carries the room's own Presence / Pose / Emote for owner and visitors, reusing
// NetworkManager (pose publishing, interpolation) and RemotePlayerView.
//
// Authority: the server decides. enter() asks check_world_room_access_v1 before any channel is
// opened, the Realtime RLS policy asks the same question per channel, and the session re-asks
// every ROOM_ACCESS_CHECK_MS (and right after a reconnect or a relationship change). A denial
// stops the session and reports onAccessLost so the world returns the visitor to the Dorm Lobby.
// A failed check (network) never evicts: the session only degrades. An owner whose first check
// fails keeps the local D1 room (phase LOCAL) and retries, so a client that ships before the D2
// database surface never locks anyone out of their own room.

import { NetworkManager } from "../network/network-manager.js";
import { ConnectionState } from "../network/connection-state.js";
import { SupabaseRealtimeTransport } from "../network/supabase-realtime-transport.js";
import { createPoseSource } from "../online/pose-source.js";
import { RemotePlayerView } from "../online/remote-player-view.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ROOM_ACCESS_CHECK_MS = 15_000;
export const RoomSessionPhase = Object.freeze({
  IDLE: "IDLE", CHECKING: "CHECKING", READY: "READY", DEGRADED: "DEGRADED",
  // Owner only: the server could not be asked; the room works alone (D1 behaviour) and retries.
  LOCAL: "LOCAL"
});

export function personalRoomTopic(roomId) {
  if (typeof roomId !== "string" || !UUID.test(roomId)) throw new TypeError("Invalid personal room id");
  return `world:room:${roomId.toLowerCase()}`;
}

// The NetworkManager zone id for a room: a valid place-zone id (letters, digits, _) that can never
// collide with an AREA_* campus id and is mapped to the room topic by the transport.
export function personalRoomZoneId(roomId) {
  if (typeof roomId !== "string" || !UUID.test(roomId)) throw new TypeError("Invalid personal room id");
  return `ROOM_${roomId.replaceAll("-", "").toUpperCase()}`;
}

// Narrow parse of check_world_room_access_v1: anything unexpected counts as a denial.
export function parseRoomAccess(raw, roomId) {
  if (!raw || typeof raw !== "object" || raw.roomId !== roomId) return { allowed: false, reason: "DENIED" };
  if (raw.allowed !== true) return { allowed: false, reason: typeof raw.reason === "string" ? raw.reason : "DENIED" };
  if (!["owner", "visitor"].includes(raw.role) || !UUID.test(raw.ownerUserId ?? "")) return { allowed: false, reason: "DENIED" };
  return { allowed: true, role: raw.role, ownerUserId: raw.ownerUserId, visibility: raw.visibility ?? null };
}

export function createPersonalRoomSession({
  player, controller, createAvatar, getClient, getIdentity, getEquipment = () => null,
  clock = { now: () => Date.now() }, randomId = () => globalThis.crypto.randomUUID(),
  createTransport = (client, roomId) => new SupabaseRealtimeTransport(client, { topicFor: () => personalRoomTopic(roomId) }),
  accessCheckMs = ROOM_ACCESS_CHECK_MS, onAccessLost = () => {}, onChange = () => {}
} = {}) {
  const poseSource = createPoseSource({ player, controller, isSeated: () => false });
  let active = null;
  let epoch = 0;
  let lastKey = "";
  const stats = { entered: 0, denied: 0, evicted: 0, checks: 0, checkErrors: 0 };

  function status() {
    if (!active) {
      return Object.freeze({ active: false, phase: RoomSessionPhase.IDLE, roomId: null, role: null, count: 0,
        ownerPresent: false, state: "OFFLINE", participants: Object.freeze([]) });
    }
    const remotes = active.net ? active.net.sampleRemotes() : [];
    const participants = [
      { sessionId: active.sessionId, userId: active.userId, displayName: active.displayName,
        role: active.role, local: true },
      ...remotes.map(sample => ({
        sessionId: sample.sessionId, userId: sample.userId, displayName: sample.displayName,
        role: sample.userId === active.ownerUserId ? "owner" : "visitor", local: false
      }))
    ];
    const state = active.net?.state ?? "OFFLINE";
    const online = state === ConnectionState.ONLINE && active.net?.zoneSynced === true;
    return Object.freeze({
      active: true,
      phase: active.local ? RoomSessionPhase.LOCAL
        : active.net ? (online ? RoomSessionPhase.READY : RoomSessionPhase.DEGRADED) : RoomSessionPhase.CHECKING,
      roomId: active.roomId, ownerUserId: active.ownerUserId, ownerDisplayName: active.ownerDisplayName,
      role: active.role, visibility: active.visibility, state, online,
      count: participants.length,
      ownerPresent: participants.some(p => p.role === "owner"),
      participants: Object.freeze(participants.map(p => Object.freeze(p)))
    });
  }
  function emit(force = false) {
    const s = status();
    const key = `${s.phase}|${s.roomId}|${s.role}|${s.count}|${s.ownerPresent}|${s.visibility}`;
    if (!force && key === lastKey) return;
    lastKey = key;
    try { onChange(s); } catch { /* a broken HUD never breaks the session */ }
  }

  function teardown(current) {
    try { current.net?.stop(); } catch { /* ignore */ }
    try { current.transport?.destroy?.(); } catch { /* ignore */ }
    try { current.view?.clear(); } catch { /* ignore */ }
  }
  function stop() {
    epoch += 1;
    const previous = active;
    active = null;
    if (previous) teardown(previous);
    emit(true);
    return !!previous;
  }
  function evict(current, reason) {
    if (active !== current) return;
    stats.evicted += 1;
    stop();
    try { onAccessLost({ roomId: current.roomId, role: current.role, reason }); } catch { /* ignore */ }
  }

  async function checkAccess(client, roomId) {
    stats.checks += 1;
    const { data, error } = await client.rpc("check_world_room_access_v1", { p_room: roomId });
    if (error) throw new Error(String(error.message ?? "ACCESS_CHECK_FAILED"));
    return parseRoomAccess(data, roomId);
  }

  // Opens the room channel once the server has said yes.
  function connect(current, access, client) {
    current.visibility = access.visibility;
    current.local = false;
    current.sessionId = randomId();
    current.zoneId = personalRoomZoneId(current.roomId);
    current.transport = createTransport(client, current.roomId);
    current.net = new NetworkManager({
      transport: current.transport, clock,
      identity: { sessionId: current.sessionId, userId: current.userId, displayName: current.displayName }
    });
    current.view = new RemotePlayerView({ createAvatar, localSessionId: current.sessionId });
    current.net.setEquipment(getEquipment?.() ?? null);
    current.net.setPlaceZone(current.zoneId);
    current.net.start();
    current.lastAccessCheckAt = clock.now();
    stats.entered += 1;
    emit(true);
  }
  function deny(current, reason) {
    stats.denied += 1;
    if (active === current) active = null;
    emit(true);
    try { onAccessLost({ roomId: current.roomId, role: current.role, reason }); } catch { /* ignore */ }
  }
  const matches = (current, access) => access.allowed && access.role === current.role
    && access.ownerUserId === current.ownerUserId && getIdentity?.()?.userId === current.userId;

  // expected: { roomId, ownerUserId, role, ownerDisplayName } from the owner RPC or the friend resolver.
  async function enter({ roomId, ownerUserId, role = "visitor", ownerDisplayName = null } = {}) {
    if (!UUID.test(roomId ?? "") || !UUID.test(ownerUserId ?? "") || !["owner", "visitor"].includes(role)) return false;
    const client = getClient?.();
    const identity = getIdentity?.();
    const userId = identity?.userId;
    if (!client || !UUID.test(userId ?? "")) return false;
    if ((role === "owner") !== (userId === ownerUserId)) return false;
    stop();
    const myEpoch = ++epoch;
    const current = {
      roomId: roomId.toLowerCase(), ownerUserId, role, ownerDisplayName, userId,
      displayName: identity.displayName ?? null, visibility: null, local: false,
      sessionId: null, transport: null, net: null, view: null, zoneId: null,
      lastAccessCheckAt: clock.now(), checking: false, wasOnline: false, everOnline: false
    };
    active = current;
    emit(true);
    let access;
    try {
      access = await checkAccess(client, current.roomId);
    } catch {
      if (myEpoch !== epoch || active !== current) return false;
      // The server could not answer (network, or a database without the D2 surface yet). A visitor
      // needs a positive answer and leaves; the owner keeps the D1 local room and retries.
      if (role === "visitor") { deny(current, "UNAVAILABLE"); return false; }
      current.local = true;
      current.lastAccessCheckAt = clock.now();
      emit(true);
      return true;
    }
    if (myEpoch !== epoch || active !== current) return false;
    if (!matches(current, access)) { deny(current, access.reason ?? "DENIED"); return false; }
    connect(current, access, client);
    return true;
  }

  // Owner in a local room: ask again on the check interval; open the channel once it answers yes.
  async function retryLocal(current) {
    if (current.checking) return;
    current.checking = true;
    try {
      const client = getClient?.();
      if (!client) { evict(current, "SIGNED_OUT"); return; }
      const access = await checkAccess(client, current.roomId);
      if (active !== current || !current.local) return;
      if (!matches(current, access)) { evict(current, access.reason ?? "DENIED"); return; }
      connect(current, access, client);
    } catch {
      stats.checkErrors += 1;
    } finally {
      current.checking = false;
      current.lastAccessCheckAt = clock.now();
    }
  }

  async function revalidate(current = active) {
    if (!current?.net || current.checking) return;
    current.checking = true;
    try {
      const client = getClient?.();
      if (!client) { evict(current, "SIGNED_OUT"); return; }
      const access = await checkAccess(client, current.roomId);
      if (active !== current) return;
      if (!access.allowed || access.role !== current.role) { evict(current, access.reason ?? "DENIED"); return; }
      if (access.visibility !== current.visibility) { current.visibility = access.visibility; emit(true); }
    } catch {
      stats.checkErrors += 1; // A network blip degrades, it never evicts.
    } finally {
      current.checking = false;
      current.lastAccessCheckAt = clock.now();
    }
  }

  function update(dt) {
    const current = active;
    if (!current) return;
    if (getIdentity?.()?.userId !== current.userId) { evict(current, "IDENTITY"); return; }
    if (current.local) {
      if (clock.now() - current.lastAccessCheckAt >= accessCheckMs) void retryLocal(current);
      return;
    }
    if (!current.net) return;
    const step = Math.min(Math.max(Number(dt) || 0, 0), 0.05);
    const sample = poseSource.sample(step);
    if (sample.jumped) current.net.reportJump();
    current.net.update(sample.pose);
    current.view.sync(current.net.sampleRemotes(), step);
    const online = current.net.state === ConnectionState.ONLINE;
    // A reconnect re-asks at once: access may have changed while we were away.
    if (online && !current.wasOnline) {
      if (current.everOnline) void revalidate(current);
      current.everOnline = true;
    }
    current.wasOnline = online;
    if (clock.now() - current.lastAccessCheckAt >= accessCheckMs) void revalidate(current);
    emit();
  }

  return {
    enter, stop, update,
    revalidateNow: () => revalidate(active),
    setEquipment(equipment) { return active?.net?.setEquipment(equipment ?? null) === true; },
    setVisibility(visibility) {
      if (!active || active.role !== "owner" || !["private", "friends"].includes(visibility)) return false;
      active.visibility = visibility;
      emit(true);
      return true;
    },
    reportEmote(id) { return active?.net?.reportEmote(id) === true; },
    remotePlayer(sessionId) {
      const p = active?.net?.remotes.get(sessionId);
      if (!p || p.guest) return null;
      return Object.freeze({ sessionId: p.sessionId, userId: p.userId, displayName: p.displayName,
        role: p.userId === active.ownerUserId ? "owner" : "visitor", roomId: active.roomId });
    },
    status,
    get active() { return !!active; },
    get stats() {
      return { ...stats, liveChannels: active?.transport?.liveChannelCount ?? 0, avatars: active?.view?.size ?? 0 };
    }
  };
}

