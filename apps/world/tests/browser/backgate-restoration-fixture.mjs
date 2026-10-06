// Loaded only by the hosted offline campus page. Runtime source stays unchanged.
import * as pc from 'playcanvas';
import { TARGETS, VIEWS, cameraFor, frontOf, roadCameraFor, roadViewCorners } from './backgate-restoration-qa-plan.mjs';

const relevant = name => /^(back_alley|back_market)_(base|near|detail)_/.test(name) || /^(back_street_paving_|back_street_signals_|culture_street_paving_|north_side_gate_)/.test(name);
const descendants = root => [root, ...root.children.flatMap(descendants)];
let qa;

export function prepareCampus(d) {
  const { app, streaming, registry } = d, renderer = streaming.renderer;
  const base = renderer.base, frame = base.parent, camera = app.root.findByName('Camera');
  if (frame.name !== 'CampusCoordinateFrame' || frame.getLocalScale().z !== -1 || !base.enabled) {
    throw Error('Actual production-reflected CampusBase is required');
  }
  app.off('update'); app.autoRender = false;
  const ids = TARGETS.map(q => q.id), chunks = registry.chunks.filter(c => c.streetscape.some(id => ids.includes(id)));
  const covered = chunks.flatMap(c => c.streetscape.filter(id => ids.includes(id))).sort();
  if (covered.length !== TARGETS.length || covered.join() !== [...ids].sort().join()) throw Error('All restored target plots must have exactly one chunk owner');
  for (const state of streaming.runtime.values()) if (state.handle) renderer.setState(state.handle, 'VISTA');
  const handles = chunks.map(chunk => {
    const state = streaming.runtime.get(chunk.id);
    if (!state.handle) state.handle = renderer.create(chunk);
    state.state = 'ACTIVE'; renderer.setState(state.handle, 'ACTIVE'); return state.handle;
  });
  renderer.update(1);
  const visibleRoots = new Set([base, ...handles.map(h => h.root)]), hiddenRoots = [];
  for (const child of frame.children) {
    child.enabled = visibleRoots.has(child);
    if (!child.enabled) hiddenRoots.push(child.name);
  }
  const sky = app.root.findByName('EnvironmentSkyVisuals');
  if (!sky) throw Error('Expected sky fixture is missing');
  sky.enabled = false; camera.camera.clearColor.set(.52, .71, .84, 1);
  qa = { app, renderer, handles, base, camera, previous: null, roi: null };
  return { targets: covered, chunks: chunks.map(c => c.id), reflection: -1, hiddenRoots,
    graphics: d.graphics.status(), devicePixelRatio: globalThis.devicePixelRatio || 1,
    background: 'Sky visuals hidden; fixed blue background. Production sky is not validated.',
    scene: 'Actual campus persistent BASE plus target-owned chunk layers. Non-chunk props, actors and UI hidden.',
    meshes: meshStats() };
}

export function setTier(tier) {
  if (!['ALL', 'BASE'].includes(tier)) throw Error('Unknown QA tier');
  for (const handle of qa.handles) qa.renderer.setState(handle, tier === 'ALL' ? 'ACTIVE' : 'VISTA');
  qa.renderer.update(1);
  if (!qa.base.enabled || qa.handles.some(h => !h.root.enabled ||
      h.near.enabled !== (tier === 'ALL') || h.detail.enabled !== (tier === 'ALL'))) throw Error('LOD ownership mismatch');
  return { tier, baseEnabled: qa.base.enabled, handles: qa.handles.map(h => ({ id: h.chunk.id,
    near: h.near.enabled, detail: h.detail.enabled })), meshes: meshStats() };
}

export function meshStats() {
  return ['BASE', 'NEAR', 'DETAIL'].map(tier => {
    const roots = tier === 'BASE' ? [qa.base] : qa.handles.map(h => h[tier.toLowerCase()]);
    const entities = roots.flatMap(descendants).filter(e => relevant(e.name));
    const meshes = entities.flatMap(e => e.render?.meshInstances || []);
    let vertices = 0, triangles = 0;
    for (const mi of meshes) {
      const positions = [], normals = [], indices = [];
      mi.mesh.getPositions(positions); mi.mesh.getNormals(normals); mi.mesh.getIndices(indices);
      const bounds = [...mi.aabb.center.toArray(), ...mi.aabb.halfExtents.toArray()];
      if (!positions.length || normals.length !== positions.length || ![...positions, ...normals, ...bounds].every(Number.isFinite)) {
        throw Error(`${tier}: non-finite mesh, normals or world bounds`);
      }
      vertices += positions.length / 3; triangles += indices.length / 3;
    }
    if (!meshes.length) throw Error(`${tier}: no actual shopfront meshes`);
    return { tier, meshes: meshes.length, vertices, triangles, finite: true };
  });
}

export function selectView(name) {
  const view = VIEWS.find(v => v.name === name);
  if (!view) throw Error('Unknown shopfront view');
  const { app, camera } = qa, canvas = app.graphicsDevice.canvas;
  const viewport = { width: canvas.clientWidth, height: canvas.clientHeight }, plan = view.kind === 'road' ? roadCameraFor(view, viewport) : cameraFor(view.plot, viewport);
  camera.camera.projection = pc.PROJECTION_ORTHOGRAPHIC; camera.camera.orthoHeight = plan.orthoHeight;
  camera.camera.aspectRatioMode = pc.ASPECT_MANUAL; camera.camera.aspectRatio = viewport.width / viewport.height;
  camera.camera.nearClip = plan.nearClip; camera.camera.farClip = plan.farClip;
  camera.setPosition(...plan.position); camera.lookAt(...plan.target);
  // Use current transform + actual projection immediately. The camera's cached
  // worldToScreen view matrix is invalidated only at its next prerender event.
  const viewMatrix = new pc.Mat4().copy(camera.getWorldTransform()).invert();
  const viewProjection = new pc.Mat4().mul2(camera.camera.projectionMatrix, viewMatrix);
  const q = view.plot, depths = [];
  const corners = view.kind === 'road' ? roadViewCorners(view) : [-q.w / 2, q.w / 2].flatMap(u => [0, q.h].map(y => {
    const p=q.frame.at(u,frontOf(q)-.15);return [p.x,y,-p.z];
  }));
  const projected = corners.map(point => {
    const world = new pc.Vec3(...point);
    // Orthographic worldToScreen.z is clip-space, not positive view distance.
    depths.push(-viewMatrix.transformPoint(world).z);
    const clip = viewProjection.transformPoint(world); // Orthographic w is exactly 1.
    return new pc.Vec3((clip.x + 1) * viewport.width / 2, (1 - clip.y) * viewport.height / 2, clip.z);
  });
  const roi = { minX: Math.min(...projected.map(p => p.x)) / viewport.width,
    maxX: Math.max(...projected.map(p => p.x)) / viewport.width,
    minY: Math.min(...projected.map(p => p.y)) / viewport.height,
    maxY: Math.max(...projected.map(p => p.y)) / viewport.height };
  if (!Object.values(roi).every(Number.isFinite) || roi.minX < .01 || roi.maxX > .99 || roi.minY < .01 || roi.maxY > .99 ||
      depths.some(depth => !Number.isFinite(depth) || depth <= plan.nearClip || depth >= plan.farClip)) {
    throw Error(`${name}: facade does not fit the actual viewport ${JSON.stringify({roi,depths,viewport,plan})}`);
  }
  qa.roi = roi; qa.previous = null; qa.activePrefixes = view.prefixes;
  return { name, plot: q?.id || view.name, side: q?.side ?? null, camera: plan, viewport, roi,
    depth: { min: Math.min(...depths), max: Math.max(...depths), coordinates: 'camera-forward distance' } };
}

export function showShopfronts(visible) {
  for (const root of [qa.base, ...qa.handles.map(h => h.root)]) {
    for (const e of descendants(root)) if ((qa.activePrefixes || []).some(prefix => e.name.startsWith(prefix))) e.enabled = visible;
  }
}

export function pixels() {
  return new Promise((resolve, reject) => {
    const { app } = qa;
    const timer = setTimeout(() => { app.off('postrender', onFrame); reject(Error('Shopfront frame timeout')); }, 6000);
    const onFrame = async () => {
      try {
        const gl = app.graphicsDevice.gl, width = gl.drawingBufferWidth, height = gl.drawingBufferHeight;
        const data = new Uint8Array(width * height * 4), old = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
        try { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null); gl.finish(); gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, data); }
        finally { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, old); }
        const roi = qa.roi, x0 = Math.ceil(roi.minX * width), x1 = Math.floor(roi.maxX * width);
        const y0 = Math.ceil(roi.minY * height), y1 = Math.floor(roi.maxY * height);
        let changed = 0, changedFacade = 0;
        const rgbDifference = index => Math.abs(data[index] - qa.previous[index]) +
          Math.abs(data[index + 1] - qa.previous[index + 1]) + Math.abs(data[index + 2] - qa.previous[index + 2]);
        if (qa.previous?.length === data.length) for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          if (rgbDifference(((height - 1 - y) * width + x) * 4) > 12) {
            changed++; if (x >= x0 && x <= x1 && y >= y0 && y <= y1) changedFacade++;
          }
        }
        const samples = [];
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
          const px = Math.floor(x0 + (x + .5) * (x1 - x0) / 32), py = Math.floor(y0 + (y + .5) * (y1 - y0) / 32);
          samples.push(...data.subarray(((height - 1 - py) * width + px) * 4, ((height - 1 - py) * width + px) * 4 + 3));
        }
        const glError = gl.getError(), contextLost = gl.isContextLost(); qa.previous = data;
        const sha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(x => x.toString(16).padStart(2, '0')).join('');
        resolve({ width, height, sha256, changed, changedFacade, glError, contextLost, samples,
          readbackFramebuffer: 'resolved-default', facadePixels: (x1 - x0 + 1) * (y1 - y0 + 1) });
      } catch (error) { reject(error); } finally { clearTimeout(timer); }
    };
    app.once('postrender', onFrame); app.renderNextFrame = true;
  });
}
