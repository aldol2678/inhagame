import test from "node:test";
import assert from "node:assert/strict";

import {
  AOI_GRID_DEFAULTS,
  AOI_MAX_SUBSCRIPTIONS,
  AOI_TOPIC,
  aoiCanObserve,
  aoiCellForPosition,
  aoiCellKey,
  aoiNeighborhood,
  aoiTopic,
  aoiTopicsForPosition,
  decodeAoiCellIndex,
  encodeAoiCellIndex,
  estimateAoiRealtimeEventsPerSecond
} from "../src/network/aoi-grid.js";
import { NEARBY_EXIT_METERS } from "../src/social/nearby-players.js";

function gridPositions(players, spacingM) {
  const side = Math.ceil(Math.sqrt(players));
  return Array.from({ length: players }, (_, index) => ({
    x: (index % side) * spacingM,
    z: Math.floor(index / side) * spacingM
  }));
}

function movingIndexes(players) {
  return Array.from({ length: players }, (_, index) => index)
    .filter((index) => index % 3 !== 2);
}

test("AOI P0-A defaults preserve the current Nearby social radius within 25 subscriptions", () => {
  assert.equal(AOI_GRID_DEFAULTS.cellSizeM, 9);
  assert.equal(AOI_GRID_DEFAULTS.neighborRadiusCells, 2);
  assert.equal(AOI_GRID_DEFAULTS.interactionGuaranteeM, 17);
  assert.equal(AOI_GRID_DEFAULTS.interactionGuaranteeM, NEARBY_EXIT_METERS);
  assert.equal(AOI_MAX_SUBSCRIPTIONS, 25);
  assert.ok(AOI_MAX_SUBSCRIPTIONS < 100, "keeps headroom under the current Realtime per-connection channel limit");
});

test("AOI signed cell encoding is stable across the origin", () => {
  for (const value of [-123, -2, -1, 0, 1, 2, 123]) {
    assert.equal(decodeAoiCellIndex(encodeAoiCellIndex(value)), value);
  }
  assert.deepEqual(aoiCellForPosition({ x: -0.01, z: -9.01 }), { x: -1, z: -2 });
  assert.deepEqual(aoiCellForPosition({ x: 0, z: 8.99 }), { x: 0, z: 0 });
  assert.deepEqual(aoiCellForPosition({ x: 9, z: 9 }), { x: 1, z: 1 });
  assert.equal(aoiCellKey({ x: -2, z: 3 }), "XN2_ZP3");
});

test("AOI topic grammar is deterministic and remains separate from the live Place Zone topic", () => {
  const topic = aoiTopic("AREA_MAIN_HALL", { x: -2, z: 3 });
  assert.equal(topic, "world:campus:AREA_MAIN_HALL:aoi:XN2_ZP3");
  assert.match(topic, AOI_TOPIC);
  assert.throws(() => aoiTopic("RC_0_0", { x: 0, z: 0 }));
});

test("one AOI neighborhood is exactly a 5x5 cell window", () => {
  const cells = aoiNeighborhood({ x: 0, z: 0 });
  assert.equal(cells.length, 25);
  assert.equal(new Set(cells.map(aoiCellKey)).size, 25);
  assert.ok(cells.some((cell) => cell.x === -2 && cell.z === -2));
  assert.ok(cells.some((cell) => cell.x === 2 && cell.z === 2));
  assert.equal(aoiTopicsForPosition("AREA_MAIN_HALL", { x: 0, z: 0 }).length, 25);
});

test("every player within the current 17 m social radius is covered across cell boundaries", () => {
  const anchors = [-18.01, -9.01, -9, -8.99, -0.01, 0, 0.01, 8.99, 9, 9.01, 17.99];
  const offsets = [-17, -12, -9, -6, -0.01, 0, 0.01, 6, 9, 12, 17];
  for (const x of anchors) {
    for (const z of anchors) {
      for (const dx of offsets) {
        for (const dz of offsets) {
          if (Math.hypot(dx, dz) > NEARBY_EXIT_METERS) continue;
          assert.equal(
            aoiCanObserve({ x, z }, { x: x + dx, z: z + dz }),
            true,
            `publisher ${x},${z} observer offset ${dx},${dz}`
          );
        }
      }
    }
  }
});

test("synthetic distributed-campus load becomes bounded, while a dense hotspot remains a known limit", () => {
  const reports = {};
  for (const players of [25, 50, 100]) {
    reports[players] = estimateAoiRealtimeEventsPerSecond({
      positions: gridPositions(players, 15),
      movingIndexes: movingIndexes(players),
      poseHz: 4
    });
  }

  // Diagnostic only, not hosted Supabase proof. The same 2/3-moving pattern as online-load.test.mjs.
  assert.ok(reports[25].totalEventsPerSec <= 500, JSON.stringify(reports[25]));
  assert.ok(reports[50].totalEventsPerSec > 500 && reports[50].totalEventsPerSec <= 2500, JSON.stringify(reports[50]));
  assert.ok(reports[100].totalEventsPerSec > 500 && reports[100].totalEventsPerSec <= 2500, JSON.stringify(reports[100]));

  const dense100 = estimateAoiRealtimeEventsPerSecond({
    positions: gridPositions(100, 8),
    movingIndexes: movingIndexes(100),
    poseHz: 4
  });
  assert.ok(dense100.totalEventsPerSec > 2500, "AOI cells alone do not solve a tightly packed 100-player crowd");

  console.log("\nONLINE AOI P0-A DIAGNOSTIC (synthetic grid, pose Broadcast only)");
  console.table({
    distributed25: reports[25],
    distributed50: reports[50],
    distributed100: reports[100],
    dense100
  });
});
