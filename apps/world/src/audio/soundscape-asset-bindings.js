import {
  WORLD_ASSET_IDS,
  resolveWorldAssetRecord
} from "../assets/world-asset-registry.js";

export const SOUNDSCAPE_PROFILE_IDS = Object.freeze({
  INKYUNG_R2: "soundscape.inkyung.r2"
});

const BASE_LAYERS = Object.freeze([
  Object.freeze({ assetId: WORLD_ASSET_IDS.INKYUNG_WATER_SHORE, gain: 0.18, offsetSeconds: 0 }),
  Object.freeze({ assetId: WORLD_ASSET_IDS.INKYUNG_AIR_LIFE, gain: 0.10, offsetSeconds: 7.5 })
]);

const WEATHER_LAYERS = Object.freeze({
  RAIN: Object.freeze([
    Object.freeze({ assetId: WORLD_ASSET_IDS.INKYUNG_RAIN, gain: 0.14, offsetSeconds: 13 })
  ])
});

export const SOUNDSCAPE_BINDINGS = Object.freeze({
  [SOUNDSCAPE_PROFILE_IDS.INKYUNG_R2]: Object.freeze({
    id: SOUNDSCAPE_PROFILE_IDS.INKYUNG_R2,
    zone: "INKYUNG",
    replaceSynthetic: true,
    fallback: "synthetic-zone-profile",
    baseLayers: BASE_LAYERS,
    weatherLayers: WEATHER_LAYERS
  })
});

function resolveLayer(binding) {
  const asset = resolveWorldAssetRecord(binding.assetId, {
    type: "audio",
    requireVerifiedRights: true,
    requireOwnerAcceptedQa: true
  });
  return asset ? Object.freeze({
    asset,
    gain: binding.gain,
    offsetSeconds: binding.offsetSeconds
  }) : null;
}

export function resolveSoundscapeAssetBinding({
  profileId = null,
  zone = null,
  weather = null
} = {}) {
  const profile = SOUNDSCAPE_BINDINGS[profileId] ?? null;
  if (!profile || profile.zone !== zone) return null;

  const weatherKey = String(weather ?? "").toUpperCase();
  const bindings = [
    ...profile.baseLayers,
    ...(profile.weatherLayers[weatherKey] ?? [])
  ];
  const layers = bindings.map(resolveLayer);
  if (layers.some(layer => !layer)) return null;

  return Object.freeze({
    id: `${profile.id}:${profile.zone}:${weatherKey || "DEFAULT"}`,
    profileId: profile.id,
    zone: profile.zone,
    weather: weatherKey || null,
    replaceSynthetic: profile.replaceSynthetic,
    fallback: profile.fallback,
    layers: Object.freeze(layers)
  });
}
