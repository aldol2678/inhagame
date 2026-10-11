// PERSONAL-ROOM-V2 PR A · fixed, open window treatment. No input, time or save state.
// The shared material factory owns materials; each procedural curtain owns its mesh.

import * as pc from "playcanvas";
import { box } from "../campus-render-kit.js";
import { PERSONAL_ROOM_BASIC } from "./personal-room-layout.js";

// The complete treatment (including finials) must remain in H2's existing
// north-wall reservation x=[-.8, 1.8]; otherwise saved posters can intersect it.
export const PERSONAL_ROOM_WINDOW = Object.freeze({ x: .5, bottom: .72, width: 1.8, height: 1.08 });

// A small draped surface has continuous fold normals instead of stacked rigid boxes.
// Both sides are explicit so the material can stay shared and normally back-culled.
export function buildPersonalRoomCurtainGeometry({ width = .62, height = 1.3, segments = 32, rows = 8, side = 1, vStart = 0, vEnd = 1 } = {}) {
  const positions = [], normals = [], uvs = [], indices = [];
  const point = (u, v) => {
    const spread = .87 + .13 * v;
    const phase = u * Math.PI * 10 + .14 * Math.sin(v * Math.PI);
    return [
      (u - .5) * width * spread + side * .018 * Math.sin(v * Math.PI),
      -height * v + .008 * Math.cos(u * Math.PI * 10) * v ** 6,
      .031 * Math.cos(phase) * (.72 + .28 * v) + .005 * Math.sin(v * Math.PI)
    ];
  };
  for (let y = 0; y <= rows; y++) {
    const v = vStart + y / rows * (vEnd - vStart);
    for (let x = 0; x <= segments; x++) {
      const u = x / segments, p = point(u, v), a = point(u + .0001, v), b = point(u, v + .0001);
      const ux = a[0] - p[0], uy = a[1] - p[1], uz = a[2] - p[2];
      const vx = b[0] - p[0], vy = b[1] - p[1], vz = b[2] - p[2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const length = Math.hypot(nx, ny, nz);
      positions.push(...p);
      normals.push(nx / length, ny / length, nz / length);
      uvs.push(u, 1 - v);
    }
  }
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < segments; x++) {
      const a = y * (segments + 1) + x, b = a + 1, c = a + segments + 1, d = c + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const vertices = positions.length / 3, frontIndices = indices.slice();
  positions.push(...positions.slice());
  normals.push(...normals.map(n => -n));
  uvs.push(...uvs.slice());
  for (let i = 0; i < frontIndices.length; i += 3) {
    indices.push(frontIndices[i] + vertices, frontIndices[i + 2] + vertices, frontIndices[i + 1] + vertices);
  }
  return { positions, normals, uvs, indices };
}

function curtain(root, name, position, materials, side) {
  const panel = new pc.Entity(name);
  panel.setLocalPosition(...position);
  root.addChild(panel);
  const detail = new pc.Entity(`${name}_fabric`);
  try {
    const data = buildPersonalRoomCurtainGeometry({ side });
    const device = pc.Application.getApplication()?.graphicsDevice;
    if (!device) throw new Error("Room curtain graphics device unavailable");
    const mesh = pc.createMesh(device, data.positions, { normals: data.normals, uvs: data.uvs, indices: data.indices });
    detail.once("destroy", () => mesh.destroy());
    detail.addComponent("render", { type: "asset", meshInstances: [new pc.MeshInstance(mesh, materials.get("curtain"))], castShadows: true });
    // Crop the same draped surface for a sewn hem, preserving every fold and curve.
    const hemData = buildPersonalRoomCurtainGeometry({ rows: 1, side, vStart: .978 });
    const hemMesh = pc.createMesh(device, hemData.positions, { normals: hemData.normals, uvs: hemData.uvs, indices: hemData.indices });
    detail.once("destroy", () => hemMesh.destroy());
    const hem = new pc.Entity(`${name}_hem`);
    detail.addChild(hem);
    hem.addComponent("render", { type: "asset", meshInstances: [new pc.MeshInstance(hemMesh, materials.get("curtainHem"))], castShadows: false });
    hem.setLocalPosition(0, 0, -.001);
    panel.addChild(detail);
  } catch {
    // Optional procedural geometry must never block room entry. Destroy partial
    // resources before exposing a simple pleated fallback with the same footprint.
    detail.destroy();
    for (let i = 0; i < 8; i++) {
      box(panel, `${name}_fallback_pleat_${i}`, [(i - 3.5) * .071, -.65, (i % 2 ? 1 : -1) * .017], [.084, 1.3, .023], materials.get("curtain"), (i % 2 ? 1 : -1) * 14);
    }
  }
  return panel;
}

export function createPersonalRoomWindow(root, { materials }) {
  const { halfDepth: D, wall: T } = PERSONAL_ROOM_BASIC;
  const { x, bottom, width, height } = PERSONAL_ROOM_WINDOW;
  const top = bottom + height, center = bottom + height / 2;
  const group = new pc.Entity("personal_window");
  root.addChild(group);
  const frame = materials.get("windowFrame");
  const oak = materials.get("oak");

  // Recess, sky, silhouettes, glass and frame occupy distinct depth layers, all
  // inside the pre-existing wall. Outside-view art is deliberately room-local.
  box(group, "window_exterior_sky", [x, center, D + T - .017], [width, height, .014], materials.get("exteriorSky"));
  box(group, "window_exterior_haze", [x, bottom + .17, D + T - .043], [width, .34, .012], materials.get("exteriorHaze"));
  const viewScale = width / 3.4;
  for (const [dx, w, h] of [[-1.1, .56, .21], [-.25, .43, .29], [.55, .7, .18], [1.22, .32, .24]]) {
    box(group, `window_distant_canopy_${dx}`, [x + dx * viewScale, bottom + .065, D + T - .08], [w * viewScale, h, .035], materials.get("exteriorFoliage"), 0, "sphere");
  }
  for (const side of [-1, 1]) {
    box(group, `window_reveal_${side}`, [x + side * (width / 2 - .027), center, D + T / 2], [.054, height, T], frame);
  }
  box(group, "window_reveal_top", [x, top - .027, D + T / 2], [width, .054, T], frame);
  box(group, "window_reveal_bottom", [x, bottom + .027, D + T / 2], [width, .054, T], frame);

  const paneWidth = (width - .24) / 2, paneHeight = height - .16;
  for (const side of [-1, 1]) {
    const paneX = x + side * (paneWidth / 2 + .022);
    box(group, `window_glass_${side}`, [paneX, center, D + .12], [paneWidth, paneHeight, .008], materials.get("windowGlass"));
  }
  box(group, "window_frame_top", [x, top - .025, D + .018], [width + .09, .09, .1], frame);
  box(group, "window_frame_bottom", [x, bottom + .025, D + .018], [width + .09, .09, .1], frame);
  for (const side of [-1, 1]) {
    box(group, `window_frame_${side}`, [x + side * width / 2, center, D + .018], [.09, height, .1], frame);
  }
  box(group, "window_mullion", [x, center, D + .062], [.06, height - .12, .075], frame);
  box(group, "window_latch", [x - .052, center - .02, D + .005], [.026, .095, .027], materials.get("metal"));
  box(group, "window_sill", [x, bottom - .025, D + .025], [width + .21, .055, .27], oak);
  box(group, "window_sill_apron", [x, bottom - .077, D - .014], [width + .1, .065, .03], frame);

  const rail = box(group, "curtain_rail", [x, top + .155, D - .07], [.023, width + .68, .023], materials.get("metal"), 0, "cylinder");
  rail.setLocalEulerAngles(0, 0, 90);
  const panels = [];
  for (const side of [-1, 1]) {
    const panelX = x + side * (width / 2 + .015);
    box(group, `curtain_rail_finial_${side}`, [x + side * (width / 2 + .35), top + .155, D - .07], [.043, .043, .043], materials.get("metal"), 0, "sphere");
    box(group, `curtain_rail_bracket_${side}`, [x + side * (width / 2 + .25), top + .135, D - .034], [.03, .055, .09], frame);
    panels.push(curtain(group, `curtain_open_${side}`, [panelX, top + .107, D - .082], materials, side));
    // Five small fabric loops make the connection to the rail readable.
    for (let i = 0; i < 5; i++) {
      box(group, `curtain_loop_${side}_${i}`, [panelX + (i - 2) * .11, top + .13, D - .075], [.02, .055, .026], materials.get("curtainHem"));
    }
  }
  return Object.freeze({ root: group, panels: Object.freeze(panels) });
}
