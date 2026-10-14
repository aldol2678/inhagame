import { createNpcNavigator } from './npc-factory/dev-navigation.mjs';
import { loadNpcPopulation } from './npc-factory/npc-population-loader.mjs';
import { createPurposefulRoster } from './npc-factory/purposeful-roster.mjs';
import { campusNavGraphData } from './src/navigation/campus-navigation.js';
import { loadPinnedRecast, recastArtifactContract } from './npc-factory/recast-navigator-poc.mjs';
import {
  RECAST_PACKAGE_VERSION,
  readRecastSourceDigests,
  recastArtifactInputs,
  fingerprint,
  loadRecastArtifact,
  validateRecastArtifact
} from './npc-factory/recast-navmesh-artifact.mjs';

const HALF_EXTENTS = Object.freeze({ x: 1.5, y: 2, z: 1.5 });
const AGENT_PARAMS = Object.freeze({
  radius: 0.32,
  height: 1.7,
  maxAcceleration: 6,
  maxSpeed: 1.8,
  collisionQueryRange: 1.6,
  pathOptimizationRange: 6,
  separationWeight: 2,
  updateFlags: 31,
  obstacleAvoidanceType: 0,
  queryFilterType: 0
});

const point3 = point => ({ x: point.x, y: Number.isFinite(point.y) ? point.y : 0, z: point.z });
const distance2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function percentile(values, q) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q))];
}

function overlapPairs(positions, threshold = AGENT_PARAMS.radius * 1.9) {
  let overlaps = 0;
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (distance2d(positions[i], positions[j]) < threshold) overlaps++;
    }
  }
  return overlaps;
}

function movementPairs({ roster, legacyNavigator }) {
  const pairs = [];
  for (const [npcId, member] of roster) {
    for (let leg = 0; leg < member.schedule.length; leg++) {
      const entry = member.schedule[leg];
      const previous = member.schedule[(leg + member.schedule.length - 1) % member.schedule.length];
      if (entry.remote || previous.remote) continue;
      const from = member.destinations[previous.destination]?.position;
      const to = member.destinations[entry.destination]?.position;
      if (!from || !to || distance2d(from, to) < 0.5) continue;
      const route = legacyNavigator.networkRoute(from, to) ?? legacyNavigator.route(from, to);
      if (!route?.length) continue;
      pairs.push({ npcId, leg, from: { ...from }, to: { ...to } });
    }
  }
  if (!pairs.length) throw new Error('INHA_NATIVE_P0C_NO_MOVEMENT_PAIRS');
  return pairs;
}

function snap(crowd, point) {
  const result = crowd.navMeshQuery.findNearestPoly(point3(point), { halfExtents: HALF_EXTENTS });
  if (!result.success || !result.nearestRef || !result.nearestPoint) {
    throw new Error('INHA_NATIVE_P0C_SNAP_FAILED');
  }
  return result.nearestPoint;
}

let runtimePromise = null;
let runtime = null;

async function initialize() {
  self.postMessage({ type: 'PHASE', phase: 'population', label: '48 NPC 데이터를 검증하는 중…' });
  const { batch, expansion } = await loadNpcPopulation({ retryDelays: [] });
  if (expansion !== 'READY' || batch.npcs?.length !== 48) throw new Error('INHA_NATIVE_P0C_POPULATION_NOT_READY');

  const legacyNavigator = createNpcNavigator(batch);
  const roster = createPurposefulRoster(batch, legacyNavigator);
  const corridorGraph = campusNavGraphData();
  const contract = recastArtifactContract({ corridorGraph });

  self.postMessage({ type: 'PHASE', phase: 'artifact', label: 'prebuilt NavMesh 무결성을 검증하는 중…' });
  const sourceDigests = await readRecastSourceDigests();
  const inputs = recastArtifactInputs({
    batch, roster, expansion, baseNavigator: legacyNavigator, corridorGraph, contract, sourceDigests
  });
  const prebuilt = await loadRecastArtifact({ expectedInputSha256: await fingerprint(inputs) });
  const surface = await validateRecastArtifact({ ...prebuilt, contract });

  self.postMessage({ type: 'PHASE', phase: 'wasm', label: 'Recast / Detour WASM을 초기화하는 중…' });
  const { core, packageVersion } = await loadPinnedRecast();
  if (packageVersion !== RECAST_PACKAGE_VERSION || typeof core?.Crowd !== 'function') {
    throw new Error('INHA_NATIVE_P0C_RECAST_VERSION');
  }
  await core.init();
  const navMesh = core.importNavMesh(prebuilt.bytes)?.navMesh;
  if (!navMesh) throw new Error('INHA_NATIVE_P0C_NAVMESH_IMPORT_FAILED');

  const pairs = movementPairs({ roster, legacyNavigator });
  runtime = { core, navMesh, pairs, surface, manifest: prebuilt.manifest };
  self.postMessage({
    type: 'READY',
    meta: {
      schema: 'inha.native-p0c.manual-preview/1',
      authorityEffect: 'NONE',
      productionCutover: false,
      packageVersion,
      population: batch.npcs.length,
      movementPairs: pairs.length,
      navMeshBytes: prebuilt.bytes.byteLength,
      triangleCount: surface.triangleCount
    }
  });
  return runtime;
}

function ensureRuntime() {
  runtimePromise ??= initialize().catch(error => {
    runtimePromise = null;
    throw error;
  });
  return runtimePromise;
}

function benchmarkTier({ core, navMesh, pairs }, agentCount, steps, dt) {
  const setupStarted = performance.now();
  const crowd = new core.Crowd(navMesh, { maxAgents: agentCount, maxAgentRadius: AGENT_PARAMS.radius });
  const items = [];
  let acceptedTargets = 0;
  try {
    for (let index = 0; index < agentCount; index++) {
      const pair = pairs[index % pairs.length];
      const start = snap(crowd, pair.from);
      const target = snap(crowd, pair.to);
      const agent = crowd.addAgent(start, { ...AGENT_PARAMS, userData: index });
      if (agent.agentIndex < 0) throw new Error('INHA_NATIVE_P0C_ADD_AGENT_FAILED');
      if (agent.requestMoveTarget(target)) acceptedTargets++;
      items.push({ agent, start, target });
    }
    const setupMs = performance.now() - setupStarted;
    const samples = [];
    for (let step = 0; step < steps; step++) {
      const started = performance.now();
      crowd.update(dt);
      samples.push(performance.now() - started);
    }
    const positions = items.map(({ agent }) => agent.position());
    return {
      agents: agentCount,
      steps,
      simulatedSeconds: steps * dt,
      activeAgents: crowd.getActiveAgentCount(),
      acceptedTargets,
      invalidAgents: items.filter(({ agent }) => agent.state() === 0).length,
      setupMs,
      updateMs: samples.reduce((sum, value) => sum + value, 0),
      meanFrameMs: samples.reduce((sum, value) => sum + value, 0) / samples.length,
      p95FrameMs: percentile(samples, 0.95),
      maxFrameMs: Math.max(...samples),
      overlapPairs: overlapPairs(positions),
      meanDistanceMoved: items.reduce((sum, item) => sum + distance2d(item.start, item.agent.position()), 0) / items.length,
      meanRemainingTargetDistance: items.reduce((sum, item) => sum + distance2d(item.agent.position(), item.target), 0) / items.length
    };
  } finally {
    crowd.destroy();
  }
}

self.addEventListener('message', event => {
  const message = event.data ?? {};
  if (message.type === 'INIT') {
    void ensureRuntime().catch(error => self.postMessage({ type: 'ERROR', message: error?.message ?? String(error), stack: error?.stack ?? null }));
    return;
  }
  if (message.type !== 'RUN') return;
  void ensureRuntime().then(loaded => {
    const tiers = Array.isArray(message.tiers) ? message.tiers : [48, 100, 200];
    const steps = Number.isSafeInteger(message.steps) ? message.steps : 180;
    const dt = Number.isFinite(message.dt) ? message.dt : 1 / 60;
    const started = performance.now();
    const results = [];
    for (const agents of tiers) {
      self.postMessage({ type: 'RUN_PHASE', agents });
      results.push(benchmarkTier(loaded, agents, steps, dt));
    }
    self.postMessage({
      type: 'RESULT',
      result: {
        schema: 'inha.native-p0c.manual-preview-result/1',
        authorityEffect: 'NONE',
        productionCutover: false,
        benchmarkOnly: true,
        packageVersion: RECAST_PACKAGE_VERSION,
        movementPairCount: loaded.pairs.length,
        workerElapsedMs: performance.now() - started,
        agentParameters: { ...AGENT_PARAMS },
        results
      }
    });
  }).catch(error => self.postMessage({ type: 'ERROR', message: error?.message ?? String(error), stack: error?.stack ?? null }));
});

self.addEventListener('close', () => {
  try { runtime?.navMesh?.destroy?.(); } catch {}
  runtime = null;
});
