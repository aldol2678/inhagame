#!/usr/bin/env node
// Deterministic self-authored asset build. No Blender, downloads or third-party
// geometry. Importable for byte-for-byte generation checks without writing files.
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { PERSONAL_ROOM_CHAIR_PARTS, buildPersonalRoomChairGeometry } from '../../apps/world/src/rooms/personal-room-chair-design.js';
import { PERSONAL_ROOM_MATERIAL_PROFILES } from '../../apps/world/src/rooms/personal-room-materials.js';

export function generatePersonalRoomChairGlb() {
  const chunks = [], bufferViews = [], accessors = [], meshes = [], nodes = [], materialNames = [...new Set(PERSONAL_ROOM_CHAIR_PARTS.map(p => p.material))];
  let byteOffset = 0;
  function accessor(values, type, componentType, target, bounds = false) {
    const array = componentType === 5123 ? new Uint16Array(values) : new Float32Array(values);
    const bytes = Buffer.from(array.buffer), bufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset, byteLength: bytes.length, target });
    chunks.push(bytes); byteOffset += bytes.length;
    if (byteOffset % 4) { const padding = Buffer.alloc(4 - byteOffset % 4); chunks.push(padding); byteOffset += padding.length; }
    const width = { SCALAR: 1, VEC2: 2, VEC3: 3 }[type];
    const entry = { bufferView, componentType, count: values.length / width, type };
    if (bounds) {
      entry.min = Array.from({ length: width }, (_, j) => Math.min(...array.filter((_, i) => i % width === j)));
      entry.max = Array.from({ length: width }, (_, j) => Math.max(...array.filter((_, i) => i % width === j)));
    }
    accessors.push(entry); return accessors.length - 1;
  }
  const shapeAccessors = new Map(), meshIndices = new Map();
  for (const part of PERSONAL_ROOM_CHAIR_PARTS) {
    if (!shapeAccessors.has(part.shape)) {
      const geometry = buildPersonalRoomChairGeometry(part.shape);
      shapeAccessors.set(part.shape, {
        attributes: { POSITION: accessor(geometry.positions, 'VEC3', 5126, 34962, true), NORMAL: accessor(geometry.normals, 'VEC3', 5126, 34962), TEXCOORD_0: accessor(geometry.uvs, 'VEC2', 5126, 34962) },
        indices: accessor(geometry.indices, 'SCALAR', 5123, 34963)
      });
    }
    const key = `${part.shape}:${part.material}`;
    if (!meshIndices.has(key)) {
      meshIndices.set(key, meshes.length);
      meshes.push({ name: key, primitives: [{ ...shapeAccessors.get(part.shape), material: materialNames.indexOf(part.material), mode: 4 }] });
    }
    nodes.push({ name: part.name, mesh: meshIndices.get(key), translation: part.at, scale: part.size });
  }
  const materials = materialNames.map(name => {
    const profile = PERSONAL_ROOM_MATERIAL_PROFILES[name], n = parseInt(profile.color.slice(1), 16);
    return { name, pbrMetallicRoughness: { baseColorFactor: [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1], metallicFactor: 0, roughnessFactor: 1 - profile.gloss } };
  });
  const binary = Buffer.concat(chunks);
  const gltf = { asset: { version: '2.0', generator: 'INHAGAME deterministic fixed-chair generator v1', copyright: 'INHAGAME. Self-authored geometry; repository LICENSE applies.' }, scene: 0,
    scenes: [{ name: 'fixed-chair-oak-linen', nodes: nodes.map((_, i) => i) }], nodes, meshes, materials,
    buffers: [{ byteLength: binary.length }], bufferViews, accessors,
    extras: { scope: 'fixed-personal-room-chair-only', seatTop: .27, backDirection: '+Z', footprint: [.55, .55], source: 'apps/world/src/rooms/personal-room-chair-design.js' } };
  const json = Buffer.from(JSON.stringify(gltf)), jsonPadding = Buffer.alloc((4 - json.length % 4) % 4, 0x20);
  const jsonChunk = Buffer.concat([json, jsonPadding]), totalLength = 12 + 8 + jsonChunk.length + 8 + binary.length;
  const header = Buffer.alloc(12); header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2, 4); header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8); jsonHeader.writeUInt32LE(jsonChunk.length); jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const binHeader = Buffer.alloc(8); binHeader.writeUInt32LE(binary.length); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binary]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const output = fileURLToPath(new URL('../../apps/world/assets/rooms/personal-v2/fixed-chair-oak-linen.glb', import.meta.url));
  const bytes = generatePersonalRoomChairGlb();
  if (process.argv.includes('--check')) {
    if (!readFileSync(output).equals(bytes)) throw Error('Fixed chair asset differs from deterministic source; regenerate it.');
    console.log(`Fixed chair asset is current (${bytes.length} bytes).`);
  } else { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, bytes); console.log(`Generated ${output} (${bytes.length} bytes).`); }
}
