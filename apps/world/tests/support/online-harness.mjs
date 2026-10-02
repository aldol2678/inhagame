// Shared deterministic harness for Online P0 tests: fake clock, fake hub, fake local players.
// Lives under tests/support so world-tests.sh (tests/*.test.mjs) does not run it directly.

import { FakeNetworkHub, FakeScheduler } from "../../src/network/fake-transport.js";
import { NetworkManager } from "../../src/network/network-manager.js";
import { classifyAnim } from "../../src/network/protocol.js";

export const MAIN_HALL = "AREA_MAIN_HALL";
export const AGORA = "AREA_AGORA_6_9";
export const STUDENT_CENTER = "AREA_INKYUNG_STUDENT_CENTER";
export const FRAME_MS = 1000 / 60;
export const WALK_SPEED = 7;
export const RUN_SPEED = 12;

// Stand-in for PlayerController: owns its own position. The network only ever sees frozen samples.
export class LocalPlayerSim {
  constructor({ x = 0, y = 1.15, z = 0, yaw = 0 } = {}) {
    Object.assign(this, { x, y, z, yaw, vx: 0, vz: 0, vy: 0, grounded: true, frames: 0 });
    this.input = { speed: 0, heading: 0, turnRate: 0 };
    this.groundY = 1.15;
  }

  jump() {
    if (!this.grounded) return false;
    this.vy = 7;
    this.grounded = false;
    return true;
  }

  step(dtMs) {
    const dt = dtMs / 1000;
    this.frames += 1;
    this.input.heading += this.input.turnRate * dt;
    const rad = this.input.heading * Math.PI / 180;
    this.vx = Math.sin(rad) * this.input.speed;
    this.vz = Math.cos(rad) * this.input.speed;
    this.x += this.vx * dt;
    this.z += this.vz * dt;
    if (this.input.speed > 0) this.yaw = this.input.heading;
    if (!this.grounded) {
      this.vy -= 20 * dt;
      this.y += this.vy * dt;
      if (this.y <= this.groundY) { this.y = this.groundY; this.vy = 0; this.grounded = true; }
    }
  }

  sample() {
    return Object.freeze({
      x: this.x, y: this.y, z: this.z, yaw: this.yaw, vx: this.vx, vz: this.vz,
      anim: classifyAnim({ moving: this.input.speed > 0, sprint: this.input.speed > WALK_SPEED, grounded: this.grounded })
    });
  }
}

export function createWorld(hubOptions = {}) {
  const scheduler = new FakeScheduler(1_000_000);
  const hub = new FakeNetworkHub({ scheduler, latencyMs: 40, ...hubOptions });
  const clients = [];
  return { scheduler, hub, clients };
}

export function createClient(world, { label, userId = `user-${label.toLowerCase()}`, sessionId = `sess-${label.toLowerCase()}`,
  displayName = `Duck${label}`, identity = { sessionId, userId, displayName }, credentials = null, position = {}, net = {} } = {}) {
  const transport = world.hub.createTransport(label);
  const manager = new NetworkManager({ transport, clock: world.scheduler, identity, credentials, ...net });
  const client = { label, sessionId, userId, transport, net: manager, sim: new LocalPlayerSim(position), online: true };
  world.clients.push(client);
  return client;
}

// Advance fake time frame by frame: deliver due network events, move local players, run network update.
export function run(world, ms, { onFrame } = {}) {
  const end = world.scheduler.now() + ms;
  while (world.scheduler.now() + FRAME_MS <= end + 1e-9) {
    world.scheduler.advanceTo(world.scheduler.now() + FRAME_MS);
    for (const client of world.clients) {
      client.sim.step(FRAME_MS);
      onFrame?.(client, world.scheduler.now());
      if (client.online) client.net.update(client.sim.sample());
    }
  }
}

export function remoteIds(client) {
  return client.net.remotes.list().map((p) => p.sessionId).sort();
}
