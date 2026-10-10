import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createBiryongAtmosphere } from '../src/biryong/biryong-atmosphere.js';

// The engine boundary is replaced; production density allocation/tier logic runs unchanged.
const densityUrl = new URL('../src/biryong/biryong-environment-density.js', import.meta.url);
const source = (await readFile(densityUrl, 'utf8'))
  .replace('import * as pc from "playcanvas";', `const pc = { Entity: class Entity {
    constructor(name) { this.name = name; this.children = []; this.enabled = true; }
    addChild(child) { child.parent = this; this.children.push(child); }
    destroy() { for (const child of [...this.children]) child.destroy();
      if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
      this.destroyed = true; }
  }};`)
  .replace('import { box, surface } from "../campus-render-kit.js";', `
    const surface = () => Object.freeze({ shared: true });
    const box = (root, name) => { const entity = new pc.Entity(name); entity.render = {};
      root.addChild(entity); return entity; };`)
  .replace('"./biryong-environment-density-policy.js"', JSON.stringify(new URL('../src/biryong/biryong-environment-density-policy.js', import.meta.url).href));
const { createBiryongEnvironmentDensity } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
function densityHarness(enabled = true) {
  let tier = 'low';
  const root = { children: [], addChild(child) { child.parent = this; this.children.push(child); } };
  const view = createBiryongEnvironmentDensity({ root, enabled, getGraphicsTier: () => tier });
  const meshes = node => node.children.reduce((sum, child) => sum + (child.render ? 1 : 0) + meshes(child), 0);
  return { root, view, meshes: () => meshes(root), tier: value => { tier = value; view.update(); } };
}
test('density allocates only tier-required meshes and releases downgraded groups', () => {
  const h = densityHarness();
  assert.equal(h.meshes(), 24);
  h.tier('medium'); assert.equal(h.meshes(), 60);
  h.tier('high'); assert.equal(h.meshes(), 88);
  h.tier('low'); assert.equal(h.meshes(), 24);
  for (let i = 0; i < 10; i++) { h.tier('high'); h.tier('low'); }
  assert.equal(h.meshes(), 24);
  h.view.destroy(); h.view.destroy();
  h.tier('high'); assert.equal(h.meshes(), 0);
  assert.equal(h.view.status().counts.total, 0);
});
test('disabled density lifecycle never allocates entities', () => {
  const h = densityHarness(false);
  h.view.destroy(); h.tier('high');
  assert.equal(h.meshes(), 0);
  assert.equal(h.root.children.length, 0);
});
test('atmosphere captures each entry baseline and restores on destroy', () => {
  let active = false;
  const color = () => ({ set(...values) { this.values = values; } });
  const scene = { fog: { color: color() } };
  const camera = { camera: { clearColor: color(), toneMapping: 11 } };
  const canvas = { style: { filter: '' } };
  const canonical = { clearColor: [0.1, 0.2, 0.3], fogColor: [0.4, 0.5, 0.6],
    fogType: 'linear', fogStart: 40, fogEnd: 100, artificialLightFactor: 0 };
  const view = createBiryongAtmosphere({ scene, camera, canvas, enabled: true,
    environment: { copyVisualAtmosphereState: out => Object.assign(out, canonical) },
    getActive: () => active, toneMappingNeutral: 11, toneMappingCinematic: 22 });
  camera.camera.toneMapping = 33; canvas.style.filter = 'contrast(1.1)';
  active = true; view.update();
  active = false; view.update();
  assert.equal(camera.camera.toneMapping, 33);
  assert.equal(canvas.style.filter, 'contrast(1.1)');
  camera.camera.toneMapping = 44; canvas.style.filter = 'brightness(1.2)';
  active = true; view.update(); canonical.fogEnd = 80;
  view.destroy(); view.destroy(); view.update();
  assert.equal(scene.fog.end, 80);
  assert.equal(camera.camera.toneMapping, 44);
  assert.equal(canvas.style.filter, 'brightness(1.2)');
  assert.equal(view.status().active, false);
});

test('visual teardown removes update listeners without breaking BFCache resume', async () => {
  const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
  for (const name of ['updateBiryongDensity', 'updateBiryongLighting', 'updateBiryongAtmosphere']) {
    assert.ok(main.includes(`app.off("update", ${name})`), name);
  }
  assert.ok(main.includes('app.off("postrender", updateBiryongPerformance)'));
  assert.match(main, /if \(!event.persisted\) destroyBiryongVisualLab\(\)/);
  assert.match(main, /app.once\("destroy", destroyBiryongVisualLab\)/);
});

test('Biryong lighting restores current canonical celestial pose rather than old preset angles', async () => {
  const { createEnvironmentDirector } = await import('../src/environment/environment-director.js');
  const { createBiryongVisualLighting } = await import('../src/biryong/biryong-visual-lighting.js');
  const color = () => ({ set(...value) { this.value = value; } });
  const scene = { ambientLight: color() };
  const lightEntity = { light: { color: color() }, setEulerAngles(...value) { this.euler = value; } };
  const environment = createEnvironmentDirector({ scene, lightEntity });
  let active = true;
  const view = createBiryongVisualLighting({ scene, lightEntity, environment,
    enabled: true, getActive: () => active });
  environment.setCelestialPose({ sunEuler: [28, 143, 0] });
  view.update();
  environment.setCelestialPose({ sunEuler: [29, 144, 0] });
  active = false; view.update();
  assert.deepEqual(lightEntity.euler, [29, 144, 0]);
});
