import {
  ASSET_OPTIMIZATION_SHADOW_MAP,
  createAssetOptimizationShadow
} from "./asset-optimization-shadow.js";
import {
  assetCanarySelected,
  createAssetAuthorityCanary
} from "./asset-authority-canary.js";

export const ASSET_PRODUCTION_CANARY_PERCENTAGE = 1;
export const ASSET_PRODUCTION_CANARY_SOURCE = "/assets/induck-v3.glb";
export const ASSET_PRODUCTION_CANARY_OPTIMIZED =
  ASSET_OPTIMIZATION_SHADOW_MAP[ASSET_PRODUCTION_CANARY_SOURCE];
export const ASSET_PRODUCTION_CANARY_STORAGE_KEY = "inhagame.asset.canary.subject.v1";

const PRODUCTION_MAPPING = Object.freeze({
  [ASSET_PRODUCTION_CANARY_SOURCE]: ASSET_PRODUCTION_CANARY_OPTIMIZED
});

export function getOrCreateAssetCanarySubjectKey({
  storage = null,
  cryptoImpl = null
} = {}) {
  try {
    const targetStorage = storage ?? globalThis.localStorage;
    const targetCrypto = cryptoImpl ?? globalThis.crypto;
    const existing = targetStorage?.getItem?.(ASSET_PRODUCTION_CANARY_STORAGE_KEY);
    if (typeof existing === "string" && /^[0-9a-f-]{36}$/iu.test(existing)) return existing;
    if (typeof targetCrypto?.randomUUID !== "function") return null;
    const created = targetCrypto.randomUUID();
    targetStorage?.setItem?.(ASSET_PRODUCTION_CANARY_STORAGE_KEY, created);
    return targetStorage?.getItem?.(ASSET_PRODUCTION_CANARY_STORAGE_KEY) === created ? created : null;
  } catch {
    return null;
  }
}

export function createProductionAssetCanary({
  app,
  enabled = true,
  storage = null,
  cryptoImpl = null,
  subjectKeyOverride = null
} = {}) {
  const subjectKey = subjectKeyOverride ??
    getOrCreateAssetCanarySubjectKey({ storage, cryptoImpl });
  const selected = Boolean(
    enabled &&
    subjectKey &&
    assetCanarySelected(subjectKey, ASSET_PRODUCTION_CANARY_PERCENTAGE)
  );

  const shadow = createAssetOptimizationShadow({
    app,
    enabled: selected,
    mapping: PRODUCTION_MAPPING
  });

  const canary = createAssetAuthorityCanary({
    app,
    shadow,
    enabled: selected,
    percentage: ASSET_PRODUCTION_CANARY_PERCENTAGE,
    productionWired: true
  });

  return Object.freeze({
    subjectKey,
    selected,
    shadow,
    canary,
    status: () => Object.freeze({
      enabled: Boolean(enabled),
      productionWired: true,
      percentage: ASSET_PRODUCTION_CANARY_PERCENTAGE,
      asset: ASSET_PRODUCTION_CANARY_SOURCE,
      optimizedAsset: ASSET_PRODUCTION_CANARY_OPTIMIZED,
      subjectAvailable: Boolean(subjectKey),
      selected,
      authority: canary.status()
    })
  });
}
