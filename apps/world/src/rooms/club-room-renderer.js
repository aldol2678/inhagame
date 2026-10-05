// Club Room P0 · ROOM_CLUBHOUSE_01 scene. Built once from club-room-layout.js and reused; the
// transition only toggles it. Its root is a sibling of the campus root (same canonical frame,
// scale z = −1), never a child of the campus and never placed inside the campus map.

import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { CLUB_ROOM, CLUB_ROOM_FURNITURE } from "./club-room-layout.js";

const { halfWidth: W, halfDepth: D, ceiling: H, door: DOOR } = CLUB_ROOM;

function glow(hex, intensity = 1) {
  const n = parseInt(hex.slice(1), 16);
  const c = new pc.Color((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
  const m = new pc.StandardMaterial();
  m.diffuse = c;
  m.emissive = c;
  m.emissiveIntensity = intensity;
  m.update();
  return m;
}

function group(root, name, [x, y, z], yaw = 0) {
  const e = new pc.Entity(name);
  e.setLocalPosition(x, y, z);
  e.setLocalEulerAngles(0, yaw, 0);
  root.addChild(e);
  return e;
}

const BOOK_COLORS = ["#c0392b", "#2e86c1", "#f1c40f", "#27ae60", "#8e44ad", "#e67e22", "#16a085"];

function buildPiece(root, item) {
  const g = group(root, `club_${item.id}`, item.at, item.yaw ?? 0);
  const [w, h, d] = item.size;
  const mat = surface(item.color);
  const dark = surface("#3b2a1c");
  switch (item.kind) {
    case "rug":
      box(g, "rug", [0, 0.006, 0], [w, 0.012, d], mat);
      box(g, "rug_inner", [0, 0.013, 0], [w - 0.35, 0.004, d - 0.35], surface("#c9794f"));
      break;
    case "table":
      box(g, "top", [0, h - 0.025, 0], [w, 0.05, d], mat);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, "leg", [x * (w / 2 - 0.08), (h - 0.05) / 2, z * (d / 2 - 0.08)], [0.06, h - 0.05, 0.06], dark);
      box(g, "laptop", [0.45, h + 0.01, 0.05], [0.32, 0.015, 0.22], surface("#cfd6de"));
      box(g, "mug", [-0.55, h + 0.04, -0.12], [0.06, 0.08, 0.06], surface("#f5f1e6"), 0, "cylinder");
      box(g, "papers", [-0.1, h + 0.005, 0.18], [0.3, 0.008, 0.22], surface("#fbfbf3"), 12);
      break;
    case "chair": {
      box(g, "seat", [0, 0.23, 0], [w, 0.04, d], mat);
      box(g, "back", [0, 0.4, -d / 2 + 0.02], [w, 0.32, 0.04], mat);
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) box(g, "leg", [x * (w / 2 - 0.03), 0.105, z * (d / 2 - 0.03)], [0.035, 0.21, 0.035], surface("#9aa5b1"));
      break;
    }
    case "sofa":
      box(g, "base", [0, 0.12, 0], [w, 0.24, d], mat);
      box(g, "cushion", [0, 0.28, 0.06], [w - 0.3, 0.1, d - 0.2], surface("#4f8a74"));
      box(g, "back", [0, 0.36, -d / 2 + 0.1], [w, 0.48, 0.2], mat);
      for (const s of [-1, 1]) box(g, "arm", [s * (w / 2 - 0.1), 0.24, 0], [0.2, 0.3, d], mat);
      break;
    case "side_table":
      box(g, "top", [0, h - 0.02, 0], [w, 0.04, d], mat);
      box(g, "stem", [0, (h - 0.04) / 2, 0], [0.08, h - 0.04, 0.08], dark);
      box(g, "lamp", [0.05, h + 0.1, 0.05], [0.12, 0.2, 0.12], glow("#ffd9a0", 0.8), 0, "cylinder");
      break;
    case "bookshelf": {
      box(g, "frame", [0, h / 2, 0], [w, h, d], mat);
      box(g, "hollow", [0, h / 2, -0.03], [w - 0.08, h - 0.08, d - 0.02], dark);
      for (let shelf = 0; shelf < 3; shelf += 1) {
        const y = 0.06 + shelf * (h - 0.1) / 3;
        box(g, "shelf", [0, y, -0.02], [w - 0.08, 0.03, d - 0.04], mat);
        for (let i = 0; i < 9; i += 1) {
          const bh = 0.2 + ((i * 7 + shelf * 3) % 5) * 0.025;
          box(g, "book", [-w / 2 + 0.16 + i * 0.17, y + 0.015 + bh / 2, -0.04], [0.12, bh, d - 0.14], surface(BOOK_COLORS[(i + shelf * 2) % BOOK_COLORS.length]));
        }
      }
      break;
    }
    case "cabinet":
      box(g, "body", [0, h / 2, 0], [w, h, d], mat);
      box(g, "seam", [0, h / 2, -d / 2 - 0.004], [0.01, h - 0.08, 0.01], dark);
      for (const s of [-1, 1]) box(g, "handle", [s * 0.07, h * 0.55, -d / 2 - 0.02], [0.02, 0.12, 0.02], surface("#d9dde2"));
      box(g, "box_top", [-0.25, h + 0.1, 0], [0.4, 0.2, 0.3], surface("#c9a66b"));
      break;
    case "plant":
      box(g, "pot", [0, 0.12, 0], [0.3, 0.24, 0.3], surface("#b5643c"), 0, "cylinder");
      box(g, "leaves", [0, 0.45, 0], [0.42, 0.45, 0.42], mat, 0, "sphere");
      box(g, "leaves_top", [0.04, 0.66, -0.02], [0.28, 0.28, 0.28], surface("#4f9448"), 0, "sphere");
      break;
    case "noticeboard":
      box(g, "board", [0, 0, 0], [w, h, d], mat);
      box(g, "frame", [0.01, 0, 0], [w, h + 0.05, d + 0.05], dark);
      [["#fff7b0", 0.2, -0.5], ["#ffd1dc", -0.1, -0.1], ["#c9f2ff", 0.15, 0.3], ["#ffffff", -0.12, 0.55], ["#d7f7c2", 0.05, 0.05]]
        .forEach(([c, y, z], i) => box(g, `note_${i}`, [-0.035, y, z], [0.01, 0.16, 0.2], surface(c), (i % 2 ? 4 : -5)));
      break;
    case "plush":
      box(g, "body", [0, 0.1, 0], [0.26, 0.22, 0.24], mat, 0, "sphere");
      box(g, "head", [0, 0.26, 0.02], [0.16, 0.16, 0.16], mat, 0, "sphere");
      box(g, "beak", [0, 0.25, 0.11], [0.07, 0.04, 0.07], surface("#f39c34"), 0, "sphere");
      for (const s of [-1, 1]) box(g, "eye", [s * 0.04, 0.29, 0.085], [0.025, 0.025, 0.025], surface("#1b1b1b"), 0, "sphere");
      break;
    default:
      box(g, item.kind, [0, h / 2, 0], [w, h, d], mat);
  }
  return g;
}

export function createClubRoomScene(app) {
  const root = new pc.Entity("Room_ROOM_CLUBHOUSE_01");
  root.setLocalScale(1, 1, -1); // same canonical frame as the campus root
  const T = 0.3;
  const wall = surface("#efe3cf");
  const trim = surface("#8a6a4a");
  // Shell: floor, planks, ceiling, walls, baseboards.
  box(root, "floor", [0, -0.05, 0], [2 * W + 2 * T, 0.1, 2 * D + 2 * T], surface("#a9794e"));
  for (let x = -W + 0.45; x < W; x += 0.45) box(root, "plank", [x, 0.001, 0], [0.012, 0.002, 2 * D], surface("#8d6440"));
  box(root, "ceiling", [0, H + 0.05, 0], [2 * W + 2 * T, 0.1, 2 * D + 2 * T], surface("#f4f0e8"));
  box(root, "wall_north", [0, H / 2, D + T / 2], [2 * W + 2 * T, H, T], wall);
  box(root, "wall_south", [0, H / 2, -D - T / 2], [2 * W + 2 * T, H, T], wall);
  box(root, "wall_west", [-W - T / 2, H / 2, 0], [T, H, 2 * D], wall);
  box(root, "wall_east", [W + T / 2, H / 2, 0], [T, H, 2 * D], wall);
  box(root, "wainscot_north", [0, 0.28, D - 0.01], [2 * W, 0.56, 0.02], surface("#d9c7a8"));
  box(root, "wainscot_south", [0, 0.28, -D + 0.01], [2 * W, 0.56, 0.02], surface("#d9c7a8"));
  for (const [name, p, s] of [["base_n", [0, 0.04, D - 0.02], [2 * W, 0.08, 0.03]], ["base_s", [0, 0.04, -D + 0.02], [2 * W, 0.08, 0.03]],
    ["base_w", [-W + 0.02, 0.04, 0], [0.03, 0.08, 2 * D]], ["base_e", [W - 0.02, 0.04, 0], [0.03, 0.08, 2 * D]]]) box(root, name, p, s, trim);
  // Door (south wall, the way back to the main hall).
  box(root, "door_frame", [DOOR.x, DOOR.height / 2 + 0.03, -D + 0.02], [DOOR.width + 0.14, DOOR.height + 0.07, 0.04], trim);
  for (const s of [-1, 1]) {
    box(root, "door_leaf", [DOOR.x + s * DOOR.width / 4, DOOR.height / 2, -D + 0.04], [DOOR.width / 2 - 0.02, DOOR.height - 0.02, 0.03], surface("#7a4b2a"));
    box(root, "door_handle", [DOOR.x + s * 0.08, DOOR.height * 0.48, -D + 0.07], [0.02, 0.1, 0.02], surface("#e2c46a"));
    box(root, "door_window", [DOOR.x + s * DOOR.width / 4, DOOR.height * 0.72, -D + 0.058], [0.2, 0.22, 0.01], glow("#dff1ff", 0.35));
  }
  box(root, "door_sign", [DOOR.x, DOOR.height + 0.14, -D + 0.03], [0.46, 0.1, 0.02], glow("#5fd38d", 0.9));
  // Windows with daylight (north wall and above the sofa).
  box(root, "window_north", [0.2, 0.92, D - 0.015], [2.0, 0.7, 0.02], glow("#cfe9ff", 0.9));
  for (const x of [-0.8, 0.2, 1.2]) box(root, "mullion_n", [x, 0.92, D - 0.03], [0.04, 0.74, 0.02], trim);
  box(root, "sill_n", [0.2, 0.55, D - 0.05], [2.1, 0.04, 0.08], trim);
  box(root, "window_west", [-W + 0.015, 1.02, 0.4], [0.02, 0.5, 1.6], glow("#cfe9ff", 0.9));
  box(root, "mullion_w", [-W + 0.03, 1.02, 0.4], [0.02, 0.54, 0.04], trim);
  // Club banner (fictional, no real club identity) and a clock.
  box(root, "banner", [0, 1.18, D - 0.02], [1.1, 0.18, 0.02], surface("#1f5fa8"));
  box(root, "banner_stripe", [0, 1.18, D - 0.03], [1.1, 0.04, 0.01], surface("#ffd23f"));
  box(root, "clock", [-W + 0.03, 1.2, -1.8], [0.02, 0.22, 0.22], surface("#fafafa"), 0);
  // Ceiling lights (emissive panels) + a few cheap unshadowed lights.
  for (const x of [-1.8, 1.8]) box(root, "ceiling_panel", [x, H - 0.015, 0.4], [1.1, 0.03, 0.5], glow("#fff4dc", 1.2));
  for (const item of CLUB_ROOM_FURNITURE) buildPiece(root, item);

  const lights = [];
  const light = (name, [x, y, z], color, intensity, range) => {
    const e = new pc.Entity(name);
    e.addComponent("light", { type: "omni", color: new pc.Color(...color), intensity, range, castShadows: false });
    e.setLocalPosition(x, y, z);
    root.addChild(e);
    lights.push(e);
  };
  light("club_light_west", [-1.8, H - 0.2, 0.4], [1, 0.9, 0.76], 1.25, 7);
  light("club_light_east", [1.8, H - 0.2, 0.4], [1, 0.9, 0.76], 1.25, 7);
  light("club_window_fill", [0.2, 1.0, D - 0.6], [0.78, 0.88, 1], 0.55, 5);

  root.enabled = false;
  app.root.addChild(root);
  return {
    root,
    lights,
    ambient: new pc.Color(0.46, 0.43, 0.4),
    clearColor: new pc.Color(0.16, 0.14, 0.13),
    get entityCount() { let n = 0; const walk = (e) => { n += 1; e.children.forEach(walk); }; walk(root); return n; }
  };
}
