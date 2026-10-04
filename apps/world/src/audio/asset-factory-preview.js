// Compatibility shim for AF-07/AF-09 preview links.
// Runtime ownership moved to the generic Soundscape Binding contract in AF-10.
import {
  SOUNDSCAPE_PROFILE_IDS,
  resolveSoundscapeAssetBinding
} from "./soundscape-asset-bindings.js";
import { WORLD_ASSET_IDS } from "../assets/world-asset-registry.js";

export const AF07_R2_PROFILE_ID = SOUNDSCAPE_PROFILE_IDS.INKYUNG_R2;
export const AF07_R2_ASSET_IDS = WORLD_ASSET_IDS;
export const resolveAssetFactoryPreviewAmbience = resolveSoundscapeAssetBinding;
