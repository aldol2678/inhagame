// Social S1-D2 · 제1생활관 로비 scene.
// Built once and toggled through the generic Room transition adapter.

import * as pc from "playcanvas";
import { box, surface } from "../campus-render-kit.js";
import { DORM_1_LOBBY, DORM_1_LOBBY_FURNITURE } from "./dorm1-lobby-layout.js";

const { halfWidth: W, halfDepth: D, ceiling: H, wall: T, campusDoor, myRoomDoor } = DORM_1_LOBBY;

function glow(hex, intensity = 1) {
  const n = parseInt(hex.slice(1), 16);
  const c = new pc.Color((n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255);
  const m = new pc.StandardMaterial();
  m.diffuse = c; m.emissive = c; m.emissiveIntensity = intensity; m.update();
  return m;
}

function group(root, name, [x, y, z]) {
  const e = new pc.Entity(name);
  e.setLocalPosition(x, y, z);
  root.addChild(e);
  return e;
}

function furniture(root, item) {
  const g = group(root, "dorm1_lobby_" + item.id, item.at);
  const [w, h, d] = item.size;
  if (item.kind === "desk") {
    box(g, "body", [0, h / 2, 0], [w, h, d], surface("#8b6847"));
    box(g, "counter", [0, h + 0.08, 0], [w + 0.18, 0.16, d + 0.08], surface("#b18a64"));
    box(g, "monitor", [0.45, h + 0.3, 0.05], [0.42, 0.3, 0.06], surface("#34495e"));
  } else if (item.kind === "bench") {
    box(g, "seat", [0, 0.24, 0], [w, 0.12, d], surface("#85613f"));
    box(g, "back", [0, 0.48, d / 2 - 0.07], [w, 0.45, 0.12], surface("#9d7750"));
    for (const s of [-1, 1]) box(g, "leg", [s * (w / 2 - 0.15), 0.11, 0], [0.1, 0.22, 0.1], surface("#4d4f52"));
  } else if (item.kind === "noticeboard") {
    box(g, "board", [0, 0, 0], [w, h, d], surface("#b98b5a"));
    for (let i = 0; i < 5; i++) box(g, "note_" + i, [-0.035, 0.22 - i * 0.11, -0.55 + i * 0.27], [0.01, 0.14, 0.2], surface(i % 2 ? "#fff7b0" : "#d7eefc"));
  } else if (item.kind === "mailboxes") {
    box(g, "bank", [0, 0, 0], [w, h, d], surface("#87919a"));
    for (let row = 0; row < 5; row += 1) for (let col = 0; col < 4; col += 1) {
      box(g, `door_${row}_${col}`, [-0.07, h / 2 - 0.5 + row * 0.24, -0.86 + col * 0.56],
        [0.02, 0.2, 0.48], surface((row + col) % 2 ? "#9ca5ac" : "#b0b7bd"));
    }
  } else if (item.kind === "plant") {
    box(g, "pot", [0, 0.13, 0], [0.32, 0.26, 0.32], surface("#b5643c"), 0, "cylinder");
    box(g, "leaves", [0, 0.5, 0], [0.46, 0.54, 0.46], surface("#4f8c47"), 0, "sphere");
  }
}

export function createDorm1LobbyScene(app) {
  const root = new pc.Entity("Room_ROOM_DORM1_LOBBY");
  root.setLocalScale(1, 1, -1);

  const wall = surface("#e7e5df");
  const trim = surface("#6e7478");
  const floor = surface("#c4b9a4");
  box(root, "floor", [0, -0.05, 0], [2 * W + 2 * T, 0.1, 2 * D + 2 * T], floor);
  box(root, "ceiling", [0, H + 0.05, 0], [2 * W + 2 * T, 0.1, 2 * D + 2 * T], surface("#f2f2ef"));
  box(root, "wall_north", [0, H / 2, D + T / 2], [2 * W + 2 * T, H, T], wall);
  box(root, "wall_south", [0, H / 2, -D - T / 2], [2 * W + 2 * T, H, T], wall);
  box(root, "wall_west", [-W - T / 2, H / 2, 0], [T, H, 2 * D], wall);
  box(root, "wall_east", [W + T / 2, H / 2, 0], [T, H, 2 * D], wall);

  // Campus exit on the south wall.
  box(root, "campus_door_frame", [campusDoor.x, campusDoor.height / 2 + 0.03, -D + 0.02],
    [campusDoor.width + 0.18, campusDoor.height + 0.08, 0.05], trim);
  box(root, "campus_door", [campusDoor.x, campusDoor.height / 2, -D + 0.05],
    [campusDoor.width, campusDoor.height, 0.04], glow("#cfe9ff", 0.32));

  // Reserved personal-room door. It is visual only until D1.3.
  box(root, "my_room_frame", [myRoomDoor.x, myRoomDoor.height / 2 + 0.03, myRoomDoor.z],
    [myRoomDoor.width + 0.16, myRoomDoor.height + 0.08, 0.05], trim);
  box(root, "my_room_door", [myRoomDoor.x, myRoomDoor.height / 2, myRoomDoor.z - 0.03],
    [myRoomDoor.width, myRoomDoor.height, 0.04], surface("#7d5c3e"));
  box(root, "my_room_sign", [myRoomDoor.x, myRoomDoor.height + 0.14, myRoomDoor.z - 0.04],
    [0.55, 0.12, 0.025], glow("#5fd38d", 0.65));

  // Elevator bank and a simple directory establish the lobby identity without reproducing a real interior.
  for (const x of [-1.35, 1.35]) {
    box(root, "elevator_frame", [x, 0.72, D - 0.03], [1.05, 1.42, 0.05], trim);
    box(root, "elevator_door", [x, 0.7, D - 0.06], [0.88, 1.3, 0.025], surface("#9aa1a6"));
  }
  box(root, "directory", [-4.55, 1.08, D - 0.055], [1.55, 0.82, 0.025], surface("#355b74"));

  for (const item of DORM_1_LOBBY_FURNITURE) furniture(root, item);

  for (const x of [-3.5, 0, 3.5]) box(root, "ceiling_panel", [x, H - 0.015, 0.25], [1.1, 0.03, 0.48], glow("#fff5df", 0.55));

  const lights = [];
  for (const [name, x] of [["lobby_light_west", -3.4], ["lobby_light_east", 3.4]]) {
    const e = new pc.Entity(name);
    e.addComponent("light", { type: "omni", color: new pc.Color(1, 0.92, 0.8), intensity: 0.72, range: 9.5, castShadows: false });
    e.setLocalPosition(x, H - 0.28, 0.25);
    root.addChild(e);
    lights.push(e);
  }

  root.enabled = false;
  app.root.addChild(root);
  return {
    root,
    lights,
    ambient: new pc.Color(0.42, 0.41, 0.39),
    clearColor: new pc.Color(0.16, 0.16, 0.16),
    get entityCount() { let n = 0; const walk = e => { n += 1; e.children.forEach(walk); }; walk(root); return n; }
  };
}
