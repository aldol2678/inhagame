import test from 'node:test';
import assert from 'node:assert/strict';
import { ENVIRONMENT_PRESETS as PRESETS } from '../src/environment/environment-presets.js';
import { biryongVisualLightingProfile } from '../src/biryong/biryong-visual-lighting-policy.js';
import { biryongAtmosphereProfile } from '../src/biryong/biryong-atmosphere-policy.js';
const near = (a,b) => assert.ok(Math.abs(a-b) < 1e-10, `${a} != ${b}`);
const tiers = ['low','medium','high'];
for (const tier of tiers) {
  test(`${tier}: night uses existing DUSK readability floor without adding sunlight or mutating presets`, () => {
    const before = JSON.stringify(PRESETS);
    const profile = biryongVisualLightingProfile(PRESETS.NIGHT, tier);
    profile.ambientColor.forEach((value,i) => near(value, PRESETS.DUSK.ambientColor[i]));
    near(profile.exposure, PRESETS.DUSK.exposure);
    assert.equal(profile.sunIntensity, 0);
    assert.equal(JSON.stringify(PRESETS), before);
    const atmosphere = biryongAtmosphereProfile({ ...PRESETS.NIGHT, targetTime: 'NIGHT' }, tier);
    assert.match(atmosphere.canvasFilter, /contrast\(1\) brightness\(1.000\)/);
    assert.equal(atmosphere.screenSpaceBloom, false);
  });
}
test('night ambient floor retains canonical weather dimming', () => {
  for (const scale of [1, .86, .92, .78, .88]) {
    const profile = biryongVisualLightingProfile({ ...PRESETS.NIGHT, ambientLightScale: scale }, 'high');
    profile.ambientColor.forEach((value,i) => near(value, PRESETS.DUSK.ambientColor[i] * scale));
    assert.equal(profile.sunIntensity, 0);
  }
});
test('DAY output is unchanged and DUSK-boundary/late-night blending is continuous', () => {
  const day = biryongVisualLightingProfile(PRESETS.DAY, 'high');
  near(day.exposure, PRESETS.DAY.exposure + .030);
  day.ambientColor.forEach((value,i) => near(value, PRESETS.DAY.ambientColor[i] * (1 + .060 * [.45,.92,1.18][i])));
  const base = { ...PRESETS.NIGHT, artificialLightFactor: PRESETS.DUSK.artificialLightFactor };
  const a = biryongVisualLightingProfile(base, 'high');
  const b = biryongVisualLightingProfile({ ...base, artificialLightFactor: base.artificialLightFactor + 1e-7 }, 'high');
  a.ambientColor.forEach((value,i) => assert.ok(Math.abs(value-b.ambientColor[i]) < 1e-7));
  for (let n = .67; n <= 1; n += .01) {
    const p = biryongVisualLightingProfile({ ...PRESETS.NIGHT, artificialLightFactor: n }, 'high');
    assert.ok(p.exposure <= PRESETS.DUSK.exposure + 1e-10);
    assert.equal(p.sunIntensity, 0);
  }
});

test('pixel gate rejects black crush and missing character/background separation', async () => {
  const { analyzeBiryongNightPixels, BIRYONG_NIGHT_PIXEL_GATE: gate } = await import('./browser/biryong-night-pixel-policy.mjs');
  const image = { width: 1280, height: 720, data: new Uint8Array(1280*720*4) };
  for(let i=3;i<image.data.length;i+=4) image.data[i]=255;
  assert.equal(analyzeBiryongNightPixels(image).passed, false);
  for(let i=0;i<image.data.length;i+=4) image.data[i]=image.data[i+1]=image.data[i+2]=30;
  assert.equal(analyzeBiryongNightPixels(image).passed, false, 'flat gray cannot hide a missing character');
  const [x0,y0,x1,y1]=gate.regions.character.rect;
  for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
    const i=(y*1280+x)*4;image.data[i]=image.data[i+1]=image.data[i+2]=15;
  }
  assert.equal(analyzeBiryongNightPixels(image).passed, true);
});

test('browser gate reads composited screenshots for all tiers without weakening exact-head receipts', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('./browser/graphics-parallel-smoke.mjs',import.meta.url),'utf8');
  assert.match(source, /execFileSync\('git', \['rev-parse', 'HEAD'\]/);
  assert.match(source, /createImageBitmap\(new Blob/);
  assert.match(source, /biryongNightPixels = nightPixels/);
  assert.match(source, /\['low', 'medium', 'high'\]/);
  assert.match(source, /assert.equal\(pixels.passed, true/);
  assert.match(source, /restore live night exposure/);
});

test('Preview night override leaves canonical environment unchanged and restores on OFF/exit', async () => {
  const { createEnvironmentDirector } = await import('../src/environment/environment-director.js');
  const { createBiryongVisualLighting } = await import('../src/biryong/biryong-visual-lighting.js');
  const color = () => ({ value: [], set(...value) { this.value = value; } });
  const scene = { ambientLight: color() };
  const lightEntity = { light: { color: color() }, setEulerAngles() {} };
  const environment = createEnvironmentDirector({ scene, lightEntity, initialTime: 'NIGHT' });
  const canonical = environment.status();
  let active = true;
  const lighting = createBiryongVisualLighting({ scene, lightEntity, environment, enabled: true, getActive: () => active });
  lighting.update();
  assert.deepEqual(scene.ambientLight.value, PRESETS.DUSK.ambientColor);
  assert.deepEqual(environment.status(), canonical);
  assert.equal(lightEntity.light.intensity, 0);
  lighting.setEnabled(false);
  assert.deepEqual(scene.ambientLight.value, PRESETS.NIGHT.ambientColor);
  near(scene.exposure, PRESETS.NIGHT.exposure);
  lighting.setEnabled(true); active = false; lighting.update();
  assert.deepEqual(scene.ambientLight.value, PRESETS.NIGHT.ambientColor);
  assert.deepEqual(environment.status(), canonical);
});
