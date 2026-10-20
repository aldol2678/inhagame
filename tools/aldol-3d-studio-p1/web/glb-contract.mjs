// Deliberately bounded static glTF 2.0 profile. Shared by server and browser;
// validation finishes before PlayCanvas sees any caller-controlled bytes.
const fail = code => { throw Error(code); };
const integer = (n, max = 20 * 1024 * 1024) => Number.isSafeInteger(n) && n >= 0 && n <= max;
export function validateRenderGlb(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 28 || bytes.length > 20 * 1024 * 1024 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== bytes.length) fail('E_GLB_HEADER');
  const length = view.getUint32(12, true);
  if (length % 4 || length > bytes.length - 28 || view.getUint32(16, true) !== 0x4e4f534a) fail('E_GLB_JSON_CHUNK');
  let doc;
  try { doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + length))); } catch { fail('E_GLB_JSON_INVALID'); }
  const start = 28 + length, binLength = view.getUint32(20 + length, true);
  if (view.getUint32(24 + length, true) !== 0x004e4942 || binLength % 4 || start + binLength !== bytes.length) fail('E_GLB_BIN_CHUNK');
  if (doc.asset?.version !== '2.0') fail('E_GLB_VERSION');
  // Reject even optional extensions: some engine extensions can initiate requests.
  function walk(value, depth = 0) {
    if (depth > 64) fail('E_GLB_DEPTH');
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'uri') fail('E_GLB_EXTERNAL_URI');
      if ((key === 'extensions' || key === 'extensionsUsed' || key === 'extensionsRequired') && Object.keys(child || {}).length) fail('E_GLB_UNSUPPORTED_EXTENSION');
      walk(child, depth + 1);
    }
  }
  walk(doc);
  const arrays = ['buffers', 'bufferViews', 'accessors', 'meshes', 'nodes', 'scenes', 'materials', 'textures', 'images', 'samplers'];
  for (const key of arrays) { if (doc[key] === undefined) doc[key] = []; if (!Array.isArray(doc[key]) || doc[key].length > 4096) fail('E_GLB_ARRAY_LIMIT'); }
  if (doc.animations?.length || doc.skins?.length) fail('E_GLB_STATIC_ONLY');
  if (doc.buffers.length !== 1 || !integer(doc.buffers[0].byteLength) || doc.buffers[0].byteLength > binLength || binLength - doc.buffers[0].byteLength > 3) fail('E_GLB_BUFFER_RANGE');
  const ref = (list, index, code = 'E_GLB_REFERENCE') => { if (!integer(index, list.length - 1) || !list[index]) fail(code); return list[index]; };
  for (const b of doc.bufferViews) {
    if (b.buffer !== 0 || !integer(b.byteOffset ?? 0) || !integer(b.byteLength) || (b.byteOffset ?? 0) + b.byteLength > doc.buffers[0].byteLength) fail('E_GLB_VIEW_RANGE');
    if (b.byteStride !== undefined && (!integer(b.byteStride, 252) || b.byteStride < 4 || b.byteStride % 4)) fail('E_GLB_STRIDE');
  }
  const sizes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const readers = { 5120: 'getInt8', 5121: 'getUint8', 5122: 'getInt16', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' };
  let accessorElements = 0;
  const access = doc.accessors.map(a => {
    const b = ref(doc.bufferViews, a.bufferView), size = sizes[a.componentType], width = widths[a.type];
    if (a.sparse || !size || !width || !integer(a.count, 1000000) || a.count < 1 || !integer(a.byteOffset ?? 0)) fail('E_GLB_ACCESSOR');
    accessorElements += a.count * width; if (accessorElements > 8000000) fail('E_GLB_ACCESSOR_LIMIT');
    const stride = b.byteStride ?? size * width, offset = a.byteOffset ?? 0;
    if (stride < size * width || offset % size || ((b.byteOffset ?? 0) + offset) % size || offset + (a.count - 1) * stride + size * width > b.byteLength) fail('E_GLB_ACCESSOR_RANGE');
    const read = (i, j = 0) => view[readers[a.componentType]](start + (b.byteOffset ?? 0) + offset + i * stride + j * size, true);
    if (a.componentType === 5126) for (let i = 0; i < a.count; i++) for (let j = 0; j < width; j++) if (!Number.isFinite(read(i, j)) || Math.abs(read(i, j)) > 1e7) fail('E_GLB_NONFINITE');
    return { ...a, read };
  });
  let primitives = 0, vertices = 0, indices = 0;
  for (const mesh of doc.meshes) {
    if (!Array.isArray(mesh.primitives) || !mesh.primitives.length) fail('E_GLB_NO_GEOMETRY');
    for (const p of mesh.primitives) {
      if ((p.mode ?? 4) !== 4 || p.targets || mesh.weights) fail('E_GLB_STATIC_TRIANGLES_ONLY');
      const position = ref(access, p.attributes?.POSITION);
      if (position.type !== 'VEC3' || position.componentType !== 5126) fail('E_GLB_POSITION');
      for (const [semantic, id] of Object.entries(p.attributes)) {
        const a = ref(access, id);
        if (!['POSITION', 'NORMAL', 'TEXCOORD_0', 'TANGENT', 'COLOR_0'].includes(semantic) || a.count !== position.count) fail('E_GLB_ATTRIBUTE');
        const expected = { POSITION: ['VEC3'], NORMAL: ['VEC3'], TEXCOORD_0: ['VEC2'], TANGENT: ['VEC4'], COLOR_0: ['VEC3', 'VEC4'] }[semantic];
        if (!expected.includes(a.type) || (a.componentType !== 5126 && (!['TEXCOORD_0', 'COLOR_0'].includes(semantic) || ![5121,5123].includes(a.componentType) || !a.normalized))) fail('E_GLB_ATTRIBUTE');
      }
      if (p.indices !== undefined) {
        const a = ref(access, p.indices);
        if (a.type !== 'SCALAR' || ![5121,5123,5125].includes(a.componentType) || a.normalized || a.count % 3) fail('E_GLB_INDICES');
        for (let i = 0; i < a.count; i++) if (a.read(i) >= position.count) fail('E_GLB_INDEX_RANGE');
        indices += a.count;
      } else if (position.count % 3) fail('E_GLB_TRIANGLES');
      if (p.material !== undefined) ref(doc.materials, p.material);
      primitives++; vertices += position.count;
      if (primitives > 1024 || vertices > 1000000 || indices > 3000000) fail('E_GLB_GEOMETRY_LIMIT');
    }
  }
  if (!primitives) fail('E_GLB_NO_GEOMETRY');
  let pixels = 0;
  for (const image of doc.images) {
    if (image.mimeType !== 'image/png') fail('E_GLB_TEXTURE_PNG_ONLY');
    const b = ref(doc.bufferViews, image.bufferView), off = start + (b.byteOffset ?? 0);
    if (b.byteLength < 33 || view.getUint32(off) !== 0x89504e47 || view.getUint32(off + 4) !== 0x0d0a1a0a || view.getUint32(off + 12) !== 0x49484452) fail('E_GLB_TEXTURE_HEADER');
    const w = view.getUint32(off + 16), h = view.getUint32(off + 20); pixels += w * h;
    if (!w || !h || w > 4096 || h > 4096 || pixels > 16777216) fail('E_GLB_TEXTURE_LIMIT');
  }
  for (const t of doc.textures) { ref(doc.images, t.source); if (t.sampler !== undefined) ref(doc.samplers, t.sampler); }
  function checkTextures(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (key.endsWith('Texture')) { ref(doc.textures, child?.index); if ((child.texCoord ?? 0) !== 0) fail('E_GLB_TEXCOORD'); }
      checkTextures(child);
    }
  }
  doc.materials.forEach(checkTextures);
  if (doc.nodes.length > 512) fail('E_GLB_NODE_LIMIT');
  const parents = new Set(); let instanceVertices=0,instancePrimitives=0;
  for (const n of doc.nodes) {
    if (n.mesh !== undefined) { const mesh=ref(doc.meshes,n.mesh); instancePrimitives+=mesh.primitives.length; for(const p of mesh.primitives) instanceVertices+=access[p.attributes.POSITION].count; if(instanceVertices>2000000||instancePrimitives>2048) fail('E_GLB_INSTANCE_LIMIT'); }
    if (n.skin !== undefined || n.weights) fail('E_GLB_STATIC_ONLY');
    for (const [key, len] of [['translation',3],['rotation',4],['scale',3],['matrix',16]]) if (n[key] !== undefined && (!Array.isArray(n[key]) || n[key].length !== len || n[key].some(v => !Number.isFinite(v) || Math.abs(v) > 1e7))) fail('E_GLB_TRANSFORM');
    if (n.matrix && (n.translation || n.rotation || n.scale)) fail('E_GLB_TRANSFORM');
    if (n.children !== undefined && !Array.isArray(n.children)) fail('E_GLB_HIERARCHY');
    for (const c of n.children || []) { ref(doc.nodes, c); if (parents.has(c)) fail('E_GLB_HIERARCHY'); parents.add(c); }
  }
  const visit = (id, path = new Set()) => { ref(doc.nodes, id); if (path.has(id) || path.size > 64) fail('E_GLB_HIERARCHY'); const next = new Set(path).add(id); for (const c of doc.nodes[id].children || []) visit(c, next); };
  doc.nodes.forEach((_, id) => visit(id));
  const scene = ref(doc.scenes, doc.scene ?? 0);
  for (const s of doc.scenes) {
    if (!Array.isArray(s.nodes)) fail('E_GLB_SCENE');
    for (const id of s.nodes) { ref(doc.nodes, id); if (parents.has(id)) fail('E_GLB_HIERARCHY'); }
    if (new Set(s.nodes).size !== s.nodes.length) fail('E_GLB_HIERARCHY');
  }
  if (!scene.nodes.length) fail('E_GLB_NO_SCENE');
  return { meshes: doc.meshes.length, primitives, vertices, indices, materials: doc.materials.length, textures: doc.textures.length, nodes: doc.nodes.length, instanceVertices, instancePrimitives, texturePixels: pixels };
}
