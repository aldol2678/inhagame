// One real shared club room with server admission, bounded leases and atomic seats.
// No owner/visitor UUID coercion and no silently successful local-only fallback.
import { NetworkManager } from "../network/network-manager.js";
import { ConnectionState } from "../network/connection-state.js";
import { validatePresence, validatePose } from "../network/protocol.js";
import { createPoseSource } from "../online/pose-source.js";
import { RemotePlayerView } from "../online/remote-player-view.js";
import { ClubRoomTransport } from "./club-room-transport.js";
import { CLUB_ROOM_ID, CLUB_ROOM_CAPACITY, CLUB_ROOM_SEAT_IDS, CLUB_ROOM_SEATS } from "./club-room-seats.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const CLUB_HEARTBEAT_MS = 5_000;
export const CLUB_LEASE_MS = 20_000;
export function parseClubSnapshot(raw, { roomId, sessionId, userId, admissionId = null }) {
  const denied = { allowed: false, reason: typeof raw?.reason === "string" ? raw.reason : "DENIED" };
  if (raw?.allowed !== true || raw.roomId !== roomId || roomId !== CLUB_ROOM_ID ||
      raw.sessionId !== sessionId || raw.userId !== userId || raw.capacity !== CLUB_ROOM_CAPACITY ||
      !UUID.test(raw.admissionId ?? "") || (admissionId && raw.admissionId !== admissionId) ||
      raw.topic !== `world:club:${roomId}:${raw.admissionId}` ||
      !UUID.test(raw.inboxNonce ?? "") || !Number.isSafeInteger(raw.revision) || raw.revision < 0 ||
      !Number.isFinite(raw.leaseMs) || raw.leaseMs <= 0 || raw.leaseMs > CLUB_LEASE_MS ||
      !Array.isArray(raw.participants) || raw.participants.length > CLUB_ROOM_CAPACITY ||
      !Array.isArray(raw.seats) || raw.seats.length > CLUB_ROOM_CAPACITY) return denied;
  const participants = [], sessions = new Set(), users = new Set();
  for (const packet of raw.participants) {
    const parsed = validatePresence(packet);
    if (!parsed.ok || !UUID.test(packet.sessionId ?? "") || !UUID.test(packet.userId ?? "") ||
        packet.placeZoneId !== CLUB_ROOM_ID || packet.guest === true || sessions.has(packet.sessionId) || users.has(packet.userId)) return denied;
    sessions.add(packet.sessionId); users.add(packet.userId); participants.push(parsed.presence);
  }
  if (!participants.some(p => p.sessionId === sessionId && p.userId === userId)) return denied;
  const seats = [], seatIds = new Set(), sitters = new Set();
  for (const seat of raw.seats) {
    if (!CLUB_ROOM_SEAT_IDS.includes(seat?.seatId) || seatIds.has(seat.seatId) || sitters.has(seat.sessionId) ||
        !participants.some(p => p.sessionId === seat.sessionId && p.userId === seat.userId)) return denied;
    seatIds.add(seat.seatId); sitters.add(seat.sessionId);
    seats.push({ seatId: seat.seatId, sessionId: seat.sessionId, userId: seat.userId });
  }
  const poses = [];
  for (const pose of Array.isArray(raw.poses) ? raw.poses.slice(0, CLUB_ROOM_CAPACITY) : []) {
    const parsed = validatePose(pose?.packet);
    if (parsed.ok && sessions.has(pose.sessionId)) poses.push({ sessionId: pose.sessionId, packet: parsed.pose });
  }
  return { allowed: true, roomId, sessionId, userId, capacity: CLUB_ROOM_CAPACITY,
    admissionId: raw.admissionId, topic: raw.topic, inboxNonce: raw.inboxNonce, leaseMs: raw.leaseMs, revision: raw.revision, participants, seats, poses, claimed: raw.claimed === true,
    reason: typeof raw.reason === "string" ? raw.reason : null };
}

export function createClubRoomSession({
  player, controller, createAvatar, getClient, getIdentity, getEquipment = () => null, isSeated = () => false,
  clock = { now: () => Date.now() }, randomId = () => globalThis.crypto.randomUUID(),
  createTransport = (client, options) => new ClubRoomTransport(client, options),
  onAccessLost = () => {}, onSeatLost = () => {}, onChange = () => {}
} = {}) {
  const poseSource = createPoseSource({ player, controller, isSeated });
  let active = null, epoch = 0, lastKey = "", getChatBubble = () => null;
  let joinTail = Promise.resolve();
  const stats = { entered: 0, denied: 0, evicted: 0, heartbeats: 0, errors: 0, claims: 0 };
  const safe = (fn, value) => { try { return fn(value); } catch { return undefined; } };
  const ownsIdentity = current => getIdentity?.()?.userId === current.userId && getIdentity?.()?.guest !== true;
  function status() {
    if (!active) return Object.freeze({ active: false, phase: "IDLE", roomId: null, sessionId: null, zoneId: null,
      role: null, count: 0, capacity: CLUB_ROOM_CAPACITY, online: false, participants: [], seats: [], seatId: null });
    const current = active;
    const online = current.net?.state === ConnectionState.ONLINE && current.net?.zoneSynced === true &&
      ownsIdentity(current) && clock.now() < current.leaseUntil;
    return Object.freeze({ active: true, phase: !current.net ? "CHECKING" : online ? "READY" : "DEGRADED",
      kind: "club", role: "member", roomId: current.roomId, sessionId: current.sessionId, zoneId: current.roomId,
      userId: current.userId, capacity: CLUB_ROOM_CAPACITY, online,
      count: current.snapshot?.participants.length ?? 0,
      participants: (current.snapshot?.participants ?? []).map(p => ({ ...p, local: p.sessionId === current.sessionId, role: "member" })),
      seats: current.snapshot?.seats ?? [],
      seatId: current.snapshot?.seats.find(s => s.sessionId === current.sessionId)?.seatId ?? null });
  }
  function emit(force = false) {
    const value = status();
    const key = JSON.stringify([value.phase, value.sessionId, value.participants, value.seats]);
    if (!force && key === lastKey) return;
    lastKey = key; safe(onChange, value);
  }
  async function releaseAdmission(current, admissionId = current.admissionId) {
    if (!UUID.test(admissionId ?? "")) return;
    try { await current.client.rpc("leave_world_club_room_v1", {
      p_room: current.roomId, p_admission: admissionId
    }); } catch { /* lease expiry is the reliable disconnect fallback */ }
  }
  function stop() {
    epoch += 1;
    const previous = active; active = null;
    if (previous) {
      if (previous.snapshot?.seats.some(s => s.sessionId === previous.sessionId)) safe(onSeatLost, { roomId: previous.roomId, reason: "STOPPED" });
      safe(() => previous.net?.stop()); safe(() => previous.transport?.destroy?.()); safe(() => previous.view?.clear());
      void releaseAdmission(previous);
    }
    emit(true); return !!previous;
  }
  function evict(current, reason) {
    if (active !== current) return;
    stats.evicted += 1;
    safe(onSeatLost, { roomId: current.roomId, reason });
    stop(); safe(onAccessLost, { roomId: current.roomId, reason });
  }
  function acceptSnapshot(current, raw, requestedAt = clock.now()) {
    if (active !== current || !ownsIdentity(current)) return false;
    const snapshot = parseClubSnapshot(raw, current);
    if (!snapshot.allowed || requestedAt + snapshot.leaseMs <= clock.now()) return false;
    // Heartbeat and seat responses can cross in flight. Only server order may change occupancy.
    if (snapshot.revision < (current.snapshot?.revision ?? -1)) return true;
    const oldSeat = current.snapshot?.seats.find(s => s.sessionId === current.sessionId)?.seatId;
    current.admissionId = snapshot.admissionId;
    current.snapshot = snapshot;
    // Request start is conservative: delayed responses never extend a lease beyond the server.
    current.leaseUntil = requestedAt + snapshot.leaseMs;
    current.lastHeartbeatAt = clock.now();
    current.transport?.setSnapshot?.(snapshot, current.leaseUntil);
    if (oldSeat && !snapshot.seats.some(s => s.sessionId === current.sessionId && s.seatId === oldSeat)) {
      safe(onSeatLost, { roomId: current.roomId, reason: "SEAT_LOST" });
    }
    emit(); return true;
  }
  async function enter({ roomId = CLUB_ROOM_ID } = {}) {
    const client = getClient?.(), identity = getIdentity?.();
    if (roomId !== CLUB_ROOM_ID || !client || !UUID.test(identity?.userId ?? "") || identity.guest === true) {
      safe(onAccessLost, { roomId, reason: "PERMANENT_ACCOUNT_REQUIRED" }); return false;
    }
    stop();
    const sessionId = randomId();
    if (!UUID.test(sessionId ?? "")) return false;
    const myEpoch = ++epoch;
    const current = active = { roomId, sessionId, admissionId: null, userId: identity.userId, client,
      net: null, view: null, transport: null, snapshot: null, leaseUntil: 0, checking: false,
      seatPending: false, lastHeartbeatAt: clock.now(), wasOnline: false };
    emit(true);
    try {
      const requestedAt = clock.now();
      // Serialize local admission intents. A delayed older join must revoke its own returned
      // admission before a new join, even when both attempts reuse the same client pose UUID.
      const joining = joinTail.catch(() => {}).then(async () => {
        if (myEpoch !== epoch || active !== current) return null;
        const result = await client.rpc("join_world_club_room_v1", { p_room: roomId, p_session: sessionId });
        if (myEpoch !== epoch || active !== current) {
          await releaseAdmission(current, result?.data?.admissionId);
          return null;
        }
        return result;
      });
      joinTail = joining.catch(() => {});
      const result = await joining;
      if (myEpoch !== epoch || active !== current) return false;
      const { data, error } = result ?? {};
      if (error) throw error;
      if (!acceptSnapshot(current, data, requestedAt)) { stats.denied += 1; evict(current, data?.reason ?? "DENIED"); return false; }
      current.transport = createTransport(client, { roomId, sessionId, admissionId: current.admissionId, userId: current.userId, clock,
        onSnapshot: (raw, requestedAt) => acceptSnapshot(current, raw, requestedAt), onDenied: reason => evict(current, reason) });
      current.transport.setSnapshot?.(current.snapshot, current.leaseUntil);
      current.net = new NetworkManager({ transport: current.transport, clock,
        identity: { sessionId, userId: current.userId, displayName: identity.displayName } });
      current.view = new RemotePlayerView({ createAvatar, localSessionId: sessionId });
      current.net.setEquipment(getEquipment() ?? null);
      current.net.setPlaceZone(roomId); current.net.start();
      stats.entered += 1; emit(true); return true;
    } catch {
      if (active === current) { stats.errors += 1; evict(current, "UNAVAILABLE"); }
      return false;
    }
  }
  async function revalidate(current = active) {
    if (!current?.net || current.checking || active !== current) return false;
    if (!ownsIdentity(current)) { evict(current, "IDENTITY"); return false; }
    current.checking = true; stats.heartbeats += 1;
    const requestedAt = clock.now();
    try {
      const { data, error } = await current.client.rpc("heartbeat_world_club_room_v1", {
        p_room: current.roomId, p_admission: current.admissionId
      });
      if (active !== current) return false;
      if (error) throw error;
      if (!acceptSnapshot(current, data, requestedAt)) { evict(current, data?.reason ?? "DENIED"); return false; }
      return true;
    } catch { stats.errors += 1; return false; }
    finally { current.checking = false; current.lastHeartbeatAt = clock.now(); }
  }
  async function seatMutation(name, seatId, expectedSessionId, expectedAdmissionId, claim) {
    const current = active;
    if (!current || current.sessionId !== expectedSessionId || current.admissionId !== expectedAdmissionId || !ownsIdentity(current) ||
        !CLUB_ROOM_SEAT_IDS.includes(seatId) || (claim && (!status().online || current.seatPending))) return false;
    if (claim) current.seatPending = true;
    try {
      const requestedAt = clock.now();
      const { data, error } = await current.client.rpc(name, {
        p_room: current.roomId, p_admission: current.admissionId, p_seat: seatId
      });
      if (active !== current || !ownsIdentity(current)) return false;
      if (error) throw error;
      if (!acceptSnapshot(current, data, requestedAt)) { evict(current, data?.reason ?? "DENIED"); return false; }
      if (claim && data.claimed === true) stats.claims += 1;
      return claim ? data.claimed === true && status().seatId === seatId : true;
    } catch { stats.errors += 1; return false; }
    finally { if (claim) current.seatPending = false; }
  }
  function update(dt) {
    const current = active; if (!current) return;
    if (!ownsIdentity(current)) { evict(current, "IDENTITY"); return; }
    if (!current.net) return;
    if (clock.now() >= current.leaseUntil) { evict(current, "SESSION_EXPIRED"); return; }
    if (clock.now() - current.lastHeartbeatAt >= CLUB_HEARTBEAT_MS) void revalidate(current);
    const step = Math.min(Math.max(Number(dt) || 0, 0), .05);
    const sample = poseSource.sample(step);
    if (sample.jumped) current.net.reportJump();
    current.net.update(sample.pose);
    current.transport?.flushPose?.();
    current.view.sync(current.net.sampleRemotes().filter(remote => current.snapshot?.participants.some(
      p => p.sessionId === remote.sessionId && p.userId === remote.userId)).map(remote => ({ ...remote,
      bubble: safe(() => getChatBubble(remote.sessionId, remote.userId)) ?? null })), step);
    const online = current.net.state === ConnectionState.ONLINE && current.net.zoneSynced === true;
    if (current.wasOnline && !online && status().seatId) safe(onSeatLost, { reason: "DISCONNECTED", roomId: current.roomId });
    current.wasOnline = online; emit();
  }
  return {
    enter, stop, update, status, revalidateNow: () => revalidate(),
    claimSeat: seatId => seatMutation("claim_world_club_room_seat_v1", seatId, active?.sessionId, active?.admissionId, true),
    releaseSeat: (seatId, sessionId = active?.sessionId, admissionId = active?.admissionId) => seatMutation("release_world_club_room_seat_v1", seatId, sessionId, admissionId, false),
    reportEmote: id => status().online && active.net.reportEmote(id) === true,
    setEquipment: value => active?.net?.setEquipment(value ?? null) === true,
    forcePose() { if (!active?.net) return false; active.net.publisher.forceSnapshot(); return true; },
    // Install once before admission. The chat owner clears its own account-scoped data on stop.
    setChatBubbles(getBubble) { getChatBubble = typeof getBubble === "function" ? getBubble : () => null; },
    remoteSeatedPositions() {
      return (active?.snapshot?.seats ?? []).filter(s => s.sessionId !== active.sessionId).map(s => ({
        ...CLUB_ROOM_SEATS.find(a => a.seatId === s.seatId).position, sessionId: s.sessionId
      }));
    },
    remotePlayer(sessionId) {
      const p = active?.snapshot?.participants.find(p => p.sessionId === sessionId && p.sessionId !== active.sessionId);
      return p ? { ...p, roomId: active.roomId, role: "member" } : null;
    },
    get active() { return !!active; },
    get admissionId() { return active?.admissionId ?? null; },
    get stats() { return { ...stats, liveChannels: active?.transport?.liveChannelCount ?? 0, avatars: active?.view?.size ?? 0 }; }
  };
}
