import test from "node:test";
import assert from "node:assert/strict";
import {
  MAP_DISCOVERY_STATE,
  MAP_GATE_STATE,
  MAP_POI_PRESENTATION,
  MAP_SURFACE,
  createMapPoiRegistry
} from "../src/minimap/minimap-poi-registry.js";

const base = (poiId, priority = 10, extra = {}) => ({
  poiId,
  title: poiId,
  kind: "LANDMARK",
  sourceRef: { type: "TEST", id: poiId },
  iconKey: "landmark",
  priority,
  labelMode: "NONE",
  surfaces: [MAP_SURFACE.MINIMAP],
  ...extra
});

test("registry rejects duplicate stable poi ids", () => {
  assert.throws(() => createMapPoiRegistry({
    definitions: [base("poi.same"), base("poi.same")],
    resolvePosition: () => ({ x: 0, z: 0 })
  }), /Duplicate poiId/);
});

test("sourceRef position resolves without copying coordinates into the definition", () => {
  const seen = [];
  const registry = createMapPoiRegistry({
    definitions: [base("poi.main-gate")],
    resolvePosition: (sourceRef, definition) => {
      seen.push({ sourceRef, definition });
      return { x: 12.5, z: -88 };
    }
  });
  const poi = registry.get("poi.main-gate");
  assert.deepEqual({ x: poi.x, z: poi.z }, { x: 12.5, z: -88 });
  assert.deepEqual(seen[0].sourceRef, { type: "TEST", id: "poi.main-gate" });
  assert.equal("x" in seen[0].definition, false, "definition has no duplicated world coordinate");
});

test("Back Gate-like gate state passes through the owner and changes presentation", () => {
  let gate = MAP_GATE_STATE.LOCKED_PROGRESS;
  const registry = createMapPoiRegistry({
    definitions: [base("poi.back-gate", 20, { gateRef: { type: "SPAWN", id: "BACK_GATE" } })],
    resolvePosition: () => ({ x: 100, z: 140 }),
    resolveGateState: ref => {
      assert.deepEqual(ref, { type: "SPAWN", id: "BACK_GATE" });
      return gate;
    }
  });
  let poi = registry.get("poi.back-gate");
  assert.equal(poi.gateState, MAP_GATE_STATE.LOCKED_PROGRESS);
  assert.equal(poi.presentation, MAP_POI_PRESENTATION.LOCKED);
  gate = MAP_GATE_STATE.AVAILABLE;
  poi = registry.get("poi.back-gate");
  assert.equal(poi.gateState, MAP_GATE_STATE.AVAILABLE);
  assert.equal(poi.presentation, MAP_POI_PRESENTATION.NORMAL);
});

test("resolver failures become UNKNOWN, never silently AVAILABLE or LOCKED", () => {
  const registry = createMapPoiRegistry({
    definitions: [base("poi.fail", 1, { gateRef: { id: "x" }, discoveryRef: { id: "y" } })],
    resolvePosition: () => ({ x: 0, z: 0 }),
    resolveGateState: () => { throw Error("gate offline"); },
    resolveDiscoveryState: () => { throw Error("discovery offline"); },
    clock: { now: () => 123 }
  });
  const poi = registry.get("poi.fail");
  assert.equal(poi.gateState, MAP_GATE_STATE.UNKNOWN);
  assert.equal(poi.discoveryState, MAP_DISCOVERY_STATE.UNKNOWN);
  assert.equal(poi.presentation, MAP_POI_PRESENTATION.UNKNOWN);
  assert.equal(poi.visible, true);
  assert.deepEqual(registry.errors.map(({ where, at }) => ({ where, at })), [
    { where: "gate", at: 123 },
    { where: "discovery", at: 123 }
  ]);
});

test("HIDDEN POIs are omitted by default but remain inspectable", () => {
  const registry = createMapPoiRegistry({
    definitions: [base("poi.hidden")],
    resolvePosition: () => ({ x: 0, z: 0 }),
    resolveGateState: () => MAP_GATE_STATE.HIDDEN
  });
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.get("poi.hidden").visible, false);
  assert.equal(registry.list({ includeHidden: true }).length, 1);
});

test("UNDISCOVERED remains distinct from lock state", () => {
  const registry = createMapPoiRegistry({
    definitions: [base("poi.secret", 1, { discoveryRef: { id: "secret" } })],
    resolvePosition: () => ({ x: 1, z: 2 }),
    resolveGateState: () => MAP_GATE_STATE.AVAILABLE,
    resolveDiscoveryState: () => MAP_DISCOVERY_STATE.UNDISCOVERED
  });
  const poi = registry.get("poi.secret");
  assert.equal(poi.gateState, MAP_GATE_STATE.AVAILABLE);
  assert.equal(poi.discoveryState, MAP_DISCOVERY_STATE.UNDISCOVERED);
  assert.equal(poi.presentation, MAP_POI_PRESENTATION.UNDISCOVERED);
});

test("surface filtering and priority order are deterministic", () => {
  const registry = createMapPoiRegistry({
    definitions: [
      base("poi.low", 5),
      base("poi.high-b", 50),
      base("poi.high-a", 50),
      base("poi.full-only", 999, { surfaces: [MAP_SURFACE.FULL_MAP] })
    ],
    resolvePosition: ref => ({ x: ref.id.length, z: 0 })
  });
  assert.deepEqual(registry.list().map(p => p.poiId), ["poi.high-a", "poi.high-b", "poi.low"]);
  assert.deepEqual(registry.list({ surface: MAP_SURFACE.FULL_MAP }).map(p => p.poiId), ["poi.full-only"]);
});

test("invalid resolved positions never produce a marker at a nonsense coordinate", () => {
  const registry = createMapPoiRegistry({
    definitions: [base("poi.bad")],
    resolvePosition: () => ({ x: NaN, z: 0 }),
    clock: { now: () => 456 }
  });
  const poi = registry.get("poi.bad");
  assert.equal(poi.validPosition, false);
  assert.equal(poi.visible, false);
  assert.equal(poi.x, null);
  assert.equal(poi.z, null);
  assert.deepEqual(registry.list(), []);
  assert.equal(registry.errors.at(-1).where, "position");
  assert.equal(registry.errors.at(-1).at, 456);
});

test("invalid definitions fail at construction instead of leaking into render state", () => {
  assert.throws(() => createMapPoiRegistry({
    definitions: [{ ...base("x"), poiId: "?" }],
    resolvePosition: () => ({ x: 0, z: 0 })
  }), /Invalid poiId/);
  assert.throws(() => createMapPoiRegistry({
    definitions: [{ ...base("poi.x"), surfaces: ["NOPE"] }],
    resolvePosition: () => ({ x: 0, z: 0 })
  }), /Invalid surfaces/);
  assert.throws(() => createMapPoiRegistry({
    definitions: [base("poi.x")],
    resolvePosition: null
  }), /resolvePosition is required/);
});
