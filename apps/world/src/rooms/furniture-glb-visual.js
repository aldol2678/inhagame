import * as pc from 'playcanvas';
import { createFurnitureAssetPool, SOFA_VISUAL } from './furniture-visual-assets.js';
const pools = new WeakMap();
function poolFor(app) {
  if (pools.has(app)) return pools.get(app);
  const pool = createFurnitureAssetPool({
    async load(url, { signal }) {
      // Abortable, bounded transport; ContainerHandler still performs actual GLB parsing.
      const response = await fetch(url, { signal, credentials: 'same-origin' });
      if (!response.ok) throw Error(`SOFA_HTTP_${response.status}`);
      if (Number(response.headers.get('content-length')) > 150000) throw Error('SOFA_BYTE_BUDGET');
      const contents = await response.arrayBuffer();
      if (contents.byteLength > 150000) throw Error('SOFA_BYTE_BUDGET');
      // The pinned parser can throw asynchronously on truncated GLBs. Admit only
      // the exact validated static payload, before handing any bytes to the engine.
      const digest = await globalThis.crypto.subtle.digest('SHA-256', contents);
      const hash = Array.from(new Uint8Array(digest), v => v.toString(16).padStart(2, '0')).join('');
      if (hash !== SOFA_VISUAL.sha256) throw Error('SOFA_HASH_MISMATCH');
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      return new Promise((resolve, reject) => {
        const asset = new pc.Asset('owned-furniture-sofa-v1', 'container', { url, contents });
        let done = false;
        const clean = () => { asset.unload(); app.assets.remove(asset); };
        const fail = error => { if (done) return; done=true; signal.removeEventListener('abort',abort); clean(); reject(error instanceof Error ? error : Error(String(error))); };
        const abort = () => fail(new DOMException('Cancelled', 'AbortError'));
        asset.once('load', () => { if (done || signal.aborted) { clean(); return; } done=true; signal.removeEventListener('abort',abort); resolve(asset); });
        asset.once('error', fail); signal.addEventListener('abort',abort,{once:true});
        try { app.assets.add(asset); app.assets.load(asset); } catch (error) { fail(error); }
      });
    },
    dispose(asset) { asset.unload(); app.assets.remove(asset); }
  });
  pools.set(app, pool);
  app.once('destroy', () => { pool.close(); pools.delete(app); });
  return pool;
}
export const furnitureAssetStatus = app => pools.get(app)?.status() ?? [];

export function validateSofaVisual(model) {
  const instances = model.findComponents('render').flatMap(component => component.meshInstances);
  if (!instances.length) throw Error('SOFA_EMPTY');
  let triangles = 0;
  const materials = new Set(), low = [Infinity,Infinity,Infinity], high = [-Infinity,-Infinity,-Infinity];
  for (const mi of instances) {
    if (!mi.mesh || !mi.material || mi.skinInstance || mi.morphInstance) throw Error('SOFA_INVALID_MESH');
    materials.add(mi.material);
    for (const primitive of mi.mesh.primitive) {
      if (primitive.type !== pc.PRIMITIVE_TRIANGLES || primitive.count % 3) throw Error('SOFA_PRIMITIVE');
      triangles += primitive.count / 3;
    }
    const min = mi.aabb.getMin(), max = mi.aabb.getMax();
    [min.x,min.y,min.z].forEach((v,i) => { if (!Number.isFinite(v)) throw Error('SOFA_BOUNDS'); low[i]=Math.min(low[i],v); });
    [max.x,max.y,max.z].forEach((v,i) => { if (!Number.isFinite(v)) throw Error('SOFA_BOUNDS'); high[i]=Math.max(high[i],v); });
  }
  const expectedMin=[-.55,0,-.39],expectedMax=[.55,.72,.39],epsilon=.0001;
  if (low.some((v,i)=>Math.abs(v-expectedMin[i])>epsilon) || high.some((v,i)=>Math.abs(v-expectedMax[i])>epsilon)) throw Error('SOFA_ORIGIN_OR_SIZE');
  if (triangles > SOFA_VISUAL.maxTriangles || materials.size > SOFA_VISUAL.maxMaterials) throw Error('SOFA_BUDGET');
  return { triangles, materials:materials.size, meshInstances:instances.length, min:low, max:high };
}

export function attachSofaVisual({ app, anchor, fallback, onChange = () => {}, timeoutMs = 8000 }) {
  let alive=true, model=null, lease=null, timer=null, state='LOADING', detail=null, settle;
  const ready=new Promise(resolve=>{ settle=resolve; });
  const finish = (next, reason=null) => {
    if (!alive) return;
    clearTimeout(timer); app.off('postrender', rendered);
    state=next; if (next !== "GLB" || reason !== null) detail=reason;
    if (next !== 'GLB') { model?.destroy(); model=null; fallback.enabled=true; lease?.release(); lease=null; }
    app.renderNextFrame=true; onChange(); settle(next);
  };
  const rendered=()=>finish('GLB');
  const lost=()=>finish('FALLBACK','GRAPHICS_CONTEXT_LOST');
  const destroy=()=>{
    if (!alive) return;
    alive=false; clearTimeout(timer); app.off('postrender',rendered); app.graphicsDevice?.off('devicelost',lost);
    model?.destroy(); model=null; fallback.enabled=true; lease?.release(); lease=null; state='DISPOSED'; settle(state);
  };
  anchor.once('destroy',destroy); app.graphicsDevice?.on('devicelost',lost);
  timer=setTimeout(()=>finish('FALLBACK','LOAD_OR_RENDER_TIMEOUT'),timeoutMs);
  try {
    lease=poolFor(app).acquire(SOFA_VISUAL.url);
    lease.ready.then(asset=>{
      if (!alive || state !== 'LOADING') return;
      try {
        model=asset.resource.instantiateRenderEntity({castShadows:true,receiveShadows:true});
        model.name='sofa_glb_visual';
        detail=validateSofaVisual(model); // isolated origin, before inherited placement transforms
        anchor.addChild(model); fallback.enabled=false;
        app.once('postrender',rendered); app.renderNextFrame=true;
      } catch (error) { finish('FALLBACK',String(error.message)); }
    }).catch(error=>finish('FALLBACK',String(error.message)));
  } catch(error) { finish('FALLBACK',String(error.message)); }
  return { ready, destroy, status:()=>({state,detail,version:SOFA_VISUAL.version}) };
}
