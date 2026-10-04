import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as core from 'recast-navigation';
import * as generators from 'recast-navigation/generators';
import { loadNpcPopulation } from '../../npc-factory/npc-population-loader.mjs';
import { createNpcNavigator } from '../../npc-factory/dev-navigation.mjs';
import { createPurposefulRoster } from '../../npc-factory/purposeful-roster.mjs';
import { campusNavGraphData } from '../../src/navigation/campus-navigation.js';
import { createRecastNpcNavigator } from '../../npc-factory/recast-navigator-poc.mjs';
import { evaluateRecastSchedule } from '../../npc-factory/recast-schedule-evaluation.mjs';

export const actualRecastLoader = async () => ({ core, generators });

export async function evaluateCampus() {
  const fetcher = async url => new Response(await readFile(new URL(`../..${url}`, import.meta.url)));
  const started = performance.now();
  const { batch, expansion } = await loadNpcPopulation({ fetcher, retryDelays: [] });
  const legacyNavigator = createNpcNavigator(batch);
  const roster = createPurposefulRoster(batch, legacyNavigator);
  const recastNavigator = await createRecastNpcNavigator(legacyNavigator, {
    loader: actualRecastLoader, corridorGraph: campusNavGraphData()
  });
  const generatedMs = performance.now() - started;
  try {
    const result = evaluateRecastSchedule({ batch, roster, legacyNavigator, recastNavigator, expansion });
    // Independent readback over every returned waypoint, not just the adapter's ok bit.
    let unsafeReturnedRoutes = 0, incorrectEndpoints = 0;
    for (const member of roster.values()) for (let i = 0; i < member.schedule.length; i++) {
      const entry = member.schedule[i], previous = member.schedule[(i + member.schedule.length - 1) % member.schedule.length];
      if (entry.remote || previous.remote) continue;
      const from = member.destinations[previous.destination]?.position;
      const to = member.destinations[entry.destination]?.position;
      if (!from || !to) continue;
      const route = recastNavigator.route(from, to);
      if (!route) continue;
      let last = from, safe = true;
      for (const point of route) { safe &&= legacyNavigator.segmentSafe(last, point); last = point; }
      if (!safe) unsafeReturnedRoutes++;
      if (Math.hypot(last.x - to.x, last.z - to.z) > 1e-6) incorrectEndpoints++;
    }
    return { ...result, generatedMs, elapsedMs: performance.now() - started,
      unsafeReturnedRoutes, incorrectEndpoints, rssBytes: process.memoryUsage().rss };
  } finally {
    recastNavigator.destroy();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await evaluateCampus(), null, 2));
}
