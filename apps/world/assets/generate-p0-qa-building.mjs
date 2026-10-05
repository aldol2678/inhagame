import { writeFile } from "node:fs/promises";

const faces = [
  { normal: [0, 0, 1], corners: [[-1.5, 0, 1.5], [1.5, 0, 1.5], [1.5, 4, 1.5], [-1.5, 4, 1.5]] },
  { normal: [0, 0, -1], corners: [[1.5, 0, -1.5], [-1.5, 0, -1.5], [-1.5, 4, -1.5], [1.5, 4, -1.5]] },
  { normal: [1, 0, 0], corners: [[1.5, 0, 1.5], [1.5, 0, -1.5], [1.5, 4, -1.5], [1.5, 4, 1.5]] },
  { normal: [-1, 0, 0], corners: [[-1.5, 0, -1.5], [-1.5, 0, 1.5], [-1.5, 4, 1.5], [-1.5, 4, -1.5]] },
  { normal: [0, 1, 0], corners: [[-1.5, 4, 1.5], [1.5, 4, 1.5], [1.5, 4, -1.5], [-1.5, 4, -1.5]] },
  { normal: [0, -1, 0], corners: [[-1.5, 0, -1.5], [1.5, 0, -1.5], [1.5, 0, 1.5], [-1.5, 0, 1.5]] }
];
const positions = new Float32Array(faces.flatMap(face => face.corners.flat()));
const normals = new Float32Array(faces.flatMap(face => face.corners.flatMap(() => face.normal)));
const indices = new Uint16Array(faces.flatMap((_, face) => [0, 1, 2, 0, 2, 3].map(index => face * 4 + index)));
const positionBytes = Buffer.from(positions.buffer);
const normalBytes = Buffer.from(normals.buffer);
const indexBytes = Buffer.from(indices.buffer);
const bin = Buffer.concat([positionBytes, normalBytes, indexBytes]);
const gltf = {
  asset: { version: "2.0", generator: "INHA WORLD P0 QA" },
  scenes: [{ nodes: [0] }], scene: 0,
  nodes: [{ mesh: 0, name: "P0 QA Building" }],
  meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
  materials: [{ name: "QA blue", pbrMetallicRoughness: { baseColorFactor: [0.36, 0.61, 0.77, 1], metallicFactor: 0, roughnessFactor: 0.9 }, doubleSided: true }],
  accessors: [
    { bufferView: 0, componentType: 5126, count: 24, type: "VEC3", min: [-1.5, 0, -1.5], max: [1.5, 4, 1.5] },
    { bufferView: 1, componentType: 5126, count: 24, type: "VEC3" },
    { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" }
  ],
  bufferViews: [
    { buffer: 0, byteOffset: 0, byteLength: positionBytes.length, target: 34962 },
    { buffer: 0, byteOffset: positionBytes.length, byteLength: normalBytes.length, target: 34962 },
    { buffer: 0, byteOffset: positionBytes.length + normalBytes.length, byteLength: indexBytes.length, target: 34963 }
  ],
  buffers: [{ byteLength: bin.length }]
};
const pad4 = (buffer, byte = 0x20) => Buffer.concat([buffer, Buffer.alloc((4 - buffer.length % 4) % 4, byte)]);
const json = pad4(Buffer.from(JSON.stringify(gltf), "utf8"));
const paddedBin = pad4(bin, 0);
const header = Buffer.alloc(12);
header.write("glTF", 0);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(12 + 8 + json.length + 8 + paddedBin.length, 8);
const jsonHeader = Buffer.alloc(8);
jsonHeader.writeUInt32LE(json.length, 0);
jsonHeader.write("JSON", 4);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(paddedBin.length, 0);
binHeader.write("BIN\0", 4);
const file = Buffer.concat([header, jsonHeader, json, binHeader, paddedBin]);
await writeFile("apps/world/assets/p0-qa-building.glb", file);
process.stdout.write(`generated ${file.length} bytes\n`);
