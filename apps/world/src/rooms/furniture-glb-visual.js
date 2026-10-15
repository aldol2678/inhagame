import * as pc from 'playcanvas';
import { createFurnitureAssetPool, SOFA_VISUAL, requireFurnitureVisual, furnitureVisualForUrl } from './furniture-visual-assets.js';
import { validateFurniturePayload } from './furniture-glb-contract.js';
import { furnitureLoadPolicy, createFurnitureLoadWatchdog, readFurnitureBytes, withFurnitureLoadDeadline } from './furniture-load-progress.js';
const pools = new WeakMap();
function poolFor(app) {
  if (pools.has(app)) return pools.get(app);
  const pool = createFurnitureAssetPool({
    async load(url, { signal, onProgress }) {
      const visual = requireFurnitureVisual(furnitureVisualForUrl(url));
      return withFurnitureLoadDeadline(async (signal, reportProgress) => {
        // Per-manifest bounded transport; never accept layout/RPC URLs.
        const response = await fetch(url, { signal, credentials: 'same-origin' });
        if (!response.ok) throw Error(`FURNITURE_HTTP_${response.status}`);
        const contents = await readFurnitureBytes(response, visual.byteLength, { signal, onProgress: reportProgress });
        // The pinned parser can throw asynchronously on truncated GLBs. Admit only
        // the exact validated static payload, before handing any bytes to the engine.
        await validateFurniturePayload(contents, visual);
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        return new Promise((resolve, reject) => {
          const asset = new pc.Asset(`owned-furniture-${visual.version}`, 'container', { url, contents });
          let done = false;
          const clean = () => { asset.unload(); app.assets.remove(asset); };
          const fail = error => { if (done) return; done=true; signal.removeEventListener('abort',abort); clean(); reject(error instanceof Error ? error : Error(String(error))); };
          const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
          asset.once('load', () => { if (done || signal.aborted) { clean(); return; } done=true; signal.removeEventListener('abort',abort); resolve(asset); });
          asset.once('error', fail); signal.addEventListener('abort',abort,{once:true});
          try { app.assets.add(asset); app.assets.load(asset); } catch (error) { fail(error); }
        });
      }, { signal, policy: furnitureLoadPolicy(visual), onProgress });
    },
    dispose(asset) { asset.unload(); app.assets.remove(asset); }
  });
  pools.set(app, pool);
  app.once('destroy', () => { pool.close(); pools.delete(app); });
  return pool;
}
export const furnitureAssetStatus = app => pools.get(app)?.status() ?? [];

export function validateFurnitureVisual(model, visual) {
  const instances = model.findComponents('render').flatMap(component => component.meshInstances);
  if (!instances.length) throw Error('FURNITURE_EMPTY');
  let triangles = 0;
  const materials = new Set(), low = [Infinity,Infinity,Infinity], high = [-Infinity,-Infinity,-Infinity];
  for (const mi of instances) {
    if (!mi.mesh || !mi.material || mi.skinInstance || mi.morphInstance) throw Error('FURNITURE_INVALID_MESH');
    materials.add(mi.material);
    for (const primitive of mi.mesh.primitive) {
      if (primitive.type !== pc.PRIMITIVE_TRIANGLES || primitive.count % 3) throw Error('FURNITURE_PRIMITIVE');
      triangles += primitive.count / 3;
    }
    const min = mi.aabb.getMin(), max = mi.aabb.getMax();
    [min.x,min.y,min.z].forEach((v,i) => { if (!Number.isFinite(v)) throw Error('FURNITURE_BOUNDS'); low[i]=Math.min(low[i],v); });
    [max.x,max.y,max.z].forEach((v,i) => { if (!Number.isFinite(v)) throw Error('FURNITURE_BOUNDS'); high[i]=Math.max(high[i],v); });
  }
  const expectedMin=visual.min,expectedMax=visual.max,epsilon=.0001;
  if (low.some((v,i)=>Math.abs(v-expectedMin[i])>epsilon) || high.some((v,i)=>Math.abs(v-expectedMax[i])>epsilon)) throw Error('FURNITURE_ORIGIN_OR_SIZE');
  if (triangles !== visual.triangles || materials.size !== visual.materials || instances.length !== visual.primitives) throw Error('FURNITURE_STRUCTURE_MISMATCH');
  return { triangles, materials:materials.size, meshInstances:instances.length, min:low, max:high };
}

export const validateSofaVisual = model => validateFurnitureVisual(model, SOFA_VISUAL);
export const attachSofaVisual = options => attachFurnitureVisual({ ...options, visual: SOFA_VISUAL });
export function attachFurnitureVisual({ app, anchor, fallback, visual, onChange = () => {}, timeoutMs }) {
  requireFurnitureVisual(visual);
  let alive=true, model=null, lease=null, watchdog=null, unsubscribeProgress=()=>{}, state='LOADING', detail=null, settle;
  const listeners = new Set();
  const sourceKey = `${visual.url}@${visual.sha256}`;
  let progress = Object.freeze({ sourceKey, loadedBytes: 0, totalBytes: visual.byteLength });
  const ready=new Promise(resolve=>{ settle=resolve; });
  const finish = (next, reason=null) => {
    if (!alive || state === 'FALLBACK' || (next === 'GLB' && state !== 'LOADING')) return;
    watchdog?.stop(); unsubscribeProgress(); listeners.clear(); app.off('postrender', rendered);
    state=next; if (next !== "GLB" || reason !== null) detail=reason;
    if (next !== 'GLB') { model?.destroy(); model=null; fallback.enabled=true; lease?.release(); lease=null; }
    app.renderNextFrame=true; onChange(); settle(next);
  };
  const rendered=()=>finish('GLB');
  const lost=()=>finish('FALLBACK','GRAPHICS_CONTEXT_LOST');
  const destroy=()=>{
    if (!alive) return;
    alive=false; anchor.off('destroy',destroy); watchdog?.stop(); unsubscribeProgress(); listeners.clear(); app.off('postrender',rendered); app.graphicsDevice?.off('devicelost',lost);
    model?.destroy(); model=null; fallback.enabled=true; lease?.release(); lease=null; state='DISPOSED'; settle(state);
  };
  anchor.once('destroy',destroy); app.graphicsDevice?.on('devicelost',lost);
  watchdog=createFurnitureLoadWatchdog({ policy: furnitureLoadPolicy(visual, timeoutMs), onTimeout: error => finish('FALLBACK',error.message) });
  try {
    lease=poolFor(app).acquire(visual.url);
    unsubscribeProgress = lease.subscribeProgress(value => {
      if (!alive || state !== 'LOADING' || value.totalBytes !== visual.byteLength || value.loadedBytes <= progress.loadedBytes) return;
      progress = Object.freeze({ sourceKey, ...value });
      watchdog.progress(value.loadedBytes, value.totalBytes);
      for (const listener of [...listeners]) { try { listener(progress); } catch { /* isolate observers */ } }
    });
    lease.ready.then(asset=>{
      if (!alive || state !== 'LOADING') return;
      try {
        model=asset.resource.instantiateRenderEntity({castShadows:true,receiveShadows:true});
        model.name=visual === SOFA_VISUAL ? 'sofa_glb_visual' : `${visual.version}_visual`;
        detail=validateFurnitureVisual(model, visual); // isolated origin, before inherited placement transforms
        model.setLocalEulerAngles(0, visual.transform.yaw, 0);
        model.setLocalScale(...visual.transform.scale);
        anchor.addChild(model); fallback.enabled=false;
        if (visual.geometryPolicy === 'character-r1') onChange(); // synchronize physical envelope before the first visible frame
        watchdog.render(); app.once('postrender',rendered); app.renderNextFrame=true;
      } catch (error) { finish('FALLBACK',String(error.message)); }
    }).catch(error=>finish('FALLBACK',String(error.message)));
  } catch(error) { finish('FALLBACK',String(error.message)); }
  return { ready, destroy, subscribeProgress(listener) {
    if (!alive || typeof listener !== 'function') return () => {};
    if (state === 'LOADING') listeners.add(listener);
    try { listener(progress); } catch { /* isolate observers */ }
    return () => listeners.delete(listener);
  }, status:()=>({state,modelVisible:Boolean(model && !fallback.enabled),detail,version:visual.version, sourceKey, itemId:visual.itemId}) };
}
