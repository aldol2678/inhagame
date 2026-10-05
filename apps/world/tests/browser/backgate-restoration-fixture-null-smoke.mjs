// Actual pinned-engine fixture/projection contract. No server, browser or pixels.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { VIEWPORTS, VIEWS, expectedRaster } from './backgate-restoration-qa-plan.mjs';
import { GRAPHICS_PRESETS } from '../../src/graphics-presets.js';

globalThis.document = { addEventListener() {}, removeEventListener() {}, createElement() {
  return { width: 0, height: 0, getContext() { return { measureText: t => ({ width: t.length * 45 }), fillText() {} }; } };
} };
const engine = new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url).href;
registerHooks({ resolve(s, c, next) { return next(s === 'playcanvas' ? engine : s, c); } });
const pc = await import('playcanvas');
const { CampusChunkRenderer } = await import('../../src/campus-chunk-renderer.js');
const { RenderChunkRegistry } = await import('../../src/render-chunk-registry.js');
const { RenderChunkStreaming } = await import('../../src/render-chunk-streaming.js');
const { prepareCampus, selectView, setTier } = await import('./backgate-restoration-fixture.mjs');
const report = { engine: pc.version, device: 'NullGraphicsDevice', visualEvidence: false, cases: [] };
for (const viewport of VIEWPORTS) {
  const tier = viewport.name === 'desktop' ? 'high' : 'low', graphics = { tier, ...GRAPHICS_PRESETS[tier] };
  const raster = expectedRaster(viewport, graphics, 1);
  const canvas = { id: 'shopfront-camera-null', width: raster.width, height: raster.height,
    clientWidth: viewport.width, clientHeight: viewport.height,
    getBoundingClientRect: () => ({ width: viewport.width, height: viewport.height }) };
  const app = new pc.AppBase(canvas), options = new pc.AppOptions();
  options.graphicsDevice = new pc.NullGraphicsDevice(canvas);
  options.componentSystems = [pc.RenderComponentSystem, pc.CameraComponentSystem, pc.LightComponentSystem]; app.init(options);
  try {
    app.graphicsDevice.updateClientRect();
    const root = new pc.Entity('CampusCoordinateFrame'); root.setLocalScale(1, 1, -1); app.root.addChild(root);
    const camera = new pc.Entity('Camera'); camera.addComponent('camera', {}); app.root.addChild(camera);
    app.root.addChild(new pc.Entity('EnvironmentSkyVisuals'));
    const registry = new RenderChunkRegistry(), renderer = new CampusChunkRenderer(app, root, registry);
    const streaming = new RenderChunkStreaming(registry, renderer);
    const fixture = prepareCampus({ app, streaming, registry, graphics: { status: () => graphics } });
    assert.equal(fixture.targets.length, 114); assert.equal(canvas.width, raster.width); assert.equal(canvas.height, raster.height);
    const views = VIEWS.map(view => selectView(view.name));
    for (const view of views) {
      assert.ok(view.depth.min > .05 && view.depth.max < 200);
      assert.ok(view.roi.minX > .01 && view.roi.maxX < .99 && view.roi.minY > .01 && view.roi.maxY < .99);
    }
    const handles = [...streaming.runtime.values()].filter(r => r.handle).map(r => r.handle);
    const layers = handles.map(h => [h.near, h.detail]);
    setTier('BASE'); assert.ok(handles.every(h => !h.near.enabled && !h.detail.enabled));
    setTier('ALL'); assert.ok(handles.every((h, i) => h.near === layers[i][0] && h.detail === layers[i][1] && h.near.enabled && h.detail.enabled));
    report.cases.push({ viewport, raster, views, meshes: fixture.meshes });
  } finally { app.destroy(); }
}
console.log(JSON.stringify(report, null, 2));
