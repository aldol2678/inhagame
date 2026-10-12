// JSL-B · PlayCanvas scenes for the Jeongseok 1F lobby and the two B1 spaces.
//
// Built lazily on first entry and released when the player is back on campus. Static geometry is
// merged per material (static-batch.js); only the visual-only gate flaps stay separate entities so
// they can swing. Lights: two non-shadowing omni lights per room plus emissive panels, so the
// interiors add no shadow maps and no per-fixture dynamic lights. Colours and shapes are our own;
// no photo, logo, book cover, exhibition image or real ID/QR is used. Roots mirror Z like every
// other room (scale z = −1) and are siblings of the campus root.

import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { createStaticBatch } from "./static-batch.js";
import { createJeongseokLobbyCollision } from "./lobby-layout.js";
import { PORTAL_WALL_INSET } from "./interior-kit.js";
import { JEONGSEOK_LAYOUTS, JEONGSEOK_LOBBY_ROOM_ID, JEONGSEOK_B1_READING_ROOM_ID, JEONGSEOK_B1_CREATIVE_ROOM_ID } from "./interior-rooms.js";

const glowCache = new Map();
function glow(hex, intensity = 1) {
  const key = `${hex}:${intensity}`;
  if (glowCache.has(key)) return glowCache.get(key);
  const n = parseInt(hex.slice(1), 16);
  const c = new pc.Color((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
  const m = new pc.StandardMaterial();
  m.name = `jeongseok-glow:${key}`;
  m.diffuse = c; m.emissive = c; m.emissiveIntensity = intensity; m.update();
  glowCache.set(key, m);
  return m;
}
const glassCache = new Map();
function glass(hex, opacity = 0.35) {
  const key = `${hex}:${opacity}`;
  if (glassCache.has(key)) return glassCache.get(key);
  const n = parseInt(hex.slice(1), 16);
  const m = new pc.StandardMaterial();
  m.name = `jeongseok-glass:${key}`;
  m.diffuse = new pc.Color((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
  m.specular = new pc.Color(0.6, 0.7, 0.78); m.gloss = 0.85;
  m.emissive = m.diffuse.clone(); m.emissiveIntensity = 0.18;
  m.opacity = opacity; m.blendType = pc.BLEND_NORMAL; m.depthWrite = false; m.cull = pc.CULLFACE_NONE;
  m.update();
  glassCache.set(key, m);
  return m;
}
let polishedTile = null;
function polished() {
  if (polishedTile) return polishedTile;
  polishedTile = new pc.StandardMaterial();
  polishedTile.name = "jeongseok-polished-grey-tile";
  polishedTile.diffuse = new pc.Color(0.80, 0.81, 0.82);
  polishedTile.specular = new pc.Color(0.3, 0.31, 0.32); polishedTile.gloss = 0.66;
  polishedTile.update();
  return polishedTile;
}

const M = {
  wallLight: () => surface("#e4e2d8", "concrete"),
  column: () => surface("#a7aaa2", "concrete"),
  ceiling: () => surface("#f0eee4", "concrete"),
  metal: () => surface("#a6aaa0", "metal"),
  darkMetal: () => surface("#505b5b", "metal"),
  steel: () => surface("#727674", "metal"),
  wood: () => surface("#93765e", "wood"),
  lightWood: () => surface("#c9a77c", "wood"),
  darkWood: () => surface("#6c5942", "wood"),
  white: () => surface("#f4f3ee", "paint"),
  laminate: () => surface("#e6e1d6", "paint"),
  chair: () => surface("#55616c", "neutral"),
  mesh: () => surface("#2f3335", "rubber"),
  soil: () => surface("#4a3b2c", "ground"),
  planter: () => surface("#7d8280", "concrete"),
  foliage: () => surface("#527745", "foliage"),
  foliageLight: () => surface("#65894b", "foliage"),
  navy: () => surface("#1f2f4f", "paint"),
  carpet: () => surface("#3d4863", "neutral"),
  darkCeiling: () => surface("#2b2f33", "paint"),
  fabric: () => surface("#5f7d6e", "neutral"),
  sign: () => surface("#2b3a4a", "paint")
};

// ---------------------------------------------------------------- shared shell
function shell(b, shellDef, { floor, walls, ceiling }) {
  const { halfWidth: W, halfDepth: D, ceiling: H, wall: T } = shellDef;
  b.box(floor, [0, -0.05, 0], [2 * W + 2 * T, 0.1, 2 * D + 2 * T]);
  b.box(ceiling, [0, H + 0.25, 0], [2 * W + 2 * T, 0.5, 2 * D + 2 * T]);
  b.box(walls.north ?? walls.all, [0, H / 2, D + T / 2], [2 * W + 2 * T, H, T]);
  b.box(walls.south ?? walls.all, [0, H / 2, -D - T / 2], [2 * W + 2 * T, H, T]);
  b.box(walls.west ?? walls.all, [-W - T / 2, H / 2, 0], [T, H, 2 * D]);
  b.box(walls.east ?? walls.all, [W + T / 2, H / 2, 0], [T, H, 2 * D]);
  // Skirting keeps wall/floor contact readable on low tiers without shadows.
  b.box(M.darkMetal(), [0, 0.04, D - 0.01], [2 * W, 0.08, 0.02]);
  b.box(M.darkMetal(), [0, 0.04, -D + 0.01], [2 * W, 0.08, 0.02]);
  b.box(M.darkMetal(), [-W + 0.01, 0.04, 0], [0.02, 0.08, 2 * D]);
  b.box(M.darkMetal(), [W - 0.01, 0.04, 0], [0.02, 0.08, 2 * D]);
}

function floorGrid(b, material, W, D, step) {
  for (let x = -W + step; x < W; x += step) b.box(material, [x, 0.003, 0], [0.02, 0.006, 2 * D]);
  for (let z = -D + step; z < D; z += step) b.box(material, [0, 0.003, z], [2 * W, 0.006, 0.02]);
}

// Interior roots mirror Z (scale z = −1), so a plate that faces +z must mirror its glyph along x
// to read correctly; plates facing −z do not.
const glyphMirror = depthSign => depthSign > 0 ? -1 : 1;

// A "2" plate made of seven-segment strokes: identifies the reading room without real text/logo.
function digitTwo(b, material, [cx, cy, cz], height, depthSign = 1) {
  const w = height * 0.55, t = height * 0.12, h2 = height / 2, m = glyphMirror(depthSign);
  const z = cz + depthSign * 0.02;
  b.box(material, [cx, cy + h2 - t / 2, z], [w, t, 0.02]);
  b.box(material, [cx + m * (w / 2 - t / 2), cy + h2 / 2, z], [t, h2, 0.02]);
  b.box(material, [cx, cy, z], [w, t, 0.02]);
  b.box(material, [cx - m * (w / 2 - t / 2), cy - h2 / 2, z], [t, h2, 0.02]);
  b.box(material, [cx, cy - h2 + t / 2, z], [w, t, 0.02]);
}

// dir 1 points down, -1 points up: a shaft plus a stepped triangular head (wall-plane boxes only).
function downArrow(b, material, [cx, cy, cz], size, depthSign = 1, dir = 1) {
  const z = cz + depthSign * 0.02;
  b.box(material, [cx, cy + dir * size * 0.18, z], [size * 0.14, size * 0.42, 0.02]);
  for (let k = 0; k < 4; k += 1) {
    const w = size * (0.62 - k * 0.15);
    b.box(material, [cx, cy - dir * (size * 0.04 + k * size * 0.07), z], [Math.max(size * 0.06, w), size * 0.07, 0.02]);
  }
}

// A temporary transfer marker: dashed amber frame + floor pad, deliberately not a stair or lift.
function portalMarker(b, portal, wallSide, { label = "B1", arrow = "down", H, pad: showPad = true }) {
  const { x, z } = portal.position;
  const amber = glow("#ffbf47", 0.7), pad = glow("#ffcf6a", 0.35);
  const inset = PORTAL_WALL_INSET - 0.02;
  const wallZ = wallSide === "north" ? z + inset : wallSide === "south" ? z - inset : z;
  const wallX = wallSide === "east" ? x + inset : wallSide === "west" ? x - inset : x;
  const alongX = wallSide === "north" || wallSide === "south";
  const sign = wallSide === "north" || wallSide === "east" ? -1 : 1;
  if (showPad) b.box(pad, [x, 0.008, z], alongX ? [1.6, 0.012, 0.9] : [0.9, 0.012, 1.6]);
  const frameH = Math.min(1.45, H - 0.15);
  for (let i = 0; i < 5; i += 1) {
    const y = 0.15 + i * frameH / 5;
    if (alongX) { b.box(amber, [x - 0.85, y, wallZ], [0.07, frameH / 5 * 0.6, 0.04]); b.box(amber, [x + 0.85, y, wallZ], [0.07, frameH / 5 * 0.6, 0.04]); }
    else { b.box(amber, [wallX, y, z - 0.85], [0.04, frameH / 5 * 0.6, 0.07]); b.box(amber, [wallX, y, z + 0.85], [0.04, frameH / 5 * 0.6, 0.07]); }
  }
  if (alongX) b.box(M.sign(), [x, frameH * 0.62, wallZ], [1.2, 0.62, 0.03]);
  else b.box(M.sign(), [wallX, frameH * 0.62, z], [0.03, 0.62, 1.2]);
  const white = glow("#f6f8fb", 0.9);
  if (alongX) {
    const m = glyphMirror(sign), gz = wallZ + sign * 0.02, gy = frameH * 0.62;
    if (label === "B1") { // "B" as a stem and two bowls, then a stroke for "1"
      b.box(white, [x - m * 0.28, gy, gz], [0.06, 0.4, 0.02]);
      b.box(white, [x - m * 0.18, gy + 0.1, gz], [0.18, 0.16, 0.02]);
      b.box(white, [x - m * 0.18, gy - 0.1, gz], [0.2, 0.17, 0.02]);
      b.box(white, [x + m * 0.05, gy, gz], [0.06, 0.4, 0.02]);
    } else { // "1F": a stroke, then a stem with two bars
      b.box(white, [x - m * 0.26, gy, gz], [0.06, 0.4, 0.02]);
      b.box(white, [x - m * 0.08, gy, gz], [0.06, 0.4, 0.02]);
      b.box(white, [x + m * 0.0, gy + 0.17, gz], [0.16, 0.06, 0.02]);
      b.box(white, [x - m * 0.02, gy + 0.02, gz], [0.12, 0.06, 0.02]);
    }
    downArrow(b, white, [x + m * 0.34, gy, wallZ], 0.42, sign, arrow === "up" ? -1 : 1);
  } else {
    // Symmetric two-way arrow for the B1 temporary link (reads the same from either mirror).
    const gx = wallX + sign * 0.02, gy = frameH * 0.62;
    b.box(white, [gx, gy, z], [0.02, 0.08, 0.7]);
    for (const end of [-1, 1]) for (let k = 0; k < 3; k += 1)
      b.box(white, [gx, gy, z + end * (0.3 - k * 0.06)], [0.02, 0.1 + k * 0.08, 0.06]);
  }
}

function doorway(b, x, z, width, height, sign) {
  b.box(M.darkMetal(), [x, height + 0.04, z], [width + 0.2, 0.08, 0.06]);
  b.box(M.darkMetal(), [x - width / 2 - 0.05, height / 2, z], [0.08, height, 0.06]);
  b.box(M.darkMetal(), [x + width / 2 + 0.05, height / 2, z], [0.08, height, 0.06]);
  b.box(glass("#bfe3f2", 0.45), [x, height / 2, z + sign * 0.01], [width, height, 0.03]);
  b.box(M.darkMetal(), [x, height / 2, z + sign * 0.01], [0.04, height, 0.035]);
}

function chair(b, entry, material = M.chair()) {
  const [x, , z] = entry.at;
  const yaw = entry.facing ?? 0;
  const back = (dx, dz) => { const r = yaw * Math.PI / 180; return [x + dx * Math.cos(r) + dz * Math.sin(r), z - dx * Math.sin(r) + dz * Math.cos(r)]; };
  b.box(material, [x, 0.23, z], [0.32, 0.04, 0.32], yaw);
  const [bx, bz] = back(0, -0.15);
  b.box(material, [bx, 0.38, bz], [0.32, 0.28, 0.04], yaw);
  b.box(M.steel(), [x, 0.11, z], [0.04, 0.22, 0.04], yaw);
  b.box(M.steel(), [x, 0.015, z], [0.26, 0.03, 0.26], yaw);
}

function table(b, entry, top = M.laminate(), legs = M.steel()) {
  const [x, , z] = entry.at, [w, h, d] = entry.size;
  b.box(top, [x, h - 0.02, z], [w, 0.04, d]);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(legs, [x + sx * (w / 2 - 0.07), (h - 0.04) / 2, z + sz * (d / 2 - 0.07)], [0.05, h - 0.04, 0.05]);
}

// ---------------------------------------------------------------- module renderers
const MODULES = {
  gate_cabinet(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.metal(), [x, h / 2, z], [w, h, d]);
    b.box(M.darkMetal(), [x, h + 0.015, z], [w + 0.02, 0.03, d + 0.02]);
    b.box(glow("#3ddc84", 0.8), [x, h + 0.035, z - d / 2 + 0.12], [w * 0.7, 0.01, 0.12]);
    b.box(M.darkMetal(), [x, h - 0.08, z - d / 2 + 0.25], [w + 0.01, 0.06, 0.18]); // reader pad, no real card or QR
  },
  glass_barrier(b, e) {
    const [x, , z] = e.at, [w, h] = e.size;
    b.box(glass("#cfe8f5", 0.4), [x, h / 2 + 0.05, z], [w, h - 0.1, 0.03]);
    b.box(M.steel(), [x, h, z], [w, 0.04, 0.05]);
    for (let i = 0; i <= Math.max(1, Math.round(w / 1.2)); i += 1) {
      const px = x - w / 2 + i * w / Math.max(1, Math.round(w / 1.2));
      b.box(M.steel(), [px, h / 2, z], [0.05, h, 0.05]);
    }
  },
  overhead_sign(b, e) {
    const [x, y, z] = e.at, [w, h, d] = e.size;
    b.box(M.sign(), [x, y + h / 2, z], [w, h, d]);
    b.box(glow("#e9f1f8", 0.75), [x, y + h / 2, z - d / 2 - 0.005], [w - 0.2, 0.05, 0.01]);
    for (const sx of [-1, 1]) b.box(M.steel(), [x + sx * (w / 2 - 0.3), y + h + 0.6, z], [0.03, 1.2, 0.03]);
    // Abstract arrows only.
    for (const dx of [-1.4, 0, 1.4]) downArrow(b, glow("#e9f1f8", 0.75), [x + dx, y + h / 2 + 0.02, z - d / 2], 0.18, -1);
  },
  guide_npc(b, e) {
    // Original stylized game guide, with no school insignia or real employee likeness.
    const [x, y, z] = e.at;
    b.sphere(M.laminate(), [x, y + 0.78, z], 0.16);
    b.box(M.navy(), [x, y + 0.48, z], [0.34, 0.36, 0.22]);
    for (const side of [-1, 1]) {
      b.box(M.darkMetal(), [x + side * 0.10, y + 0.16, z], [0.12, 0.28, 0.15]);
      b.box(M.navy(), [x + side * 0.23, y + 0.47, z], [0.10, 0.30, 0.12]);
    }
    b.box(glow("#a5e4e8", 0.4), [x, y + 0.48, z - 0.12], [0.12, 0.09, 0.02]);
  },
  info_desk(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.wood(), [x, h / 2, z], [w, h, d]);
    b.box(M.white(), [x, h + 0.025, z], [w + 0.1, 0.05, d + 0.06]);
    b.box(M.mesh(), [x - 0.6, h + 0.2, z + 0.15], [0.45, 0.3, 0.04]);
    b.box(M.mesh(), [x + 0.6, h + 0.2, z + 0.15], [0.45, 0.3, 0.04]);
    b.box(glow("#9cc7e8", 0.5), [x, h * 0.55, z - d / 2 - 0.005], [w * 0.8, 0.05, 0.01]);
  },
  search_kiosk(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.white(), [x, h / 2, z], [w, h, d * 0.6]);
    b.box(M.darkMetal(), [x, h + 0.16, z - 0.04], [w, 0.34, 0.08]);
    b.box(glow("#5aa9e6", 0.9), [x, h + 0.16, z - 0.085], [w - 0.08, 0.28, 0.01]);
    b.box(M.darkMetal(), [x, h + 0.01, z - 0.08], [w * 0.8, 0.02, 0.18]);
  },
  column_square(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.column(), [x, h / 2, z], [w, h, d]);
    b.box(M.darkMetal(), [x, 0.06, z], [w + 0.04, 0.12, d + 0.04]);
  },
  planter(b, e, detail) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.planter(), [x, h / 2, z], [w, h, d]);
    b.box(M.soil(), [x, h + 0.01, z], [w - 0.12, 0.02, d - 0.12]);
    const count = Math.max(1, Math.round(w / 0.7));
    for (let i = 0; i < count; i += 1) {
      const px = x - w / 2 + (i + 0.5) * w / count;
      b.sphere(i % 2 ? M.foliage() : M.foliageLight(), [px, h + 0.32, z], Math.min(0.36, d * 0.34));
      if (detail !== "low") b.sphere(M.foliage(), [px + 0.12, h + 0.62, z - 0.05], 0.2, 4, 6);
    }
  },
  bench(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.lightWood(), [x, h - 0.04, z], [w, 0.08, d]);
    for (const s of [-1, 1]) b.box(M.steel(), [x, (h - 0.08) / 2, z + s * (d / 2 - 0.15)], [w - 0.1, h - 0.08, 0.05]);
  },
  bookshelf(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    const alongZ = d > w;
    b.box(M.wood(), [x, h / 2, z], [w, h, d]);
    const colors = ["#7d8b99", "#a39074", "#6f8070", "#b39a85", "#8c7f99"];
    for (let shelf = 0; shelf < 3; shelf += 1) {
      const y = 0.12 + shelf * (h - 0.15) / 3;
      const len = alongZ ? d : w;
      for (let k = 0; k < 8; k += 1) {
        const t = -len / 2 + 0.15 + k * (len - 0.3) / 8;
        const mat = surface(colors[(k + shelf) % colors.length], "paint");
        const bh = 0.22 + (k % 3) * 0.03;
        if (alongZ) b.box(mat, [x + w / 2 - 0.12, y + bh / 2, z + t + 0.1], [0.2, bh, 0.14]);
        else b.box(mat, [x + t + 0.1, y + bh / 2, z - d / 2 + 0.12], [0.14, bh, 0.2]);
      }
    }
  },
  guide_board(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.sign(), [x, h * 0.6, z], [w, h * 0.7, d]);
    for (const [dx, dy, c] of [[-0.3, 0.15, "#ffbf47"], [0, 0.15, "#5aa9e6"], [0.3, 0.15, "#3ddc84"], [-0.15, -0.12, "#e9f1f8"], [0.15, -0.12, "#e9f1f8"]])
      b.box(glow(c, 0.7), [x + dx, h * 0.6 + dy, z - d / 2 - 0.005], [0.18, 0.14, 0.01]);
    b.box(M.steel(), [x, h * 0.12, z], [0.06, h * 0.25, 0.06]);
    b.box(M.steel(), [x, 0.02, z], [0.5, 0.04, 0.3]);
  },
  column_wood(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.wood(), [x, h / 2, z], [w, h, d]);
    for (let i = 1; i < 4; i += 1) b.box(M.darkWood(), [x, i * h / 4, z], [w + 0.01, 0.015, d + 0.01]);
  },
  open_table(b, e) { table(b, e); },
  meeting_table(b, e) { table(b, e, M.white(), M.steel()); },
  chair(b, e) { chair(b, e); },
  mesh_chair(b, e) { chair(b, e, M.mesh()); },
  carrel_row(b, e) {
    const [x, , z] = e.at, [w, , d] = e.size;
    const deskH = 0.38, partTop = e.size[1];
    b.box(M.laminate(), [x, deskH - 0.02, z], [w, 0.04, d]);
    b.box(M.white(), [x, (deskH + partTop) / 2 + 0.02, z + d / 2 - 0.02], [w, partTop - deskH, 0.03]);
    for (let i = 0; i <= e.desks; i += 1) {
      const px = x - w / 2 + i * w / e.desks;
      b.box(M.white(), [px, (deskH + partTop) / 2 + 0.02, z], [0.03, partTop - deskH, d]);
      b.box(M.steel(), [px, deskH / 2, z], [0.04, deskH - 0.04, d - 0.06]);
    }
    for (let i = 0; i < e.desks; i += 1) b.box(glow("#fff4d8", 0.35), [x - w / 2 + (i + 0.5) * w / e.desks, partTop - 0.04, z + d / 2 - 0.05], [0.4, 0.02, 0.04]);
  },
  carrel(b, e) { chair(b, e); },
  standing_counter(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.white(), [x, h / 2 - 0.03, z], [w - 0.1, h - 0.06, d - 0.15]);
    b.box(M.lightWood(), [x, h - 0.02, z], [w, 0.04, d]);
  },
  standing_desk_slot(b, e) { b.box(surface("#9aa3ab", "paint"), [e.at[0], 0.004, e.at[2]], [0.3, 0.008, 0.3]); },
  accessible_desk(b, e) { table(b, e, M.laminate(), M.steel()); },
  accessible_seat(b, e) { b.box(glow("#3b7dd8", 0.35), [e.at[0], 0.004, e.at[2]], [e.size[0], 0.008, e.size[2]]); },
  room_sign_2(b, e) {
    const [x, y, z] = e.at, [w, h, d] = e.size;
    b.box(M.sign(), [x, y + h / 2, z], [w, h, d]);
    digitTwo(b, glow("#f6f8fb", 0.9), [x + w * 0.28, y + h / 2, z + d / 2], h * 0.7, 1);
    b.box(glow("#9cc7e8", 0.7), [x - w * 0.12, y + h / 2, z + d / 2 + 0.01], [w * 0.45, 0.04, 0.02]);
  },
  notice_plate(b, e) {
    const [x, y, z] = e.at, [w, h, d] = e.size;
    b.box(M.white(), [x, y + h / 2, z], [w, h, d]);
    b.box(surface("#55616c", "paint"), [x, y + h / 2, z + d / 2 + 0.005], [w * 0.7, 0.05, 0.01]);
  },
  column_round_slat(b, e, detail) {
    const [x, , z] = e.at, h = e.size[1], r = e.radius;
    b.cylinder(M.darkWood(), [x, h / 2, z], r * 0.82, h, 12);
    const slats = detail === "low" ? 10 : 18;
    for (let i = 0; i < slats; i += 1) {
      const a = i / slats * Math.PI * 2;
      b.box(M.lightWood(), [x + Math.cos(a) * r * 0.9, h / 2, z + Math.sin(a) * r * 0.9], [0.05, h, 0.09], -a * 180 / Math.PI);
    }
  },
  long_table(b, e) {
    table(b, e, M.lightWood(), M.mesh());
    const [x, , z] = e.at, [w, h, d] = e.size;
    const long = Math.max(w, d), alongZ = d > w;
    b.box(M.mesh(), [x, h + 0.02, z], alongZ ? [0.12, 0.04, long - 0.4] : [long - 0.4, 0.04, 0.12]);
    for (let i = 0; i < 6; i += 1) {
      const t = -long / 2 + 0.5 + i * (long - 1.0) / 5;
      b.box(glow("#9cf0c0", 0.6), alongZ ? [x, h + 0.045, z + t] : [x + t, h + 0.045, z], [0.04, 0.01, 0.04]);
    }
  },
  sofa(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.fabric(), [x, h / 2 - 0.05, z], [w, h - 0.1, d]);
    b.box(M.fabric(), [x, h + 0.12, z + d / 2 - 0.1], [w, 0.34, 0.2]);
    for (const s of [-1, 1]) b.box(M.fabric(), [x + s * (w / 2 - 0.08), h + 0.02, z], [0.16, 0.16, d]);
  },
  coffee_table(b, e) { table(b, e, M.lightWood(), M.steel()); },
  round_table(b, e) {
    const [x, , z] = e.at, [w, h] = e.size;
    b.cylinder(M.white(), [x, h - 0.02, z], w / 2, 0.04, 14);
    b.cylinder(M.steel(), [x, (h - 0.04) / 2, z], 0.04, h - 0.04, 6);
  },
  curved_glass(b, e, _detail, H) {
    const [x, , z] = e.at, seg = e.segment;
    b.box(glass("#cfe8f5", 0.32), [x, H / 2, z], [0.03, H, seg.length], seg.yaw);
    b.box(M.darkMetal(), [x, 0.03, z], [0.05, 0.06, seg.length], seg.yaw);
    b.box(M.darkMetal(), [x, H - 0.03, z], [0.05, 0.06, seg.length], seg.yaw);
  },
  glass_wall(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(glass("#d8eef7", 0.3), [x, h / 2, z], [w, h, d]);
    b.box(M.darkMetal(), [x, 0.03, z], [w + 0.01, 0.06, d + 0.01]);
    b.box(M.darkMetal(), [x, h - 0.03, z], [w + 0.01, 0.06, d + 0.01]);
    b.box(surface("#e9eef0", "paint"), [x, h * 0.45, z], [w + 0.012, 0.12, d + 0.012]); // privacy band
  },
  glass_header(b, e) { const [x, y, z] = e.at, [w, h, d] = e.size; b.box(M.darkMetal(), [x, y + h / 2, z], [w, h, d]); },
  room_plate(b, e) { const [x, y, z] = e.at, [w, h, d] = e.size; b.box(M.white(), [x, y, z], [w, h, d]); },
  wall_monitor(b, e) {
    const [x, y, z] = e.at, [w, h, d] = e.size;
    b.box(M.mesh(), [x, y + h / 2, z], [w, h, d]);
    b.box(glow("#4b6f94", 0.45), [x, y + h / 2, z + d / 2 + 0.003], [w - 0.06, h - 0.06, 0.005]);
  },
  tiered_seating(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    const tiers = e.tiers, depth = w / tiers;
    for (let i = 0; i < tiers; i += 1) {
      const tierH = h * (i + 1) / tiers;
      // Tier 0 is nearest the screen (east, +x), each further tier steps up.
      const tx = x + w / 2 - depth * (i + 0.5);
      b.box(M.lightWood(), [tx, tierH / 2, z], [depth, tierH, d]);
      b.box(M.darkWood(), [tx + depth / 2 - 0.02, tierH - 0.01, z], [0.04, 0.02, d]);
      for (let k = 0; k < 5; k += 1) b.box(surface("#c8b48f", "neutral"), [tx, tierH + 0.03, z - d / 2 + 0.7 + k * (d - 1.4) / 4], [depth * 0.6, 0.05, 0.55]);
    }
  },
  lecture_screen(b, e) {
    const [x, y, z] = e.at, [w, h, d] = e.size;
    b.box(M.mesh(), [x, y + h / 2, z], [w, h + 0.1, d + 0.1]);
    b.box(glow("#d9e6f5", 0.8), [x - w / 2 - 0.003, y + h / 2, z], [0.005, h - 0.06, d - 0.06]);
  },
  lectern(b, e) {
    const [x, , z] = e.at, [w, h, d] = e.size;
    b.box(M.wood(), [x, h / 2, z], [w, h, d]);
    b.box(M.lightWood(), [x - 0.04, h + 0.02, z], [w + 0.06, 0.04, d + 0.04], 0);
  },
  ring_pendant(b, e, _detail, H) {
    const [x, y, z] = e.at, r = e.size[0] / 2;
    const warm = glow("#ffe2a8", 0.9);
    for (let i = 0; i < 20; i += 1) {
      const a = i / 20 * Math.PI * 2;
      b.box(warm, [x + Math.cos(a) * r, y, z + Math.sin(a) * r], [0.05, 0.05, 2 * Math.PI * r / 20 + 0.01], -a * 180 / Math.PI);
    }
    for (let i = 0; i < 3; i += 1) {
      const a = i / 3 * Math.PI * 2;
      b.box(M.steel(), [x + Math.cos(a) * r, (y + H) / 2, z + Math.sin(a) * r], [0.01, H - y, 0.01]);
    }
  },
  ceiling_cylinder(b, e, _detail, H) {
    const [x, y, z] = e.at, [w, h] = e.size;
    b.cylinder(surface("#e4e2d8", "paint"), [x, y + h / 2, z], w / 2, h, 12);
    b.cylinder(glow("#fff3d6", 1.0), [x, y - 0.005, z], w / 2 - 0.03, 0.01, 12);
    b.box(M.steel(), [x, (y + h + H) / 2, z], [0.02, Math.max(0.01, H - y - h), 0.02]);
  }
};

// ---------------------------------------------------------------- per-room dressing
function lobbyDressing(b, layout, detail) {
  const s = layout.shell, { halfWidth: W, halfDepth: D, ceiling: H } = s;
  shell(b, s, { floor: polished(), walls: { all: M.wallLight() }, ceiling: M.ceiling() });
  floorGrid(b, surface("#b0ada2", "concrete"), W, D, detail === "low" ? 2 : 1);
  // Curtain wall: south (entry) side full height, upper band on east/west.
  const pane = glass("#a9d4ec", 0.55), mull = M.darkMetal();
  b.box(pane, [0, H / 2, -D + 0.03], [2 * W, H, 0.03]);
  for (let x = -W; x <= W + 1e-6; x += 1.1) b.box(mull, [x, H / 2, -D + 0.06], [0.06, H, 0.06]);
  for (let y = 0.9; y < H; y += 0.9) b.box(mull, [0, y, -D + 0.06], [2 * W, 0.05, 0.06]);
  for (const side of [-1, 1]) {
    b.box(pane, [side * (W - 0.03), H * 0.72, 0], [0.03, H * 0.5, 2 * D]);
    for (let z = -D; z <= D + 1e-6; z += 1.5) b.box(mull, [side * (W - 0.06), H * 0.72, z], [0.06, H * 0.5, 0.06]);
  }
  doorway(b, s.campusDoor.x, -D + 0.08, s.campusDoor.width, s.campusDoor.height, 1);
  // Light bands in the ceiling.
  for (let x = -8; x <= 8; x += 4) b.box(glow("#fff7e6", 0.65), [x, H - 0.012, 1.0], [0.25, 0.02, 2 * D - 4]);
  for (const portal of layout.portals) portalMarker(b, portal, "north", { H });
}

function readingDressing(b, layout, detail) {
  const s = layout.shell, { halfWidth: W, halfDepth: D, ceiling: H } = s;
  shell(b, s, { floor: surface("#c9c8ba", "concrete"), walls: { all: surface("#ece9df", "concrete") }, ceiling: M.ceiling() });
  floorGrid(b, surface("#a7aaa2", "concrete"), W, D, detail === "low" ? 4 : 2);
  // Bright ceiling panel grid.
  const panel = glow("#fffaf0", 0.75);
  for (let x = -W + 1.6; x < W - 1; x += 2.4) for (let z = -D + 1.5; z < D - 1; z += 2.0) b.box(panel, [x, H - 0.012, z], [1.1, 0.02, 0.7]);
  // Wood wainscot strip around the room ties the column finish to the walls.
  b.box(M.wood(), [0, 0.35, D - 0.02], [2 * W, 0.7, 0.03]);
  b.box(M.wood(), [-W + 0.02, 0.35, 0], [0.03, 0.7, 2 * D]);
  doorway(b, 0, -D + 0.08, 1.8, 1.2, 1);
  portalMarker(b, { position: { x: layout.exit.position.x + 1.6, z: layout.exit.position.z } }, "south", { H, label: "1F", arrow: "up", pad: false });
  for (const portal of layout.portals) portalMarker(b, portal, "east", { H, arrow: "right" });
}

function creativeDressing(b, layout, detail) {
  const s = layout.shell, { halfWidth: W, halfDepth: D, ceiling: H, partition: P } = s;
  shell(b, s, { floor: surface("#b0ada2", "concrete"), walls: { all: surface("#d5d3c7", "concrete"), east: M.navy() }, ceiling: M.darkCeiling() });
  // Lecture carpet and navy panels.
  b.box(M.carpet(), [(P.maxX + W) / 2, 0.006, 0], [W - P.maxX, 0.012, 2 * D]);
  for (const side of [-1, 1]) b.box(M.navy(), [(P.maxX + W) / 2, H / 2, side * (D - 0.02)], [W - P.maxX, H, 0.03]);
  for (let z = -D + 1; z < D; z += 1.5) b.box(surface("#1c2d38", "rubber"), [W - 0.03, H / 2, z], [0.02, H, 0.04]);
  // Partition between the zones (GAME_ADAPTATION opening).
  const partMat = surface("#dcd9cc", "concrete");
  b.box(partMat, [(P.minX + P.maxX) / 2, H / 2, (-D + P.openingMinZ) / 2], [P.maxX - P.minX, H, P.openingMinZ + D]);
  b.box(partMat, [(P.minX + P.maxX) / 2, H / 2, (P.openingMaxZ + D) / 2], [P.maxX - P.minX, H, D - P.openingMaxZ]);
  b.box(M.darkWood(), [(P.minX + P.maxX) / 2, H - 0.15, (P.openingMinZ + P.openingMaxZ) / 2], [P.maxX - P.minX, 0.3, P.openingMaxZ - P.openingMinZ]);
  // Study zone: dark grid ceiling with downlights, windows, wood wall panels.
  const grid = surface("#1c2d38", "rubber");
  for (let x = -W + 1; x < P.minX; x += 1.5) b.box(grid, [x, H - 0.05, 0], [0.05, 0.1, 2 * D]);
  for (let z = -D + 1; z < D; z += 1.5) b.box(grid, [(-W + P.minX) / 2, H - 0.05, z], [W + P.minX, 0.1, 0.05]);
  const down = glow("#fff3d6", 1.1);
  for (let x = -W + 1.75; x < P.minX - 0.5; x += 1.5) for (let z = -D + 1.75; z < D - 0.5; z += 3.0) b.cylinder(down, [x, H - 0.012, z], 0.09, 0.02, 10);
  const pane = glass("#cfe6f2", 0.6), mull = M.darkMetal();
  b.box(pane, [(-W + P.minX) / 2, H * 0.55, D - 0.03], [W + P.minX - 0.4, H * 0.8, 0.03]);
  for (let x = -W + 0.2; x < P.minX; x += 1.3) b.box(mull, [x, H * 0.55, D - 0.06], [0.06, H * 0.8, 0.05]);
  b.box(mull, [(-W + P.minX) / 2, H * 0.15, D - 0.06], [W + P.minX - 0.4, 0.05, 0.05]);
  const panelWood = M.wood();
  for (let z = -D + 0.3; z < D - 0.2; z += 0.35) if (Math.abs(z) > 1.2 && !(z > 2.6 && z < 7.0)) b.box(panelWood, [-W + 0.025, H / 2, z], [0.03, H, 0.22]);
  for (let x = -W + 0.3; x < -4.6; x += 0.35) if (Math.abs(x - layout.exit.position.x) > 1.2) b.box(panelWood, [x, H / 2, -D + 0.025], [0.22, H, 0.03]);
  doorway(b, layout.exit.position.x, -D + 0.08, 1.8, 1.2, 1);
  portalMarker(b, { position: { x: layout.exit.position.x + 1.6, z: layout.exit.position.z } }, "south", { H, label: "1F", arrow: "up", pad: false });
  for (const portal of layout.portals) portalMarker(b, portal, "west", { H, arrow: "left" });
}

const DRESSING = {
  [JEONGSEOK_LOBBY_ROOM_ID]: lobbyDressing,
  [JEONGSEOK_B1_READING_ROOM_ID]: readingDressing,
  [JEONGSEOK_B1_CREATIVE_ROOM_ID]: creativeDressing
};
const LIGHTING = {
  [JEONGSEOK_LOBBY_ROOM_ID]: { ambient: [0.5, 0.5, 0.52], clear: [0.72, 0.8, 0.86], lights: [[-5, 2.8, 0, [1, 0.97, 0.92], 0.85, 16], [5, 2.8, 2, [1, 0.97, 0.92], 0.85, 16]] },
  [JEONGSEOK_B1_READING_ROOM_ID]: { ambient: [0.5, 0.5, 0.49], clear: [0.2, 0.2, 0.2], lights: [[-6, 1.5, 0, [1, 0.98, 0.94], 0.8, 15], [6, 1.5, 0, [1, 0.98, 0.94], 0.8, 15]] },
  [JEONGSEOK_B1_CREATIVE_ROOM_ID]: { ambient: [0.46, 0.45, 0.44], clear: [0.12, 0.12, 0.13], lights: [[-6, 1.6, 0, [1, 0.9, 0.76], 0.9, 15], [8, 1.6, 0, [0.85, 0.9, 1], 0.7, 12]] }
};

// Existing graphics tiers decide interior detail; no separate interior quality setting.
const REDUCED_DETAIL_TIERS = new Set(["very_low", "low"]);
export const interiorDetailForTier = tier => REDUCED_DETAIL_TIERS.has(tier) ? "low" : "full";

/** Engine-free count of what one room batches (Node tests use the layout; browser QA reads status()). */
export function buildRoomGeometry(batch, layout, detail = "full") {
  const H = layout.shell.ceiling;
  DRESSING[layout.roomId](batch, layout, detail);
  for (const entry of layout.items) {
    if (detail === "low" && entry.detail === "decor") continue;
    if (entry.module === "gate_flap") continue; // separate animated entities
    const render = MODULES[entry.module];
    if (!render) throw new Error(`No renderer for module ${entry.module}`);
    render(batch, entry, detail, H);
  }
  return batch;
}

function buildGateFlaps(root, layout) {
  const flaps = [];
  const mat = glass("#cfe8f5", 0.55);
  for (const entry of layout.items.filter(item => item.module === "gate_flap")) {
    const lane = layout.gateLanes[entry.lane];
    const half = lane.width / 2 - 0.03;
    for (const side of [-1, 1]) {
      const hinge = new pc.Entity(`jsl_gate_flap_${entry.lane}_${side < 0 ? "w" : "e"}`);
      hinge.setLocalPosition(lane.x + side * (lane.width / 2), 0, lane.z);
      root.addChild(hinge);
      box(hinge, "panel", [-side * half / 2, 0.38, 0], [half, 0.3, 0.03], mat);
      flaps.push({ hinge, side, lane });
    }
  }
  return flaps;
}

export function createJeongseokInteriorScenes(app, { getGraphicsTier = () => "medium", now = () => performance.now(), isGateOpen = () => false } = {}) {
  const scenes = new Map();
  let failNext = null;
  const history = [];

  function build(roomId) {
    const layout = JEONGSEOK_LAYOUTS[roomId];
    if (!layout) throw new Error(`Unknown Jeongseok room ${roomId}`);
    if (failNext === "build") { failNext = null; throw new Error("QA: injected Jeongseok scene build failure"); }
    const started = now();
    const detail = interiorDetailForTier(getGraphicsTier());
    const root = new pc.Entity(`Room_${roomId}`);
    root.setLocalScale(1, 1, -1);
    root.enabled = false;
    try {
      const batch = createStaticBatch();
      buildRoomGeometry(batch, layout, detail);
      const primitives = batch.primitiveCount, vertices = batch.vertexCount;
      const meshes = batch.build(root, `jsl_static_${roomId}`);
      const flaps = roomId === JEONGSEOK_LOBBY_ROOM_ID ? buildGateFlaps(root, layout) : [];
      const config = LIGHTING[roomId];
      const lights = config.lights.map(([x, y, z, color, intensity, range], index) => {
        const e = new pc.Entity(`jsl_light_${index}`);
        e.addComponent("light", { type: "omni", color: new pc.Color(...color), intensity, range, castShadows: false });
        e.setLocalPosition(x, y, z);
        root.addChild(e);
        return e;
      });
      app.root.addChild(root);
      const buildMs = now() - started;
      const collision = roomId === JEONGSEOK_LOBBY_ROOM_ID ? createJeongseokLobbyCollision(isGateOpen() === true) : null;
      const scene = {
        root, lights, roomId, detail,
        obstacles: collision?.obstacles ?? [...layout.obstacles],
        ambient: new pc.Color(...config.ambient),
        clearColor: new pc.Color(...config.clear),
        stats: Object.freeze({ drawMeshes: meshes.length, primitives, vertices, flaps: flaps.length, lights: lights.length, buildMs }),
        /** Stable collision array is shared with PlayerController/Orbit; no test-only barrier. */
        setGateAccess(open) { collision?.setGateAccess(open); },
        /** Proximity may animate only an already-authorized gate, never unlock it. */
        update(position, dt = 0.016) {
          const allowed = isGateOpen() === true;
          this.setGateAccess(allowed);
          for (const flap of flaps) {
            const near = position && Math.abs(position.x - flap.lane.x) < flap.lane.width / 2 + 0.35 && Math.abs(position.z - flap.lane.z) < 1.4;
            const target = allowed && near ? flap.side * 80 : 0;
            const current = flap.hinge.getLocalEulerAngles().y;
            const next = current + (target - current) * Math.min(1, dt * 10);
            flap.hinge.setLocalEulerAngles(0, Math.abs(next - target) < 0.5 ? target : next, 0);
          }
        },
        get flapAngles() { return flaps.map(flap => Math.round(flap.hinge.getLocalEulerAngles().y)); },
        onDeactivate() { for (const flap of flaps) flap.hinge.setLocalEulerAngles(0, 0, 0); }
      };
      scene.setGateAccess(isGateOpen() === true);
      history.push({ roomId, buildMs, detail, drawMeshes: meshes.length });
      return scene;
    } catch (error) { root.destroy(); throw error; }
  }

  return {
    get(room) {
      const id = room?.id ?? room;
      if (!JEONGSEOK_LAYOUTS[id]) return null;
      if (!scenes.has(id)) scenes.set(id, build(id));
      return scenes.get(id);
    },
    /** Release every inactive interior scene (mesh memory) once the player is back on campus. */
    releaseAll() {
      let released = 0;
      for (const [id, scene] of scenes) {
        if (scene.root.enabled) continue;
        scene.root.destroy();
        scenes.delete(id);
        released += 1;
      }
      return released;
    },
    activeScene() { for (const scene of scenes.values()) if (scene.root.enabled) return scene; return null; },
    failNextBuild() { failNext = "build"; },
    status: () => Object.freeze({ built: [...scenes.keys()], history: history.slice(-12),
      scenes: Object.fromEntries([...scenes].map(([id, scene]) => [id, scene.stats])) })
  };
}
