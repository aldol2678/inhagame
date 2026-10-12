// JSL-B2 · B1 통합 제2열람실 (engine-free layout).
//
// 2026-08 reporting (JSL-R0-F03-READING-2026) says the former 2-1 and 2-2 rooms were merged and the
// dividing wall removed, so this is ONE open room: no 2-1/2-2 wall is rebuilt and the graduate-only
// 54 reservation seats get no physical partition (service category only, CONFLICT in R0).
// The article's 474 seats are a reference figure; this blockout places representative seat modules
// (open tables, white-partition carrels, standing counter, accessible desk) on a game grid.
// Observed finishes: entrance sign, wood-panel square columns, bright ceiling panels, white
// partitions. Seat arrangement, room size and aisle widths are GAME_ADAPTATION.

import { GAME_ADAPTATION, SOURCE_CLASS, traced } from "./interior-evidence.js";
import { PORTAL_WALL_INSET, anchor, freezeLayout, item, itemObstacle, shellBounds, shellObstacles, tableWithChairs } from "./interior-kit.js";

export const JEONGSEOK_B1_READING_ROOM_ID = "ROOM_JEONGSEOK_B1_READING";

const READING = ["JSL-R0-F03-READING-2026"];
const observed = note => traced(SOURCE_CLASS.OBSERVED_MUSE, READING, note);

export const JEONGSEOK_B1_READING = Object.freeze({
  halfWidth: 13,
  halfDepth: 9,
  ceiling: 1.75, // lower B1 ceiling (~3.5 m), presentation estimate
  wall: 0.35,
  camera: Object.freeze({ initial: 2.3, min: 1.1, max: 3.0 }),
  articleSeatReference: Object.freeze({ total: 474, open: 320, partitioned: 126, standing: 20, carrel: 6, accessible: 2,
    evidence: "JSL-R0-F03-READING-2026", gameRequirement: false }),
  graduateOnlyServiceSeats: Object.freeze({ count: 54, physicalPartition: false, evidence: "JSL-R0-SEAT-SERVICE-20261012" }),
  mergedRoom: Object.freeze({ formerRooms: Object.freeze(["2-1", "2-2"]), dividingWallRebuilt: false }),
  trace: Object.freeze({
    shell: GAME_ADAPTATION("single open room; real plan and removed wall position UNKNOWN"),
    ceiling: observed("bright ceiling panels"),
    floor: GAME_ADAPTATION("neutral floor finish")
  })
});

const { halfWidth: W, halfDepth: D, ceiling: H } = JEONGSEOK_B1_READING;
const openTable = GAME_ADAPTATION("open table module on a game grid");
const carrelTrace = observed("white partition desks; row arrangement is a game value");

const items = [
  // Wood-panel square columns (observed); grid positions are game values.
  ...[-6.5, 6.5].flatMap(x => [-2.0, 4.0].map(z =>
    item(`wood_column_${x < 0 ? "w" : "e"}_${z < 0 ? "s" : "n"}`, "column_wood", [x, 0, z], [0.7, H, 0.7],
      observed("wood-panel square column")))),
  // West block · open tables, 6 seats each.
  ...[-9.4, -3.6].flatMap(x => [-3.0, -0.3, 2.4, 5.1].flatMap(z =>
    tableWithChairs(`open_table_${x < -5 ? "w" : "c"}_${String(z).replace(/[-.]/g, "_")}`,
      { x, z, width: 2.4, depth: 1.0, chairsPerSide: 3, trace: openTable }))),
  // East block · white-partition carrel rows, 4 desks each.
  ...[4.0, 9.4].flatMap(x => [-3.0, -0.4, 2.2, 4.8].flatMap(z => {
    const id = `carrel_row_${x < 6 ? "c" : "e"}_${String(z).replace(/[-.]/g, "_")}`;
    return [
      item(id, "carrel_row", [x, 0, z], [3.2, 0.62, 0.62], carrelTrace, { desks: 4 }),
      ...[0, 1, 2, 3].map(i => item(`${id}_seat_${i}`, "carrel", [x - 1.2 + i * 0.8, 0, z - 0.55], [0.34, 0.46, 0.34],
        carrelTrace, { facing: 0 }))
    ];
  })),
  item("standing_counter", "standing_counter", [0, 0, 8.25], [4.8, 0.55, 0.6],
    GAME_ADAPTATION("standing desk counter; article lists standing seats, position is a game value"), { standingSlots: 5 }),
  ...[0, 1, 2, 3, 4].map(i => item(`standing_slot_${i}`, "standing_desk_slot", [-1.92 + i * 0.96, 0, 7.75], [0.3, 0.02, 0.3],
    GAME_ADAPTATION("standing position marker"), { collide: false, detail: "decor" })),
  item("accessible_desk", "accessible_desk", [-4.4, 0, -6.4], [1.6, 0.38, 0.9],
    GAME_ADAPTATION("accessible desk with clear knee space; position is a game value")),
  item("accessible_seat_0", "accessible_seat", [-4.4, 0, -6.95], [0.7, 0.02, 0.5],
    GAME_ADAPTATION("wheelchair space, no chair"), { collide: false, detail: "decor" }),
  item("entry_sign", "room_sign_2", [-2.4, 1.05, -D + 0.06], [1.5, 0.42, 0.06],
    observed("제2열람실 entrance sign; rendered as an abstract '2' plate, no school logo"), { collide: false }),
  item("quiet_notice", "notice_plate", [2.4, 1.05, -D + 0.06], [1.0, 0.36, 0.05],
    GAME_ADAPTATION("plain quiet-zone plate"), { collide: false, detail: "decor" })
];

const portalTrace = GAME_ADAPTATION("temporary transfer; real B1 circulation UNKNOWN");

export const JEONGSEOK_B1_READING_SPAWN = anchor(0, -7.2, 0, GAME_ADAPTATION("arrival from the 1F temporary transfer"));
export const JEONGSEOK_B1_READING_EXIT = Object.freeze({
  id: "JEONGSEOK_B1_READING_TO_LOBBY", position: Object.freeze({ x: 0, z: -D + PORTAL_WALL_INSET }), radius: 1.1, trace: portalTrace
});
export const JEONGSEOK_B1_READING_PORTALS = Object.freeze([
  Object.freeze({ id: "JEONGSEOK_B1_READING_TO_CREATIVE", target: "ROOM_JEONGSEOK_B1_CREATIVE", kind: "switch",
    icon: "➡️", label: "Creative Space로 이동 (B1 임시 연결)",
    position: Object.freeze({ x: W - PORTAL_WALL_INSET, z: -6.4 }), radius: 1.1,
    arrival: anchor(W - 1.8, -6.4, -90, portalTrace), trace: portalTrace })
]);

export const JEONGSEOK_B1_READING_LAYOUT = freezeLayout({
  roomId: JEONGSEOK_B1_READING_ROOM_ID,
  shell: JEONGSEOK_B1_READING,
  items,
  obstacles: [
    ...shellObstacles("jsl_b1r", JEONGSEOK_B1_READING),
    ...items.filter(entry => entry.collide).map(entry => itemObstacle("jsl_b1r", entry))
  ],
  bounds: shellBounds(JEONGSEOK_B1_READING),
  spawn: JEONGSEOK_B1_READING_SPAWN,
  exit: JEONGSEOK_B1_READING_EXIT,
  portals: JEONGSEOK_B1_READING_PORTALS,
  zones: [
    { id: "open_tables", minX: -W, maxX: -1.4, trace: openTable },
    { id: "partition_carrels", minX: 1.4, maxX: W, trace: carrelTrace }
  ],
  aisles: [
    { id: "reading_main_aisle", width: 2.0, points: [{ x: 0, z: -7.2 }, { x: 0, z: 6.8 }] },
    { id: "reading_front_cross_aisle", width: 1.2, points: [{ x: -11.8, z: -5.2 }, { x: W - 1.8, z: -5.2 }] },
    { id: "reading_west_secondary", width: 1.0, points: [{ x: -6.5, z: -5.2 }, { x: -6.5, z: -3.0 }] },
    { id: "reading_east_secondary", width: 1.0, points: [{ x: 6.7, z: -5.2 }, { x: 6.7, z: -3.0 }] }
  ]
});
