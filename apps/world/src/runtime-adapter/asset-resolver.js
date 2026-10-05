export class AssetResolver {
  constructor(assets, { loadAsset, resolveAssetUri = asset => asset.uri, assetCache = new Map() }) {
    if (typeof loadAsset !== "function") throw new TypeError("loadAsset is required");
    this.assets = new Map(assets.map(asset => [asset.id, asset]));
    this.loadAsset = loadAsset;
    this.resolveAssetUri = resolveAssetUri;
    this.cache = assetCache;
  }

  resolve(assetId) {
    const asset = this.assets.get(assetId);
    if (!asset) return Promise.reject(new Error(`R_ASSET_NOT_FOUND:${assetId}`));
    return Promise.resolve().then(() => this.resolveAssetUri(asset)).then(uri => {
      if (!this.cache.has(uri)) {
        const loading = Promise.resolve().then(() => this.loadAsset(uri, asset));
        this.cache.set(uri, loading);
        loading.catch(() => { if (this.cache.get(uri) === loading) this.cache.delete(uri); });
      }
      return this.cache.get(uri);
    });
  }
}
