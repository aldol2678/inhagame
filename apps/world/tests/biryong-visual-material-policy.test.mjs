import test from "node:test";
import assert from "node:assert/strict";
import {
  BIRYONG_VISUAL_MATERIALS,
  BIRYONG_VISUAL_MATERIAL_PROFILE_VERSION,
  biryongVisualMaterialIds,
  biryongVisualMaterialProfile
} from "../src/biryong/biryong-visual-material-policy.js";

test("Biryong P0-B material profile covers every current realm surface token", () => {
  assert.equal(BIRYONG_VISUAL_MATERIAL_PROFILE_VERSION, "biryong.visual.material.p0b.v1");
  assert.deepEqual(
    biryongVisualMaterialIds().sort(),
    [
      "accent", "darkStone", "field", "grass", "path", "platform", "plaster",
      "road", "roof", "roofWarm", "stone", "water", "wood", "workshop"
    ].sort()
  );
  for (const id of biryongVisualMaterialIds()) {
    const profile = biryongVisualMaterialProfile(id);
    assert.match(profile.color, /^#[0-9a-f]{6}$/);
    assert.equal(profile.specular.length, 3);
    assert.ok(profile.gloss >= 0 && profile.gloss <= 1);
    assert.ok(profile.reflectivity >= 0 && profile.reflectivity <= 1);
    assert.ok(profile.opacity > 0 && profile.opacity <= 1);
  }
});

test("P0-B separates rough ground, architecture, metal and water optical response", () => {
  assert.ok(BIRYONG_VISUAL_MATERIALS.road.gloss < BIRYONG_VISUAL_MATERIALS.platform.gloss);
  assert.ok(BIRYONG_VISUAL_MATERIALS.platform.gloss < BIRYONG_VISUAL_MATERIALS.accent.gloss);
  assert.ok(BIRYONG_VISUAL_MATERIALS.accent.gloss < BIRYONG_VISUAL_MATERIALS.water.gloss);
  assert.ok(BIRYONG_VISUAL_MATERIALS.grass.gloss < BIRYONG_VISUAL_MATERIALS.wood.gloss);
  assert.ok(BIRYONG_VISUAL_MATERIALS.water.reflectivity > BIRYONG_VISUAL_MATERIALS.platform.reflectivity);
  assert.ok(BIRYONG_VISUAL_MATERIALS.accent.reflectivity > BIRYONG_VISUAL_MATERIALS.roof.reflectivity);
});

test("water remains restrained rather than becoming an opaque mirror", () => {
  const water = BIRYONG_VISUAL_MATERIALS.water;
  assert.ok(water.opacity < 1);
  assert.ok(water.opacity >= 0.85);
  assert.ok(water.reflectivity <= 0.35);
});
