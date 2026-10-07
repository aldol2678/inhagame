import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { FISHING_SPOTS } from '../src/activity/fishing-spots.js';
import { overPondWater } from '../src/landmark-detail-layout.js';
import { buildPolygonSurfaceGeometry } from '../src/reality-adapter.js';

const module = await import('../src/activity/fishing-visuals.js').catch(() => null);
test('fishing visual adapter is provided', () => assert.ok(module));
const attempt = (status = 'ACTIVE', id = 'cast-1') => ({ attemptId: id, status,
  sourceRef: FISHING_SPOTS[0].sourceRef, startedAtMs: 1000, biteAtMs: 4000,
  hookDeadlineMs: 6000, expiresAtMs: 8000,
  result: status === 'SUCCEEDED' ? { catch: { itemId: 'material.fish_carp' } } : null });
function rig() {
  let time = 1000;
  const listeners = new Set(), views = [];
  const fishing = { state: 'READY', busy: null, attempt: null, lastError: null,
    serverNow: () => time,
    onChange(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    emit(reason, patch = {}) { Object.assign(fishing, patch); for (const cb of listeners) cb({ ...fishing, reason }); }
  };
  const presentation = module.createFishingPresentation({ fishing, createView() {
    const view = { frames: [], destroyed: false, render(frame) { this.frames.push(frame); },
      destroy() { this.destroyed = true; } };
    views.push(view); return view;
  } });
  return { fishing, presentation, views, listeners, tick(ms) { time = ms; presentation.update(); },
    get frame() { return views.at(-1)?.frames.at(-1); } };
}
if (module) {
  test('each canonical fishing target is water at the geometry surface elevation', () => {
    const height = buildPolygonSurfaceGeometry([{x:0,z:0},{x:1,z:0},{x:0,z:1}]).positions[1];
    for (const spot of FISHING_SPOTS) {
      const target = module.fishingWaterTarget(spot);
      assert.ok(overPondWater(target.x, target.z));
      assert.equal(target.y, height);
    }
  });
  test('closed, signed-out and unavailable presentations create no props', () => {
    const r = rig(); r.fishing.emit('refresh', { attempt: attempt() }); r.tick(1000);
    assert.equal(r.views.length, 0);
    r.fishing.state = 'SIGNED_OUT'; r.presentation.setOpen(true); assert.equal(r.views.length, 0);
    r.fishing.emit('probe', { state: 'UNAVAILABLE' }); assert.equal(r.views.length, 0);
  });
  test('server phases drive one reused view, one bite splash, no speculative catch', () => {
    const r = rig(); r.presentation.setOpen(true);
    r.fishing.emit('refresh', { attempt: attempt() }); r.tick(2000);
    assert.equal(r.frame.phase, 'WAITING'); assert.equal(r.frame.splashFrame, null);
    r.tick(4000); assert.equal(r.frame.phase, 'BITE'); assert.equal(r.frame.splashFrame, 0);
    r.tick(4700); assert.equal(r.frame.splashFrame, null);
    r.fishing.emit('hook', { busy: 'hook' }); assert.equal(r.frame.showFish, false);
    r.tick(6000); assert.equal(r.frame.phase, 'LATE'); assert.equal(r.frame.showFish, false);
    for (let i = 0; i < 20; i++) r.fishing.emit('refresh');
    assert.equal(r.views.length, 1);
  });
  test('new start casts once; recovered and already-active attempts skip casting', () => {
    const r = rig(); r.presentation.setOpen(true);
    r.fishing.emit('start', { busy: 'start' });
    r.fishing.emit('start', { busy: null, attempt: attempt(), outcome: 'STARTED' });
    assert.equal(r.frame.castProgress, 0);
    r.tick(1350); assert.equal(r.frame.castProgress, 1); assert.equal(r.frame.splashFrame, 0);
    r.tick(2100); assert.equal(r.frame.splashFrame, null);
    r.presentation.setOpen(false); r.presentation.setOpen(true);
    assert.equal(r.frame.castProgress, 1); assert.equal(r.frame.splashFrame, null);
    const recovered = rig(); recovered.presentation.setOpen(true);
    recovered.fishing.emit('start', { busy: 'start' });
    recovered.fishing.emit('start', { busy: null, attempt: attempt(), lastError: 'ATTEMPT_ALREADY_ACTIVE' });
    assert.equal(recovered.frame.castProgress, 1);
  });
  test('only a newly observed successful hook can show the caught fish', () => {
    const r = rig(); r.presentation.setOpen(true); r.fishing.emit('refresh', { attempt: attempt() });
    r.tick(4500); r.fishing.emit('hook', { busy: 'hook' });
    r.fishing.emit('hook', { busy: null, attempt: attempt('SUCCEEDED') });
    assert.equal(r.frame.showFish, true); assert.equal(r.frame.reelProgress, 0);
    r.tick(5100); assert.equal(r.frame.reelProgress, 1);
    r.fishing.emit('refresh'); assert.equal(r.frame.reelProgress, 1);
    r.presentation.setOpen(false); r.presentation.setOpen(true);
    assert.equal(r.frame?.showFish, true); // old frame, no new view for restored result
    assert.equal(r.views.length, 1); assert.equal(r.views[0].destroyed, true);
    const recovered = rig(); recovered.fishing.attempt = attempt('SUCCEEDED'); recovered.presentation.setOpen(true);
    assert.equal(recovered.views.length, 0);
  });
  test('cancel, failed, expired, account change, close and dispose release activity instances', () => {
    for (const outcome of ['FAILED', 'CANCELLED', 'EXPIRED']) {
      const r = rig(); r.presentation.setOpen(true); r.fishing.emit('refresh', { attempt: attempt() });
      r.fishing.emit('hook', { attempt: attempt(outcome) }); assert.ok(r.views[0].destroyed);
    }
    for (const action of ['cancel', 'account', 'close', 'destroy', 'suspend']) {
      const r = rig(); r.presentation.setOpen(true); r.fishing.emit('refresh', { attempt: attempt() });
      if (action === 'cancel') r.fishing.emit('cancel', { busy: 'cancel' });
      if (action === 'account') r.fishing.emit('account', { state: 'CHECKING', attempt: null });
      if (action === 'close') r.presentation.setOpen(false);
      if (action === 'destroy') { r.presentation.destroy(); r.presentation.destroy(); assert.equal(r.listeners.size, 0); }
      if (action === 'suspend') r.presentation.setSuppressed(true);
      assert.ok(r.views[0].destroyed, action);
    }
  });
  test('hidden scene/BFCache resumes current phase without cast, bite or catch replay', () => {
    const r = rig(); r.presentation.setOpen(true); r.fishing.emit('refresh', { attempt: attempt() });
    r.presentation.setSuppressed(true); r.tick(4000);
    r.presentation.setSuppressed(false);
    assert.equal(r.frame.phase, 'BITE'); assert.equal(r.frame.splashFrame, null);
    assert.equal(r.frame.castProgress, 1);
  });
  test('committed model/atlas bytes match the approved original assets and preserve colors/sockets', () => {
    for (const spec of Object.values(module.FISHING_ASSETS)) {
      const bytes = readFileSync(new URL(`..${spec.url}`, import.meta.url));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), spec.sha256);
      if (!spec.url.endsWith('.glb')) continue;
      const gltf = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
      assert.ok(gltf.meshes.every(mesh => mesh.primitives.every(p => Number.isInteger(p.attributes.COLOR_0))));
      assert.ok(gltf.nodes.some(node => node.name === spec.socket));
      assert.equal(gltf.materials.length, spec.surfaces);
      assert.ok(!gltf.extensionsRequired?.length);
    }
  });
}

test('a throwing view remains a cosmetic failure and cannot break the update loop', () => {
  let renders = 0, disposed = 0, callback;
  const fishing = { state: 'READY', busy: null, attempt: attempt(), serverNow: () => 2000,
    onChange(cb) { callback = cb; return () => {}; } };
  const view = module.createFishingPresentation({ fishing, createView: () => ({
    render() { renders++;throw new Error('device loss'); }, destroy() { disposed++; }
  }) });
  assert.doesNotThrow(() => view.setOpen(true));
  assert.doesNotThrow(() => { view.update();callback({ reason: 'refresh' }); });
  assert.equal(disposed, 1);assert.equal(renders, 1);assert.equal(view.status().failed, true);
  view.destroy();
});
