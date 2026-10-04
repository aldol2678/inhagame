import test from "node:test";
import assert from "node:assert/strict";

import { buildRoadNetworkAudit } from "../tools/road-network-audit.mjs";

test("Road Network v2 P0 audit exposes current virtual junction and authority mismatch queues", () => {
  const audit = buildRoadNetworkAudit();

  // Keep one stable machine-readable line in CI so the current JUNCTION queue can be
  // recovered without reproducing the whole campus runtime outside the repository.
  console.log("ROAD_NETWORK_AUDIT_JSON=" + JSON.stringify(audit));

  assert.equal(audit.schema, "inha.road-network-audit/1");
  assert.ok(audit.nav.nodeCount > 0);
  assert.ok(audit.nav.edgeCount > 0);
  assert.ok(audit.nav.virtualJunctionCount > 0, "current campus graph should expose reviewable JUNCTION connectors");
  assert.equal(audit.nav.droppedLineIds.length, 0, "current authored navigation lines remain in one routable component");

  const deferred = new Set(audit.sourceEvidence.deferredRoads.map(road => road.osmWayId));
  assert.ok(deferred.has(1098491074), "law-school road conflict stays visible");
  assert.ok(deferred.has(216916384), "60th-building road conflict stays visible");

  assert.ok(
    audit.authorityParity.renderedNotNavigated.includes("main_gate_approach"),
    "main-gate rendered approach remains visible as an authority-parity issue"
  );
});
