import * as pc from 'playcanvas';
import { box } from '../campus-render-kit.js';
import { PERSONAL_ROOM_CHAIR_PARTS, buildPersonalRoomChairGeometry } from './personal-room-chair-design.js';

// Same source shapes/material slots as the packaged GLB. Asset errors therefore
// keep the matching chair visible; a successful load cannot change its style.
export function createPersonalRoomChairFallback({ app, root, anchor, materials }) {
  const fallback = new pc.Entity('chair_fallback'), meshes = new Map();
  anchor.addChild(fallback);
  for (const part of PERSONAL_ROOM_CHAIR_PARTS) {
    if (!meshes.has(part.shape)) {
      let mesh = null;
      if (app?.graphicsDevice && typeof pc.createMesh === 'function') {
        try {
          const data = buildPersonalRoomChairGeometry(part.shape);
          mesh = pc.createMesh(app.graphicsDevice, data.positions, { normals: data.normals, indices: data.indices, uvs: data.uvs });
        } catch { /* Mesh allocation is optional; retain the primitive chair. */ }
      }
      meshes.set(part.shape, mesh);
    }
    const mesh = meshes.get(part.shape), material = materials.get(part.material);
    if (!mesh) {
      box(fallback, part.name, part.at, part.size, material, 0, part.shape === 'cushion' ? 'sphere' : 'box');
      continue;
    }
    const entity = new pc.Entity(part.name);
    entity.addComponent('render', { type: 'asset', meshInstances: [new pc.MeshInstance(mesh, material)], castShadows: true, receiveShadows: true });
    entity.setLocalPosition(...part.at); entity.setLocalScale(...part.size); fallback.addChild(entity);
  }
  root.once('destroy', () => { for (const mesh of meshes.values()) mesh?.destroy(); meshes.clear(); });
  return fallback;
}
