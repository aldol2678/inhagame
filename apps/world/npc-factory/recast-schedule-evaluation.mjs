import { routeLength } from './recast-navigator-poc.mjs';

// Shared by the standalone browser page and the actual-WASM integration gate.
// Only a complete, legacy-segment-safe Recast route counts. No fallback is counted.
export function evaluateRecastSchedule({ batch, roster, legacyNavigator, recastNavigator,
  expansion, expectedPopulation = 48 } = {}) {
  let eligible = 0, legacyRoutes = 0, recastRoutes = 0, comparable = 0;
  let stationaryLegs = 0, stationaryRoutes = 0, skippedRemoteLegs = 0, skippedMissingEndpoints = 0;
  let totalLegacyDistance = 0, totalRecastDistance = 0;
  let comparableMovement = 0, movementLegacyDistance = 0, movementRecastDistance = 0;
  const failures = [];
  for (const [id, member] of roster) {
    const schedule = member.schedule;
    for (let index = 0; index < schedule.length; index++) {
      const entry = schedule[index];
      const previous = schedule[(index + schedule.length - 1) % schedule.length];
      if (entry.remote || previous.remote) { skippedRemoteLegs++; continue; }
      const from = member.destinations[previous.destination]?.position;
      const to = member.destinations[entry.destination]?.position;
      if (!from || !to) { skippedMissingEndpoints++; continue; }
      eligible++;
      const stationary = Math.hypot(from.x - to.x, from.z - to.z) < 1e-6;
      if (stationary) stationaryLegs++;
      const legacy = legacyNavigator.networkRoute?.(from, to) ?? legacyNavigator.route(from, to);
      const result = recastNavigator.evaluateRoute(from, to);
      const recast = result.ok ? result.route : null;
      if (legacy) legacyRoutes++;
      if (recast) recastRoutes++;
      if (recast && stationary) stationaryRoutes++;
      if (legacy && recast) {
        comparable++;
        totalLegacyDistance += routeLength(from, legacy);
        totalRecastDistance += routeLength(from, recast);
        if (!stationary) {
          comparableMovement++;
          movementLegacyDistance += routeLength(from, legacy);
          movementRecastDistance += routeLength(from, recast);
        }
      }
      if (!recast) {
        const { route, ok, ...diagnostics } = result;
        failures.push({ npc: id, leg: index, from: previous.destination, to: entry.destination,
          fromPosition: { ...from }, toPosition: { ...to }, legacyAvailable: Boolean(legacy), ...diagnostics });
      }
    }
  }
  const gates = {
    populationReady: batch.npcs.length === expectedPopulation && expansion === 'READY',
    nonEmptySchedule: eligible > 0,
    endpointsComplete: skippedMissingEndpoints === 0
  };
  const eligibleReady = Object.values(gates).every(Boolean);
  const verdict = !eligibleReady ? 'FAIL' : recastRoutes === eligible ? 'PASS' :
    recastRoutes >= Math.ceil(eligible * 0.95) ? 'PARTIAL_PASS' : 'FAIL';
  const movementLegs = eligible - stationaryLegs;
  return {
    verdict, gates, scope: 'CAMPUS_PURPOSEFUL_SCHEDULE_ONLY',
    population: batch.npcs.length, expectedPopulation, rosterSize: roster.size, expansion,
    eligibleLegs: eligible, stationaryLegs, stationaryRoutes, movementLegs, skippedRemoteLegs, skippedMissingEndpoints,
    legacyRoutes, recastRoutes, coverage: eligible ? recastRoutes / eligible : 0,
    movementCoverage: movementLegs ? (recastRoutes - stationaryRoutes) / movementLegs : 0,
    comparable,
    averageLegacyDistance: comparable ? totalLegacyDistance / comparable : null,
    averageRecastDistance: comparable ? totalRecastDistance / comparable : null,
    averageDistanceDeltaRatio: comparable && totalLegacyDistance > 0
      ? (totalRecastDistance - totalLegacyDistance) / totalLegacyDistance : null,
    comparableMovement,
    averageMovementLegacyDistance: comparableMovement ? movementLegacyDistance / comparableMovement : null,
    averageMovementRecastDistance: comparableMovement ? movementRecastDistance / comparableMovement : null,
    movementDistanceDeltaRatio: comparableMovement && movementLegacyDistance > 0
      ? (movementRecastDistance - movementLegacyDistance) / movementLegacyDistance : null,
    surfaceTiles: recastNavigator.recast.surfaceTiles,
    corridorQuads: recastNavigator.recast.corridorQuads,
    triangleCount: recastNavigator.recast.triangleCount,
    recastPackageVersion: recastNavigator.recast.packageVersion,
    failures
  };
}
