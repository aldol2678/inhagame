// JSL-B · merge static interior geometry into one mesh per material.
//
// Repeated desks, chairs, carrels, columns and finish strips are emitted as plain vertex data and
// built once per material, so a room costs a handful of draw calls instead of one per box. The
// geometry functions are engine-free (Node tests read their counts); build() needs PlayCanvas.

import * as pc from "playcanvas";

function group(groups, material) {
  let g = groups.get(material);
  if (!g) { g = { positions: [], normals: [], uvs: [], indices: [] }; groups.set(material, g); }
  return g;
}

const rotate = (x, z, yaw) => {
  const r = yaw * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
  return [x * c + z * s, -x * s + z * c];
};

function pushQuad(g, corners, normal) {
  const base = g.positions.length / 3;
  for (const [x, y, z] of corners) g.positions.push(x, y, z);
  for (let i = 0; i < 4; i += 1) g.normals.push(...normal);
  g.uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
  g.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

export function createStaticBatch() {
  const groups = new Map();
  let boxes = 0;
  const api = {
    /** Axis box centred at c, optionally turned by yaw degrees about Y. */
    box(material, [cx, cy, cz], [w, h, d], yaw = 0) {
      if (!(w > 0 && h > 0 && d > 0)) return api;
      const g = group(groups, material);
      const hx = w / 2, hy = h / 2, hz = d / 2;
      const p = (x, y, z) => { const [rx, rz] = rotate(x, z, yaw); return [cx + rx, cy + y, cz + rz]; };
      const n = (x, y, z) => { const [rx, rz] = rotate(x, z, yaw); return [rx, y, rz]; };
      pushQuad(g, [p(-hx, -hy, hz), p(hx, -hy, hz), p(hx, hy, hz), p(-hx, hy, hz)], n(0, 0, 1));
      pushQuad(g, [p(hx, -hy, -hz), p(-hx, -hy, -hz), p(-hx, hy, -hz), p(hx, hy, -hz)], n(0, 0, -1));
      pushQuad(g, [p(hx, -hy, hz), p(hx, -hy, -hz), p(hx, hy, -hz), p(hx, hy, hz)], n(1, 0, 0));
      pushQuad(g, [p(-hx, -hy, -hz), p(-hx, -hy, hz), p(-hx, hy, hz), p(-hx, hy, -hz)], n(-1, 0, 0));
      pushQuad(g, [p(-hx, hy, hz), p(hx, hy, hz), p(hx, hy, -hz), p(-hx, hy, -hz)], n(0, 1, 0));
      pushQuad(g, [p(-hx, -hy, -hz), p(hx, -hy, -hz), p(hx, -hy, hz), p(-hx, -hy, hz)], n(0, -1, 0));
      boxes += 1;
      return api;
    },
    /** Vertical cylinder (prism) centred at c. */
    cylinder(material, [cx, cy, cz], radius, height, segments = 12) {
      const g = group(groups, material);
      const y0 = cy - height / 2, y1 = cy + height / 2;
      for (let i = 0; i < segments; i += 1) {
        const a0 = i / segments * Math.PI * 2, a1 = (i + 1) / segments * Math.PI * 2, am = (a0 + a1) / 2;
        const x0 = cx + Math.cos(a0) * radius, z0 = cz + Math.sin(a0) * radius;
        const x1 = cx + Math.cos(a1) * radius, z1 = cz + Math.sin(a1) * radius;
        pushQuad(g, [[x1, y0, z1], [x0, y0, z0], [x0, y1, z0], [x1, y1, z1]], [Math.cos(am), 0, Math.sin(am)]);
        const base = g.positions.length / 3;
        g.positions.push(cx, y1, cz, x1, y1, z1, x0, y1, z0, cx, y0, cz, x0, y0, z0, x1, y0, z1);
        g.normals.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0);
        g.uvs.push(0.5, 0.5, 1, 0, 0, 0, 0.5, 0.5, 0, 1, 1, 1);
        g.indices.push(base, base + 1, base + 2, base + 3, base + 4, base + 5);
      }
      boxes += 1;
      return api;
    },
    /** Low-poly sphere for foliage. */
    sphere(material, [cx, cy, cz], radius, rings = 5, segments = 8) {
      const g = group(groups, material);
      const base = g.positions.length / 3;
      for (let r = 0; r <= rings; r += 1) {
        const v = r / rings * Math.PI, y = Math.cos(v), s = Math.sin(v);
        for (let k = 0; k <= segments; k += 1) {
          const u = k / segments * Math.PI * 2, x = Math.cos(u) * s, z = Math.sin(u) * s;
          g.positions.push(cx + x * radius, cy + y * radius, cz + z * radius);
          g.normals.push(x, y, z);
          g.uvs.push(k / segments, r / rings);
        }
      }
      for (let r = 0; r < rings; r += 1) for (let k = 0; k < segments; k += 1) {
        const a = base + r * (segments + 1) + k, b = a + segments + 1;
        g.indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
      boxes += 1;
      return api;
    },
    get materialCount() { return groups.size; },
    get primitiveCount() { return boxes; },
    get vertexCount() { let n = 0; for (const g of groups.values()) n += g.positions.length / 3; return n; },
    /** One render entity per material under `parent`. Meshes are destroyed with the entity. */
    build(parent, name, { castShadows = false } = {}) {
      const device = pc.Application.getApplication().graphicsDevice;
      const entities = [];
      let index = 0;
      for (const [material, g] of groups) {
        if (!g.indices.length) continue;
        const mesh = pc.createMesh(device, g.positions, { normals: g.normals, uvs: g.uvs, indices: g.indices });
        const entity = new pc.Entity(`${name}_${index++}`);
        entity.addComponent("render", { type: "asset", meshInstances: [new pc.MeshInstance(mesh, material)], castShadows });
        entity.on("destroy", () => mesh.destroy());
        parent.addChild(entity);
        entities.push(entity);
      }
      groups.clear();
      return entities;
    }
  };
  return api;
}
