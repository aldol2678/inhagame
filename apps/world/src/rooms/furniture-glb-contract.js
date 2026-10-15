// Pure pre-parser contract. Descriptors are code-owned; this validator grants no
// network authority. Transport additionally requires registry object identity.
export async function validateFurniturePayload(contents, visual, crypto = globalThis.crypto) {
  if (!(contents instanceof ArrayBuffer) || contents.byteLength !== visual.byteLength) throw Error('FURNITURE_BYTE_LENGTH');
  const digest = await crypto.subtle.digest('SHA-256', contents);
  const hash = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== visual.sha256) throw Error('FURNITURE_HASH_MISMATCH');
  const view = new DataView(contents);
  if (view.byteLength < 28 || view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2 || view.getUint32(8, true) !== contents.byteLength) throw Error('FURNITURE_GLB_HEADER');
  const jsonLength = view.getUint32(12, true);
  if (view.getUint32(16, true) !== 0x4e4f534a || jsonLength % 4 || 20 + jsonLength + 8 > contents.byteLength) throw Error('FURNITURE_GLB_JSON');
  const gltf = JSON.parse(new TextDecoder().decode(new Uint8Array(contents, 20, jsonLength)));
  const binaryOffset = 20 + jsonLength;
  if (view.getUint32(binaryOffset + 4, true) !== 0x004e4942 || binaryOffset + 8 + view.getUint32(binaryOffset, true) !== contents.byteLength) throw Error('FURNITURE_GLB_BIN');
  if (gltf.asset?.version !== '2.0' || gltf.buffers?.length !== 1 || gltf.buffers[0].uri !== undefined || gltf.buffers[0].byteLength > view.getUint32(binaryOffset, true)) throw Error('FURNITURE_BUFFER');
  if ([...(gltf.extensionsRequired ?? []), ...(gltf.extensionsUsed ?? [])].some(name => !(visual.allowedExtensions ?? []).includes(name)) || gltf.skins?.length || gltf.animations?.length) throw Error('FURNITURE_UNSUPPORTED_STRUCTURE');
  for (const image of gltf.images ?? []) {
    if (image.uri !== undefined || !Number.isInteger(image.bufferView) || !gltf.bufferViews?.[image.bufferView] || !['image/png','image/jpeg'].includes(image.mimeType)) throw Error('FURNITURE_EXTERNAL_IMAGE');
  }
  for (const buffer of gltf.bufferViews ?? []) {
    if (buffer.buffer !== 0 || !Number.isInteger(buffer.byteLength) || buffer.byteLength < 0 || (buffer.byteOffset ?? 0) < 0 || (buffer.byteOffset ?? 0) + buffer.byteLength > gltf.buffers[0].byteLength) throw Error('FURNITURE_BUFFER_VIEW');
  }
  for (const node of gltf.nodes ?? []) {
    if (node.skin !== undefined || node.weights || node.matrix || node.translation?.some(value => value !== 0) || node.scale?.some(value => value !== 1) || node.rotation?.some((value, i) => value !== (i === 3 ? 1 : 0))) throw Error('FURNITURE_NODE_TRANSFORM');
  }
  let triangles = 0, primitives = 0;
  for (const mesh of gltf.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
    const indices = gltf.accessors?.[primitive.indices];
    if ((primitive.mode ?? 4) !== 4 || primitive.targets || !indices || indices.type !== 'SCALAR' || !Number.isInteger(indices.count) || indices.count % 3 || !gltf.materials?.[primitive.material]) throw Error('FURNITURE_PRIMITIVE');
    triangles += indices.count / 3; primitives++;
  }
  if (triangles !== visual.triangles || primitives !== visual.primitives || gltf.materials?.length !== visual.materials) throw Error('FURNITURE_STRUCTURE_MISMATCH');
  // Exact SHA pins all material definitions, alpha modes and embedded image bytes.
  return { triangles, primitives, materials: gltf.materials.length };
}
