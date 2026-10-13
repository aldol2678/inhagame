// JSL-B3/B4/B5 · B1 Creative Space (engine-free layout).
//
// The 2024 official introduction (JSL-R0-F03-CREATIVE-2024) shows two visually different zones:
//   study zone   — floor-to-ceiling wood-slat ROUND STRUCTURAL columns, dark grid ceiling with
//                  downlights, long shared tables with power strips, sofas, mesh chairs, large
//                  windows, wood wall panels, curved glass partition;
//   lecture zone — navy panel walls, large screen, stepped wooden seating, ring pendants and ceiling
//                  cylinder light fittings (fittings, NOT the study-zone columns), carpet.
// Their real connection order, the outside doors and the window orientation are UNKNOWN, so the
// partition opening between the zones and every transfer here is GAME_ADAPTATION. Of the eight
// official group study rooms only two representative glass rooms are instantiated; the other six
// are reserved slots with no coordinates, never invented positions.

import { GAME_ADAPTATION, SOURCE_CLASS, traced } from "./interior-evidence.js";
import { PORTAL_WALL_INSET, anchor, boxOf, freezeLayout, item, itemObstacle, shellBounds, shellObstacles, tableWithChairs } from "./interior-kit.js";

export const JEONGSEOK_B1_CREATIVE_ROOM_ID = "ROOM_JEONGSEOK_B1_CREATIVE";

const CREATIVE = ["JSL-R0-F03-CREATIVE-2024"];
const observed = note => traced(SOURCE_CLASS.OBSERVED_MUSE, CREATIVE, note);

export const JEONGSEOK_B1_CREATIVE = Object.freeze({
  halfWidth: 13,
  halfDepth: 9,
  ceiling: 1.9,
  wall: 0.35,
  camera: Object.freeze({ initial: 2.5, min: 1.1, max: 3.3 }),
  // Zone split: x < partition.minX is the study zone, x > partition.maxX the lecture zone.
  partition: Object.freeze({ minX: 2.55, maxX: 2.85, openingMinZ: -2.0, openingMaxZ: 1.0,
    trace: GAME_ADAPTATION("zone partition and opening; real connection order UNKNOWN") }),
  trace: Object.freeze({
    shell: GAME_ADAPTATION("single shell holding both zones for play"),
    studyCeiling: observed("dark grid ceiling with downlights"),
    lectureWalls: observed("navy panel walls"),
    lectureFloor: observed("carpet"),
    studyWindows: observed("large windows; orientation UNKNOWN, placed on the north wall for play"),
    studyWalls: observed("wood wall panels")
  })
});

const { halfWidth: W, halfDepth: D, ceiling: H, partition } = JEONGSEOK_B1_CREATIVE;

// Eight official rooms (JSL-R0-CREATIVE-FACILITY-GUIDE); two representative modules are placed.
export const GROUP_STUDY_ROOM_MODULE = Object.freeze({
  width: 2.8, depth: 3.0, glass: 0.06, doorWidth: 0.9,
  table: Object.freeze({ width: 1.2, depth: 0.7 }), chairsPerSide: 2,
  officialRoomCount: 8,
  trace: traced(SOURCE_CLASS.OBSERVED_MUSE, ["JSL-R0-F03-CREATIVE-2024", "JSL-R0-CREATIVE-FACILITY-GUIDE"],
    "glass group study room with table, chairs and wall monitor")
});
export const GROUP_STUDY_ROOM_SLOTS = Object.freeze([
  Object.freeze({ id: "group_study_A", status: "PLACED", minX: -4.3, minZ: -D }),
  Object.freeze({ id: "group_study_B", status: "PLACED", minX: -1.2, minZ: -D }),
  ...["C", "D", "E", "F", "G", "H"].map(id => Object.freeze({ id: `group_study_${id}`, status: "RESERVED_UNPLACED",
    reason: "real position of the remaining official rooms is UNKNOWN" }))
]);

function groupStudyRoom(slot) {
  const m = GROUP_STUDY_ROOM_MODULE;
  const x0 = slot.minX, x1 = slot.minX + m.width, z0 = slot.minZ, z1 = slot.minZ + m.depth;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const doorL = cx - m.doorWidth / 2, doorR = cx + m.doorWidth / 2;
  const pre = slot.id;
  return [
    item(`${pre}_glass_w`, "glass_wall", [x0, 0, cz], [m.glass, H, m.depth], m.trace),
    item(`${pre}_glass_e`, "glass_wall", [x1, 0, cz], [m.glass, H, m.depth], m.trace),
    item(`${pre}_glass_n_l`, "glass_wall", [(x0 + doorL) / 2, 0, z1], [doorL - x0, H, m.glass], m.trace),
    item(`${pre}_glass_n_r`, "glass_wall", [(doorR + x1) / 2, 0, z1], [x1 - doorR, H, m.glass], m.trace),
    item(`${pre}_door_header`, "glass_header", [cx, H - 0.35, z1], [m.doorWidth, 0.35, m.glass], m.trace, { collide: false }),
    item(`${pre}_plate`, "room_plate", [doorR + 0.25, 0.95, z1 + 0.05], [0.24, 0.16, 0.03],
      GAME_ADAPTATION("blank room plate; real numbering/order UNKNOWN"), { collide: false, detail: "decor" }),
    item(`${pre}_monitor`, "wall_monitor", [cx, 0.62, z0 + 0.06], [1.2, 0.68, 0.06], m.trace, { collide: false }),
    ...tableWithChairs(`${pre}_table`, { x: cx, z: cz - 0.2, width: m.table.width, depth: m.table.depth,
      chairsPerSide: m.chairsPerSide, trace: m.trace, chairModule: "mesh_chair", module: "meeting_table" })
  ];
}

const slatColumn = observed("floor-to-ceiling wood-slat round structural column (NOT a light fitting)");
const longTable = observed("long shared table with power strip; placement is a game value");

// Curved glass bay on the west wall with its opening facing north.
const bayCenter = Object.freeze({ x: -W, z: 4.8 }), bayRadius = 2.0;
const bayItems = [];
for (let a = -90; a < 45; a += 15) {
  const r0 = a * Math.PI / 180, r1 = (a + 15) * Math.PI / 180;
  const p = { x: bayCenter.x + bayRadius * Math.cos(r0), z: bayCenter.z + bayRadius * Math.sin(r0) };
  const q = { x: bayCenter.x + bayRadius * Math.cos(r1), z: bayCenter.z + bayRadius * Math.sin(r1) };
  const len = Math.hypot(q.x - p.x, q.z - p.z);
  bayItems.push(item(`curved_glass_${a + 90}`, "curved_glass", [(p.x + q.x) / 2, 0, (p.z + q.z) / 2],
    [Math.max(0.1, Math.abs(q.x - p.x)), H, Math.max(0.1, Math.abs(q.z - p.z))],
    observed("curved glass partition; bay position is a game value"),
    { segment: Object.freeze({ length: len, yaw: Math.atan2(q.x - p.x, q.z - p.z) * 180 / Math.PI }) }));
}

const items = [
  // ---- study zone ----
  ...[-9, -3.5].flatMap(x => [-3, 3].map(z =>
    item(`slat_column_${x === -9 ? "w" : "c"}_${z < 0 ? "s" : "n"}`, "column_round_slat", [x, 0, z], [0.9, H, 0.9], slatColumn, { radius: 0.45 }))),
  ...tableWithChairs("long_table_w", { x: -6.25, z: 0, width: 5.0, depth: 1.1, chairsPerSide: 4, alongZ: true,
    trace: longTable, module: "long_table", chairModule: "mesh_chair" }),
  ...tableWithChairs("long_table_c", { x: -0.3, z: 0, width: 5.0, depth: 1.1, chairsPerSide: 4, alongZ: true,
    trace: longTable, module: "long_table", chairModule: "mesh_chair" }),
  ...[-7.5, -3.5, 0.5].flatMap((x, i) => [
    item(`sofa_${i}`, "sofa", [x, 0, 7.6], [2.0, 0.42, 0.8], observed("sofa seating by the windows"), { seats: 2 }),
    item(`coffee_table_${i}`, "coffee_table", [x, 0, 6.35], [0.9, 0.25, 0.5], GAME_ADAPTATION("low table"))
  ]),
  ...bayItems,
  item("bay_table", "round_table", [-W + 1.0, 0, bayCenter.z], [0.7, 0.36, 0.7], GAME_ADAPTATION("small table inside the glass bay")),
  ...GROUP_STUDY_ROOM_SLOTS.filter(slot => slot.status === "PLACED").flatMap(groupStudyRoom),
  // ---- lecture zone ----
  item("tiered_seating", "tiered_seating", [5.9, 0, 0], [3.0, 0.6, 7.2],
    observed("stepped wooden seating facing the screen; walk-around blockout, tiers are not walkable"), { tiers: 3, facing: 90 }),
  item("lecture_screen", "lecture_screen", [W - 0.05, 0.42, 0], [0.06, 1.15, 4.2], observed("large screen on the navy wall"), { collide: false }),
  item("lectern", "lectern", [W - 1.6, 0, -2.6], [0.6, 0.55, 0.5], GAME_ADAPTATION("small lectern")),
  ...[-2.4, 0, 2.4].map(z => item(`ring_pendant_${z < 0 ? "s" : z > 0 ? "n" : "c"}`, "ring_pendant", [5.9, H - 0.5, z], [1.1, 0.06, 1.1],
    observed("ring pendant light (fitting, not a column)"), { collide: false })),
  ...[-2.0, 2.0].map(z => item(`cylinder_fitting_${z < 0 ? "s" : "n"}`, "ceiling_cylinder", [9.6, H - 0.32, z], [0.32, 0.32, 0.32],
    observed("ceiling cylinder light fitting; does not reach the floor"), { collide: false }))
];

const partitionObstacles = [
  boxOf("jsl_b1c_partition_s", partition.minX, partition.maxX, -D, partition.openingMinZ, 0, H + 0.4),
  boxOf("jsl_b1c_partition_n", partition.minX, partition.maxX, partition.openingMaxZ, D, 0, H + 0.4)
];

const portalTrace = GAME_ADAPTATION("temporary transfer; real B1 circulation UNKNOWN");

export const JEONGSEOK_B1_CREATIVE_SPAWN = anchor(-6, -7.2, 0, GAME_ADAPTATION("arrival from the 1F temporary transfer"));
export const JEONGSEOK_B1_CREATIVE_EXIT = Object.freeze({
  id: "JEONGSEOK_B1_CREATIVE_TO_LOBBY", position: Object.freeze({ x: -6, z: -D + PORTAL_WALL_INSET }), radius: 1.1, trace: portalTrace
});
export const JEONGSEOK_B1_CREATIVE_PORTALS = Object.freeze([
  Object.freeze({ id: "JEONGSEOK_B1_CREATIVE_TO_READING", target: "ROOM_JEONGSEOK_B1_READING", kind: "switch",
    icon: "⬅️", label: "제2열람실로 이동 (B1 임시 연결)",
    position: Object.freeze({ x: -W + PORTAL_WALL_INSET, z: 0 }), radius: 1.1,
    arrival: anchor(-W + 1.8, 0, 90, portalTrace), trace: portalTrace })
]);

export const JEONGSEOK_B1_CREATIVE_LAYOUT = freezeLayout({
  roomId: JEONGSEOK_B1_CREATIVE_ROOM_ID,
  shell: JEONGSEOK_B1_CREATIVE,
  items,
  obstacles: [
    ...shellObstacles("jsl_b1c", JEONGSEOK_B1_CREATIVE),
    ...partitionObstacles,
    ...items.filter(entry => entry.collide).map(entry => itemObstacle("jsl_b1c", entry))
  ],
  bounds: shellBounds(JEONGSEOK_B1_CREATIVE),
  spawn: JEONGSEOK_B1_CREATIVE_SPAWN,
  exit: JEONGSEOK_B1_CREATIVE_EXIT,
  portals: JEONGSEOK_B1_CREATIVE_PORTALS,
  zones: [
    { id: "study", minX: -W, maxX: partition.minX, trace: observed("study / rest zone") },
    { id: "lecture", minX: partition.maxX, maxX: W, trace: observed("lecture zone") }
  ],
  aisles: [
    { id: "creative_entry_to_study", width: 1.2, points: [{ x: -6, z: -7.2 }, { x: -6, z: -4.4 }, { x: 1.9, z: -4.4 }] },
    { id: "creative_study_to_lecture", width: 1.2, points: [{ x: 1.9, z: -4.4 }, { x: 1.9, z: -0.5 }, { x: 3.6, z: -0.5 },
      { x: 3.6, z: -5.0 }, { x: 9.0, z: -5.0 }, { x: 9.0, z: 0 }] },
    { id: "creative_reading_link", width: 1.0, points: [{ x: -W + 1.8, z: 0 }, { x: -9.0, z: 0 }] }
  ]
});
