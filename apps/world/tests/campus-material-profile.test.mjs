import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CAMPUS_MATERIAL_PROFILES,
  campusMaterialProfile,
  inferCampusMaterialProfile,
  normalizeMaterialHex
} from '../src/campus-material-profile.js';

test('P7A material profiles keep distinct optical response', () => {
  assert.ok(CAMPUS_MATERIAL_PROFILES.asphalt.gloss < CAMPUS_MATERIAL_PROFILES.concrete.gloss);
  assert.ok(CAMPUS_MATERIAL_PROFILES.concrete.gloss < CAMPUS_MATERIAL_PROFILES.metal.gloss);
  assert.ok(CAMPUS_MATERIAL_PROFILES.metal.gloss < CAMPUS_MATERIAL_PROFILES.glass.gloss);
  assert.ok(CAMPUS_MATERIAL_PROFILES.foliage.gloss < CAMPUS_MATERIAL_PROFILES.wood.gloss);
  assert.ok(CAMPUS_MATERIAL_PROFILES.rubber.gloss < CAMPUS_MATERIAL_PROFILES.asphalt.gloss);
});

test('known campus palette colors map only to explicit semantic profiles', () => {
  assert.equal(inferCampusMaterialProfile('#747d7b'), 'asphalt');
  assert.equal(inferCampusMaterialProfile('#B4B4A8'), 'concrete');
  assert.equal(inferCampusMaterialProfile('#ac7965'), 'brick');
  assert.equal(inferCampusMaterialProfile('#e6e4d3'), 'paint');
  assert.equal(inferCampusMaterialProfile('#e1e3df'), 'metal');
  assert.equal(inferCampusMaterialProfile('#548d99'), 'glass');
  assert.equal(inferCampusMaterialProfile('#8d6848'), 'wood');
  assert.equal(inferCampusMaterialProfile('#527447'), 'foliage');
  assert.equal(inferCampusMaterialProfile('#303735'), 'rubber');
});

test('unknown colors remain neutral instead of guessing by hue', () => {
  assert.equal(inferCampusMaterialProfile('#6fe7ff'), 'neutral');
  assert.equal(inferCampusMaterialProfile('#ffd56a'), 'neutral');
  assert.equal(inferCampusMaterialProfile('#123456'), 'neutral');
  assert.equal(inferCampusMaterialProfile('not-a-color'), 'neutral');
  assert.equal(normalizeMaterialHex('#ABCDEF'), '#abcdef');
  assert.equal(normalizeMaterialHex('#abc'), null);
});

test('unknown profile names safely fall back to neutral', () => {
  assert.equal(campusMaterialProfile('missing'), CAMPUS_MATERIAL_PROFILES.neutral);
});
