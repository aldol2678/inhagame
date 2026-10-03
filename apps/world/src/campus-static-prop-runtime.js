import { loadWorldDocument } from './runtime-adapter/load-world.js';

// Own the one document instance and its context materials. AssetResolver and
// PlayCanvas's asset registry keep ownership of the cached GLB container; an
// instance teardown must not unload resources that another consumer can reuse.
export function createCampusStaticPropRuntime(world, context) {
  let runtime = null;
  let disposeRequested = false;
  let disposed = false;
  const release = async () => {
    if (disposed) return;
    disposed = true;
    try { await runtime?.dispose(); }
    finally { context.dispose?.(); }
  };
  const ready = loadWorldDocument(world, context).then(async value => {
    runtime = value;
    // A page may leave while GLB decoding is pending. Dispose only after the
    // adapter has finished attaching its visual, so no late child is orphaned.
    if (disposeRequested) await release();
    return runtime;
  });
  return {
    ready,
    status: () => ({
      state: disposed ? 'disposed' : runtime?.state ?? 'loading',
      assetId: world.assets[0].id,
      entities: runtime?.bindings.size ?? 0,
      diagnostics: runtime?.diagnostics ?? []
    }),
    async dispose() { disposeRequested = true; await ready; await release(); }
  };
}
