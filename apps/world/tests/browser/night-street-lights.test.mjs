// Actual PlayCanvas light components with a NullGraphicsDevice, no pixels/GPU claims.
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as pc from './node_modules/playcanvas/build/playcanvas.mjs';
const hook = registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'playcanvas'
    ? { url: pathToFileURL(realpathSync(new URL('./node_modules/playcanvas/build/playcanvas.mjs', import.meta.url))).href, shortCircuit: true }
    : nextResolve(specifier, context);
} });
const { createNightStreetLights } = await import('../../src/environment/night-street-lights.js');
hook.deregister();
const { CAMPUS_STREETLAMP_LIGHT: lamp } = await import('../../src/campus-streetlamp-layout.js');

test('approved lamp shares the existing 0/2/4 pool, follows time, distance, release and destroy', () => {
  const canvas = { id: 'night-light-test', width: 16, height: 16, style: {}, addEventListener() {}, removeEventListener() {} };
  const app = new pc.AppBase(canvas), options = new pc.AppOptions();
  options.graphicsDevice = new pc.NullGraphicsDevice(canvas);
  options.componentSystems = [pc.RenderComponentSystem, pc.LightComponentSystem];
  app.init(options);
  let factor = 0, tier = 'high', position = lamp?.head ?? { x: 0, z: 0 };
  const lights = createNightStreetLights({ root: app.root, app,
    getPlayerPosition: () => position, getArtificialLightFactor: () => factor, getGraphicsTier: () => tier });
  const before = lights.status().lampCount, factors = [];
  assert.equal(typeof lights.registerLamp, 'function', 'reuse shared pool registration');
  const release = lights.registerLamp({ ...lamp, setArtificialLightFactor: v => factors.push(v) });
  lights.update(.2);
  assert.equal(lights.status().lampCount, before + 1);
  assert.equal(lights.status().activeDynamicLights, 0);
  assert.equal(app.root.findComponents('light').length, 4, 'no fifth light allocated');
  factor = 1; lights.update(.2);
  assert.equal(factors.at(-1), 1);
  assert.equal(lights.status().activeLampIds[0], lamp.id, 'nearest source has first priority');
  const selected = app.root.findByName('night_street_omni_0');
  assert.equal(selected.light.type, 'omni'); assert.equal(selected.light.castShadows, false);
  assert.equal(selected.light.range, lamp.range); assert.equal(selected.light.intensity, lamp.intensity);
  assert.deepEqual(selected.light.color.toArray(), [1, .8, .52, 1]);
  assert.ok(Math.abs(selected.getLocalPosition().y - (lamp.head.y + lamp.lightOffsetY)) < 1e-6);
  tier = 'low'; lights.update(0); assert.equal(lights.status().activeDynamicLights, 0);
  tier = 'medium'; lights.update(0);
  assert.ok(lights.status().activeDynamicLights <= 2);
  assert.equal(lights.status().activeLampIds.filter(id => id === lamp.id).length, 1);
  factor = .18; lights.update(.2); assert.equal(factors.at(-1), .18);
  assert.equal(selected.light.intensity, .18 * lamp.intensity);
  position = { x: 10000, z: 10000 }; lights.update(.2);
  assert.equal(lights.status().activeDynamicLights, 0);
  position = lamp.head; lights.update(.2);
  assert.equal(lights.status().activeLampIds.filter(id => id === lamp.id).length, 1);
  assert.throws(() => lights.registerLamp({ ...lamp }), /already registered/);
  release(); release();
  assert.equal(lights.status().lampCount, before);
  assert.ok(!lights.status().activeLampIds.includes(lamp.id), 'release removes the real light immediately');
  assert.throws(() => lights.registerLamp({ ...lamp, setArtificialLightFactor() { throw new Error('material update failed'); } }), /material update failed/);
  assert.equal(lights.status().lampCount, before, 'failed registration leaves no candidate');
  assert.equal(lights.status().registeredLampCount, 0);
  const releaseAgain = lights.registerLamp({ ...lamp });
  assert.equal(lights.status().activeLampIds.filter(id => id === lamp.id).length, 1, 'recreated instance registers exactly once');
  lights.destroy(); lights.destroy(); lights.update(.2);
  releaseAgain();
  assert.equal(app.root.findComponents('light').length, 0);
  assert.equal(lights.status().activeDynamicLights, 0);
  assert.equal(lights.status().registeredLampCount, 0);
  assert.equal(lights.status().lampCount, before);
});
