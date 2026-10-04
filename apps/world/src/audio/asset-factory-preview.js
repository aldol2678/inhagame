import {
  WORLD_ASSET_IDS,
  resolveWorldAssetRecord
} from "../assets/world-asset-registry.js";

export const AF07_R2_PROFILE_ID = "af07-r2";
export const AF07_R2_ASSET_IDS = WORLD_ASSET_IDS;

const BASE_LAYERS = Object.freeze([
  Object.freeze({ assetId: WORLD_ASSET_IDS.INKYUNG_WATER_SHORE, gain: 0.18, offsetSeconds: 0 }),
  Object.freeze({ assetId: WORLD_ASSET_IDS.INKYUNG_AIR_LIFE, gain: 0.10, offsetSeconds: 7.5 })
]);
const RAIN_LAYER = Object.freeze({
  assetId: WORLD_ASSET_IDS.INKYUNG_RAIN,
  gain: 0.14,
  offsetSeconds: 13
});

function resolveLayer(binding) {
  const asset = resolveWorldAssetRecord(binding.assetId, {
    type: "audio",
    requireVerifiedRights: true,
    requireOwnerAcceptedQa: true
  });
  return asset ? Object.freeze({ asset, gain: binding.gain, offsetSeconds: binding.offsetSeconds }) : null;
}

export function resolveAssetFactoryPreviewAmbience({ profileId = null, zone = null, weather = null } = {}) {
  if (profileId !== AF07_R2_PROFILE_ID || zone !== "INKYUNG") return null;
  const rain = String(weather ?? "").toUpperCase() === "RAIN";
  const bindings = [...BASE_LAYERS, ...(rain ? [RAIN_LAYER] : [])];
  const layers = bindings.map(resolveLayer);
  if (layers.some(layer => !layer)) return null;
  return Object.freeze({
    id: `${AF07_R2_PROFILE_ID}:INKYUNG:${rain ? "RAIN" : "BASE"}`,
    replaceSynthetic: true,
    layers: Object.freeze(layers)
  });
}
