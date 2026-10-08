import test from 'node:test';
import assert from 'node:assert/strict';
import { createGraphicsPresetController } from '../src/graphics-presets.js';
import { setSetting } from '../src/settings-registry.js';

function fixture({ mobile = false, saved = {}, existingStorage } = {}) {
  const values = new Map();
  const storage = existingStorage || { getItem: k => values.get(k) ?? null, setItem: (k,v) => values.set(k,v) };
  for (const [key,value] of Object.entries(saved)) setSetting(storage, `graphics.${key}`, value);
  const listeners = new Map();
  const app = { autoRender: true, renderNextFrame: false, resizeCanvas() {},
    on(type, fn) { const set = listeners.get(type) || new Set(); set.add(fn); listeners.set(type,set); },
    off(type, fn) { listeners.get(type)?.delete(fn); },
    fire(type, ...args) { for (const fn of listeners.get(type) || []) fn(...args); } };
  const doc = new EventTarget(); doc.hidden = false;
  const win = new EventTarget();
  const fpsElement = { hidden: true, textContent: '' };
  const device = {};
  const light = { intensity: 0.7, shadowIntensity: 0.3 };
  let time = 0;
  const controller = createGraphicsPresetController({ app, device, light, storage,
    viewport: { width: 1280, height: 720, dpr: 2, mobile, maxTextureSize: 8192 },
    document: doc, window: win, fpsElement, now: () => time });
  function tick(ms) { time = ms; app.fire('update', 1 / 60); const rendered = app.autoRender || app.renderNextFrame; if(rendered) { app.fire('postrender'); app.renderNextFrame = false; } return rendered; }
  return { controller, app, device, light, storage, doc, win, fpsElement, tick, listeners };
}

test('stored graphics overrides apply independently and auto restores low policy', () => {
  const f = fixture({ mobile: true, saved: { renderScale: 0.7, shadows: 'high', frameLimit: 30, showFps: true } });
  assert.equal(f.device.maxPixelRatio, 1.4);
  assert.equal(f.light.castShadows, true);
  assert.equal(f.light.shadowResolution, 2048);
  assert.equal(f.light.intensity, 0.7);
  assert.equal(f.light.shadowIntensity, 0.3);
  assert.equal(f.fpsElement.hidden, false);
  assert.equal(f.controller.setDetail('renderScale', 'auto'), true);
  assert.equal(f.device.maxPixelRatio, 0.8);
  f.controller.setDetail('shadows', 'auto');
  assert.equal(f.light.castShadows, false);
  f.controller.setDetail('shadows', 'off');
  f.controller.setPreference('high');
  assert.equal(f.light.castShadows, false);
  assert.equal(f.controller.setDetail('frameLimit', 999), false);
  f.controller.destroy();
});

test('render pacing limits frames without skipping updates and counts actual renders', () => {
  const f = fixture({ saved: { frameLimit: 30, showFps: true } });
  let updates = 0; f.app.on('update', () => updates++);
  let renders = 0;
  for (let i=0;i<=60;i++) if(f.tick(i * 1000 / 60)) renders++;
  assert.equal(updates, 61);
  assert.equal(renders, 31);
  assert.match(f.fpsElement.textContent, /30 FPS/);
  f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.tick(1100), false);
  f.doc.hidden = false; f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(f.tick(10000), true);
  assert.equal(f.tick(10001), false);
  f.controller.setDetail('frameLimit', 'auto');
  assert.equal(f.tick(10002), true);
  f.controller.destroy(); f.controller.destroy();
  assert.equal(f.app.autoRender, true);
  assert.equal(f.listeners.get('postrender').size, 0);
  assert.equal(f.fpsElement.hidden, true);
});

test('reset restores graphics defaults only and persisted overrides survive recreation', () => {
  const f = fixture();
  f.controller.setDetail('frameLimit', 45);
  f.controller.setDetail('showFps', true);
  assert.equal(JSON.parse(f.storage.getItem('inhagame-device-settings-v2')).graphics.frameLimit, 45);
  setSetting(f.storage, 'audio.master', 0.4);
  const restored = fixture({ existingStorage: f.storage });
  assert.equal(restored.controller.status().frameLimit,45);
  assert.equal(restored.fpsElement.hidden,false);
  restored.controller.destroy();
  f.controller.reset();
  assert.equal(f.controller.status().frameLimit, 'auto');
  assert.equal(f.controller.status().showFps, false);
  assert.equal(JSON.parse(f.storage.getItem('inhagame-device-settings-v2')).audio.master, 0.4);
  f.controller.destroy();
});

for (const limit of [30,45,60,90,120]) {
  test(`frame pacing supports ${limit} FPS on a 144 Hz display`,()=>{
    const f=fixture({saved:{frameLimit:limit}});
    let rendered=0;
    for(let i=0;i<144;i++) if(f.tick(i*1000/144))rendered++;
    assert.equal(rendered,limit);
    f.controller.destroy();
  });
}

test('storage failure keeps session overrides and rejects invalid values without changing runtime',()=>{
  const f=fixture({existingStorage:{getItem(){throw Error('blocked');},setItem(){throw Error('blocked');}}});
  assert.equal(f.controller.setDetail('renderScale',0.85),false);
  assert.equal(f.device.maxPixelRatio,1.7);
  assert.equal(f.controller.setDetail('renderScale',0),false);
  assert.equal(f.device.maxPixelRatio,1.7);
  assert.equal(f.controller.setDetail('shadows','off'),false);
  assert.equal(f.device.maxPixelRatio,1.7);
  assert.equal(f.light.castShadows,false);
  f.controller.destroy();
});

test('bfcache pageshow clears stale FPS samples and controller removes its lifecycle listener',()=>{
  const f=fixture({saved:{frameLimit:30,showFps:true}});
  for(let i=0;i<=60;i++)f.tick(i*1000/60);
  assert.equal(f.fpsElement.textContent,'30 FPS');
  f.win.dispatchEvent(new Event('pageshow'));
  assert.equal(f.fpsElement.textContent,'— FPS');
  f.controller.destroy();
  f.fpsElement.textContent='unchanged';
  f.win.dispatchEvent(new Event('pageshow'));
  assert.equal(f.fpsElement.textContent,'unchanged');
});
