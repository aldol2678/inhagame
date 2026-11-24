import test from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, createNullRenderer } from '../src/index.js';

const t = (x, y, z) => ({ position: [x, y, z], rotation: [0, 0, 0, 1], scale: [1, 1, 1] });
const sample = () => ({ world: { id: 'w1' }, entities: [
  { id: 'parent', parentId: null, transform: t(0, 0, 0), components: {} },
  { id: 'child', parentId: 'parent', transform: t(1, 0, -1), components: { 'core.primitive': { shape: 'sphere' } } }
] });
const validate = x => ({ valid: true, value: x, diagnostics: [] });
const invalid = () => ({ valid: false, errors: [{ severity: 'ERROR', code: 'E_SCHEMA' }] });
const fakeScheduler = () => {
  let next = 0; const callbacks = new Map();
  return {
    callbacks,
    requestAnimationFrame(cb) { const id = ++next; callbacks.set(id, cb); return id; },
    cancelAnimationFrame(id) { callbacks.delete(id); },
    step(stamp) { const tasks = [...callbacks.values()]; callbacks.clear(); for (const fn of tasks) fn(stamp); }
  };
};
test('valid load, stable hierarchy data, fixed update, lifecycle, idempotent dispose', async () => {
  const scheduler = fakeScheduler(); const renderer = createNullRenderer(); let ticks = 0; let disposed = 0;
  const engine = createEngine({ renderer, validateManifest: validate, scheduler, systems: [{ fixedUpdate() { ticks++; }, dispose() { disposed++; } }] });
  assert.equal((await engine.load(sample())).ok, true);
  assert.equal(engine.state, 'ready');
  assert.equal(engine.getEntity('child').parentId, 'parent');
  engine.start(); scheduler.step(1000); scheduler.step(1034);
  assert.equal(ticks, 2);
  assert.equal(engine.pause(), true);
  assert.equal(scheduler.callbacks.size, 0);
  assert.equal(engine.resume(), true);
  engine.setTransform('child', t(2, 1, -3));
  assert.deepEqual(renderer.objects.get('child').position, [2, 1, -3]);
  assert.equal(engine.stop(), true);
  await engine.dispose(); await engine.dispose();
  assert.equal(disposed, 1); assert.equal(renderer.disposals, 1); assert.equal(engine.state, 'disposed');
});
test('invalid manifest fails without mounting', async () => {
  const renderer = createNullRenderer();
  const engine = createEngine({ renderer, validateManifest: invalid });
  assert.equal((await engine.load({})).ok, false);
  assert.equal(engine.state, 'failed'); assert.equal(renderer.mounts, 0);
  await engine.dispose();
});
test('unsupported component is warned without executing payload', async () => {
  const manifest = sample(); manifest.entities[0].components['custom.script'] = { code: 'evil()' };
  const engine = createEngine({ renderer: createNullRenderer(), validateManifest: validate });
  assert.equal((await engine.load(manifest)).ok, true);
  assert.equal(engine.diagnostics[0].code, 'W_COMPONENT_UNSUPPORTED');
  await engine.dispose();
});
test('failed graphics initialization reports failed then disposes', async () => {
  const engine = createEngine({ renderer: { mount() { throw Error('GPU unavailable'); }, async dispose() {} }, validateManifest: validate });
  const result = await engine.load(sample());
  assert.equal(result.ok, false); assert.equal(result.diagnostics.at(-1).code, 'E_ENGINE_LOAD');
  assert.equal(engine.state, 'failed');
  await engine.dispose();
});
test('start without load, invalid transformations rejected', async () => {
  const engine = createEngine({ renderer: createNullRenderer(), validateManifest: validate });
  assert.throws(() => engine.start(), /E_ENGINE_START_STATE/);
  await engine.load(sample());
  assert.throws(() => engine.setTransform('child', { position: [NaN, 0, 0] }), /E_TRANSFORM_INVALID/);
  await engine.dispose();
});
