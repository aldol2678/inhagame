import { createNpcNavigator } from './npc-factory/dev-navigation.mjs';
import { loadNpcPopulation } from './npc-factory/npc-population-loader.mjs';
import { createPurposefulRoster } from './npc-factory/purposeful-roster.mjs';
import { createRecastNpcNavigator } from './npc-factory/recast-navigator-poc.mjs';
import { evaluateRecastSchedule } from './npc-factory/recast-schedule-evaluation.mjs';
import { campusNavGraphData } from './src/navigation/campus-navigation.js';

const output = document.getElementById('recast-poc-output');
const status = document.getElementById('recast-poc-status');

async function run() {
  status.textContent = '현행 NPC 48명 데이터를 읽고 Recast navmesh를 생성하는 중…';
  const started = performance.now();
  const { batch, expansion } = await loadNpcPopulation({
    retryDelays: [],
    onExpansionError: error => console.warn('Recast PoC expansion unavailable:', error)
  });
  const baseNavigator = createNpcNavigator(batch);
  const roster = createPurposefulRoster(batch, baseNavigator);
  const recastNavigator = await createRecastNpcNavigator(baseNavigator, { corridorGraph: campusNavGraphData() });
  try {
    const result = {
      ...evaluateRecastSchedule({ batch, roster, legacyNavigator: baseNavigator, recastNavigator, expansion }),
      elapsedMs: performance.now() - started
    };
    window.__RECAST_NPC_POC__ = Object.freeze(result);
    status.textContent = `${result.verdict} · Recast ${result.recastRoutes}/${result.eligibleLegs} 경로 · NPC ${batch.npcs.length}명`;
    output.textContent = JSON.stringify(result, null, 2);
  } finally {
    recastNavigator.destroy();
  }
}

run().catch(error => {
  const result = { verdict: 'ERROR', message: error?.message ?? String(error), stack: error?.stack ?? null };
  window.__RECAST_NPC_POC__ = Object.freeze(result);
  status.textContent = `ERROR · ${result.message}`;
  output.textContent = JSON.stringify(result, null, 2);
  console.error(error);
});
