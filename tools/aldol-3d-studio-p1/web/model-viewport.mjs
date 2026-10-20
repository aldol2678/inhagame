import { validateRenderGlb } from './glb-contract.mjs';

// Separate device from the legacy viewport; all objects in this viewport share
// one PlayCanvas depth buffer. Input and document mutations stay in studio.js.
export async function createModelViewport(inputCanvas, report) {
  const pc = await import('/vendor/playcanvas.mjs');
  if (pc.version !== '2.22.4') throw Error('E_PLAYCANVAS_VERSION');
  const canvas = document.createElement('canvas');
  canvas.id = 'model-canvas'; canvas.className = 'model-canvas';
  canvas.setAttribute('aria-label', '검증된 GLB 모델 PlayCanvas 장면');
  inputCanvas.insertAdjacentElement('afterend', canvas);
  let app;
  try { app = new pc.Application(canvas, { graphicsDeviceOptions: { deviceTypes: ['webgl2'], antialias: true, preserveDrawingBuffer: true } }); }
  catch (error) { canvas.remove(); throw error; }
  const camera = new pc.Entity('Studio camera');
  camera.addComponent('camera', { fov: 45, nearClip: .1, farClip: 150, clearColor: new pc.Color(.075, .106, .145) });
  app.root.addChild(camera);
  const light = new pc.Entity('Studio light');
  light.addComponent('light', { type: 'directional', intensity: 1.2 }); light.setEulerAngles(45, 30, 0); app.root.addChild(light);
  app.scene.ambientLight = new pc.Color(.3, .3, .3);
  const plain = new pc.StandardMaterial(); plain.diffuse.set(.57, .71, .79); plain.update();
  const selected = new pc.StandardMaterial(); selected.diffuse.set(.93, .74, .4); selected.update();
  const roots = new Map(), assets = new Map(), loads = new Map();
  const abort = new AbortController();
  const budgets = new Map();
  let disposed = false, lost = false, generation = 0, desired = [];
  const diagnostics = new Map();
  const notify = () => report({ state: lost ? 'context-lost' : diagnostics.size ? 'limited' : loads.size ? 'loading' : 'ready', diagnostics: [...diagnostics.values()] });
  app.graphicsDevice.on('devicelost', () => { lost = true; diagnostics.set('gpu', 'E_GPU_CONTEXT_LOST: 새로고침으로 모델을 다시 로드하세요'); notify(); });
  app.graphicsDevice.on('devicerestored', () => { lost = false; diagnostics.delete('gpu'); notify(); });
  function removeAsset(id) {
    const asset = assets.get(id); if (!asset) return;
    assets.delete(id); budgets.delete(id); app.assets.remove(asset); asset.unload();
  }
  function rebuild() {
    for (const e of roots.values()) e.destroy(); roots.clear();
    for (const n of desired) { const e = new pc.Entity(n.id); roots.set(n.id, e); }
    let vertexBudget=0,primitiveBudget=0;
    for (const n of desired) {
      const e = roots.get(n.id); (roots.get(n.parentId) || app.root).addChild(e);
      e.setLocalPosition(...n.transform.position); e.setLocalRotation(...n.transform.rotation); e.setLocalScale(...n.transform.scale); e.enabled = n.enabled !== false;
      if (n.renderAssetId) {
        const asset = assets.get(n.renderAssetId);
        if (asset?.resource) {
          vertexBudget+=asset.studioEvidence.instanceVertices;primitiveBudget+=asset.studioEvidence.instancePrimitives;
          if(vertexBudget>2000000||primitiveBudget>2048)diagnostics.set(n.id,'E_SCENE_MODEL_BUDGET: '+n.id);
          else e.addChild(asset.resource.instantiateRenderEntity());
        }
        // An unavailable GLB is explicitly absent, never shown as a successful cube.
      } else { e.addComponent('render', { type: 'box', material: plain }); }
    }
  }
  async function sync(nodes, records) {
    const ticket = ++generation; desired = nodes;
    const needed = new Set(nodes.map(n => n.renderAssetId).filter(Boolean));
    // Destroy instances before unloading their shared meshes/textures.
    for (const e of roots.values()) e.destroy(); roots.clear();
    for (const id of assets.keys()) if (!needed.has(id)) removeAsset(id);
    diagnostics.clear(); if (lost) diagnostics.set('gpu', 'E_GPU_CONTEXT_LOST');
    rebuild();
    report({state: lost ? 'context-lost' : 'loading', diagnostics: [...diagnostics.values()]});
    await Promise.all([...needed].map(id => {
      if (assets.has(id)) return;
      if (loads.has(id)) return loads.get(id);
      const record = records.find(r => r.assetId === id);
      const pending = (async () => {
        let asset;
        try {
          if (!/^factory\.[a-f0-9]{24}$/.test(id) || !record || record.structure.format !== 'glb') throw Error('E_MODEL_BYTES_UNAVAILABLE');
          const response = await fetch('/api/assets/' + id, { cache: 'no-store', signal: abort.signal });
          if (!response.ok) throw Error('E_MODEL_BYTES_UNAVAILABLE');
          if (Number(response.headers.get('content-length')) > 20*1024*1024) throw Error('E_MODEL_SIZE');
          const bytes = await response.arrayBuffer();
          const digest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2,'0')).join('');
          if (digest !== record.sha256 || bytes.byteLength !== record.byteSize || record.uri !== `assets/${digest}.glb` || id !== 'factory.' + digest.slice(0,24)) throw Error('E_MODEL_SHA_MISMATCH');
          const structure = validateRenderGlb(bytes);
          if (disposed || !desired.some(n => n.renderAssetId === id)) return;
          if([...budgets.values()].reduce((sum,n)=>sum+n,0)+structure.texturePixels>33554432)throw Error('E_SCENE_TEXTURE_BUDGET');
          budgets.set(id,structure.texturePixels);
          // Supported Asset.file.contents API avoids a second fetch / TOCTOU.
          asset = new pc.Asset(id, 'container', { url: `verified-${digest}.glb`, filename: 'verified.glb', contents: bytes });
          asset.studioEvidence = { sha256: digest, ...structure }; app.assets.add(asset);
          await new Promise((ok, fail) => { asset.once('load', ok); asset.once('error', error => fail(Error('E_MODEL_DECODE: ' + String(error)))); app.assets.load(asset); });
          if (disposed || !desired.some(n => n.renderAssetId === id)) { app.assets.remove(asset); asset.unload(); budgets.delete(id); return; }
          const instance = asset.resource.instantiateRenderEntity();
          const count = instance.findComponents('render').reduce((s, r) => s + r.meshInstances.length, 0); instance.destroy();
          if (!count) throw Error('E_MODEL_NO_MESH_INSTANCES');
          assets.set(id, asset);
        } catch (error) {
          budgets.delete(id);
          if (asset) { app.assets.remove(asset); asset.unload(); }
          if (!disposed && desired.some(n => n.renderAssetId === id)) diagnostics.set(id, `${id}: ${error.message}`);
        }
      })();
      loads.set(id, pending);
      pending.finally(() => loads.delete(id));
      return pending;
    }));
    if (!disposed && ticket === generation) { rebuild(); notify(); }
  }
  const lineColor = new pc.Color(.17, .23, .31);
  function frame(nodes, eye, selectedId) {
    if (disposed || lost) return;
    const w = Math.max(1, inputCanvas.clientWidth), h = Math.max(1, inputCanvas.clientHeight);
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.floor(w*dpr) || canvas.height !== Math.floor(h*dpr)) app.graphicsDevice.resizeCanvas(Math.floor(w*dpr), Math.floor(h*dpr));
    camera.setPosition(...eye); camera.lookAt(0, 0, 0);
    for (const n of nodes) {
      let e = roots.get(n.id);
      if (!e && n.ghost) { e = new pc.Entity(n.id); e.addComponent('render', { type: 'box', material: selected }); app.root.addChild(e); roots.set(n.id, e); }
      if (!e) continue;
      e.setLocalPosition(...n.transform.position); e.setLocalRotation(...n.transform.rotation); e.setLocalScale(...n.transform.scale); e.enabled = n.enabled !== false;
      if (e.render) e.render.material = n.id === selectedId ? selected : plain;
    }
    const ids = new Set(nodes.map(n => n.id)); for (const [id, e] of roots) if (!ids.has(id)) { e.destroy(); roots.delete(id); }
    for (let x = -10; x <= 10; x++) { app.drawLine(new pc.Vec3(x,0,-10), new pc.Vec3(x,0,10), lineColor); app.drawLine(new pc.Vec3(-10,0,x), new pc.Vec3(10,0,x), lineColor); }
    app.render();
  }
  function evidence() {
    return { version: pc.version, lost, diagnostics: [...diagnostics.values()], assets: [...assets.values()].filter(a => a.resource).map(a => ({ ...a.studioEvidence, materials: a.resource.materials.map(m => ({name:m.resource.name, diffuse:[m.resource.diffuse.r,m.resource.diffuse.g,m.resource.diffuse.b], texture:!!m.resource.diffuseMap})), textures: a.resource.textures.map(t => ({width:t.resource.width,height:t.resource.height})) })),
      entities: [...roots].map(([id,e]) => ({id,parent:e.parent.name,enabled:e.enabled,position:e.getLocalPosition().toArray(),worldPosition:e.getPosition().toArray(),rotation:e.getLocalRotation().toArray(),scale:e.getLocalScale().toArray(),glbNodes:desired.find(n=>n.id===id)?.renderAssetId?(e.children[0]?.find(()=>true)||[]).map(n=>({name:n.name,parent:n.parent?.name,position:n.getLocalPosition().toArray(),scale:n.getLocalScale().toArray(),rotation:n.getLocalRotation().toArray()})):[],meshes:e.findComponents('render').flatMap(r=>r.meshInstances.map(m=>({vertices:m.mesh.vertexBuffer.numVertices,indices:m.mesh.primitive[0].count,material:m.material.name}))) })) };
  }
  // Read-only diagnostic snapshot for local QA. No app/mutation capability exposed.
  window.__ALDOL_MODEL_EVIDENCE__ = evidence;
  return { sync, frame, dispose() { disposed = true; generation++; for (const e of roots.values()) e.destroy(); roots.clear(); for (const id of assets.keys()) removeAsset(id); plain.destroy(); selected.destroy(); abort.abort(); canvas.remove(); delete window.__ALDOL_MODEL_EVIDENCE__;
    // Let the engine finish its asynchronous parser before destroying its device.
    Promise.allSettled([...loads.values()]).then(() => app.destroy()); } };
}
