export const ASSET_OPTIMIZATION_SHADOW_STATUS = Object.freeze({
  MATCH: "MATCH",
  MISMATCH: "MISMATCH",
  UNAVAILABLE: "UNAVAILABLE"
});

export const ASSET_OPTIMIZATION_SHADOW_MAP = Object.freeze({
  "/assets/induck-v3.glb": "/.generated/assets-optimized/induck-v3.glb",
  "/assets/induck-backpack-v1.glb": "/.generated/assets-optimized/induck-backpack-v1.glb",
  "/assets/p0-qa-building.glb": "/.generated/assets-optimized/p0-qa-building.glb"
});

function entitySummary(entity) {
  const renders = entity?.findComponents?.("render") ?? [];
  const meshInstances = renders.flatMap(render => render?.meshInstances ?? []);
  const materials = new Set(meshInstances.map(instance => instance?.material).filter(Boolean));
  let entities = 0;
  const visit = node => {
    if (!node) return;
    entities += 1;
    for (const child of node.children ?? []) visit(child);
  };
  visit(entity);
  return Object.freeze({
    entities,
    renderComponents: renders.length,
    meshInstances: meshInstances.length,
    materials: materials.size
  });
}

function comparable(summary) {
  return {
    renderComponents: summary.renderComponents,
    meshInstances: summary.meshInstances,
    materials: summary.materials
  };
}

function instantiateSummary(asset) {
  const resource = asset?.resource;
  if (!resource?.instantiateRenderEntity) throw new Error("ASSET_SHADOW_RESOURCE_UNAVAILABLE");
  const entity = resource.instantiateRenderEntity({ castShadows: false, receiveShadows: false });
  try {
    return entitySummary(entity);
  } finally {
    entity?.destroy?.();
  }
}

function sameShape(left, right) {
  return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right));
}

export function createAssetOptimizationShadow({
  app,
  enabled = false,
  mapping = ASSET_OPTIMIZATION_SHADOW_MAP
} = {}) {
  if (!app?.assets?.loadFromUrl) throw new TypeError("PlayCanvas asset registry is required");

  const records = new Map();
  const pending = new Map();
  const consumers = new Map();

  function optimizedUrlFor(canonicalUrl) {
    return Object.prototype.hasOwnProperty.call(mapping, canonicalUrl) ? mapping[canonicalUrl] : null;
  }

  function rememberConsumer(canonicalUrl, consumer) {
    if (!consumers.has(canonicalUrl)) consumers.set(canonicalUrl, new Set());
    consumers.get(canonicalUrl).add(consumer || "unknown");
  }

  function observeResource(canonicalUrl, canonicalAsset, { consumer = "unknown" } = {}) {
    const optimizedUrl = optimizedUrlFor(canonicalUrl);
    if (!enabled || !optimizedUrl) return Promise.resolve(null);
    rememberConsumer(canonicalUrl, consumer);
    if (records.has(canonicalUrl)) return Promise.resolve(records.get(canonicalUrl));
    if (pending.has(canonicalUrl)) return pending.get(canonicalUrl);

    let canonical;
    try {
      canonical = instantiateSummary(canonicalAsset);
    } catch (error) {
      const record = Object.freeze({
        canonicalUrl,
        optimizedUrl,
        status: ASSET_OPTIMIZATION_SHADOW_STATUS.UNAVAILABLE,
        reason: String(error?.message ?? error),
        canonical: null,
        optimized: null
      });
      records.set(canonicalUrl, record);
      return Promise.resolve(record);
    }

    const task = new Promise(resolve => {
      app.assets.loadFromUrl(optimizedUrl, "container", (error, optimizedAsset) => {
        let record;
        try {
          if (error || !optimizedAsset?.resource) throw error || new Error("ASSET_SHADOW_OPTIMIZED_UNAVAILABLE");
          const optimized = instantiateSummary(optimizedAsset);
          record = Object.freeze({
            canonicalUrl,
            optimizedUrl,
            status: sameShape(canonical, optimized)
              ? ASSET_OPTIMIZATION_SHADOW_STATUS.MATCH
              : ASSET_OPTIMIZATION_SHADOW_STATUS.MISMATCH,
            reason: null,
            canonical,
            optimized
          });
        } catch (cause) {
          record = Object.freeze({
            canonicalUrl,
            optimizedUrl,
            status: ASSET_OPTIMIZATION_SHADOW_STATUS.UNAVAILABLE,
            reason: String(cause?.message ?? cause),
            canonical,
            optimized: null
          });
        } finally {
          try { optimizedAsset?.unload?.(); } catch {}
          try { app.assets.remove?.(optimizedAsset); } catch {}
        }
        records.set(canonicalUrl, record);
        resolve(record);
      });
    }).finally(() => pending.delete(canonicalUrl));

    pending.set(canonicalUrl, task);
    return task;
  }

  async function whenIdle() {
    while (pending.size) await Promise.allSettled([...pending.values()]);
    return status();
  }

  function status() {
    const entries = [...records.values()].map(record => Object.freeze({
      ...record,
      consumers: Object.freeze([...(consumers.get(record.canonicalUrl) ?? [])].sort())
    }));
    return Object.freeze({
      enabled: Boolean(enabled),
      advisoryOnly: true,
      authority: "CANONICAL_SOURCE_ONLY",
      pending: pending.size,
      counts: Object.freeze({
        match: entries.filter(entry => entry.status === ASSET_OPTIMIZATION_SHADOW_STATUS.MATCH).length,
        mismatch: entries.filter(entry => entry.status === ASSET_OPTIMIZATION_SHADOW_STATUS.MISMATCH).length,
        unavailable: entries.filter(entry => entry.status === ASSET_OPTIMIZATION_SHADOW_STATUS.UNAVAILABLE).length
      }),
      entries: Object.freeze(entries)
    });
  }

  return Object.freeze({
    enabled: Boolean(enabled),
    optimizedUrlFor,
    observeResource,
    whenIdle,
    status
  });
}
