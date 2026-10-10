// INHA WORLD Online P0 bootstrap: permanent INHAGAME account → Supabase Realtime transport →
// NetworkManager, fed by semantic Place Zones and a read-only pose source, rendered by
// RemotePlayerView. Every failure path leaves the local World running (offline fallback).
//
// Guests (no permanent account) join the same Place Zone channels through a separate anonymous
// Supabase session. They only move and jump: no chat, no emote, no identity, no social layer.
//
// Engine-free: the PlayCanvas avatar factory is injected by main.js, so Node tests drive this
// module with fakes.

import { NetworkManager } from "../network/network-manager.js";
import { normalizeDisplayName } from "../network/protocol.js";
import { SupabaseRealtimeTransport } from "../network/supabase-realtime-transport.js";
import { PlaceZoneNetworkBridge } from "./place-zone-bridge.js";
import { createPoseSource } from "./pose-source.js";
import { RemotePlayerView } from "./remote-player-view.js";
import { createOnlineHud } from "./online-hud.js";
import { ChatComposer, ChatFeed, passThroughModeration } from "./local-chat.js";
import { ActionType, equipmentKey } from "../network/protocol.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config/supabase-public-config.js";
import { setStaffBadgeClient } from "../staff-badges.js";
export { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "../config/supabase-public-config.js";

// The guest session lives under its own storage key so it never replaces or signs out the
// shared INHAGAME member session (hub-account.js), and is reused across reloads.
export const GUEST_AUTH_STORAGE_KEY = "inhagame-world-guest-auth-v1";

const isPermanent = (user) => !!user?.id && user.is_anonymous !== true;
const MEMBER_ACTIVITY_INTERVAL_MS = 300_000;

export function startWorldOnline({
  app, places, player, controller, createAvatar, hudElement,
  supabaseLib = globalThis.window?.supabase,
  createClient = (lib) => lib?.createClient?.(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY),
  createGuestClient = (lib) => lib?.createClient?.(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { storageKey: GUEST_AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
  }),
  createTransport = (client, options) => new SupabaseRealtimeTransport(client, options),
  allowGuests = true,
  clock = { now: () => Date.now() },
  randomId = () => globalThis.crypto.randomUUID(),
  windowTarget = globalThis.window,
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
  // Connection-creation boundary. `stopped` is terminal (stop(): operator ejection, teardown).
  // `suspended` is a recoverable hold used when the server-side allowed state cannot be confirmed;
  // resume() lifts it. `startEpoch` orders auth resolutions: any later stop / sign-out / refresh makes
  // an earlier, still-awaiting resolution stale. A Realtime session is only ever created through
  // openSession(), and only while mayConnect(epoch) holds.
  let stopped = false;
  let suspended = null; // null | { reason }
  let startEpoch = 0;
  const mayConnect = (epoch) => !stopped && suspended === null && epoch === startEpoch;
  let client = null;
  let guestClient = null;
  let memberActivityLastAt = 0;
  let memberActivityPending = false;
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
      localSpace: campusPaused?.label ?? null,
      suspended: suspended !== null
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

  async function touchMemberActivity(force = false) {
    if (!session || session.guest || !client?.rpc || memberActivityPending) return false;
    const now = clock.now();
    if (!force && now - memberActivityLastAt < MEMBER_ACTIVITY_INTERVAL_MS) return false;
    memberActivityPending = true;
    try {
      const result = await client.rpc("touch_inhagame_member_activity_v1", { p_surface: "world" });
      if (result?.error) throw result.error;
      memberActivityLastAt = now;
      return true;
    } catch (error) {
      record("member-activity", error);
      return false;
    } finally {
      memberActivityPending = false;
    }
  }

  async function displayNameFor(userId) {
    try {
      const { data } = await client.from("profiles").select("nickname").eq("user_id", userId).single();
      return data?.nickname;
    } catch (error) {
      record("profile", error);
      return undefined;
    }
  }

  async function startFor(user, epoch) {
    if (!mayConnect(epoch)) return;
    if (!isPermanent(user)) { await startGuest(epoch); return; }
    if (session?.userId === user.id && !session.guest) return;
    stopSession();
    const displayName = await displayNameFor(user.id);
    if (!mayConnect(epoch)) return;
    if (!openSession({ userId: user.id, displayName, guest: false, transportClient: client })) return;
    void touchMemberActivity(true);
    // Exactly what other players see (presence applies the same nickname rule).
    setIdentity({ userId: user.id, displayName: normalizeDisplayName(displayName) });
    session.net.start();
  }

  // No permanent account: an anonymous guest session on its own client. A member sign-in later
  // bumps startEpoch and replaces it.
  async function startGuest(epoch) {
    if (!mayConnect(epoch)) return;
    if (!allowGuests) { stopSession(); return; }
    if (session?.guest) return;
    stopSession();
    try {
      guestClient ??= supabaseLib ? createGuestClient(supabaseLib) : null;
      if (!guestClient?.auth) return;
      const { data } = await guestClient.auth.getSession();
      let user = data?.session?.user ?? null;
      if (!user?.id) {
        if (!mayConnect(epoch)) return;
        const result = await guestClient.auth.signInAnonymously();
        if (result?.error) throw result.error;
        user = result?.data?.user ?? result?.data?.session?.user ?? null;
      }
      if (!mayConnect(epoch) || !user?.id || session) return;
      if (!openSession({ userId: user.id, displayName: null, guest: true, transportClient: guestClient })) return;
      session.net.start();
    } catch (error) {
      // Anonymous sign-ins disabled or rate limited: stay offline until the next auth event.
      record("guest", error);
    }
  }

  function openSession({ userId, displayName, guest, transportClient }) {
    // Last line of defence: no Realtime transport is ever built after stop() or while suspended.
    if (stopped || suspended !== null) return false;
    setStaffBadgeClient(transportClient);
    const transport = createTransport(transportClient, { allowGuest: guest });
    const sessionId = randomId();
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
    return true;
  }

  async function refreshAuth() {
    if (stopped || suspended !== null) return;
    // The epoch is taken BEFORE awaiting the auth answer, so stop() / sign-out / a newer refresh that
    // happens while getSession() is pending invalidates this resolution.
    const epoch = ++startEpoch;
    try {
      const { data } = await client.auth.getSession();
      if (!mayConnect(epoch)) return;
      await startFor(data?.session?.user ?? null, epoch);
    } catch (error) {
      record("auth", error);
      if (epoch === startEpoch && !stopped) stopSession();
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
  const onPageHide = () => stopSession();
  // A page restored from the back/forward cache starts a fresh session.
  const onPageShow = (event) => { if (event?.persisted && !stopped) void refreshAuth(); };
  windowTarget?.addEventListener?.("pagehide", onPageHide);
  windowTarget?.addEventListener?.("pageshow", onPageShow);

  try {
    client = supabaseLib ? createClient(supabaseLib) : null;
  } catch (error) {
    record("client", error);
  }
  let offAuth = null;
  if (client) {
    try {
      const { data } = client.auth.onAuthStateChange((event) => {
        // Supabase advises not awaiting client calls inside this callback.
        setTimeout(() => {
          // Already-scheduled callbacks outlive stop(); they must not reconnect.
          if (stopped) return;
          if (event === "SIGNED_OUT") { startEpoch += 1; stopSession(); void refreshAuth(); return; }
          if (event === "SIGNED_IN" || event === "INITIAL_SESSION" || event === "USER_UPDATED") void refreshAuth();
        }, 0);
      });
      offAuth = data?.subscription;
    } catch (error) {
      record("auth", error);
    }
    void refreshAuth();
  }
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
    // Social S1-C1: the signed-in Supabase client and user id, for the social RPC layer only.
    // Both stay null for a guest session: guests have no social layer.
    get supabase() { return session && !session.guest ? client : null; },
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
    get suspended() { return suspended !== null; },
    get stopped() { return stopped; },
    // Recoverable hold: tear the Realtime session down and refuse to create one until resume().
    // Used when the server-side allowed state cannot be confirmed (see world-population-heartbeat.js).
    suspend(reason = "unverified") {
      if (stopped || suspended !== null) return false;
      suspended = { reason };
      startEpoch += 1;
      stopSession();
      hud.render(view());
      return true;
    },
    // Lifts a suspend() and reconnects through the normal auth path. Never revives a stopped layer.
    resume() {
      if (stopped || suspended === null) return false;
      suspended = null;
      hud.render(view());
      void refreshAuth();
      return true;
    },
    stop() {
      stopped = true;
      suspended = null;
      startEpoch += 1;
      stopSession();
      offPlace?.();
      offAuth?.unsubscribe?.();
      app.off?.("update", onUpdate);
      windowTarget?.removeEventListener?.("pagehide", onPageHide);
      windowTarget?.removeEventListener?.("pageshow", onPageShow);
    }
  };
}
