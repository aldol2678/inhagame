// Code-owned optional visual. Never take URLs, transforms or authority from layout/RPC data.
export const SOFA_VISUAL = Object.freeze({
  itemId: 'furniture.dorm_single_sofa', url: '/assets/furniture/dorm-single-sofa-v1.glb',
  version: 'sofa-glb-v1', sha256: '858615e44a6d2e8896d42c713be027b39b78e6061dcd96088e3c1a446240f7c0', bounds: Object.freeze([1.10, .72, .78]),
  maxTriangles: 2000, maxMaterials: 3
});

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
        entry = { url, refs: 0, settled: false, disposed: false, value: null, controller: new AbortController() };
        entries.set(url, entry);
        entry.promise = Promise.resolve().then(() => load(url, { signal: entry.controller.signal })).then(value => {
          entry.value = value; return value;
        }).finally(() => { entry.settled = true; collect(entry); });
      }
      entry.refs++;
      let released = false;
      return { ready: entry.promise, release() {
        if (released) return;
        released = true; entry.refs = Math.max(0, entry.refs - 1); defer(() => collect(entry));
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
  const mode = after.modelMode !== "procedural" && after.objects.length > 0 && after.objects.every(o => o.state === "GLB") ? "GLB" : "FALLBACK";
  // Camera/angle/lighting/quality belong to the caller; absent a view key, do not cache.
  return { image, cacheKey: viewKey === null ? null : JSON.stringify([SOFA_VISUAL.version, after.contentKey, viewKey, after.revision, mode]), mode, status: after };
}
