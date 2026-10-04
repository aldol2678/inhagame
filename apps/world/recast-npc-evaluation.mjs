import { createNpcNavigator } from './npc-factory/dev-navigation.mjs';
import { loadNpcPopulation } from './npc-factory/npc-population-loader.mjs';
import { createPurposefulRoster } from './npc-factory/purposeful-roster.mjs';
import { createRecastNpcNavigator, recastArtifactContract } from './npc-factory/recast-navigator-poc.mjs';
import { evaluateRecastSchedule } from './npc-factory/recast-schedule-evaluation.mjs';
import { campusNavGraphData } from './src/navigation/campus-navigation.js';
import { readRecastSourceDigests, recastArtifactInputs, fingerprint, loadRecastArtifact }
  from './npc-factory/recast-navmesh-artifact.mjs';

export async function runRecastEvaluation({ prebuiltMode = false, onPhase = () => {} } = {}) {
  onPhase('population');
  const started = performance.now();
  const { batch, expansion } = await loadNpcPopulation({
    retryDelays: [],
    onExpansionError: error => console.warn('Recast PoC expansion unavailable:', error)
  });
  const baseNavigator = createNpcNavigator(batch);
  const roster = createPurposefulRoster(batch, baseNavigator);
  const corridorGraph = campusNavGraphData();
  let prebuilt = null;
  let artifactValidationMs = null;
  if (prebuiltMode) {
    onPhase('artifact');
    const at = performance.now();
    const sourceDigests = await readRecastSourceDigests();
    const contract = recastArtifactContract({ corridorGraph });
    const inputs = recastArtifactInputs({ batch, roster, expansion, baseNavigator, corridorGraph, contract, sourceDigests });
    prebuilt = await loadRecastArtifact({ expectedInputSha256: await fingerprint(inputs) });
    artifactValidationMs = performance.now() - at;
  }
  onPhase('navigator');
  const navigatorStarted = performance.now();
  const recastNavigator = await createRecastNpcNavigator(baseNavigator, { corridorGraph, prebuilt });
  const navigatorInitializationMs = performance.now() - navigatorStarted;
  try {
    onPhase('schedule');
    const scheduleStarted = performance.now();
    const result = {
      ...evaluateRecastSchedule({ batch, roster, legacyNavigator: baseNavigator, recastNavigator, expansion }),
      elapsedMs: performance.now() - started,
      navMeshInitialization: recastNavigator.recast.initialization,
      artifactValidationMs, navigatorInitializationMs,
      scheduleEvaluationMs: performance.now() - scheduleStarted
    };
    return result;
  } finally {
    recastNavigator.destroy();
  }
}

