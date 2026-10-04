import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import {
  CAMPUS_NAV_TOLERANCE,
  campusNavGraphData,
  campusNavPolylines
} from "../src/navigation/campus-navigation.js";
import { GATE_DORM_CORRIDORS } from "../src/main-gate-road-layout.js";
import { NAV_EDGE_KIND } from "../src/navigation/nav-graph.js";

const evidenceUrl = new URL("../data/reality/evidence/roads/source.json", import.meta.url);

const round = value => Number(value.toFixed(3));

export function buildRoadNetworkAudit() {
  const graph = campusNavGraphData();
  const nodes = new Map(graph.nodes.map(node => [node.id, node]));
  const polylines = campusNavPolylines();
  const navLineIds = new Set(polylines.map(line => line.id));

  const incident = nodeId => graph.edges
    .filter(edge => edge.kind !== NAV_EDGE_KIND.CONNECTOR && (edge.a === nodeId || edge.b === nodeId))
    .map(edge => Object.freeze({ lineId: edge.lineId, source: edge.source, kind: edge.kind }))
    .filter((value, index, values) =>
      values.findIndex(other =>
        other.lineId === value.lineId && other.source === value.source && other.kind === value.kind
      ) === index
    );

  const virtualJunctions = graph.edges
    .filter(edge => edge.kind === NAV_EDGE_KIND.CONNECTOR)
    .map(edge => {
      const a = nodes.get(edge.a);
      const b = nodes.get(edge.b);
      const length = Math.hypot(b.x - a.x, b.z - a.z);
      return Object.freeze({
        edgeId: edge.id,
        lineId: edge.lineId,
        lengthWU: round(length),
        approxMeters: round(length * 2),
        from: Object.freeze({
          x: round(a.x),
          z: round(a.z),
          adjacent: Object.freeze(incident(edge.a))
        }),
        to: Object.freeze({
          x: round(b.x),
          z: round(b.z),
          adjacent: Object.freeze(incident(edge.b))
        })
      });
    })
    .sort((a, b) => b.lengthWU - a.lengthWU);

  const renderedGateCorridors = GATE_DORM_CORRIDORS.map(corridor => Object.freeze({
    id: corridor.id,
    kind: corridor.kind,
    widthWU: corridor.width,
    includedInCampusNavigation: navLineIds.has(corridor.id)
  }));

  const source = JSON.parse(readFileSync(evidenceUrl, "utf8"));
  const sourceCounts = {};
  for (const line of polylines) sourceCounts[line.source] = (sourceCounts[line.source] ?? 0) + 1;

  const renderedNotNavigated = renderedGateCorridors
    .filter(corridor => !corridor.includedInCampusNavigation)
    .map(corridor => corridor.id);

  return Object.freeze({
    schema: "inha.road-network-audit/1",
    nav: Object.freeze({
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      droppedLineIds: graph.dropped?.lineIds ?? [],
      junctionToleranceWU: CAMPUS_NAV_TOLERANCE.junction,
      junctionToleranceApproxMeters: CAMPUS_NAV_TOLERANCE.junction * 2,
      virtualJunctionCount: virtualJunctions.length,
      virtualJunctions
    }),
    authorityParity: Object.freeze({
      renderedGateCorridors,
      renderedNotNavigated
    }),
    sourceEvidence: Object.freeze({
      sourceUrl: source.sourceUrl,
      retrievedAt: source.retrievedAt,
      rawSha256: source.rawSha256,
      deferredRoads: source.deferred ?? []
    }),
    navSourceCounts: Object.freeze(sourceCounts),
    findings: Object.freeze([
      ...(virtualJunctions.length
        ? [`${virtualJunctions.length} navigation JUNCTION connector(s) bridge gaps that need physical-surface review.`]
        : []),
      ...(renderedNotNavigated.length
        ? [`${renderedNotNavigated.length} main-gate/dorm rendered corridor(s) are not explicit Campus Navigation polylines.`]
        : []),
      ...((source.deferred ?? []).length
        ? [`${source.deferred.length} OSM road geometry conflict(s) remain deferred in source evidence.`]
        : [])
    ])
  });
}

export function roadNetworkAuditMarkdown(audit = buildRoadNetworkAudit()) {
  const lines = [
    "# INHA WORLD Road Network v2 — P0 Audit",
    "",
    `- Navigation nodes / edges: ${audit.nav.nodeCount} / ${audit.nav.edgeCount}`,
    `- Virtual JUNCTIONs: ${audit.nav.virtualJunctionCount}`,
    `- Junction tolerance: ${audit.nav.junctionToleranceWU} WU (~${audit.nav.junctionToleranceApproxMeters} m)`,
    `- Dropped authored lines: ${audit.nav.droppedLineIds.length}`,
    `- Rendered gate corridors missing explicit nav lines: ${audit.authorityParity.renderedNotNavigated.length}`,
    `- Deferred OSM road conflicts: ${audit.sourceEvidence.deferredRoads.length}`,
    "",
    "## Virtual JUNCTION review queue",
    ""
  ];

  if (!audit.nav.virtualJunctions.length) lines.push("- none");
  for (const item of audit.nav.virtualJunctions) {
    const left = item.from.adjacent.map(edge => edge.lineId).join(", ") || "none";
    const right = item.to.adjacent.map(edge => edge.lineId).join(", ") || "none";
    lines.push(
      `- ${item.edgeId} / ${item.lineId}: ${item.lengthWU} WU (~${item.approxMeters} m), ` +
      `(${item.from.x}, ${item.from.z}) [${left}] → (${item.to.x}, ${item.to.z}) [${right}]`
    );
  }

  lines.push("", "## Rendered but not explicitly navigated", "");
  if (!audit.authorityParity.renderedNotNavigated.length) lines.push("- none");
  for (const id of audit.authorityParity.renderedNotNavigated) lines.push(`- ${id}`);

  lines.push("", "## Deferred OSM road conflicts", "");
  if (!audit.sourceEvidence.deferredRoads.length) lines.push("- none");
  for (const road of audit.sourceEvidence.deferredRoads) {
    lines.push(`- OSM way ${road.osmWayId}: ${road.reason}`);
  }

  lines.push("", "## Interpretation", "");
  lines.push(
    "- A JUNCTION is not automatically a bug. It is a review queue item: confirm a visible road, walkway, plaza surface, or remove the virtual link.",
    "- This audit is diagnostic only. It does not move roads, buildings, navigation nodes, or production geometry."
  );

  return lines.join("\n");
}

const isDirectRun = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  const audit = buildRoadNetworkAudit();
  if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify(audit, null, 2)}\n`);
  else process.stdout.write(`${roadNetworkAuditMarkdown(audit)}\n`);
}
