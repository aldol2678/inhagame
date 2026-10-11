import test from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { readFileSync } from "node:fs";
import { PERSONAL_ROOM_BASIC, PERSONAL_ROOM_BASIC_OBSTACLES, PERSONAL_ROOM_BASIC_BOUNDS } from "../src/rooms/personal-room-layout.js";
import { ROOM_FURNITURE, furnitureBox, positionOnSurface, validateFurniture } from "../src/rooms/furniture-layout.js";

// Mock GPU allocation only. Exercise actual shell assembly, curtain geometry,
// material ownership, shallow wall clearance and failure/re-entry lifecycles.
const gpu = `
  export const allocatedMeshes = [];
  let meshCount = 0, failAt = 0;
  export function failMeshAt(n) { meshCount = 0; failAt = n; }
  export class Entity {
    constructor(name) { this.name = name; this.children = []; this.handlers = {}; this.position = [0,0,0]; this.scale = [1,1,1]; this.euler = [0,0,0]; }
    addChild(child) { child.parent = this; this.children.push(child); }
    addComponent(type, options) { this[type] = { ...options }; }
    setLocalPosition(...p) { this.position = p; }
    setLocalScale(...s) { this.scale = s; }
    setLocalEulerAngles(...r) { this.euler = r; }
    on(event, fn) { (this.handlers[event] ??= []).push(fn); }
    once(event, fn) { this.on(event, fn); }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      for (const fn of this.handlers.destroy ?? []) fn();
      for (const child of [...this.children]) child.destroy();
      this.children = [];
      if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this);
    }
  }
  export class StandardMaterial { update() {} destroy() { this.destroyed = true; } }
  export class Color { constructor(r, g, b) { Object.assign(this, {r, g, b}); } }
  export class Vec2 { constructor(x, y) { Object.assign(this, {x, y}); } }
  export class MeshInstance { constructor(mesh, material) { Object.assign(this, {mesh, material}); } }
  export const Application = { getApplication: () => ({ graphicsDevice: {} }) };
  export function createMesh(_device, positions, rest) {
    if (++meshCount === failAt) throw new Error('Simulated optional mesh allocation failure');
    const mesh = { positions, ...rest, destroyCount: 0, destroy() { this.destroyCount++; this.destroyed = true; } };
    allocatedMeshes.push(mesh);
    return mesh;
  }
`;
registerHooks({ resolve(specifier, context, next) {
  return specifier === "playcanvas" ? { url: `data:text/javascript,${encodeURIComponent(gpu)}`, shortCircuit: true } : next(specifier, context);
} });
const pc = await import("playcanvas");
const { createPersonalRoomShell } = await import("../src/rooms/personal-room-shell-renderer.js");
const { PERSONAL_ROOM_WINDOW, buildPersonalRoomCurtainGeometry } = await import("../src/rooms/personal-room-window.js");
const all = root => [root, ...root.children.flatMap(all)];
const find = (root, name) => all(root).find(x => x.name === name);
const meshes = root => all(root).flatMap(x => x.render?.meshInstances?.map(y => y.mesh) ?? []);
const close = (a, b) => Math.abs(a - b) < 1e-8;
function worldPoint(entity, point) {
  let [x, y, z] = point;
  for (let e = entity; e; e = e.parent) {
    x *= e.scale[0]; y *= e.scale[1]; z *= e.scale[2];
    const [rx, ry, rz] = e.euler.map(v => v * Math.PI / 180);
    [y, z] = [y * Math.cos(rx) - z * Math.sin(rx), y * Math.sin(rx) + z * Math.cos(rx)];
    [x, z] = [x * Math.cos(ry) + z * Math.sin(ry), -x * Math.sin(ry) + z * Math.cos(ry)];
    [x, y] = [x * Math.cos(rz) - y * Math.sin(rz), x * Math.sin(rz) + y * Math.cos(rz)];
    x += e.position[0]; y += e.position[1]; z += e.position[2];
  }
  return [x, y, z];
}
function visualVertices(root) {
  const vertices = [];
  for (const entity of all(root)) {
    if (!entity.render) continue;
    if (entity.render.type === "asset") {
      for (const { mesh } of entity.render.meshInstances) {
        for (let i = 0; i < mesh.positions.length; i += 3) vertices.push(worldPoint(entity, mesh.positions.slice(i, i + 3)));
      }
    } else {
      // Conservative bounds also cover the rounded sphere/cylinder primitives.
      for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) vertices.push(worldPoint(entity, [x, y, z]));
    }
  }
  return vertices;
}
function palette() {
  const cache = new Map();
  return { get(name) { if (!cache.has(name)) cache.set(name, { name, destroyed: false }); return cache.get(name); }, cache };
}
function rig(materials = palette()) {
  const root = new pc.Entity("room");
  const result = createPersonalRoomShell(root, { materials });
  return { root, result, materials };
}

test("curtains have curved finite double-sided geometry within a small triangle budget", () => {
  for (const side of [-1, 1]) {
    const geometry = buildPersonalRoomCurtainGeometry({ side });
    const { positions, normals, indices, uvs } = geometry;
    assert.equal(positions.length, 594 * 3);
    assert.equal(normals.length, positions.length);
    assert.equal(uvs.length, 594 * 2);
    assert.equal(indices.length / 3, 1024);
    assert.ok([...positions, ...normals, ...uvs].every(Number.isFinite));
    assert.ok(indices.every(i => Number.isInteger(i) && i >= 0 && i < 594));
    for (let i = 0; i < normals.length; i += 3) assert.ok(close(Math.hypot(...normals.slice(i, i + 3)), 1));
    const z = positions.filter((_, i) => i % 3 === 2);
    assert.ok(Math.max(...z) - Math.min(...z) > .055, "folds must have real depth");
    assert.ok(Math.max(...z) - Math.min(...z) < .07, "drape must stay shallow");
    for (let i = 0; i < 297 * 3; i++) {
      assert.equal(positions[i], positions[i + 297 * 3]);
      assert.equal(normals[i], -normals[i + 297 * 3]);
    }
    for (let i = 0; i < indices.length; i += 3) {
      const [a, b, c] = indices.slice(i, i + 3).map(n => positions.slice(n * 3, n * 3 + 3));
      const ab = b.map((v, j) => v - a[j]), ac = c.map((v, j) => v - a[j]);
      const cross = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]];
      const normal = normals.slice(indices[i] * 3, indices[i] * 3 + 3);
      assert.ok(cross.reduce((sum, v, j) => sum + v * normal[j], 0) > 0, "triangle winding follows surface normals");
    }
  }
});

test("C70 floor seam, bounds and authoritative collisions remain unchanged", () => {
  const before = JSON.stringify({ obstacles: PERSONAL_ROOM_BASIC_OBSTACLES, bounds: PERSONAL_ROOM_BASIC_BOUNDS });
  const { root, result } = rig();
  const { halfWidth: W, halfDepth: D, wall: T } = PERSONAL_ROOM_BASIC;
  assert.equal(result.floor, find(root, "floor"));
  assert.deepEqual(result.floor.position, [0, -.05, 0]);
  assert.deepEqual(result.floor.scale, [2 * W + 2 * T, .1, 2 * D + 2 * T]);
  assert.match(result.floor.render.material.name, /b99168/);
  assert.ok(all(root).every(x => !x.collision && !x.rigidbody));
  assert.equal(JSON.stringify({ obstacles: PERSONAL_ROOM_BASIC_OBSTACLES, bounds: PERSONAL_ROOM_BASIC_BOUNDS }), before);
  assert.ok(PERSONAL_ROOM_BASIC_OBSTACLES.some(x => x.id === "personal_wall_north" && x.minZ === D));
  root.destroy();
});

test("north visual wall surrounds the inset opening without blocking it", () => {
  const { root } = rig();
  const { halfWidth: W, wall: T, ceiling: H } = PERSONAL_ROOM_BASIC;
  const { x, bottom, width, height } = PERSONAL_ROOM_WINDOW;
  const parts = find(root, "wall_north").children;
  assert.equal(parts.length, 4);
  for (let px = -W - T + .023; px < W + T; px += .097) {
    for (let py = .017; py < H; py += .073) {
      const covering = parts.filter(e => px >= e.position[0] - e.scale[0] / 2 && px <= e.position[0] + e.scale[0] / 2 && py >= e.position[1] - e.scale[1] / 2 && py <= e.position[1] + e.scale[1] / 2);
      const opening = px > x - width / 2 && px < x + width / 2 && py > bottom && py < bottom + height;
      assert.equal(covering.length, opening ? 0 : 1, `north wall coverage at ${px}, ${py}`);
    }
  }
  root.destroy();
});

test("glass and exterior have distinct depth; all window geometry stays within wall clearance", () => {
  const { root, result } = rig();
  const D = PERSONAL_ROOM_BASIC.halfDepth;
  assert.ok(find(root, "window_exterior_sky").position[2] > find(root, "window_glass_1").position[2]);
  assert.ok(find(root, "window_glass_1").position[2] > find(root, "window_mullion").position[2]);
  assert.equal(result.window.panels.length, 2);
  for (const entity of all(result.window.root)) {
    let z = 0;
    for (let e = entity; e !== result.window.root && e; e = e.parent) z += e.position[2];
    if (entity.render?.type === "asset") {
      for (const mesh of meshes(entity)) {
        for (let i = 2; i < mesh.positions.length; i += 3) assert.ok(z + mesh.positions[i] >= D - .15);
      }
    } else if (entity.render) {
      assert.ok(z - entity.scale[2] / 2 >= D - .15, `${entity.name} intrudes into editable floor`);
      assert.ok(z + entity.scale[2] / 2 <= D + PERSONAL_ROOM_BASIC.wall + 1e-8, `${entity.name} exceeds wall depth`);
    }
  }
  assert.equal(meshes(root).reduce((n, mesh) => n + mesh.indices.length / 3, 0), 2304);
  root.destroy();
});

test("curtain meshes release exactly once; supplied materials remain externally owned", () => {
  const shared = palette();
  const first = rig(shared), second = rig(shared);
  const firstMeshes = meshes(first.root), secondMeshes = meshes(second.root);
  assert.equal(firstMeshes.length, 4);
  first.root.destroy();
  first.root.destroy();
  assert.ok(firstMeshes.every(x => x.destroyCount === 1));
  assert.ok(secondMeshes.every(x => !x.destroyed));
  assert.ok([...shared.cache.values()].every(x => !x.destroyed));
  second.root.destroy();
  assert.ok(secondMeshes.every(x => x.destroyCount === 1));
});

test("entire window treatment and fallback stay inside the existing north-wall reservation", () => {
  for (const failure of [0, 1]) {
    pc.failMeshAt(failure);
    const { root, result } = rig();
    const points = visualVertices(result.window.root);
    const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
    assert.ok(minX >= -.8, `left treatment bound ${minX} exceeds H2 reservation`);
    assert.ok(maxX <= 1.8, `right treatment bound ${maxX} exceeds H2 reservation`);
    assert.ok(close(minX, -.7715));
    assert.ok(close(maxX, 1.7715));
    root.destroy();
    pc.failMeshAt(0);
  }
});

test("valid owned posters beside both sides of the reservation never overlap window treatment", () => {
  const { root, result } = rig();
  const points = visualVertices(result.window.root);
  const minX = Math.min(...points.map(p => p[0])), maxX = Math.max(...points.map(p => p[0]));
  const id = "11111111-1111-4111-8111-111111111111";
  const owned = ROOM_FURNITURE.map(item => ({ itemId: item.itemId, quantity: 1 }));
  for (const x of [-1.25, 2.25]) {
    const poster = { id, itemId: "furniture.campus_map_poster", surface: "north", ...positionOnSurface("north", x, 0) };
    assert.equal(validateFurniture([poster], owned), null, `existing adjacent poster at x=${x} remains valid`);
    const bounds = furnitureBox(poster);
    assert.ok(bounds.maxX < minX || bounds.minX > maxX, `adjacent poster at x=${x} intersects window treatment`);
  }
  // Include every accepted grid anchor for all current north-wall item types.
  let accepted = 0;
  for (const item of ROOM_FURNITURE.filter(item => item.surfaces.includes("north"))) {
    for (let x = -5; x <= 5; x += .25) {
      const object = { id, itemId: item.itemId, surface: "north", ...positionOnSurface("north", x, 0) };
      if (validateFurniture([object], owned) !== null) continue;
      const bounds = furnitureBox(object);
      assert.ok(bounds.maxX < minX || bounds.minX > maxX, `${item.itemId} at x=${x} intersects window treatment`);
      accepted++;
    }
  }
  assert.ok(accepted > 50);
  root.destroy();
});

test("missing optional curtain geometry falls back after cleaning partial allocations", () => {
  // Fail once before allocation, then once after main cloth but before its hem.
  for (const failAt of [1, 2]) {
    pc.failMeshAt(failAt);
    const start = pc.allocatedMeshes.length;
    const { root, result } = rig();
    const panel = result.window.panels[0];
    assert.equal(panel.children.length, 8);
    assert.ok(panel.children.every(x => x.name.includes("fallback_pleat")));
    assert.equal(all(panel).filter(x => x.name.endsWith("_fabric")).length, 0);
    const allocated = pc.allocatedMeshes.slice(start);
    if (failAt === 2) assert.equal(allocated[0].destroyCount, 1, "partially created cloth released before fallback");
    root.destroy();
    assert.ok(allocated.every(x => x.destroyCount === 1));
    pc.failMeshAt(0);
  }
});

test("twenty shell create/destroy cycles leave no custom meshes or detached scene entities", () => {
  const appRoot = new pc.Entity("app");
  const start = pc.allocatedMeshes.length;
  for (let i = 0; i < 20; i++) {
    const root = new pc.Entity("room");
    appRoot.addChild(root);
    createPersonalRoomShell(root);
    assert.equal(appRoot.children.length, 1);
    root.destroy();
    assert.equal(appRoot.children.length, 0);
  }
  assert.ok(pc.allocatedMeshes.slice(start).every(x => x.destroyCount === 1));
});

test("shell/window modules contain no persistence, input, lighting controls or external asset request", () => {
  for (const name of ["personal-room-shell-renderer", "personal-room-window"]) {
    const source = readFileSync(new URL(`../src/rooms/${name}.js`, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\.rpc\(|fetch\(|loadFromUrl|localStorage|addEventListener|setInterval|new pc\.StandardMaterial|addComponent\(["'](?:collision|rigidbody|camera|light)/);
  }
});
