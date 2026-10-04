import { readFile } from 'node:fs/promises';
import { loadNpcPopulation } from '../../npc-factory/npc-population-loader.mjs';
import { createNpcNavigator } from '../../npc-factory/dev-navigation.mjs';
import { createPurposefulRoster } from '../../npc-factory/purposeful-roster.mjs';
import { campusNavGraphData } from '../../src/navigation/campus-navigation.js';
import { recastArtifactContract } from '../../npc-factory/recast-navigator-poc.mjs';
import { readRecastSourceDigests, recastArtifactInputs, fingerprint } from '../../npc-factory/recast-navmesh-artifact.mjs';

export const localFetcher = async url => {
  try { return new Response(await readFile(new URL(`../..${url}`, import.meta.url))); }
  catch (error) { if (error.code === 'ENOENT') return new Response('', { status: 404 }); throw error; }
};

export async function prepareCampus() {
  const { batch, expansion } = await loadNpcPopulation({ fetcher: localFetcher, retryDelays: [] });
  const legacyNavigator = createNpcNavigator(batch);
  const roster = createPurposefulRoster(batch, legacyNavigator);
  const corridorGraph = campusNavGraphData();
  const contract = recastArtifactContract({ corridorGraph });
  const sourceDigests = await readRecastSourceDigests({ fetcher: localFetcher });
  const inputs = recastArtifactInputs({ batch, roster, expansion, baseNavigator: legacyNavigator,
    corridorGraph, contract, sourceDigests });
  return { batch, expansion, legacyNavigator, roster, corridorGraph, contract,
    inputs, inputSha256: await fingerprint(inputs) };
}

export function auditCampusRoutes({ roster, legacyNavigator }, navigator) {
  let unsafeReturnedRoutes = 0, incorrectEndpoints = 0;
  const routes = [];
  for (const [id, member] of roster) for (let i = 0; i < member.schedule.length; i++) {
    const entry = member.schedule[i], previous = member.schedule[(i + member.schedule.length - 1) % member.schedule.length];
    if (entry.remote || previous.remote) continue;
    const from = member.destinations[previous.destination]?.position, to = member.destinations[entry.destination]?.position;
    if (!from || !to) continue;
    const result = navigator.evaluateRoute(from, to);
    routes.push({ id, leg: i, ...result });
    if (!result.ok) continue;
    let last = from, safe = true;
    for (const point of result.route) { safe &&= legacyNavigator.segmentSafe(last, point); last = point; }
    if (!safe) unsafeReturnedRoutes++;
    if (Math.hypot(last.x - to.x, last.z - to.z) > 1e-6) incorrectEndpoints++;
  }
  return { unsafeReturnedRoutes, incorrectEndpoints, routes };
}
