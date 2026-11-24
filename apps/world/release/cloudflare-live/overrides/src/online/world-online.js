// INHA WORLD Online P0 bootstrap: Firebase + Neon account → local-only transport →
// NetworkManager, fed by semantic Place Zones and a read-only pose source, rendered by
// RemotePlayerView. Every failure path leaves the local World running (offline fallback).
//
// Guests (no permanent account) get a local guest session (random id, no server login).
// They only move and jump: no chat, no emote, no identity, no social layer. The guest
// session id doubles as the guest profile user id when a profile is created for it, so the
// Firebase login flow can link it to an identity later (ACCOUNT-DESIGN.md §4).
//
// Engine-free: the PlayCanvas avatar factory is injected by main.js, so Node tests drive this
// module with fakes.

import { NetworkManager } from "../network/network-manager.js";
import { normalizeDisplayName } from "../network/protocol.js";
import { LocalOnlyTransport } from "../network/local-only-transport.js";
import { PlaceZoneNetworkBridge } from "./place-zone-bridge.js";
import { createPoseSource } from "./pose-source.js";
import { RemotePlayerView } from "./remote-player-view.js";
import { createOnlineHud } from "./online-hud.js";
import { ChatComposer, ChatFeed, passThroughModeration } from "./local-chat.js";
import { ActionType, equipmentKey } from "../network/protocol.js";
import { readSnapshotSessionId } from "../activity/session-id.js";
import { setStaffBadgeClient } from "../staff-badges.js";

// The guest session id lives under the Firebase + Neon bridge key (ACCOUNT-DESIGN.md §4):
// the server uses this id as the guest profile user id, so the Firebase login flow can
// link it to an identity later. The old guest storage key
// ("inhagame-world-guest-auth-v1") is gone; nothing reads it anymore.
export const GUEST_SESSION_STORAGE_KEY = "inhaworld-guest-session-v1";
export const FIREBASE_SESSION_STORAGE_KEY = "inhaworld-firebase-session-v1";

const isPermanent = (user) => !!user?.id && user.is_anonymous !== true;

export function startWorldOnline({
  app, places, player, controller, createAvatar, hudElement,
  createTransport = (_client, _options) => new LocalOnlyTransport(),
  allowGuests = true,
  clock = { now: () => Date.now() },
  randomId = () => globalThis.crypto.randomUUID(),
  windowTarget = globalThis.window,
  documentTarget = globalThis.document,
  networkOptions = {},
  moderation = passThroughModeration,
  isSeated = () => false
}) {
  const hud = createOnlineHud(hudElement);
  const poseSource = createPoseSource({ player, controller, isSeated });
  const errors = [];
  let session = null; // { userId, guest, net, transport, bridge, view }
  // Social S1-B2: ephemeral, zone-scoped chat. Guests never send; nothing is stored.
  const chatFeed = new ChatFeed({ clock, moderation });
  const chatComposer = new ChatComposer({
    clock, moderation,
    canSend: () => {
      if (!session || session.guest) return "signed_out";
      if (campusPaused) return "local_room";
      return session.net.isOnline && session.net.zoneSynced ? true : "offline";
    },
    send: (text) => {
      const p = player.getLocalPosition();
      return session.net.reportChat(text, { x: p.x, y: p.y, z: p.z });
    }
  });
  // Public INHAGAME nickname of the signed-in user, or null for guests (World never edits it).
  let identity = null;
  const identityListeners = new Set();
  const setIdentity = (next) => {
    identity = next;
    for (const listener of identityListeners) {
      try { listener(identity); } catch (error) { record("identity", error); }
    }
  };
  // Every auth read/start captures the epoch first; any newer auth event, pagehide or stop() bumps
  // it so a late reply can never (re)open a session for a previous or signed-out account.
  let startEpoch = 0;
  let stopped = false;
  // pagehide → pageshow / visible again: a hidden (possibly BFCache-frozen) page opens no session.
  let suspended = false;
  const isCurrentStart = (epoch) => !stopped && !suspended && epoch === startEpoch;
  // Last frame's remote samples (read-only copies are handed out by remoteByUser).
  let lastSamples = [];
  const teleportListeners = new Set();
  // Club Room P0: while the player is inside a local-only room, the campus session leaves its
  // Place Zone channel (no presence, no poses, no remotes, no chat) but stays signed in.
  let campusPaused = null; // null | { label }
  // Multiplayer Equipment Projection P0: the latest public equipment from the local loadout client,
  // tagged with the account it was read for. Applied only to a member session of that same account.
  let localEquipment = { accountId: null, equipment: null };
  const applyEquipment = () => {
    if (!session || session.guest) return false;
    const mine = localEquipment.accountId === session.userId ? localEquipment.equipment : null;
    return session.net.setEquipment(mine);
  };

  const record = (where, error) => {
    errors.push({ where, message: String(error?.message ?? error), at: clock.now() });
    if (errors.length > 50) errors.shift();
  };

  // ONLINE is shown only once the place-zone channel has synced; before that it is CONNECTING.
  const view = () => {
    const net = session?.net;
    const state = net?.state ?? "OFFLINE";
    return {
      signedIn: !!session,
      guest: session?.guest === true,
      state: state === "ONLINE" && !net.zoneSynced ? "CONNECTING" : state,
      count: net?.onlineCount ?? 0,
      localSpace: campusPaused?.label ?? null
    };
  };

  function equipmentStatus() {
    let avatars = 0;
    let slots = 0;
    for (const avatar of session?.view.avatars.values() ?? []) {
      const active = avatar.equipmentStatus?.().active ?? [];
      if (active.length) avatars += 1;
      slots += active.length;
    }
    return {
      localSlots: session && !session.guest ? equipmentKey(session.net.equipment).split("|").filter(Boolean).length : 0,
      remoteAvatars: avatars,
      remoteSlots: slots,
      republished: session?.net.sent.equipment ?? 0
    };
  }

  function stopSession() {
    setStaffBadgeClient(null);
    if (identity) setIdentity(null);
    chatFeed.setPlaceZone(null);
    if (!session) return;
    const current = session;
    session = null;
    try { current.net.stop(); } catch (error) { record("stop", error); }
    try { current.transport.destroy?.(); } catch (error) { record("destroy", error); }
    current.view.clear();
    lastSamples = [];
  }

  // Member activity has no endpoint in the Firebase + Neon Worker: always a no-op
  // returning false. Callers are unchanged.
  async function touchMemberActivity(_force = false) {
    return false;
  }

  // Public nickname of a member, read from GET /api/world-profile with the device
  // session id (X-Session-Id). Returns undefined when unreadable; callers fall back.
  async function displayNameFor(_userId) {
    try {
      const sessionId = readDeviceSessionId();
      if (!sessionId || typeof globalThis.fetch !== "function") return undefined;
      const response = await globalThis.fetch("/api/world-profile", {
        headers: { "X-Session-Id": sessionId }
      });
      if (!response.ok) return undefined;
      const data = await response.json();
      return data?.profile?.nickname;
    } catch (error) {
      record("profile", error);
      return undefined;
    }
  }

  async function startFor(user, epoch) {
    if (!isCurrentStart(epoch)) return;
    if (!isPermanent(user)) { await startGuest(epoch); return; }
    if (session?.userId === user.id && !session.guest) return;
    stopSession();
    const displayName = await displayNameFor(user.id);
    if (!isCurrentStart(epoch)) return;
    openSession({ userId: user.id, displayName, guest: false });
    void touchMemberActivity(true);
    // Exactly what other players see (presence applies the same nickname rule).
    setIdentity({ userId: user.id, displayName: normalizeDisplayName(displayName) });
    session.net.start();
  }

  // No permanent account: a local guest session. Its id is the guest profile user id
  // (ACCOUNT-DESIGN.md §4 rule 3), so it is stored under the bridge key for the
  // Firebase login flow. A member sign-in later bumps startEpoch and replaces it.
  async function startGuest(epoch) {
    if (!isCurrentStart(epoch)) return;
    if (!allowGuests) { stopSession(); return; }
    if (session?.guest) return;
    stopSession();
    const guestId = randomId();
    openSession({ userId: guestId, displayName: null, guest: true, sessionId: guestId });
    try {
      windowTarget?.localStorage?.setItem?.(GUEST_SESSION_STORAGE_KEY, guestId);
    } catch {
      // Storage blocked: the session still works for this page load.
    }
    session.net.start();
  }

  function openSession({ userId, displayName, guest, sessionId = randomId() }) {
    // Staff badges (Tier 4 guest-open): the badge lookup authenticates with the
    // snapshot session id (X-Session-Id), not a realtime transport client.
    setStaffBadgeClient({ getSessionId: () => readSnapshotSessionId() });
    const transport = createTransport(null, { allowGuest: guest });
    const net = new NetworkManager({
      transport, clock, identity: { sessionId, userId, displayName, guest }, ...networkOptions
    });
    const bridge = new PlaceZoneNetworkBridge(net);
    const remoteView = new RemotePlayerView({ createAvatar, localSessionId: sessionId });
    session = { userId, guest, sessionId, net, transport, bridge, view: remoteView };
    net.onRemoteEvent((event) => {
      if (event.type === "playerLeft") { chatFeed.forget(event.player.sessionId); return; }
      if (event.type === "playerAction" && event.action.type === ActionType.TELEPORT) {
        for (const listener of teleportListeners) {
          try { listener(event.player.userId); } catch (error) { record("teleport", error); }
        }
        return;
      }
      if (event.type !== "playerAction" || event.action.type !== ActionType.CHAT) return;
      const { text, x, y, z } = event.action.payload;
      // Identity comes from Presence (event.player), never from the chat payload.
      chatFeed.receive({
        sender: event.player, placeZoneId: net.placeZoneId, text,
        position: { x, y, z }, receiverPosition: player.getLocalPosition()
      });
    });
    // Before the first zone join, so the initial Presence already carries the current equipment.
    applyEquipment();
    bridge.observe(campusPaused ? null : places.getCurrentPlaceZone()?.id ?? null, clock.now());
  }

  function readDeviceSessionId() {
    try {
      const value = windowTarget?.localStorage?.getItem?.(FIREBASE_SESSION_STORAGE_KEY);
      return typeof value === "string" && value ? value : null;
    } catch {
      return null;
    }
  }

  async function refreshAuth() {
    if (stopped || suspended) return;
    const epoch = ++startEpoch;
    try {
      const deviceSessionId = readDeviceSessionId();
      if (!deviceSessionId || typeof globalThis.fetch !== "function") {
        if (isCurrentStart(epoch)) await startGuest(epoch);
        return;
      }
      const response = await globalThis.fetch("/api/auth/firebase/me", {
        headers: { "X-Session-Id": deviceSessionId }
      });
      if (!isCurrentStart(epoch)) return;
      if (!response.ok) {
        await startGuest(epoch);
        return;
      }
      const me = await response.json();
      if (!isCurrentStart(epoch)) return;
      if (me && me.guest === false && typeof me.profileUserId === "string" && me.profileUserId) {
        await startFor({ id: me.profileUserId, is_anonymous: false, email: me.email ?? null }, epoch);
      } else {
        await startGuest(epoch);
      }
    } catch (error) {
      record("auth", error);
      // An older read failing must not tear down a newer account's session.
      if (isCurrentStart(epoch)) stopSession();
    }
  }

  const offPlace = places.onPlaceZoneChanged((_previous, next) => {
    if (campusPaused) return;
    session?.bridge.observe(next?.id ?? null, clock.now());
  });

  const onUpdate = (dt) => {
    try {
      const { pose, jumped } = poseSource.sample(dt);
      if (session) void touchMemberActivity();
      if (session && campusPaused) {
        // Keep the connection healthy, publish nothing: room coordinates never reach a campus channel.
        session.net.update(null);
      } else if (session) {
        const now = clock.now();
        session.bridge.tick(now);
        if (jumped) session.net.reportJump();
        session.net.update(pose);
        chatFeed.setPlaceZone(session.net.placeZoneId);
        lastSamples = session.net.sampleRemotes();
        session.view.sync(lastSamples.map((s) => ({ ...s, bubble: chatFeed.bubbleFor(s.sessionId) })), dt);
      }
      hud.render(view());
    } catch (error) {
      record("update", error);
    }
  };
  app.on("update", onUpdate);

  // Best effort only: Presence removes a closed tab by itself when its socket drops.
  const onPageHide = () => { suspended = true; startEpoch += 1; stopSession(); };
  // The page is back (BFCache restore, or a browser that fires pagehide on a tab/app switch and
  // later only a non-persisted pageshow or visibilitychange): resume once with a fresh Auth read.
  const resume = () => {
    if (stopped || !suspended) return;
    suspended = false;
    void refreshAuth();
  };
  const onPageShow = () => resume();
  const onVisibilityChange = () => { if (documentTarget?.visibilityState === "visible") resume(); };
  windowTarget?.addEventListener?.("pagehide", onPageHide);
  windowTarget?.addEventListener?.("pageshow", onPageShow);
  documentTarget?.addEventListener?.("visibilitychange", onVisibilityChange);

  // Firebase login/logout is announced by the portal, not by an auth subscription:
  // 'inhaworld-auth-changed' (same tab) and the storage event for the session keys
  // (other tabs) both re-run refreshAuth().
  const onAuthChanged = () => {
    if (!stopped && !suspended) void refreshAuth();
  };
  const onStorage = (event) => {
    if (event?.key === FIREBASE_SESSION_STORAGE_KEY || event?.key === GUEST_SESSION_STORAGE_KEY) onAuthChanged();
  };
  windowTarget?.addEventListener?.("inhaworld-auth-changed", onAuthChanged);
  windowTarget?.addEventListener?.("storage", onStorage);
  void refreshAuth();
  hud.render(view());

  return {
    get network() { return session?.net ?? null; },
    get transport() { return session?.transport ?? null; },
    get bridge() { return session?.bridge ?? null; },
    get remoteView() { return session?.view ?? null; },
    get errors() { return errors.slice(); },
    status() {
      const v = view();
      return {
        ...v,
        sessionId: session?.sessionId ?? null,
        guest: session?.guest === true,
        placeZone: session?.net.placeZoneId ?? null,
        remotes: session ? session.net.remotes.list().map((p) => ({ sessionId: p.sessionId, displayName: p.displayName, placeZoneId: p.placeZoneId, anim: p.anim })) : [],
        avatars: session?.view.size ?? 0,
        // Counts only: no entities, no raw Presence, no auth data.
        equipment: equipmentStatus(),
        liveChannels: session?.transport.liveChannelCount ?? 0,
        sent: session ? { ...session.net.sent } : null
      };
    },
    refreshAuth,
    /**
     * Local public equipment (from the server loadout READY snapshot, see appearance/equipment-presence.js)
     * for `accountId`. Stored across sessions and room pauses; Presence is republished only when the
     * value changes while a Place Zone is joined. Guests and other accounts never publish it.
     */
    setLocalEquipment(accountId, equipment) {
      localEquipment = { accountId: accountId ?? null, equipment: equipment ?? null };
      return applyEquipment();
    },
    // Club Room P0: leave the campus Place Zone channel now (no ghost avatar outside) and stay
    // signed in. No room channel is created; interiors are local-only in P0.
    pauseCampus({ label = "실내" } = {}) {
      if (campusPaused) return false;
      campusPaused = { label };
      if (session) {
        session.bridge.commitNow(null);
        session.view.clear();
      }
      lastSamples = [];
      chatFeed.setPlaceZone(null);
      hud.render(view());
      return true;
    },
    // Back outside: join the Place Zone the player now stands in.
    resumeCampus() {
      if (!campusPaused) return false;
      campusPaused = null;
      if (session) {
        session.bridge.commitNow(places.getCurrentPlaceZone()?.id ?? null);
        session.net.publisher.forceSnapshot();
      }
      hud.render(view());
      return true;
    },
    get campusPaused() { return campusPaused !== null; },
    // Social S1-B sit: send the new pose state now instead of waiting for the publish tick.
    forcePose() {
      if (!session) return false;
      session.net.publisher.forceSnapshot();
      return true;
    },
    // Where other players in our Place Zone are sitting (best-effort seat occupancy).
    remoteSeatedPositions() {
      if (!session) return [];
      return session.net.remotes.inZone(session.net.placeZoneId)
        .filter((p) => p.latestPose?.anim === "sit")
        .map((p) => ({ x: p.latestPose.x, y: p.latestPose.y, z: p.latestPose.z, sessionId: p.sessionId }));
    },
    // Social S1-B1: broadcast an emote for the signed-in user. Guests and offline: false, no traffic.
    reportEmote(emoteId) {
      if (!session || session.guest) return false;
      return session.net.reportEmote(emoteId);
    },
    get identity() { return identity; },
    // X-Session-Id supplier for the Firebase + Neon API clients (replaces the old
    // member-client getter). Null when no session is open.
    getSessionId() { return session?.sessionId ?? null; },
    get userId() { return session && !session.guest ? session.userId : null; },
    get isGuest() { return session?.guest === true; },
    // Trusted identity of a remote session (Presence), for Player Inspect. Remote guests are not
    // inspectable (no profile, never a friend or follow target).
    remotePlayer(sessionId) {
      const p = session?.net.remotes.get(sessionId);
      return p && !p.guest ? { sessionId: p.sessionId, userId: p.userId, displayName: p.displayName, placeZoneId: p.placeZoneId } : null;
    },
    // Social S1-C2 Follow: the current session of a user (Presence keeps one visible session per
    // user) with its last sampled pose. A frozen copy; null when absent or when we are offline.
    remoteByUser(userId) {
      if (!session || !userId) return null;
      const s = lastSamples.find((sample) => sample.userId === userId && !sample.guest);
      if (!s) return null;
      return Object.freeze({
        userId: s.userId, sessionId: s.sessionId, placeZoneId: s.placeZoneId, presence: s.presence, anim: s.anim,
        pose: s.pose ? Object.freeze({ x: s.pose.x, y: s.pose.y, z: s.pose.z, yaw: s.pose.yaw }) : null
      });
    },
    // P0-E: visible, same-zone Presence/pose snapshots for the Nearby panel.
    nearbyRemotes() {
      if (!session || session.guest || campusPaused || !session.net.zoneSynced) return [];
      const zone = session.net.placeZoneId;
      return lastSamples
        .filter(s => s?.pose && !s.guest && s.presence === "present" && s.placeZoneId === zone && s.userId !== session.userId)
        .map(s => Object.freeze({
          userId: s.userId, sessionId: s.sessionId, displayName: s.displayName,
          placeZoneId: s.placeZoneId, presence: s.presence,
          pose: Object.freeze({ x: s.pose.x, y: s.pose.y, z: s.pose.z })
        }));
    },
    // Mini-map M1: read-only same-Place-Zone pose snapshots already held by Realtime.
    miniMapRemotes() {
      if (!session || campusPaused) return [];
      const zone = session.net.placeZoneId;
      return lastSamples
        .filter(sample => sample?.pose && sample.placeZoneId === zone)
        .map(sample => Object.freeze({
          sessionId: sample.sessionId, userId: sample.userId, placeZoneId: sample.placeZoneId,
          pose: Object.freeze({ x: sample.pose.x, z: sample.pose.z })
        }));
    },
    // A remote player announced a TELEPORT action (handler receives its user id).
    onRemoteTeleport(handler) {
      teleportListeners.add(handler);
      return () => teleportListeners.delete(handler);
    },
    chat: {
      feed: chatFeed,
      composer: chatComposer,
      get canChat() { return chatComposer.canSend() === true; },
      get signedIn() { return !!session && !session.guest; },
      // Returns the composer result; own messages appear in the feed and over the local avatar.
      submit(input) {
        const outcome = chatComposer.submit(input);
        if (outcome.result === "sent") chatFeed.addOwn({ sessionId: session.sessionId, name: identity?.displayName, text: outcome.text });
        return outcome;
      },
      ownBubble() { return session ? chatFeed.bubbleFor(session.sessionId) : null; },
      removeSender(userId) { chatFeed.removeSender(userId); }
    },
    onIdentity(handler) {
      identityListeners.add(handler);
      try { handler(identity); } catch (error) { record("identity", error); }
      return () => identityListeners.delete(handler);
    },
    stop() {
      stopped = true;
      startEpoch += 1;
      stopSession();
      offPlace?.();
      windowTarget?.removeEventListener?.("inhaworld-auth-changed", onAuthChanged);
      windowTarget?.removeEventListener?.("storage", onStorage);
      app.off?.("update", onUpdate);
      windowTarget?.removeEventListener?.("pagehide", onPageHide);
      windowTarget?.removeEventListener?.("pageshow", onPageShow);
      documentTarget?.removeEventListener?.("visibilitychange", onVisibilityChange);
    }
  };
}
