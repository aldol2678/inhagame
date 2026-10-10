import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRecastRuntimeShadowNavigator } from '../npc-factory/recast-runtime-shadow.mjs';

class FakeWorker {
  static instances = [];
  constructor(url, options) {
    this.url = String(url);
    this.options = options;
    this.listeners = new Map();
    this.messages = [];
    this.terminated = false;
    FakeWorker.instances.push(this);
  }
  addEventListener(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(listener);
  }
  postMessage(message) { this.messages.push(structuredClone(message)); }
  emit(type, data) {
    for (const listener of this.listeners.get(type) ?? []) listener(type === 'message' ? { data } : data);
  }
  terminate() { this.terminated = true; }
}

function canonical() {
  return {
    route: (_from, to) => [{ ...to }],
    networkRoute: (_from, to) => [{ x: to.x - .25, z: to.z }, { ...to }],
    wanderRoute: (from, anchor) => [{ x: (from.x + anchor.x) / 2, z: (from.z + anchor.z) / 2 }],
    walkable: () => true,
    segmentSafe: () => true,
    bounds: { minX: 0, maxX: 10, minZ: 0, maxZ: 10 },
    navigationGeometry: () => ({})
  };
}

test('disabled Recast runtime shadow is inert and preserves canonical authority', () => {
  FakeWorker.instances.length = 0;
  const base = canonical();
  const nav = createRecastRuntimeShadowNavigator(base, { enabled: false, WorkerCtor: FakeWorker });
  const route = nav.route({ x: 0, z: 0 }, { x: 2, z: 0 });
  assert.deepEqual(route, [{ x: 2, z: 0 }]);
  assert.equal(FakeWorker.instances.length, 0);
  const status = nav.recastRuntimeShadow.status();
  assert.equal(status.state, 'DISABLED');
  assert.equal(status.authorityEffect, 'NONE');
  assert.equal(status.canonicalAuthority, 'JS_NAVIGATOR');
});

test('canonical route returns immediately while observations queue until worker is ready', () => {
  FakeWorker.instances.length = 0;
  const nav = createRecastRuntimeShadowNavigator(canonical(), { enabled: true, WorkerCtor: FakeWorker });
  const worker = FakeWorker.instances[0];
  const route = nav.networkRoute({ x: 0, z: 0 }, { x: 3, z: 0 });
  assert.deepEqual(route.at(-1), { x: 3, z: 0 });
  assert.equal(worker.messages.length, 0);
  assert.equal(nav.recastRuntimeShadow.status().queued, 1);

  worker.emit('message', {
    type: 'READY',
    version: 'p0-shadow-v2',
    packageVersion: '0.43.1',
    initialization: 'IMPORTED',
    elapsedMs: 12
  });
  assert.equal(worker.messages.length, 1);
  assert.equal(worker.messages[0].type, 'OBSERVE_ROUTE');
  assert.equal(worker.messages[0].kind, 'NETWORK');
  assert.equal(nav.recastRuntimeShadow.status().pending, 1);

  worker.emit('message', {
    type: 'RESULT',
    id: worker.messages[0].id,
    kind: 'NETWORK',
    status: 'MATCH',
    reason: 'RECAST',
    canonicalOk: true,
    recastOk: true,
    canonicalLength: 3,
    recastLength: 3.1,
    lengthDeltaPct: 3.333,
    latencyMs: .8
  });
  const status = nav.recastRuntimeShadow.status();
  assert.equal(status.pending, 0);
  assert.equal(status.counts.match, 1);
  assert.equal(status.observed, 1);
  assert.equal(status.records[0].status, 'MATCH');
});

test('shadow mismatch never replaces or rejects canonical route', () => {
  FakeWorker.instances.length = 0;
  const nav = createRecastRuntimeShadowNavigator(canonical(), { enabled: true, WorkerCtor: FakeWorker });
  const worker = FakeWorker.instances[0];
  worker.emit('message', { type: 'READY', initialization: 'IMPORTED' });

  const expected = nav.route({ x: 0, z: 0 }, { x: 4, z: 1 });
  const sent = worker.messages[0];
  worker.emit('message', {
    type: 'RESULT',
    id: sent.id,
    kind: sent.kind,
    status: 'MISMATCH',
    reason: 'NO_PATH',
    canonicalOk: true,
    recastOk: false,
    latencyMs: 1.2
  });
  assert.deepEqual(expected, [{ x: 4, z: 1 }]);
  assert.equal(nav.recastRuntimeShadow.status().counts.mismatch, 1);
  assert.equal(nav.recastRuntimeShadow.status().authorityEffect, 'NONE');
});

test('wander observation compares the canonical chosen endpoint and destroy terminates worker', () => {
  FakeWorker.instances.length = 0;
  const nav = createRecastRuntimeShadowNavigator(canonical(), { enabled: true, WorkerCtor: FakeWorker });
  const worker = FakeWorker.instances[0];
  worker.emit('message', { type: 'READY', initialization: 'IMPORTED' });
  const from = { x: 0, z: 0 };
  const route = nav.wanderRoute(from, { x: 4, z: 0 }, 'npc-003', 7, 5);
  assert.deepEqual(worker.messages[0].to, route.at(-1));
  assert.equal(worker.messages[0].kind, 'WANDER');
  assert.deepEqual(worker.messages[0].meta, { npcId: 'npc-003', leg: 7 });
  nav.recastRuntimeShadow.destroy();
  assert.equal(worker.terminated, true);
  assert.equal(nav.recastRuntimeShadow.status().state, 'DESTROYED');
});

test('runtime wiring keeps Recast shadow opt-in and exposes read-only diagnostics only', () => {
  const runtime = readFileSync(new URL('../npc-factory/dev-runtime.mjs', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(runtime, /createRecastRuntimeShadowNavigator/);
  assert.match(runtime, /recastRuntimeShadowEnabled = false/);
  assert.match(runtime, /recast_runtime_shadow: navigator\.recastRuntimeShadow\.status\(\)/);
  assert.match(runtime, /__RECAST_RUNTIME_SHADOW__/);
  assert.match(main, /const npcRecastRuntimeShadowMode = npcProductionMode && startupParams\.get\('recastShadow'\) === '1'/);
  assert.match(main, /recastRuntimeShadowEnabled: npcRecastRuntimeShadowMode/);
  assert.doesNotMatch(main, /createRecastNpcNavigator/);
});
