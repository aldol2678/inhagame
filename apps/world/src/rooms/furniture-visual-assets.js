import { RIDING_FIGURINE_VISUAL } from './riding-figurine-assets.js';
import { CHARACTER_FURNITURE_CANDIDATES } from './character-furniture-assets.js';
// Code-owned optional visual. Never take URLs, transforms or authority from layout/RPC data.
export const SOFA_VISUAL = Object.freeze({
  itemId: 'furniture.dorm_single_sofa', url: '/assets/furniture/dorm-single-sofa-v1.glb',
  version: 'sofa-glb-v1', sha256: '858615e44a6d2e8896d42c713be027b39b78e6061dcd96088e3c1a446240f7c0', bounds: Object.freeze([1.10, .72, .78]),
  maxTriangles: 2000, maxMaterials: 3,
  byteLength: 35492, triangles: 1784, materials: 3, primitives: 3,
  min: Object.freeze([-.55, 0, -.39]), max: Object.freeze([.55, .72, .39]),
  transform: Object.freeze({ yaw: 0, scale: Object.freeze([1, 1, 1]) }),
  textureBytesEstimate: 0, enabled: true
});

// Only code-reviewed immutable descriptors can reach transport. Layout/RPC values
// select item IDs, never URLs or caller-created manifest objects.
// Verified rug/bed replacements are enabled; retired sticker candidates stay disabled.
// Never publish the source GLBs, PNGs or PDF here.
export const OFFICIAL_FURNITURE_CANDIDATES = Object.freeze([
  Object.freeze({
    itemId: "furniture.induck_chair", version: 'official-chair-replacement-r1',
    url: '/api/brand-asset?asset=official-chair-replacement-r1-5a67aec0e078.glb',
    sha256: '5a67aec0e07878f22735f275892d2c3afdb317f9474d6bff6216424238b89d50', byteLength: 141552, triangles: 2152, primitives: 3, materials: 3,
    min: Object.freeze([-0.3, 0, -0.325]), max: Object.freeze([0.3, 0.65, 0.325]),
    transform: Object.freeze({ yaw: 0, scale: Object.freeze([1, 1, 1]) }),
    frontAxis: '-Z', textureBytesEstimate: 1398100, enabled: false
  }),
  Object.freeze({
    itemId: "furniture.campus_rug_blue", version: 'official-rug-replacement-r1',
    allowedExtensions: Object.freeze(['KHR_materials_specular']),
    url: '/api/brand-asset?asset=official-rug-replacement-r1-f4ca31569bdf.glb',
    sha256: 'f4ca31569bdf7e2a1220d290bd00f2d0e32fb99cbb0617aca963fc3834e83828', byteLength: 214924, triangles: 512, primitives: 2, materials: 2,
    min: Object.freeze([-1, 0, -0.75]), max: Object.freeze([1, 0.012, 0.75]),
    transform: Object.freeze({ yaw: 0, scale: Object.freeze([1, 1, 1]) }),
    frontAxis: '-Z', textureBytesEstimate: 8388604, enabled: true
  }),
  Object.freeze({
    itemId: "fixture.personal_bed", version: 'official-bed-replacement-r2',
    url: '/api/brand-asset?asset=official-bed-replacement-r2-44d3cdc7870c.glb',
    sha256: '44d3cdc7870cce0b7bce5e1904308e2989eaca242b8800a5c8b2125efffc9d0c', byteLength: 187592, triangles: 1708, primitives: 9, materials: 3,
    min: Object.freeze([-0.8, 0, -1.35]), max: Object.freeze([0.8, 0.51, 1.35]),
    transform: Object.freeze({ yaw: 180, scale: Object.freeze([1, 1, 1]) }),
    frontAxis: '+Z-foot', placementHeadAxis: '+Z', textureBytesEstimate: 4699528, enabled: true
  }),
  Object.freeze({
    itemId: "furniture.dorm_side_table_low", version: 'official-nightstand-replacement-r1',
    url: '/api/brand-asset?asset=official-nightstand-replacement-r1-38883a703e2c.glb',
    sha256: '38883a703e2cfbe53b9b68b3f553e6618e19861bd535180b25c9734b3b698138', byteLength: 101852, triangles: 1406, primitives: 4, materials: 4,
    min: Object.freeze([-0.325, 0, -0.325]), max: Object.freeze([0.325, 0.38, 0.325]),
    transform: Object.freeze({ yaw: 0, scale: Object.freeze([1, 1, 1]) }),
    frontAxis: '-Z', textureBytesEstimate: 7148612, enabled: false
  }),
  Object.freeze({
    itemId: "furniture.dorm_bookshelf_slim", version: 'official-bookshelf-replacement-r1',
    url: '/api/brand-asset?asset=official-bookshelf-replacement-r1-d153744de633.glb',
    sha256: 'd153744de633f787bb7a9fddb2ed320987f594cb7dbc70183c8881826ca644cf', byteLength: 233100, triangles: 1946, primitives: 4, materials: 4,
    min: Object.freeze([-0.375, 0, -0.175]), max: Object.freeze([0.375, 1.25, 0.175]),
    transform: Object.freeze({ yaw: 0, scale: Object.freeze([1, 1, 1]) }),
    frontAxis: '-Z', textureBytesEstimate: 9137996, enabled: false
  })
]);
export const FURNITURE_VISUALS = Object.freeze([SOFA_VISUAL, ...CHARACTER_FURNITURE_CANDIDATES, ...OFFICIAL_FURNITURE_CANDIDATES, RIDING_FIGURINE_VISUAL]);
export function furnitureVisualForItem(itemId) {
  return FURNITURE_VISUALS.find(visual => visual.itemId === itemId && visual.enabled) ?? null;
}
export function requireFurnitureVisual(visual) {
  if (!FURNITURE_VISUALS.includes(visual) || !visual.enabled) throw Error('FURNITURE_UNTRUSTED_MANIFEST');
  return visual;
}
export function furnitureVisualForUrl(url) {
  return FURNITURE_VISUALS.find(visual => visual.url === url && visual.enabled) ?? null;
}

// One source per Application/URL; every placement owns a distinct render hierarchy.
// Last release waits a microtask so a synchronous layout rebuild can reuse the source.
export function createFurnitureAssetPool({ load, dispose, defer = queueMicrotask }) {
  const entries = new Map();
  let closed = false;
  function collect(entry) {
    if (entry.refs || entry.disposed) return;
    if (!entry.settled) {
      if (entries.get(entry.url) === entry) entries.delete(entry.url);
      entry.controller.abort();
      return; // A transport ignoring abort is still disposed if it eventually settles.
    }
    entry.disposed = true;
    if (entries.get(entry.url) === entry) entries.delete(entry.url);
    if (entry.value) dispose(entry.value);
  }
  return {
    acquire(url) {
      if (closed) throw Error('Furniture visual pool closed');
      let entry = entries.get(url);
      if (!entry) {
        entry = { url, refs: 0, settled: false, disposed: false, value: null, progress: null, listeners: new Set(), controller: new AbortController() };
        entries.set(url, entry);
        const onProgress = progress => {
          if (entry.controller.signal.aborted || entry.disposed || entry.settled || entries.get(url) !== entry) return;
          const { loadedBytes, totalBytes } = progress ?? {};
          if (!Number.isSafeInteger(loadedBytes) || !Number.isSafeInteger(totalBytes) || totalBytes <= 0
            || loadedBytes <= (entry.progress?.loadedBytes ?? -1) || loadedBytes > totalBytes || loadedBytes < 0
            || (entry.progress && totalBytes !== entry.progress.totalBytes)) return;
          entry.progress = Object.freeze({ loadedBytes, totalBytes });
          for (const listener of [...entry.listeners]) { try { listener(entry.progress); } catch { /* isolate observers */ } }
        };
        entry.promise = Promise.resolve().then(() => load(url, { signal: entry.controller.signal, onProgress })).then(value => {
          entry.value = value; return value;
        }).finally(() => { entry.settled = true; collect(entry); });
      }
      entry.refs++;
      let released = false;
      const ownedListeners = new Set();
      return { ready: entry.promise, subscribeProgress(listener) {
        if (released || typeof listener !== 'function') return () => {};
        const wrapped = progress => { if (!released) listener(progress); };
        ownedListeners.add(wrapped); entry.listeners.add(wrapped);
        if (entry.progress) { try { wrapped(entry.progress); } catch { /* isolate observers */ } }
        return () => { ownedListeners.delete(wrapped); entry.listeners.delete(wrapped); };
      }, release() {
        if (released) return;
        released = true; for (const listener of ownedListeners) entry.listeners.delete(listener); ownedListeners.clear();
        entry.refs = Math.max(0, entry.refs - 1); defer(() => collect(entry));
      } };
    },
    status: () => [...entries.values()].map(({ url, refs, settled }) => ({ url, refs, settled })),
    close() { closed = true; for (const entry of entries.values()) { entry.refs = 0; collect(entry); } }
  };
}

// Contract for #362 integration: await the current generation, never cache a loading
// fallback as a final GLB thumbnail. A cancelled/superseded capture returns null.
export async function captureFurnitureVisual(layer, capture, { viewKey = null } = {}) {
  const before = layer.visualStatus();
  await layer.whenVisualsReady();
  const ready = layer.visualStatus();
  if (before.generation !== ready.generation || ready.destroyed || ready.suspended || ready.placementCount === 0) return null;
  const image = await capture();
  const after = layer.visualStatus();
  if (after.generation !== ready.generation || after.revision !== ready.revision || after.destroyed || after.suspended) return null;
  const mode = after.modelMode !== "procedural" && after.objects.length > 0 && after.objects.length === after.placementCount && after.objects.every(o => o.state === "GLB") ? "GLB" : "FALLBACK";
  // Camera/angle/lighting/quality belong to the caller; absent a view key, do not cache.
  return { image, cacheKey: viewKey === null ? null : JSON.stringify([after.objects.map(object => object.sourceKey ?? object.version), after.contentKey, viewKey, after.revision, mode]), mode, status: after };
}
