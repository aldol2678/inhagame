// Validate the equipment GLBs written by build_equipment.py. Run: node assets/check_equipment.mjs
// Also imported by tests/equipment-asset-binding.test.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const EQUIPMENT_GLBS=Object.freeze([
 {file:'induck-cap-v1.glb',root:'Equipment_InduckCap_v1',maxBytes:64000,meshes:Array.from({length:6},(_,i)=>`qa_head_${i}`)},
 {file:'induck-backpack-v1.glb',root:'Equipment_InduckBackpack_v1',maxBytes:64000,meshes:Array.from({length:6},(_,i)=>`qa_back_${i}`)},
 {file:'induck-hoodie-v1.glb',root:'Equipment_InduckHoodie_v1',maxBytes:64000,meshes:Array.from({length:6},(_,i)=>`qa_top_${i}`)}
]);

/** Parse and structurally validate one GLB; returns { gltf, bounds } (bounds over all POSITION accessors). */
export function inspectGlb(bytes, label = "glb") {
  assert.equal(bytes.readUInt32LE(0), 0x46546c67, `${label}: glTF magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${label}: GLB version 2`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${label}: header length`);
  const jsonLength = bytes.readUInt32LE(12);
  assert.equal(bytes.toString("ascii", 16, 20), "JSON", `${label}: JSON chunk`);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const binOffset = 20 + jsonLength;
  assert.equal(bytes.toString("ascii", binOffset + 4, binOffset + 8), "BIN\0", `${label}: BIN chunk`);
  assert.equal(bytes.readUInt32LE(binOffset), bytes.length - binOffset - 8, `${label}: BIN length`);
  assert.equal(gltf.asset?.version, "2.0", `${label}: glTF 2.0`);
  assert.equal(gltf.images, undefined, `${label}: no textures`);
  assert.equal(gltf.textures, undefined, `${label}: no textures`);
  for (const view of gltf.bufferViews) {
    assert.ok(view.byteOffset + view.byteLength <= gltf.buffers[0].byteLength, `${label}: buffer bound`);
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives) {
      const positions = gltf.accessors[primitive.attributes.POSITION];
      const normals = gltf.accessors[primitive.attributes.NORMAL];
      const indexes = gltf.accessors[primitive.indices];
      assert.equal(positions.count, normals.count, `${label}: ${mesh.name} normal count`);
      assert.equal(indexes.count % 3, 0, `${label}: ${mesh.name} triangle indices`);
      assert.ok(positions.count > 2, `${label}: ${mesh.name} has geometry`);
      const view = gltf.bufferViews[indexes.bufferView];
      for (let i = 0; i < indexes.count; i += 1) {
        assert.ok(bytes.readUInt16LE(binOffset + 8 + view.byteOffset + i * 2) < positions.count, `${label}: ${mesh.name} index bounds`);
      }
      for (let k = 0; k < 3; k += 1) { min[k] = Math.min(min[k], positions.min[k]); max[k] = Math.max(max[k], positions.max[k]); }
      const material = gltf.materials[primitive.material];
      assert.ok(material?.pbrMetallicRoughness?.baseColorFactor, `${label}: ${mesh.name} flat-color PBR material`);
    }
  }
  return { gltf, bounds: { min, max } };
}

export function checkEquipmentGlb(spec, bytes) {
  const { gltf, bounds } = inspectGlb(bytes, spec.file);
  assert.equal(gltf.scenes[gltf.scene].nodes.length, 1, `${spec.file}: one scene root`);
  assert.equal(gltf.nodes[gltf.scenes[gltf.scene].nodes[0]].name, spec.root, `${spec.file}: scene root name`);
  assert.deepEqual(gltf.meshes.map((mesh) => mesh.name), spec.meshes, `${spec.file}: expected meshes`);
  assert.ok(gltf.nodes.every((node) => !node.rotation && !node.scale), `${spec.file}: authored in anchor space (no node transforms)`);
  assert.ok(bytes.length < spec.maxBytes, `${spec.file}: ${bytes.length} bytes (limit ${spec.maxBytes})`);
  return { gltf, bounds };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const spec of EQUIPMENT_GLBS) {
    const bytes = readFileSync(new URL(spec.file, import.meta.url));
    const { gltf, bounds } = checkEquipmentGlb(spec, bytes);
    const fmt = (v) => v.map((n) => n.toFixed(3)).join(",");
    console.log(`${spec.file}: ${gltf.meshes.length} meshes, ${bytes.length} bytes, bounds [${fmt(bounds.min)}]..[${fmt(bounds.max)}] PASS`);
  }
}
