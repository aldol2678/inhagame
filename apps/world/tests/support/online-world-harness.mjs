// Headless INHA WORLD clients for Online P0 integration tests: the real PlaceZoneRegistry,
// world-online bootstrap, SupabaseRealtimeTransport and NetworkManager, with a fake Supabase,
// a fake PlayCanvas app and a fake local player that owns its own movement.

import { FakeScheduler } from "../../src/network/fake-transport.js";
import { PlaceZoneRegistry } from "../../src/place-zone-registry.js";
import { startWorldOnline } from "../../src/online/world-online.js";
import { FakeRealtimeServer, createFakeSupabaseLib } from "./fake-supabase.mjs";

export const FRAME_MS = 1000 / 60;
// Positions resolved by the real registry (tests assert the resolved IDs).
export const SPOTS = {
  gate: { x: 0, z: -98 },
  agora: null
};

export function createRealtimeWorld({ latencyMs = 30 } = {}) {
  const scheduler = new FakeScheduler(1_000_000);
  const server = new FakeRealtimeServer({ scheduler, latencyMs });
  return { scheduler, server, clients: [] };
}

class FakeApp {
  constructor() { this.handlers = new Map(); }
  on(name, fn) { (this.handlers.get(name) ?? this.handlers.set(name, new Set()).get(name)).add(fn); }
  off(name, fn) { this.handlers.get(name)?.delete(fn); }
  fire(name, ...args) { for (const fn of this.handlers.get(name) ?? []) fn(...args); }
}

// Owns the local position like PlayerController; the network only ever reads it.
class LocalPlayer {
  constructor({ x, z }) {
    this.pos = { x, y: 1.15, z };
    this.yaw = 0;
    this.input = { speed: 0, heading: 0 };
    this.controller = { grounded: true, mounted: false, moving: false, velocityY: 0, walkSpeed: 7, keys: new Set(), touchVector: { x: 0, y: 0 }, jumpQueued: false };
    this.entity = {
      getLocalPosition: () => ({ ...this.pos }),
      setLocalPosition: (x, y, z) => { this.pos = { x, y, z }; },
      setLocalEulerAngles: (_x, y) => { this.yaw = y; },
      getLocalRotation: () => ({ x: 0, y: Math.sin(this.yaw * Math.PI / 360), z: 0, w: Math.cos(this.yaw * Math.PI / 360) })
    };
    this.frames = 0;
  }
  teleportTo({ x, z }) { this.pos.x = x; this.pos.z = z; }
  jump() { if (!this.controller.grounded) return; this.controller.grounded = false; this.controller.velocityY = 7; }
  step(dtMs) {
    const dt = dtMs / 1000;
    this.frames += 1;
    const rad = this.input.heading * Math.PI / 180;
    this.pos.x += Math.sin(rad) * this.input.speed * dt;
    this.pos.z += Math.cos(rad) * this.input.speed * dt;
    this.controller.moving = this.input.speed > 0;
    if (this.input.speed > 0) this.yaw = this.input.heading;
    if (!this.controller.grounded) {
      this.controller.velocityY -= 20 * dt;
      this.pos.y += this.controller.velocityY * dt;
      if (this.pos.y <= 1.15) { this.pos.y = 1.15; this.controller.velocityY = 0; this.controller.grounded = true; }
    }
  }
}

export function createWorldClient(world, { label, user = { id: `user-${label.toLowerCase()}`, is_anonymous: false }, nickname = `Duck${label}`, at = SPOTS.gate, anonymousSignIns = true, allowGuests = true, windowTarget = null } = {}) {
  const app = new FakeApp();
  const places = new PlaceZoneRegistry();
  const local = new LocalPlayer(at);
  places.update(local.pos);
  const avatars = { created: [], destroyed: [], live: new Map() };
  const hud = { textContent: "", dataset: {}, title: "" };
  const lib = createFakeSupabaseLib(world.server, { user, nickname, anonymousSignIns, label: label.toLowerCase() });
  const seat = { seated: false };
  let ids = 0;
  const online = startWorldOnline({
    app, places, player: local.entity, controller: local.controller, hudElement: hud,
    supabaseLib: lib,
    allowGuests,
    isSeated: () => seat.seated,
    createAvatar: (sample) => {
      const avatar = { sessionId: sample.sessionId, last: null, updates: 0,
        update(s) { avatar.last = s; avatar.updates += 1; },
        destroy() { avatars.destroyed.push(sample.sessionId); avatars.live.delete(sample.sessionId); } };
      avatars.created.push(sample.sessionId);
      avatars.live.set(sample.sessionId, avatar);
      return avatar;
    },
    clock: world.scheduler,
    randomId: () => `${label.toLowerCase()}-session-${++ids}`,
    windowTarget
  });
  const client = { label, app, places, local, online, avatars, hud, active: true, seat, lib };
  world.clients.push(client);
  return client;
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

export async function runWorld(world, ms, { onFrame } = {}) {
  await flush();
  const end = world.scheduler.now() + ms;
  while (world.scheduler.now() + FRAME_MS <= end + 1e-9) {
    world.scheduler.advanceTo(world.scheduler.now() + FRAME_MS);
    for (const client of world.clients) {
      if (!client.active) continue;
      // Like main.js: a seated player is not moved by the controller.
      if (!client.seat.seated) client.local.step(FRAME_MS);
      client.places.update(client.local.pos);
      onFrame?.(client, world.scheduler.now());
      client.app.fire("update", FRAME_MS / 1000);
    }
    await flush();
  }
}

export const remoteSessions = (client) => client.online.status().remotes.map((r) => r.sessionId).sort();
