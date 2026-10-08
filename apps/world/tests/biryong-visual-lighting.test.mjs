import test from "node:test";
import assert from "node:assert/strict";
import {
  BIRYONG_VISUAL_LIGHTING_PROFILE_VERSION,
  biryongVisualLightingProfile
} from "../src/biryong/biryong-visual-lighting-policy.js";
import { createBiryongVisualLighting } from "../src/biryong/biryong-visual-lighting.js";

const base = Object.freeze({
  sunColor: Object.freeze([1, 0.94, 0.81]),
  sunIntensity: 1.15,
  sunEuler: Object.freeze([55, 30, 0]),
  ambientColor: Object.freeze([0.48, 0.54, 0.61]),
  exposure: 1.05,
  shadowIntensity: 0.48,
  artificialLightFactor: 0,
  sunLightScale: 1,
  ambientLightScale: 1
});

test("Biryong P0-A profile strengthens daylight without mutating the source", () => {
  const before = JSON.stringify(base);
  const medium = biryongVisualLightingProfile(base, "medium");
  const high = biryongVisualLightingProfile(base, "high");

  assert.equal(medium.version, BIRYONG_VISUAL_LIGHTING_PROFILE_VERSION);
  assert.equal(medium.tier, "medium");
  assert.ok(medium.sunIntensity > base.sunIntensity);
  assert.ok(high.sunIntensity > medium.sunIntensity);
  assert.ok(medium.shadowIntensity > base.shadowIntensity);
  assert.ok(high.shadowIntensity > medium.shadowIntensity);
  assert.ok(medium.sunEuler[1] > base.sunEuler[1]);
  assert.ok(medium.ambientColor[2] > base.ambientColor[2]);
  assert.equal(JSON.stringify(base), before);
});

test("Biryong P0-A respects night and weather sun scaling", () => {
  const night = biryongVisualLightingProfile({
    ...base,
    artificialLightFactor: 1,
    sunLightScale: 0.4
  }, "high");

  assert.equal(night.daylight, 0);
  assert.equal(night.sunIntensity, base.sunIntensity * 0.4);
  assert.deepEqual(night.sunEuler, base.sunEuler);
  assert.ok(night.shadowIntensity <= 1);
});

test("Biryong runtime is region-gated and restores the canonical environment", () => {
  let inBiryong = false;
  const ambient = { value: [0, 0, 0], set(...value) { this.value = value; } };
  const color = { value: [0, 0, 0], set(...value) { this.value = value; } };
  const scene = { ambientLight: ambient, exposure: 0 };
  const light = {
    intensity: 0,
    shadowIntensity: 0,
    castShadows: true,
    shadowResolution: 1024,
    shadowDistance: 75,
    color
  };
  const lightEntity = {
    light,
    euler: [0, 0, 0],
    setEulerAngles(...value) { this.euler = value; }
  };
  const environment = {
    copyVisualLightingState(out) {
      Object.assign(out, {
        ...base,
        sunColor: [...base.sunColor],
        sunEuler: [...base.sunEuler],
        ambientColor: [...base.ambientColor]
      });
      return out;
    }
  };

  const controller = createBiryongVisualLighting({
    scene,
    lightEntity,
    environment,
    getActive: () => inBiryong,
    getGraphicsTier: () => "medium",
    enabled: true
  });

  assert.equal(controller.update(), false);
  assert.equal(controller.status().active, false);

  inBiryong = true;
  assert.equal(controller.update(), true);
  assert.equal(controller.status().active, true);
  assert.ok(light.intensity > base.sunIntensity);
  assert.ok(light.shadowIntensity > base.shadowIntensity);
  assert.equal(light.shadowResolution, 1024);
  assert.equal(light.shadowDistance, 75);
  assert.equal(light.castShadows, true);

  inBiryong = false;
  assert.equal(controller.update(), true);
  assert.equal(controller.status().active, false);
  assert.deepEqual(ambient.value, base.ambientColor);
  assert.equal(scene.exposure, base.exposure);
  assert.deepEqual(color.value, base.sunColor);
  assert.equal(light.intensity, base.sunIntensity);
  assert.equal(light.shadowIntensity, base.shadowIntensity);
  assert.deepEqual(lightEntity.euler, base.sunEuler);
});
