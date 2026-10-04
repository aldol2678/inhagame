import test from "node:test";
import assert from "node:assert/strict";
import {
  SOUNDSCAPE_BINDINGS,
  SOUNDSCAPE_PROFILE_IDS,
  resolveSoundscapeAssetBinding
} from "../src/audio/soundscape-asset-bindings.js";
import { WORLD_ASSET_IDS } from "../src/assets/world-asset-registry.js";

test("AF-10 binding owns domain routing but not asset URI/provenance/rights", () => {
  const profile = SOUNDSCAPE_BINDINGS[SOUNDSCAPE_PROFILE_IDS.INKYUNG_R2];
  assert.equal(profile.zone, "INKYUNG");
  assert.equal(profile.replaceSynthetic, true);
  assert.equal(profile.fallback, "synthetic-zone-profile");

  const serialized = JSON.stringify(profile);
  assert.doesNotMatch(serialized, /https?:\/\//);
  assert.doesNotMatch(serialized, /provenance|commercialUse|rights/);
});

test("AF-10 clear/base binding resolves two central-registry assets", () => {
  const binding = resolveSoundscapeAssetBinding({
    profileId: SOUNDSCAPE_PROFILE_IDS.INKYUNG_R2,
    zone: "INKYUNG",
    weather: "CLEAR"
  });
  assert.equal(binding.profileId, SOUNDSCAPE_PROFILE_IDS.INKYUNG_R2);
  assert.equal(binding.fallback, "synthetic-zone-profile");
  assert.deepEqual(binding.layers.map(layer => layer.asset.id), [
    WORLD_ASSET_IDS.INKYUNG_WATER_SHORE,
    WORLD_ASSET_IDS.INKYUNG_AIR_LIFE
  ]);
  assert.deepEqual(binding.layers.map(layer => layer.offsetSeconds), [0, 7.5]);
});

test("AF-10 rain binding adds the weather layer and stays fail-closed outside the zone/profile", () => {
  const binding = resolveSoundscapeAssetBinding({
    profileId: SOUNDSCAPE_PROFILE_IDS.INKYUNG_R2,
    zone: "INKYUNG",
    weather: "RAIN"
  });
  assert.deepEqual(binding.layers.map(layer => layer.asset.id), [
    WORLD_ASSET_IDS.INKYUNG_WATER_SHORE,
    WORLD_ASSET_IDS.INKYUNG_AIR_LIFE,
    WORLD_ASSET_IDS.INKYUNG_RAIN
  ]);
  assert.deepEqual(binding.layers.map(layer => layer.offsetSeconds), [0, 7.5, 13]);
  assert.equal(resolveSoundscapeAssetBinding({
    profileId: "soundscape.unknown",
    zone: "INKYUNG",
    weather: "RAIN"
  }), null);
  assert.equal(resolveSoundscapeAssetBinding({
    profileId: SOUNDSCAPE_PROFILE_IDS.INKYUNG_R2,
    zone: "MAIN_GATE",
    weather: "RAIN"
  }), null);
});
