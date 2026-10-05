// Deterministic in-memory NetworkTransport for Node tests and simulations. No sockets, no timers:
// everything runs on FakeScheduler time. Not used by the live World.

import { TransportStatus } from "./transport.js";

export class FakeScheduler {
  constructor(startMs = 0) {
    this.nowMs = startMs;
    this.queue = [];
    this.order = 0;
  }

  now() { return this.nowMs; }

  schedule(delayMs, fn) {
    this.queue.push({ at: this.nowMs + Math.max(0, delayMs), order: this.order++, fn });
  }

  // Run everything due up to `targetMs` in (time, insertion) order, then set the clock there.
  advanceTo(targetMs) {
    for (;;) {
      let next = -1;
      for (let i = 0; i < this.queue.length; i += 1) {
        const item = this.queue[i];
        if (item.at > targetMs) continue;
        if (next < 0 || item.at < this.queue[next].at
          || (item.at === this.queue[next].at && item.order < this.queue[next].order)) next = i;
      }
      if (next < 0) break;
      const [item] = this.queue.splice(next, 1);
      this.nowMs = Math.max(this.nowMs, item.at);
      item.fn();
    }
    this.nowMs = Math.max(this.nowMs, targetMs);
  }

  advance(ms) { this.advanceTo(this.nowMs + ms); }
}

// Small seeded PRNG so loss/jitter/duplication are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const byteLength = (value) => new TextEncoder().encode(JSON.stringify(value)).length;
const clone = (value) => JSON.parse(JSON.stringify(value));

// The fake "server": zone channels with presence tracking and broadcast fan-out.
export class FakeNetworkHub {
  constructor({ scheduler, latencyMs = 40, jitterMs = 0, lossRate = 0, duplicateRate = 0, seed = 1 } = {}) {
    this.scheduler = scheduler;
    this.latencyMs = latencyMs;
    this.jitterMs = jitterMs;
    this.lossRate = lossRate;
    this.duplicateRate = duplicateRate;
    this.random = mulberry32(seed);
    this.clients = new Map();
    this.channels = new Map();
    this.unreachable = new Set();
    this.reachable = true;
    // Every payload a client put on the wire, for privacy scans and bandwidth.
    this.wire = [];
    this.metrics = {
      pose: { sent: 0, bytes: 0, delivered: 0, dropped: 0, duplicated: 0 },
      action: { sent: 0, bytes: 0, delivered: 0, dropped: 0, duplicated: 0 },
      presence: { sent: 0, bytes: 0, delivered: 0 }
    };
  }

  createTransport(label) {
    return new FakeNetworkTransport(this, label);
  }

  #delay() {
    return this.latencyMs + (this.jitterMs ? this.random() * this.jitterMs : 0);
  }

  #isReachable(transport) {
    return this.reachable && !this.unreachable.has(transport.label);
  }

  // Presence and status ride the client's single ordered socket, so they stay FIFO per receiver.
  // Broadcast (pose/action) may be reordered by jitter to exercise sequence handling.
  #deliver(transport, fn, { ordered = false } = {}) {
    let delay = this.#delay();
    if (ordered) {
      const at = Math.max(this.scheduler.now() + delay, transport.orderedUntil);
      transport.orderedUntil = at;
      delay = at - this.scheduler.now();
    }
    this.scheduler.schedule(delay, () => {
      if (transport.connected && this.#isReachable(transport)) fn();
    });
  }

  #record(kind, from, placeZoneId, payload) {
    this.wire.push({ kind, from, placeZoneId, payload: clone(payload), at: this.scheduler.now() });
  }

  connect(transport, request) {
    this.#record("connect", transport.label, null, { sessionId: request?.sessionId });
    this.scheduler.schedule(this.#delay(), () => {
      if (!this.#isReachable(transport)) {
        transport.emitStatus({ status: TransportStatus.ERROR, reason: "unreachable" });
        return;
      }
      transport.connected = true;
      transport.sessionId = request.sessionId;
      this.clients.set(transport.label, transport);
      transport.emitStatus({ status: TransportStatus.CONNECTED });
    });
  }

  // Deliberate close from the client.
  disconnect(transport) {
    this.#drop(transport);
  }

  // Server-side loss of one client (tab killed, Wi-Fi gone): others see presence leave.
  dropClient(label, { reachable = false } = {}) {
    const transport = this.clients.get(label);
    if (!reachable) this.unreachable.add(label);
    if (!transport) return;
    this.#drop(transport);
    transport.emitStatus({ status: TransportStatus.DISCONNECTED, reason: "dropped" });
  }

  restoreClient(label) {
    this.unreachable.delete(label);
  }

  // Whole network down/up. Down drops every client.
  setReachable(reachable) {
    this.reachable = reachable;
    if (reachable) return;
    for (const transport of [...this.clients.values()]) {
      this.#drop(transport);
      transport.emitStatus({ status: TransportStatus.DISCONNECTED, reason: "network_down" });
    }
  }

  #drop(transport) {
    for (const placeZoneId of [...transport.zones]) this.leave(transport, placeZoneId);
    transport.connected = false;
    this.clients.delete(transport.label);
  }

  #members(placeZoneId) {
    if (!this.channels.has(placeZoneId)) this.channels.set(placeZoneId, new Map());
    return this.channels.get(placeZoneId);
  }

  #presenceTo(target, event) {
    this.metrics.presence.delivered += 1;
    const payload = clone(event);
    this.#deliver(target, () => target.emit("presence", payload), { ordered: true });
  }

  join(transport, placeZoneId, presence) {
    if (!transport.connected) return;
    this.#record("presence", transport.label, placeZoneId, presence);
    this.metrics.presence.sent += 1;
    this.metrics.presence.bytes += byteLength(presence);
    const members = this.#members(placeZoneId);
    members.set(transport.label, clone(presence));
    transport.zones.add(placeZoneId);
    this.#presenceTo(transport, { type: "sync", placeZoneId, presences: [...members.values()] });
    for (const [label] of members) {
      if (label !== transport.label) this.#presenceTo(this.clients.get(label), { type: "join", placeZoneId, presences: [presence] });
    }
  }

  leave(transport, placeZoneId) {
    const members = this.channels.get(placeZoneId);
    const presence = members?.get(transport.label);
    transport.zones.delete(placeZoneId);
    if (!presence) return;
    members.delete(transport.label);
    for (const [label] of members) this.#presenceTo(this.clients.get(label), { type: "leave", placeZoneId, presences: [presence] });
  }

  updatePresence(transport, placeZoneId, presence) {
    const members = this.channels.get(placeZoneId);
    if (!transport.connected || !members?.has(transport.label)) return;
    this.#record("presence", transport.label, placeZoneId, presence);
    this.metrics.presence.sent += 1;
    this.metrics.presence.bytes += byteLength(presence);
    members.set(transport.label, clone(presence));
    for (const [label] of members) {
      if (label !== transport.label) this.#presenceTo(this.clients.get(label), { type: "join", placeZoneId, presences: [presence] });
    }
  }

  // Broadcast semantics: lossy, no echo to the sender, sender identified by the channel.
  broadcast(kind, transport, placeZoneId, packet) {
    const members = this.channels.get(placeZoneId);
    if (!transport.connected || !members?.has(transport.label)) return;
    // What a real adapter would put on the wire: sender session plus packet.
    const envelope = { sid: transport.sessionId, p: packet };
    this.#record(kind, transport.label, placeZoneId, envelope);
    const metric = this.metrics[kind];
    metric.sent += 1;
    metric.bytes += byteLength(envelope);
    for (const [label] of members) {
      if (label === transport.label) continue;
      const target = this.clients.get(label);
      if (this.lossRate && this.random() < this.lossRate) { metric.dropped += 1; continue; }
      const copies = this.duplicateRate && this.random() < this.duplicateRate ? 2 : 1;
      if (copies > 1) metric.duplicated += 1;
      for (let i = 0; i < copies; i += 1) {
        const event = { placeZoneId, sessionId: transport.sessionId, packet: clone(packet) };
        metric.delivered += 1;
        this.#deliver(target, () => target.emit(kind, event));
      }
    }
  }

  // Test hook: deliver an arbitrary (possibly stale or malformed) packet to one client.
  inject(kind, targetLabel, event, delayMs = 0) {
    const target = this.clients.get(targetLabel);
    this.scheduler.schedule(delayMs, () => target?.emit(kind, clone(event)));
  }
}

export class FakeNetworkTransport {
  constructor(hub, label) {
    this.hub = hub;
    this.label = label;
    this.connected = false;
    this.sessionId = null;
    this.zones = new Set();
    this.orderedUntil = 0;
    this.handlers = { status: new Set(), presence: new Set(), pose: new Set(), action: new Set() };
    this.calls = [];
    // Test hook: make any method throw to prove the core contains transport failures.
    this.failing = new Set();
  }

  #enter(method) {
    this.calls.push(method);
    if (this.failing.has(method) || this.failing.has("*")) throw new Error(`fake ${method} failure`);
  }

  emit(kind, event) {
    for (const handler of this.handlers[kind]) handler(event);
  }

  emitStatus(event) { this.emit("status", event); }

  #subscribe(kind, handler) {
    this.handlers[kind].add(handler);
    return () => this.handlers[kind].delete(handler);
  }

  connect(request) { this.#enter("connect"); this.hub.connect(this, request); }
  disconnect() { this.#enter("disconnect"); this.hub.disconnect(this); }
  joinPlaceZone(placeZoneId, presence) { this.#enter("joinPlaceZone"); this.hub.join(this, placeZoneId, presence); }
  leavePlaceZone(placeZoneId) { this.#enter("leavePlaceZone"); this.hub.leave(this, placeZoneId); }
  publishPresence(placeZoneId, presence) { this.#enter("publishPresence"); this.hub.updatePresence(this, placeZoneId, presence); }
  publishPose(placeZoneId, packet) { this.#enter("publishPose"); this.hub.broadcast("pose", this, placeZoneId, packet); }
  publishAction(placeZoneId, packet) { this.#enter("publishAction"); this.hub.broadcast("action", this, placeZoneId, packet); }
  subscribePresence(handler) { return this.#subscribe("presence", handler); }
  subscribePose(handler) { return this.#subscribe("pose", handler); }
  subscribeAction(handler) { return this.#subscribe("action", handler); }
  subscribeStatus(handler) { return this.#subscribe("status", handler); }
}
