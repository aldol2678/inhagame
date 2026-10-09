import test from "node:test";
import assert from "node:assert/strict";
import {
  BIRYONG_ATMOSPHERE_PROFILE_VERSION,
  biryongAtmosphereProfile
} from "../src/biryong/biryong-atmosphere-policy.js";
import { createBiryongAtmosphere } from "../src/biryong/biryong-atmosphere.js";

const base = Object.freeze({
  targetTime: "DAY",
  targetWeather: "CLEAR",
  artificialLightFactor: 0,
  clearColor: Object.freeze([0.52, 0.71, 0.84]),
  fogType: "none",
  fogStart: 650,
  fogEnd: 700,
  fogColor: Object.freeze([0.52, 0.71, 0.84])
});

test("P0-D adds bounded distance haze and grading to clear weather", () => {
  const medium = biryongAtmosphereProfile(base, "medium");
  const high = biryongAtmosphereProfile(base, "high");

  assert.equal(medium.version, BIRYONG_ATMOSPHERE_PROFILE_VERSION);
  assert.equal(medium.fogType, "linear");
  assert.ok(high.fogStart < medium.fogStart);
  assert.ok(high.fogEnd < medium.fogEnd);
  assert.equal(medium.toneMapping, "cinematic");
  assert.match(medium.canvasFilter, /^saturate\(/);
  assert.equal(medium.screenSpaceBloom, false);
});

test("P0-D never weakens stronger canonical weather fog", () => {
  const fog = biryongAtmosphereProfile({
    ...base,
    targetWeather: "FOG",
    fogType: "linear",
    fogStart: 40,
    fogEnd: 155,
    fogColor: [0.68, 0.72, 0.76]
  }, "high");

  assert.equal(fog.fogStart, 40);
  assert.equal(fog.fogEnd, 155);
});

test("P0-D time tint remains distinct without changing the source", () => {
  const before = JSON.stringify(base);
  const day = biryongAtmosphereProfile(base, "medium");
  const sunset = biryongAtmosphereProfile({ ...base, targetTime: "SUNSET" }, "medium");
  const night = biryongAtmosphereProfile({
    ...base,
    targetTime: "NIGHT",
    artificialLightFactor: 1
  }, "medium");

  assert.notDeepEqual(day.fogColor, sunset.fogColor);
  assert.notDeepEqual(sunset.fogColor, night.fogColor);
  assert.equal(JSON.stringify(base), before);
});

test("P0-D runtime applies only inside Biryong and restores canonical environment", () => {
  let inBiryong = false;
  const fogColor = { value: [0, 0, 0], set(...value) { this.value = value; } };
  const clearColor = { value: [0, 0, 0], set(...value) { this.value = value; } };
  const scene = {
    fog: { type: "none", start: 650, end: 700, density: 0, color: fogColor }
  };
  const camera = { camera: { clearColor, toneMapping: 11 } };
  const canvas = { style: { filter: "" } };
  const environment = {
    copyVisualAtmosphereState(out) {
      Object.assign(out, {
        ...base,
        clearColor: [...base.clearColor],
        fogColor: [...base.fogColor]
      });
      return out;
    }
  };

  const controller = createBiryongAtmosphere({
    scene,
    camera,
    canvas,
    environment,
    getActive: () => inBiryong,
    getGraphicsTier: () => "medium",
    enabled: true,
    toneMappingNeutral: 11,
    toneMappingCinematic: 22
  });

  assert.equal(controller.update(), false);
  inBiryong = true;
  assert.equal(controller.update(), true);
  assert.equal(scene.fog.type, "linear");
  assert.equal(camera.camera.toneMapping, 22);
  assert.notEqual(canvas.style.filter, "");

  inBiryong = false;
  assert.equal(controller.update(), true);
  assert.equal(scene.fog.type, base.fogType);
  assert.equal(scene.fog.start, base.fogStart);
  assert.equal(scene.fog.end, base.fogEnd);
  assert.deepEqual(fogColor.value, base.fogColor);
  assert.deepEqual(clearColor.value, base.clearColor);
  assert.equal(camera.camera.toneMapping, 11);
  assert.equal(canvas.style.filter, "");
});

test("P0-D disabled path is inert", () => {
  const scene = { fog: { color: { set() {} } } };
  const camera = { camera: { clearColor: { set() {} }, toneMapping: 11 } };
  const environment = { copyVisualAtmosphereState() { throw new Error("must stay inert"); } };
  const controller = createBiryongAtmosphere({
    scene,
    camera,
    environment,
    enabled: false,
    getGraphicsTier: () => "low"
  });

  assert.equal(controller.update(), false);
  assert.equal(controller.status().enabled, false);
});

test('NIGHT uses the readable neutral mapper for every tier while daytime and twilight retain their mapper', () => {
  for (const tier of ['low', 'medium', 'high']) {
    assert.equal(biryongAtmosphereProfile({ ...base, targetTime: 'NIGHT', artificialLightFactor: 1 }, tier).toneMapping, 'neutral');
    for (const targetTime of ['DAWN', 'DAY', 'GOLDEN_HOUR', 'SUNSET', 'DUSK'])
      assert.equal(biryongAtmosphereProfile({ ...base, targetTime }, tier).toneMapping, tier === 'low' ? 'neutral' : 'cinematic');
  }
});

test('NIGHT and quality transitions select neutral without changing the campus restoration baseline', () => {
  const color = () => ({ set() {} });
  const scene = { fog: { color: color() } };
  const camera = { camera: { clearColor: color(), toneMapping: 7 } };
  const canvas = { style: { filter: 'contrast(1.1)' } };
  let active = true, tier = 'high', time = 'DAY';
  const environment = { copyVisualAtmosphereState(out) { return Object.assign(out, base, { targetTime: time, artificialLightFactor: time === 'NIGHT' ? 1 : 0 }); } };
  const controller = createBiryongAtmosphere({ scene, camera, canvas, environment, enabled: true,
    getActive: () => active, getGraphicsTier: () => tier, toneMappingNeutral: 11, toneMappingCinematic: 22 });
  controller.update(); assert.equal(camera.camera.toneMapping, 22);
  time = 'NIGHT'; controller.update(); assert.equal(camera.camera.toneMapping, 11);
  for (tier of ['medium', 'low', 'high']) { controller.update(); assert.equal(camera.camera.toneMapping, 11); }
  time = 'SUNSET'; controller.update(); assert.equal(camera.camera.toneMapping, 22);
  time = 'NIGHT'; controller.update();
  active = false; controller.update();
  assert.equal(camera.camera.toneMapping, 7);
  assert.equal(canvas.style.filter, 'contrast(1.1)');
});
