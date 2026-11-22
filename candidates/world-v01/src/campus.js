// Campus scene (v0.1): floor, roads, 3 building boxes + name labels.
// Collision is axis-aligned boxes around each building.
// Coordinates are local game coordinates, not real-world measurements.
import * as THREE from '../vendor/three.module.js';

function makeLabel(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20, 30, 40, 0.85)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 56px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 256, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(10, 2.5, 1);
  return sprite;
}

export function createCampus(scene) {
  const colliders = [];
  const roomCenters = {};

  // Ground
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshStandardMaterial({ color: 0x7fae6a }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Roads: one north-south, one east-west, meeting at the plaza.
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x8a8f96 });
  const roadNS = new THREE.Mesh(new THREE.PlaneGeometry(6, 90), roadMat);
  roadNS.rotation.x = -Math.PI / 2;
  roadNS.position.set(0, 0.01, 0);
  scene.add(roadNS);
  const roadEW = new THREE.Mesh(new THREE.PlaneGeometry(90, 6), roadMat);
  roadEW.rotation.x = -Math.PI / 2;
  roadEW.position.set(0, 0.02, -10);
  scene.add(roadEW);

  // Plaza circle at the gate
  const plaza = new THREE.Mesh(
    new THREE.CircleGeometry(9, 32),
    new THREE.MeshStandardMaterial({ color: 0xb8b0a0 }),
  );
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.set(0, 0.03, -20);
  scene.add(plaza);

  // Buildings from data (positions duplicated here so the 3D scene
  // works even when the JSON fetch is unavailable offline).
  const buildings = [
    { id: 'main-gate', label: '정문 광장', center: [0, -20], size: [18, 6, 4], pos: [0, -30], color: 0x7a8a99 },
    { id: 'main-building', label: '본관', center: [-20, -8], size: [14, 9, 10], pos: [-24, -14], color: 0x8a7a5a },
    { id: 'library', label: '중앙도서관', center: [20, -10], size: [12, 11, 10], pos: [25, -16], color: 0x5a7a8a },
  ];
  for (const b of buildings) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.size[0], b.size[1], b.size[2]),
      new THREE.MeshStandardMaterial({ color: b.color }),
    );
    mesh.position.set(b.pos[0], b.size[1] / 2, b.pos[1]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    // Roof slab, so the box reads as a building, not a plain cube.
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(b.size[0] + 1, 0.5, b.size[2] + 1),
      new THREE.MeshStandardMaterial({ color: 0x3a4550 }),
    );
    roof.position.set(b.pos[0], b.size[1] + 0.25, b.pos[1]);
    scene.add(roof);
    const label = makeLabel(b.label);
    label.position.set(b.pos[0], b.size[1] + 2.5, b.pos[1]);
    scene.add(label);
    colliders.push({
      minX: b.pos[0] - b.size[0] / 2 - 0.4,
      maxX: b.pos[0] + b.size[0] / 2 + 0.4,
      minZ: b.pos[1] - b.size[2] / 2 - 0.4,
      maxZ: b.pos[1] + b.size[2] / 2 + 0.4,
    });
    roomCenters[b.id] = { x: b.center[0], z: b.center[1] };
  }

  // A few trees (cones + cylinders) for orientation, no collision.
  const treePositions = [[-8, -26], [8, -26], [-12, 2], [12, 4], [-30, 4], [30, 2]];
  for (const [x, z] of treePositions) {
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.3, 0.4, 2, 8),
      new THREE.MeshStandardMaterial({ color: 0x6a4a2a }),
    );
    trunk.position.set(x, 1, z);
    scene.add(trunk);
    const top = new THREE.Mesh(
      new THREE.ConeGeometry(1.8, 4, 8),
      new THREE.MeshStandardMaterial({ color: 0x3a7a3a }),
    );
    top.position.set(x, 4, z);
    scene.add(top);
  }

  return { colliders, roomCenters };
}

// Move a point, stopping at building boxes and the 44-unit boundary.
export function collide(x, z, nx, nz, colliders) {
  const r = 0.6; // player radius
  let px = nx;
  let pz = nz;
  for (const c of colliders) {
    if (px + r > c.minX && px - r < c.maxX && pz + r > c.minZ && pz - r < c.maxZ) {
      // Revert the axis that entered the box; keep the other axis.
      const xOnly = nx;
      const zOnly = nz;
      const xBlocked = xOnly + r > c.minX && xOnly - r < c.maxX && z + r > c.minZ && z - r < c.maxZ;
      const zBlocked = x + r > c.minX && x - r < c.maxX && zOnly + r > c.minZ && zOnly - r < c.maxZ;
      if (xBlocked) px = x;
      if (zBlocked) pz = z;
      if (!xBlocked && !zBlocked) { px = x; pz = z; }
    }
  }
  px = Math.max(-44, Math.min(44, px));
  pz = Math.max(-44, Math.min(44, pz));
  return { x: px, z: pz };
}
