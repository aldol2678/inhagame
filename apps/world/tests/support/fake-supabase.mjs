// Deterministic stand-in for supabase-js + Supabase Realtime, shaped like the realtime-js channel
// API the adapter uses (channel/on/subscribe/track/untrack/send/presenceState/removeChannel).
// The server enforces the same rule as migration 20260927140000: private channel, any signed-in
// account (permanent or anonymous guest), world:campus:AREA_* topic. No sockets; time comes from
// FakeScheduler.

const WORLD_TOPIC = /^world:campus:AREA_[A-Z0-9_]{1,60}$/;
const clone = (value) => JSON.parse(JSON.stringify(value));

export class FakeRealtimeServer {
  constructor({ scheduler, latencyMs = 30 }) {
    this.scheduler = scheduler;
    this.latencyMs = latencyMs;
    this.online = true;
    this.members = new Map(); // topic -> Map(channel -> meta|null)
    this.wire = [];
    this.joins = [];
    this.refs = 0;
  }

  authorize(channel) {
    const user = channel.client.session?.user;
    return channel.opts?.config?.private === true && !!user?.id
      && channel.client.realtimeToken === channel.client.session?.access_token && WORLD_TOPIC.test(channel.topic);
  }

  #later(fn) { this.scheduler.schedule(this.latencyMs, fn); }

  #room(topic) {
    if (!this.members.has(topic)) this.members.set(topic, new Map());
    return this.members.get(topic);
  }

  #state(topic) {
    const state = {};
    for (const [channel, meta] of this.#room(topic)) {
      if (!meta) continue;
      (state[channel.presenceKey] ??= []).push(meta);
    }
    return state;
  }

  #presenceDiff(topic, kind, meta, key = undefined) {
    for (const channel of this.#room(topic).keys()) {
      this.#later(() => {
        if (!channel.joined) return;
        channel.presence = this.#state(topic);
        channel.fire("presence", kind, kind === "join" ? { key, newPresences: [clone(meta)] } : { key, leftPresences: [clone(meta)] });
        channel.fire("presence", "sync", {});
      });
    }
  }

  subscribe(channel, callback) {
    this.#later(() => {
      if (!this.online || channel.client.dropped) { callback("CHANNEL_ERROR"); return; }
      if (!this.authorize(channel)) { callback("CHANNEL_ERROR", new Error("Unauthorized")); return; }
      channel.joined = true;
      this.#room(channel.topic).set(channel, null);
      this.joins.push(channel.topic);
      channel.presence = this.#state(channel.topic);
      callback("SUBSCRIBED");
      channel.fire("presence", "sync", {});
    });
  }

  track(channel, payload) {
    if (!channel.joined) return Promise.resolve("error");
    this.wire.push({ kind: "presence", topic: channel.topic, payload: clone(payload) });
    const room = this.#room(channel.topic);
    const previous = room.get(channel);
    const meta = { ...clone(payload), presence_ref: `ref-${++this.refs}` };
    room.set(channel, meta);
    // Like Phoenix presence syncDiff: a re-track of the same key delivers join(new) before leave(old),
    // and presenceState already holds only the new meta when both callbacks run.
    this.#presenceDiff(channel.topic, "join", meta, channel.presenceKey);
    if (previous) this.#presenceDiff(channel.topic, "leave", previous, channel.presenceKey);
    return Promise.resolve("ok");
  }

  untrack(channel) {
    const room = this.#room(channel.topic);
    const meta = room.get(channel);
    if (meta) { room.set(channel, null); this.#presenceDiff(channel.topic, "leave", meta); }
    return Promise.resolve("ok");
  }

  leave(channel) {
    const room = this.#room(channel.topic);
    const meta = room.get(channel);
    room.delete(channel);
    channel.joined = false;
    if (meta) this.#presenceDiff(channel.topic, "leave", meta);
  }

  send(channel, message) {
    if (!channel.joined) return Promise.resolve("error");
    this.wire.push({ kind: message.event, topic: channel.topic, payload: clone(message.payload) });
    for (const other of this.#room(channel.topic).keys()) {
      if (other === channel) continue; // broadcast.self = false
      const payload = clone(message.payload);
      this.#later(() => { if (other.joined) other.fire("broadcast", message.event, { payload }); });
    }
    return Promise.resolve("ok");
  }

  // Tab killed / socket lost: the server drops the presence, the client sees a channel error.
  dropClient(client) {
    client.dropped = true;
    for (const room of this.members.values()) {
      for (const channel of [...room.keys()]) {
        if (channel.client !== client) continue;
        this.leave(channel);
        channel.statusCallback?.("CHANNEL_ERROR");
      }
    }
  }

  restoreClient(client) { client.dropped = false; }

  setOnline(online) {
    this.online = online;
    if (online) return;
    for (const room of this.members.values()) {
      for (const channel of [...room.keys()]) {
        this.leave(channel);
        channel.statusCallback?.("CHANNEL_ERROR");
      }
    }
  }

  liveSubscriptions(client) {
    let n = 0;
    for (const room of this.members.values()) for (const channel of room.keys()) if (channel.client === client) n += 1;
    return n;
  }
}

class FakeChannel {
  constructor(client, topic, opts) {
    Object.assign(this, { client, topic, opts, joined: false, presence: {}, handlers: [] });
    this.presenceKey = opts?.config?.presence?.key ?? "anon";
  }
  on(type, filter, callback) { this.handlers.push({ type, event: filter?.event, callback }); return this; }
  fire(type, event, payload) {
    for (const h of this.handlers) if (h.type === type && h.event === event) h.callback(payload);
  }
  subscribe(callback) { this.statusCallback = callback; this.client.server.subscribe(this, callback); return this; }
  presenceState() { return clone(this.presence); }
  track(payload) { return this.client.server.track(this, payload); }
  untrack() { return this.client.server.untrack(this); }
  send(message) { return this.client.server.send(this, message); }
}

// A client created with `auth.storageKey` is a separate auth store (the World guest client). Its
// persisted session is shared by every client on the same lib and key, like localStorage.
// anonymousSignIns: false mimics a project with anonymous sign-ins disabled.
export function createFakeSupabaseLib(server, { user = null, nickname = "오리친구", accessToken = "token-", anonymousSignIns = true, label = "x" } = {}) {
  const stores = new Map([["default", user ? { access_token: `${accessToken}${user.id}`, refresh_token: "refresh-secret", user } : null]]);
  const lib = { anonymousSignInCalls: 0, clients: [] };
  lib.createClient = function createClient(_url, _key, options = {}) {
      const storageKey = options?.auth?.storageKey ?? "default";
      const listeners = new Set();
      const client = {
        server,
        storageKey,
        dropped: false,
        realtimeToken: null,
        get session() { return stores.get(storageKey) ?? null; },
        set session(value) { stores.set(storageKey, value); },
        channels: new Set(),
        auth: {
          getSession: async () => ({ data: { session: client.session }, error: null }),
          signInAnonymously: async () => {
            lib.anonymousSignInCalls += 1;
            if (!anonymousSignIns) return { data: { user: null, session: null }, error: { message: "Anonymous sign-ins are disabled" } };
            const guestUser = { id: `anon-${label}-${lib.anonymousSignInCalls}`, is_anonymous: true };
            client.session = { access_token: `${accessToken}${guestUser.id}`, refresh_token: "refresh-secret", user: guestUser };
            return { data: { user: guestUser, session: client.session }, error: null };
          },
          onAuthStateChange(callback) {
            listeners.add(callback);
            return { data: { subscription: { unsubscribe: () => listeners.delete(callback) } } };
          }
        },
        realtime: { setAuth: async (token) => { client.realtimeToken = token; } },
        channel(topic, opts) { const ch = new FakeChannel(client, topic, opts); client.channels.add(ch); return ch; },
        removeChannel(channel) { client.channels.delete(channel); server.leave(channel); return Promise.resolve("ok"); },
        from(table) {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: table === "profiles" ? { nickname } : null, error: null }) }) }) };
        },
        signOut() { client.session = null; for (const l of listeners) l("SIGNED_OUT", null); },
        // Test hook: another tab signed in to this auth store.
        signIn(nextUser) {
          client.session = { access_token: `${accessToken}${nextUser.id}`, refresh_token: "refresh-secret", user: nextUser };
          for (const l of listeners) l("SIGNED_IN", client.session);
        }
      };
      lib.clients.push(client);
      return client;
  };
  return lib;
}
