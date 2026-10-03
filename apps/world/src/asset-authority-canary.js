import { ASSET_OPTIMIZATION_SHADOW_STATUS } from "./asset-optimization-shadow.js";

export const ASSET_CANARY_AUTHORITY = Object.freeze({
  CANONICAL: "CANONICAL",
  OPTIMIZED_CANARY: "OPTIMIZED_CANARY"
});

export const ASSET_CANARY_OUTCOME = Object.freeze({
  CONTROL: "CONTROL",
  CANARY_ACTIVE: "CANARY_ACTIVE",
  ROLLED_BACK_PREFLIGHT: "ROLLED_BACK_PREFLIGHT",
  ROLLED_BACK_LOAD_FAILURE: "ROLLED_BACK_LOAD_FAILURE",
  ROLLED_BACK_INSTANTIATION_FAILURE: "ROLLED_BACK_INSTANTIATION_FAILURE",
  ROLLED_BACK_VALIDATION_FAILURE: "ROLLED_BACK_VALIDATION_FAILURE",
  ROLLED_BACK_ACTIVATION_GUARD: "ROLLED_BACK_ACTIVATION_GUARD",
  ROLLED_BACK_MANUAL: "ROLLED_BACK_MANUAL"
});

const ALLOWED_PERCENTAGES = Object.freeze(new Set([0, 1, 5, 25]));

function hashBucket(subjectKey) {
  const text = String(subjectKey);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash % 10_000;
}

export function assetCanarySelected(subjectKey, percentage) {
  if (!ALLOWED_PERCENTAGES.has(percentage)) throw new Error("E_ASSET_CANARY_PERCENTAGE");
  if (percentage === 0) return false;
  if (typeof subjectKey !== "string" || !subjectKey) throw new Error("E_ASSET_CANARY_SUBJECT");
  return hashBucket(subjectKey) < percentage * 100;
}

function instantiate(asset, options) {
  if (!asset?.resource?.instantiateRenderEntity) throw new Error("E_ASSET_CANARY_RESOURCE");
  return asset.resource.instantiateRenderEntity(options);
}

function defaultOptimizedLoader(app, optimizedUrl) {
  return new Promise((resolve, reject) => {
    app.assets.loadFromUrl(optimizedUrl, "container", (error, asset) => {
      if (error || !asset?.resource) reject(error || new Error("E_ASSET_CANARY_OPTIMIZED_UNAVAILABLE"));
      else resolve(asset);
    });
  });
}

export function createAssetAuthorityCanary({
  app,
  shadow,
  enabled = false,
  percentage = 0,
  optimizedLoader = null,
  productionWired = false,
  activationGuard = null
} = {}) {
  if (!app?.assets?.loadFromUrl) throw new TypeError("PlayCanvas asset registry is required");
  if (!shadow?.observeResource || !shadow?.optimizedUrlFor) throw new TypeError("Asset optimization shadow is required");
  if (!ALLOWED_PERCENTAGES.has(percentage)) throw new Error("E_ASSET_CANARY_PERCENTAGE");

  const loadOptimized = optimizedLoader ?? ((url) => defaultOptimizedLoader(app, url));
  const records = [];

  function record(entry) {
    const frozen = Object.freeze({ ...entry });
    records.push(frozen);
    return frozen;
  }

  async function prepare(canonicalUrl, canonicalAsset, {
    subjectKey,
    consumer = "unknown",
    instantiateOptions = { castShadows: false, receiveShadows: false },
    validateCanonicalEntity = null,
    validateOptimizedEntity = null
  } = {}) {
    const canonicalEntity = instantiate(canonicalAsset, instantiateOptions);
    if (typeof validateCanonicalEntity === "function" && validateCanonicalEntity(canonicalEntity) !== true) {
      try { canonicalEntity?.destroy?.(); } catch {}
      throw new Error("E_ASSET_CANARY_CANONICAL_VALIDATION");
    }
    const selected = enabled && assetCanarySelected(subjectKey, percentage);
    const optimizedUrl = shadow.optimizedUrlFor(canonicalUrl);

    if (!selected || !optimizedUrl) {
      const receipt = record({
        canonicalUrl,
        optimizedUrl,
        subjectKey,
        consumer,
        selected: false,
        authority: ASSET_CANARY_AUTHORITY.CANONICAL,
        outcome: ASSET_CANARY_OUTCOME.CONTROL,
        reason: optimizedUrl ? "COHORT_CONTROL" : "NO_OPTIMIZED_MAPPING"
      });
      return Object.freeze({
        activeEntity: canonicalEntity,
        canonicalEntity,
        optimizedEntity: null,
        receipt,
        rollback: () => receipt
      });
    }

    const preflight = await shadow.observeResource(canonicalUrl, canonicalAsset, {
      consumer: `canary-preflight:${consumer}`
    });

    if (!preflight || preflight.status !== ASSET_OPTIMIZATION_SHADOW_STATUS.MATCH) {
      const receipt = record({
        canonicalUrl,
        optimizedUrl,
        subjectKey,
        consumer,
        selected: true,
        authority: ASSET_CANARY_AUTHORITY.CANONICAL,
        outcome: ASSET_CANARY_OUTCOME.ROLLED_BACK_PREFLIGHT,
        reason: preflight?.status ?? "PREFLIGHT_UNAVAILABLE"
      });
      return Object.freeze({
        activeEntity: canonicalEntity,
        canonicalEntity,
        optimizedEntity: null,
        receipt,
        rollback: () => receipt
      });
    }

    let optimizedAsset;
    try {
      optimizedAsset = await loadOptimized(optimizedUrl);
    } catch (error) {
      const receipt = record({
        canonicalUrl,
        optimizedUrl,
        subjectKey,
        consumer,
        selected: true,
        authority: ASSET_CANARY_AUTHORITY.CANONICAL,
        outcome: ASSET_CANARY_OUTCOME.ROLLED_BACK_LOAD_FAILURE,
        reason: String(error?.message ?? error)
      });
      return Object.freeze({
        activeEntity: canonicalEntity,
        canonicalEntity,
        optimizedEntity: null,
        receipt,
        rollback: () => receipt
      });
    }

    let optimizedEntity;
    try {
      optimizedEntity = instantiate(optimizedAsset, instantiateOptions);
    } catch (error) {
      try { optimizedAsset?.unload?.(); } catch {}
      try { app.assets.remove?.(optimizedAsset); } catch {}
      const receipt = record({
        canonicalUrl,
        optimizedUrl,
        subjectKey,
        consumer,
        selected: true,
        authority: ASSET_CANARY_AUTHORITY.CANONICAL,
        outcome: ASSET_CANARY_OUTCOME.ROLLED_BACK_INSTANTIATION_FAILURE,
        reason: String(error?.message ?? error)
      });
      return Object.freeze({
        activeEntity: canonicalEntity,
        canonicalEntity,
        optimizedEntity: null,
        receipt,
        rollback: () => receipt
      });
    }

    if (typeof validateOptimizedEntity === "function") {
      let valid = false;
      let validationReason = "E_ASSET_CANARY_OPTIMIZED_VALIDATION";
      try {
        valid = validateOptimizedEntity(optimizedEntity) === true;
      } catch (error) {
        validationReason = String(error?.message ?? error);
      }
      if (!valid) {
        try { optimizedEntity?.destroy?.(); } catch {}
        try { optimizedAsset?.unload?.(); } catch {}
        try { app.assets.remove?.(optimizedAsset); } catch {}
        const receipt = record({
          canonicalUrl,
          optimizedUrl,
          subjectKey,
          consumer,
          selected: true,
          authority: ASSET_CANARY_AUTHORITY.CANONICAL,
          outcome: ASSET_CANARY_OUTCOME.ROLLED_BACK_VALIDATION_FAILURE,
          reason: validationReason
        });
        return Object.freeze({
          activeEntity: canonicalEntity,
          canonicalEntity,
          optimizedEntity: null,
          receipt,
          rollback: () => receipt
        });
      }
    }

    if (typeof activationGuard === "function") {
      let allowed = false;
      try { allowed = activationGuard() === true; } catch { allowed = false; }
      if (!allowed) {
        try { optimizedEntity?.destroy?.(); } catch {}
        try { optimizedAsset?.unload?.(); } catch {}
        try { app.assets.remove?.(optimizedAsset); } catch {}
        const receipt = record({
          canonicalUrl,
          optimizedUrl,
          subjectKey,
          consumer,
          selected: true,
          authority: ASSET_CANARY_AUTHORITY.CANONICAL,
          outcome: ASSET_CANARY_OUTCOME.ROLLED_BACK_ACTIVATION_GUARD,
          reason: "ACTIVATION_GUARD_CLOSED"
        });
        return Object.freeze({
          activeEntity: canonicalEntity,
          canonicalEntity,
          optimizedEntity: null,
          receipt,
          rollback: () => receipt
        });
      }
    }

    let currentAuthority = ASSET_CANARY_AUTHORITY.OPTIMIZED_CANARY;
    let currentEntity = optimizedEntity;
    let currentReceipt = record({
      canonicalUrl,
      optimizedUrl,
      subjectKey,
      consumer,
      selected: true,
      authority: currentAuthority,
      outcome: ASSET_CANARY_OUTCOME.CANARY_ACTIVE,
      reason: null
    });

    function rollback(reason = "MANUAL_ROLLBACK") {
      if (currentAuthority === ASSET_CANARY_AUTHORITY.CANONICAL) return currentReceipt;
      try { optimizedEntity?.destroy?.(); } catch {}
      try { optimizedAsset?.unload?.(); } catch {}
      try { app.assets.remove?.(optimizedAsset); } catch {}
      currentAuthority = ASSET_CANARY_AUTHORITY.CANONICAL;
      currentEntity = canonicalEntity;
      currentReceipt = record({
        canonicalUrl,
        optimizedUrl,
        subjectKey,
        consumer,
        selected: true,
        authority: currentAuthority,
        outcome: ASSET_CANARY_OUTCOME.ROLLED_BACK_MANUAL,
        reason
      });
      return currentReceipt;
    }

    return Object.freeze({
      get activeEntity() { return currentEntity; },
      canonicalEntity,
      optimizedEntity,
      get receipt() { return currentReceipt; },
      rollback
    });
  }

  function status() {
    const latestByKey = new Map();
    for (const entry of records) latestByKey.set(`${entry.consumer}:${entry.canonicalUrl}:${entry.subjectKey}`, entry);
    const latest = [...latestByKey.values()];
    return Object.freeze({
      enabled: Boolean(enabled),
      percentage,
      productionWired: Boolean(productionWired),
      allowedPercentages: Object.freeze([...ALLOWED_PERCENTAGES]),
      counts: Object.freeze({
        canonical: latest.filter(entry => entry.authority === ASSET_CANARY_AUTHORITY.CANONICAL).length,
        optimizedCanary: latest.filter(entry => entry.authority === ASSET_CANARY_AUTHORITY.OPTIMIZED_CANARY).length,
        rolledBack: latest.filter(entry => entry.outcome.startsWith("ROLLED_BACK_")).length
      }),
      entries: Object.freeze(latest)
    });
  }

  return Object.freeze({
    enabled: Boolean(enabled),
    percentage,
    prepare,
    status
  });
}
