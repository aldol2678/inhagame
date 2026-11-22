import * as THREE from '../vendor/three.module.js';
import { createSpatial } from './map/spatial.js';

async function readAsset(path, format) {
  const response = await fetch(new URL('../data/' + path, import.meta.url));
  if (!response.ok) throw Error('캠퍼스 자료를 불러오지 못했습니다 (' + response.status + '): ' + path);
  return response[format]();
}
function meshFromBatch(bytes, range) {
  const view = new DataView(bytes, range.offset, range.count * 16);
  const points = new Float32Array(range.count * 3),
    colors = new Float32Array(points.length);
  const color = new THREE.Color();
  for (let i = 0; i < range.count; i++) {
    const j = i * 16;
    for (let k = 0; k < 3; k++) points[i * 3 + k] = view.getFloat32(j + 4 * k, true);
    color.setRGB(
      view.getUint8(j + 12) / 255,
      view.getUint8(j + 13) / 255,
      view.getUint8(j + 14) / 255,
      THREE.SRGBColorSpace,
    );
    color.toArray(colors, i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(points, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.91, side: THREE.DoubleSide }),
  );
}
function plantTrees(scene, trees) {
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.24, 0.34, 2.5, 7),
    new THREE.MeshStandardMaterial({ color: 0x796453 }),
    trees.length,
  );
  const crown = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(1, 1),
    new THREE.MeshStandardMaterial({ roughness: 1 }),
    trees.length,
  );
  const transform = new THREE.Object3D();
  trees.forEach(({ x, z }, i) => {
    transform.position.set(x, 1.25, z);
    transform.scale.set(1, 1, 1);
    transform.updateMatrix();
    trunk.setMatrixAt(i, transform.matrix);
    transform.position.y = 3.35;
    transform.scale.set(1.55, 2.05, 1.6);
    transform.rotation.y = i * 1.9;
    transform.updateMatrix();
    crown.setMatrixAt(i, transform.matrix);
    crown.setColorAt(i, new THREE.Color([0x537c55, 0x628153, 0x77935e][i % 3]));
  });
  scene.add(trunk, crown);
}
export async function createCampus(scene) {
  const [layout, bytes] = await Promise.all([
    readAsset('layout.json', 'json'),
    readAsset('layout.bin', 'arrayBuffer'),
  ]);
  const spatial = createSpatial(layout),
    details = [];
  for (const [zone, range] of Object.entries(layout.ranges)) {
    const mesh = meshFromBatch(bytes, range);
    mesh.name = zone;
    scene.add(mesh);
    if (zone !== 'base')
      details.push({ mesh, anchor: spatial.rooms[zone === 'hall' ? 'main-building' : 'library'] });
  }
  plantTrees(scene, layout.trees);
  return {
    ...spatial,
    updateVisibility(x, z) {
      for (const { mesh, anchor } of details)
        mesh.visible = Math.hypot(anchor.x - x, anchor.z - z) < 110;
    },
  };
}
