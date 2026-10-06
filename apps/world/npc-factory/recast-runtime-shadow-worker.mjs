import { createNpcNavigator } from './dev-navigation.mjs';
import { loadNpcPopulation } from './npc-population-loader.mjs';
import { createPurposefulRoster } from './purposeful-roster.mjs';
import { createRecastNpcNavigator, recastArtifactContract, routeLength, RECAST_NPC_POC_VERSION }
  from './recast-navigator-poc.mjs';
import { campusNavGraphData } from '../src/navigation/campus-navigation.js';
import { readRecastSourceDigests, recastArtifactInputs, fingerprint, loadRecastArtifact, RECAST_PACKAGE_VERSION }
  from './recast-navmesh-artifact.mjs';

let navigator = null;

async function initialize() {
  const started = performance.now();
  const { batch, expansion } = await loadNpcPopulation({
    retryDelays: [],
    onExpansionError: error => { throw error; }
  });
  const baseNavigator = createNpcNavigator(batch);
  const roster = createPurposefulRoster(batch, baseNavigator);
  const corridorGraph = campusNavGraphData();
  const sourceDigests = await readRecastSourceDigests();
  const contract = recastArtifactContract({ corridorGraph });
  const inputs = recastArtifactInputs({
    batch,
    roster,
    expansion,
    baseNavigator,
    corridorGraph,
    contract,
    sourceDigests
  });
  const prebuilt = await loadRecastArtifact({ expectedInputSha256: await fingerprint(inputs) });
  navigator = await createRecastNpcNavigator(baseNavigator, { corridorGraph, prebuilt });
  return {
    version: RECAST_NPC_POC_VERSION,
    packageVersion: RECAST_PACKAGE_VERSION,
    initialization: navigator.recast.initialization,
    elapsedMs: performance.now() - started
  };
}

const ready = initialize()
  .then(meta => {
    self.postMessage({ type: 'READY', ...meta });
    return navigator;
  })
  .catch(error => {
    self.postMessage({ type: 'INIT_ERROR', reason: String(error?.message ?? error) });
    throw error;
  });

function resultFor(message) {
  const started = performance.now();
  const canonicalOk = Array.isArray(message.canonicalRoute);
  try {
    const recast = navigator.evaluateRoute(message.from, message.to);
    const recastOk = recast.ok === true;
    const canonicalLength = canonicalOk ? routeLength(message.from, message.canonicalRoute) : null;
    const recastLength = recastOk ? routeLength(message.from, recast.route) : null;
    const lengthDeltaPct = canonicalOk && recastOk && canonicalLength > 1e-6
      ? (recastLength - canonicalLength) / canonicalLength * 100
      : null;
    return {
      type: 'RESULT',
      id: message.id,
      kind: message.kind,
      status: canonicalOk === recastOk ? 'MATCH' : 'MISMATCH',
      reason: recast.reason ?? null,
      canonicalOk,
      recastOk,
      canonicalLength,
      recastLength,
      lengthDeltaPct,
      latencyMs: performance.now() - started,
      meta: message.meta ?? null
    };
  } catch (error) {
    return {
      type: 'RESULT',
      id: message.id,
      kind: message.kind,
      status: 'ERROR',
      reason: String(error?.message ?? error),
      canonicalOk,
      recastOk: false,
      canonicalLength: canonicalOk ? routeLength(message.from, message.canonicalRoute) : null,
      recastLength: null,
      lengthDeltaPct: null,
      latencyMs: performance.now() - started,
      meta: message.meta ?? null
    };
  }
}

self.addEventListener('message', event => {
  const message = event?.data ?? {};
  if (message.type !== 'OBSERVE_ROUTE') return;
  void ready.then(() => self.postMessage(resultFor(message))).catch(() => {});
});

self.addEventListener('close', () => {
  try { navigator?.destroy?.(); } catch {}
});
