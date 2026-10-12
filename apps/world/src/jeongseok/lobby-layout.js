// JSL-B1 · 정석학술정보관 1층 중앙 로비 (engine-free layout).
//
// Finishes and props follow the HISTORICAL 2013–2017 lobby record (polished light grey tile, grey
// columns, tall gridded curtain wall, planters, gate row with overhead signage, information
// counter). Their arrangement here is a GAME_ADAPTATION: the 2026 gate count/position, the doors
// and the 1F↔B1 core are UNKNOWN, so the gate row, counter, kiosks, entry and portals are separate
// slots that can be moved without touching the shell. 1 world unit ≈ 2 m.

import { GAME_ADAPTATION, SOURCE_CLASS, traced } from "./interior-evidence.js";
import { PORTAL_WALL_INSET, anchor, freezeLayout, item, itemObstacle, shellBounds, shellObstacles } from "./interior-kit.js";

export const JEONGSEOK_LOBBY_ROOM_ID = "ROOM_JEONGSEOK_LOBBY";

const LOBBY_2015 = ["JSL-R0-F03-LOBBY-2015"];
const LOBBY_FRAME = ["JSL-R0-LOBBY-2013-2017", "JSL-R0-F03-LOBBY-2015"];

export const JEONGSEOK_LOBBY = Object.freeze({
  halfWidth: 11,
  halfDepth: 7.5,
  ceiling: 3.6, // double-height lobby (~7 m); presentation estimate, not a surveyed height
  wall: 0.35,
  camera: Object.freeze({ initial: 3.2, min: 1.3, max: 4.4 }),
  campusDoor: Object.freeze({ x: 0, width: 2.6, height: 1.45 }),
  trace: Object.freeze({
    shell: GAME_ADAPTATION("rectangular shell sized for play; real plan UNKNOWN"),
    floor: traced(SOURCE_CLASS.HISTORICAL, LOBBY_FRAME, "polished light grey stone tile"),
    curtainWall: traced(SOURCE_CLASS.HISTORICAL, LOBBY_FRAME, "tall gridded glazing on the entry side"),
    ceiling: GAME_ADAPTATION("flat ceiling with light bands")
  })
});

const { halfWidth: W, halfDepth: D } = JEONGSEOK_LOBBY;

// Replaceable gate slot. The 2015 photo shows a row of metal gates under a sign; the lane count,
// widths and this z position are game values until 2026 evidence arrives.
export const JEONGSEOK_LOBBY_GATE_SLOT = Object.freeze({
  id: "JSL_B_LOBBY_GATE_ROW_SLOT_01",
  center: Object.freeze({ x: 0, z: -3.2 }),
  lanes: Object.freeze([0.9, 0.9, 0.9, 1.3]), // the wide lane keeps a wheelchair-width route
  cabinet: Object.freeze({ width: 0.28, depth: 1.1, height: 0.55 }),
  barrierHalfSpan: 8.0,
  barrierHeight: 0.5,
  trace: traced(SOURCE_CLASS.HISTORICAL, LOBBY_2015, "gate row existed in 2015; 2026 count/position UNKNOWN"),
  placement: GAME_ADAPTATION("lane count, widths and position are replaceable")
});

/** Gate cabinets, flaps and side barriers for a slot. Flaps are visual only. */
export function gateRow(slot = JEONGSEOK_LOBBY_GATE_SLOT) {
  const { center, lanes, cabinet } = slot;
  const total = lanes.reduce((sum, lane) => sum + lane, 0) + cabinet.width * (lanes.length + 1);
  const items = [];
  const laneCenters = [];
  let x = center.x - total / 2;
  for (let i = 0; i <= lanes.length; i += 1) {
    items.push(item(`gate_cabinet_${i}`, "gate_cabinet", [x + cabinet.width / 2, 0, center.z],
      [cabinet.width, cabinet.height, cabinet.depth], slot.trace));
    x += cabinet.width;
    if (i < lanes.length) {
      laneCenters.push(Object.freeze({ x: x + lanes[i] / 2, z: center.z, width: lanes[i] }));
      items.push(item(`gate_flap_${i}`, "gate_flap", [x + lanes[i] / 2, 0.22, center.z], [lanes[i] - 0.06, 0.26, 0.04],
        slot.trace, { collide: false, lane: i }));
      x += lanes[i];
    }
  }
  const half = total / 2;
  for (const side of [-1, 1]) {
    const inner = center.x + side * half, outer = center.x + side * slot.barrierHalfSpan;
    items.push(item(`gate_barrier_${side < 0 ? "w" : "e"}`, "glass_barrier", [(inner + outer) / 2, 0, center.z],
      [Math.abs(outer - inner), slot.barrierHeight, 0.08], slot.placement));
  }
  items.push(item("gate_sign", "overhead_sign", [center.x, 2.0, center.z], [Math.max(total, 4.4), 0.32, 0.12],
    traced(SOURCE_CLASS.HISTORICAL, LOBBY_2015, "overhead signage above the gates; no real text or logo"), { collide: false }));
  return { items, laneCenters: Object.freeze(laneCenters), halfSpan: half };
}

const gate = gateRow();
const columnTrace = traced(SOURCE_CLASS.HISTORICAL, LOBBY_FRAME, "light grey columns; grid positions are game values");
const plantTrace = traced(SOURCE_CLASS.HISTORICAL, LOBBY_2015, "indoor planting; planter positions are game values");

const items = [
  ...gate.items,
  // Side planters close the gap between the barriers and the walls (no bypass around the lanes).
  item("planter_gate_w", "planter", [-(gate.halfSpan + (8.0 - gate.halfSpan)) - 1.5, 0, -3.2], [3.0, 0.5, 1.1], plantTrace),
  item("planter_gate_e", "planter", [8.0 + 1.5, 0, -3.2], [3.0, 0.5, 1.1], plantTrace),
  item("info_desk", "info_desk", [-6.0, 0, -0.2], [3.2, 0.55, 1.0],
    traced(SOURCE_CLASS.HISTORICAL, LOBBY_2015, "information counter near the gates; replaceable slot")),
  item("search_kiosk_1", "search_kiosk", [6.2, 0, -0.4], [0.55, 0.75, 0.45],
    GAME_ADAPTATION("generic book search terminal; screen shows no real catalogue UI")),
  item("search_kiosk_2", "search_kiosk", [7.4, 0, -0.4], [0.55, 0.75, 0.45],
    GAME_ADAPTATION("generic book search terminal")),
  ...[-8.4, -3.6, 3.6, 8.4].flatMap(x => [1.6, 5.2].map(z =>
    item(`column_${x}_${z}`.replace(/\./g, "_").replace(/-/g, "m"), "column_square", [x, 0, z], [0.6, JEONGSEOK_LOBBY.ceiling, 0.6], columnTrace))),
  item("planter_vestibule_w", "planter", [-9.0, 0, -5.9], [2.4, 0.5, 1.2], plantTrace),
  item("planter_vestibule_e", "planter", [9.0, 0, -5.9], [2.4, 0.5, 1.2], plantTrace),
  item("planter_inner_w", "planter", [-6.0, 0, 3.4], [1.6, 0.5, 1.6], plantTrace),
  item("planter_inner_e", "planter", [6.0, 0, 3.4], [1.6, 0.5, 1.6], plantTrace),
  item("bench_w", "bench", [-10.3, 0, 1.2], [0.6, 0.4, 2.4], GAME_ADAPTATION("waiting bench")),
  item("bench_e", "bench", [10.3, 0, 1.2], [0.6, 0.4, 2.4], GAME_ADAPTATION("waiting bench")),
  item("new_books_shelf", "bookshelf", [-10.4, 0, 4.9], [0.55, 1.1, 2.6],
    GAME_ADAPTATION("display shelf with plain book blocks; no real covers")),
  item("guide_board", "guide_board", [0, 0, 2.2], [1.2, 1.1, 0.12],
    GAME_ADAPTATION("floor guide board with abstract pictograms"), { detail: "decor" })
];

const portalTrace = GAME_ADAPTATION("temporary floor transfer; does NOT claim a real stair or elevator here");

export const JEONGSEOK_LOBBY_SPAWN = anchor(0, -5.6, 0, GAME_ADAPTATION("arrival just inside the entry doors"));
export const JEONGSEOK_LOBBY_EXIT = Object.freeze({
  id: "JEONGSEOK_LOBBY_CAMPUS_DOOR", position: Object.freeze({ x: 0, z: -D + PORTAL_WALL_INSET }), radius: 1.1,
  trace: GAME_ADAPTATION("front door slot; real door count/position UNKNOWN")
});

// 1F → B1 temporary transfers. Positions are slots, not stair or elevator locations.
export const JEONGSEOK_LOBBY_PORTALS = Object.freeze([
  Object.freeze({ id: "JEONGSEOK_LOBBY_TO_B1_READING", target: "ROOM_JEONGSEOK_B1_READING", kind: "nested",
    icon: "⬇️", label: "B1 제2열람실로 이동 (임시 층간 이동)",
    position: Object.freeze({ x: -5.5, z: D - PORTAL_WALL_INSET }), radius: 1.1,
    returnAnchor: anchor(-5.5, D - 2.0, 180, portalTrace), trace: portalTrace }),
  Object.freeze({ id: "JEONGSEOK_LOBBY_TO_B1_CREATIVE", target: "ROOM_JEONGSEOK_B1_CREATIVE", kind: "nested",
    icon: "⬇️", label: "B1 Creative Space로 이동 (임시 층간 이동)",
    position: Object.freeze({ x: 5.5, z: D - PORTAL_WALL_INSET }), radius: 1.1,
    returnAnchor: anchor(5.5, D - 2.0, 180, portalTrace), trace: portalTrace })
]);

export const JEONGSEOK_LOBBY_LAYOUT = freezeLayout({
  roomId: JEONGSEOK_LOBBY_ROOM_ID,
  shell: JEONGSEOK_LOBBY,
  items,
  gateLanes: gate.laneCenters,
  obstacles: [
    ...shellObstacles("jsl_lobby", JEONGSEOK_LOBBY),
    ...items.filter(entry => entry.collide).map(entry => itemObstacle("jsl_lobby", entry))
  ],
  bounds: shellBounds(JEONGSEOK_LOBBY),
  spawn: JEONGSEOK_LOBBY_SPAWN,
  exit: JEONGSEOK_LOBBY_EXIT,
  portals: JEONGSEOK_LOBBY_PORTALS,
  // Future NPC routes: entry → each gate lane → portals. Widths in world units (1 ≈ 2 m).
  aisles: [
    { id: "lobby_entry_to_gates", width: 0.8, points: [{ x: 0, z: -5.6 }, { x: gate.laneCenters[1].x, z: -4.4 }] },
    { id: "lobby_gates_to_b1_reading", width: 1.1, points: [{ x: gate.laneCenters[1].x, z: -1.8 }, { x: -1.6, z: 3.4 },
      { x: -4.5, z: 3.4 }, { x: -4.5, z: 6.0 }, { x: -5.5, z: 6.0 }] },
    { id: "lobby_gates_to_b1_creative", width: 1.1, points: [{ x: gate.laneCenters[2].x, z: -1.8 }, { x: 1.6, z: 3.4 },
      { x: 4.5, z: 3.4 }, { x: 4.5, z: 6.0 }, { x: 5.5, z: 6.0 }] }
  ]
});
