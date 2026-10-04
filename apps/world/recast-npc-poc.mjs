import { createNpcNavigator } from './npc-factory/dev-navigation.mjs';
import { loadNpcPopulation } from './npc-factory/npc-population-loader.mjs';
import { createPurposefulRoster } from './npc-factory/purposeful-roster.mjs';
import { createRecastNpcNavigator, routeLength } from './npc-factory/recast-navigator-poc.mjs';

const output = document.getElementById('recast-poc-output');
const status = document.getElementById('recast-poc-status');

const fmt = value => Number.isFinite(value) ? value.toFixed(2) : 'n/a';
const routeFor = (navigator, from, to) => navigator.networkRoute?.(from, to) ?? navigator.route(from, to);

async function run() {
  status.textContent = '현행 NPC 48명 데이터를 읽고 Recast navmesh를 생성하는 중…';
  const started = performance.now();
  const { batch, expansion } = await loadNpcPopulation({
    retryDelays: [],
    onExpansionError: error => console.warn('Recast PoC expansion unavailable:', error)
  });
  const baseNavigator = createNpcNavigator(batch);
  const roster = createPurposefulRoster(batch, baseNavigator);
  const recastNavigator = await createRecastNpcNavigator(baseNavigator);

  let eligible = 0;
  let legacyRoutes = 0;
  let recastRoutes = 0;
  let comparable = 0;
  let totalLegacyDistance = 0;
  let totalRecastDistance = 0;
  const failures = [];

  for (const [id, member] of roster) {
    const schedule = member.schedule;
    for (let index = 0; index < schedule.length; index++) {
      const entry = schedule[index];
      const previous = schedule[(index + schedule.length - 1) % schedule.length];
      if (entry.remote || previous.remote) continue;
      const from = member.destinations[previous.destination]?.position;
      const to = member.destinations[entry.destination]?.position;
      if (!from || !to) continue;

      eligible++;
      const legacy = routeFor(baseNavigator, from, to);
      const recast = recastNavigator.route(from, to);
      if (legacy) legacyRoutes++;
      if (recast) recastRoutes++;

      if (legacy && recast) {
        comparable++;
        totalLegacyDistance += routeLength(from, legacy);
        totalRecastDistance += routeLength(from, recast);
      } else if (legacy && !recast && failures.length < 20) {
        failures.push({ npc: id, leg: index, from: previous.destination, to: entry.destination });
      }
    }
  }

  const elapsedMs = performance.now() - started;
  const result = {
    verdict: eligible > 0 && recastRoutes === eligible ? 'PASS' :
      recastRoutes >= Math.ceil(eligible * 0.95) ? 'PARTIAL_PASS' : 'FAIL',
    population: batch.npcs.length,
    expansion,
    eligibleLegs: eligible,
    legacyRoutes,
    recastRoutes,
    coverage: eligible ? recastRoutes / eligible : 0,
    comparable,
    averageLegacyDistance: comparable ? totalLegacyDistance / comparable : null,
    averageRecastDistance: comparable ? totalRecastDistance / comparable : null,
    averageDistanceDeltaRatio: comparable && totalLegacyDistance > 0
      ? (totalRecastDistance - totalLegacyDistance) / totalLegacyDistance : null,
    surfaceTiles: recastNavigator.recast.surfaceTiles,
    triangleCount: recastNavigator.recast.triangleCount,
    recastPackageVersion: recastNavigator.recast.packageVersion,
    elapsedMs,
    failures
  };

  window.__RECAST_NPC_POC__ = Object.freeze(result);
  status.textContent = `${result.verdict} · Recast ${recastRoutes}/${eligible} 경로 · NPC ${batch.npcs.length}명`;
  output.textContent = JSON.stringify(result, null, 2);
  recastNavigator.destroy();
}

run().catch(error => {
  const result = { verdict: 'ERROR', message: error?.message ?? String(error), stack: error?.stack ?? null };
  window.__RECAST_NPC_POC__ = Object.freeze(result);
  status.textContent = `ERROR · ${result.message}`;
  output.textContent = JSON.stringify(result, null, 2);
  console.error(error);
});
