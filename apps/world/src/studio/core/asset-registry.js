const copy = value => structuredClone(value);

function normalizeAsset(moduleId, asset) {
  if (!moduleId || !asset || !asset.id) throw new Error("E_STUDIO_ASSET_REGISTRY_INVALID");
  const type = String(asset.assetType || asset.type || "other").trim() || "other";
  return Object.freeze({
    key: `${moduleId}:${asset.id}`,
    moduleId,
    id: String(asset.id),
    type,
    label: String(asset.label || asset.title || asset.id),
    detail: String(asset.detail || ""),
    selectable: asset.selectable !== false,
    sourceKind: String(asset.sourceKind || "asset")
  });
}

export class StudioAssetRegistry {
  constructor() {
    this.byKey = new Map();
    this.byModule = new Map();
    this.indexedModules = new Set();
    this._listeners = new Set();
  }

  subscribe(listener) {
    this._listeners.add(listener);
    return () => this._listeners.delete(listener);
  }

  _emit() {
    const snapshot = this.snapshot();
    for (const listener of this._listeners) listener(snapshot);
  }

  replaceModuleAssets(moduleId, assets = []) {
    const previous = this.byModule.get(moduleId) || new Set();
    for (const key of previous) this.byKey.delete(key);

    const next = new Set();
    for (const asset of assets) {
      const normalized = normalizeAsset(moduleId, asset);
      this.byKey.set(normalized.key, normalized);
      next.add(normalized.key);
    }
    this.byModule.set(moduleId, next);
    this.indexedModules.add(moduleId);
    this._emit();
    return this.list({ moduleId });
  }

  hasIndexed(moduleId) {
    return this.indexedModules.has(moduleId);
  }

  get(key) {
    const asset = this.byKey.get(key);
    return asset ? copy(asset) : null;
  }

  list({ moduleId = null, type = null, query = "" } = {}) {
    const needle = String(query || "").trim().toLowerCase();
    return [...this.byKey.values()]
      .filter(asset => !moduleId || asset.moduleId === moduleId)
      .filter(asset => !type || asset.type === type)
      .filter(asset => !needle ||
        asset.label.toLowerCase().includes(needle) ||
        asset.id.toLowerCase().includes(needle) ||
        asset.detail.toLowerCase().includes(needle))
      .sort((a, b) =>
        a.type.localeCompare(b.type) ||
        a.label.localeCompare(b.label) ||
        a.key.localeCompare(b.key))
      .map(copy);
  }

  snapshot() {
    const assets = this.list();
    const counts = {};
    for (const asset of assets) counts[asset.type] = (counts[asset.type] || 0) + 1;
    return Object.freeze({
      total: assets.length,
      indexedModules: Object.freeze([...this.indexedModules].sort()),
      counts: Object.freeze({ ...counts }),
      assets: Object.freeze(assets.map(Object.freeze))
    });
  }
}

export const createStudioAssetRegistry = () => new StudioAssetRegistry();
