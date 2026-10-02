import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPHICS_PRESETS, GRAPHICS_QUALITY_KEY, readGraphicsQuality, saveGraphicsQuality,
  selectAutoGraphics, createGraphicsPresetController
} from '../src/graphics-presets.js';
import { VIEW_DISTANCE_PRESETS } from '../src/view-distance.js';
import { createWorldGraphicsDevice, GraphicsUnavailableError } from '../src/webgpu-device.js';

test('graphics preference persists stable values and rejects invalid storage', () => {
  const entries = new Map();
  const storage = { getItem: key => entries.get(key) ?? null, setItem: (key, value) => entries.set(key, value) };
  assert.equal(readGraphicsQuality(storage), 'auto');
  for (const value of ['low', 'medium', 'high', 'auto']) {
    assert.equal(saveGraphicsQuality(storage, value), true);
    assert.equal(entries.get(GRAPHICS_QUALITY_KEY), value);
    assert.equal(readGraphicsQuality(storage), value);
  }
  assert.equal(saveGraphicsQuality(storage, '__proto__'), false);
  entries.set(GRAPHICS_QUALITY_KEY, '__proto__');
  assert.equal(readGraphicsQuality(storage), 'auto');
  assert.equal(readGraphicsQuality({ getItem() { throw Error('denied'); } }), 'auto');
  assert.equal(saveGraphicsQuality(undefined, 'low'), false);
});

test('AUTO chooses a tier from capability without overriding a saved manual tier', () => {
  const viewport = { width: 1280, height: 720, dpr: 1, mobile: false, maxTextureSize: 8192 };
  assert.equal(selectAutoGraphics(viewport).tier, 'high');
  assert.equal(selectAutoGraphics({ ...viewport, mobile: true }).tier, 'low');
  assert.equal(selectAutoGraphics({ ...viewport, width: 4000, height: 1400 }).tier, 'low');
  assert.equal(selectAutoGraphics({ ...viewport, maxTextureSize: 4096 }).tier, 'medium');
  const values = new Map([[GRAPHICS_QUALITY_KEY, 'medium']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const device = { maxPixelRatio: 9 };
  const light = { castShadows: false, shadowResolution: 0, shadowDistance: 0 };
  const app = { resizeCanvasCalls: 0, resizeCanvas() { this.resizeCanvasCalls++; } };
  const originalInfo = console.info;
  console.info = () => {};
  try {
    const controller = createGraphicsPresetController({ app, device, light, storage, viewport });
    assert.equal(controller.preference, 'medium');
    assert.equal(controller.tier, 'medium');
    assert.equal(device.maxPixelRatio, GRAPHICS_PRESETS.medium.maxPixelRatio);
    assert.equal(light.shadowResolution, 1024);
    controller.setPreference('low');
    assert.equal(light.castShadows, false);
    assert.equal(device.maxPixelRatio, 0.8);
    controller.setPreference('high');
    assert.equal(light.castShadows, true);
    assert.equal(light.shadowResolution, 2048);
    assert.equal(light.shadowDistance, 100);
    const highPolicy = controller.visualPolicy(VIEW_DISTANCE_PRESETS.NORMAL);
    assert.ok(highPolicy.detailEnter > VIEW_DISTANCE_PRESETS.NORMAL.detailEnter);
    assert.equal(highPolicy.load, VIEW_DISTANCE_PRESETS.NORMAL.load);
    assert.equal(highPolicy.preserveCampus, true);
    assert.strictEqual(controller.visualPolicy(VIEW_DISTANCE_PRESETS.NORMAL), highPolicy);
    controller.setPreference('auto');
    assert.equal(controller.tier, 'high');
    assert.equal(values.get(GRAPHICS_QUALITY_KEY), 'auto');
    controller.setPreference('low');
    assert.ok(controller.visualPolicy(VIEW_DISTANCE_PRESETS.NORMAL).detailEnter < VIEW_DISTANCE_PRESETS.NORMAL.detailEnter);
    assert.equal(app.resizeCanvasCalls, 5);
  } finally { console.info = originalInfo; }
});

test('graphics device prefers WebGPU, accepts WebGL2 fallback, and rejects total failure', async () => {
  const pc = {
    DEVICETYPE_WEBGPU: 'webgpu',
    DEVICETYPE_WEBGL2: 'webgl2',
    async createGraphicsDevice(_canvas, options) {
      assert.deepEqual(options.deviceTypes, ['webgpu', 'webgl2']);
      return { isWebGPU: true, isWebGL2: false };
    }
  };
  assert.equal((await createWorldGraphicsDevice(pc, {}, { timeoutMs: 100 })).isWebGPU, true);

  const webgl2 = await createWorldGraphicsDevice({
    ...pc,
    async createGraphicsDevice(_canvas, options) {
      assert.deepEqual(options.deviceTypes, ['webgpu', 'webgl2']);
      return { isWebGPU: false, isWebGL2: true };
    }
  }, {}, { timeoutMs: 100 });
  assert.equal(webgl2.isWebGL2, true);

  await assert.rejects(
    createWorldGraphicsDevice({ ...pc, async createGraphicsDevice() { return { isWebGPU: false, isWebGL2: false }; } }, {}, { timeoutMs: 100 }),
    GraphicsUnavailableError
  );
  await assert.rejects(
    createWorldGraphicsDevice({ ...pc, async createGraphicsDevice() { throw Error('all graphics backends failed'); } }, {}, { timeoutMs: 100 }),
    GraphicsUnavailableError
  );
});
