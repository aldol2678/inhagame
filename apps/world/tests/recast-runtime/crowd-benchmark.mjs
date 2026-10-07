import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { actualRecastLoader } from './evaluate.mjs';
import { prepareCampus } from './campus-context.mjs';
import { buildFlatNavigationSurface, recastNavMeshConfig } from '../../npc-factory/recast-navigator-poc.mjs';
import { advanceRoute } from '../../npc-factory/dev-navigation.mjs';

export const INHA_NATIVE_P0_SCHEMA = 'inha.native-p0.detour-crowd/1';
const HALF_EXTENTS = Object.freeze({ x: 1.5, y: 2, z: 1.5 });
const AGENT_PARAMS = Object.freeze({
  radius: 0.32,
  height: 1.7,
  maxAcceleration: 6,
  maxSpeed: 1.8,
  collisionQueryRange: 1.6,
  pathOptimizationRange: 6,
  separationWeight: 2,
  // DetourCrowd: anticipate turns | optimize visibility | optimize topology |
  // obstacle avoidance | separation.
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
  for (let i = 0; i < positions.length; i++) for (let j = i + 1; j < positions.length; j++) {
    if (distance2d(positions[i], positions[j]) < threshold) overlaps++;
  }
  return overlaps;
}

function movementPairs({ roster, legacyNavigator }) {
  const pairs = [];
  for (const [npcId, member] of roster) for (let leg = 0; leg < member.schedule.length; leg++) {
    const entry = member.schedule[leg];
    const previous = member.schedule[(leg + member.schedule.length - 1) % member.schedule.length];
    if (entry.remote || previous.remote) continue;
    const from = member.destinations[previous.destination]?.position;
    const to = member.destinations[entry.destination]?.position;
    if (!from || !to || distance2d(from, to) < 0.5) continue;
    const route = legacyNavigator.networkRoute(from, to) ?? legacyNavigator.route(from, to);
    if (!route?.length) continue;
    pairs.push({ npcId, leg, from: { ...from }, to: { ...to }, route: route.map(point => ({ ...point })) });
  }
  if (!pairs.length) throw new Error('INHA_NATIVE_P0_NO_MOVEMENT_PAIRS');
  return pairs;
}

function benchmarkJs(pairs, agentCount, steps, dt) {
  const setupStarted = performance.now();
  const agents = Array.from({ length: agentCount }, (_, index) => {
    const pair = pairs[index % pairs.length];
    return {
      position: { ...pair.from },
      start: { ...pair.from },
      target: { ...pair.to },
      waypoints: pair.route.map(point => ({ ...point }))
    };
  });
  const setupMs = performance.now() - setupStarted;
  const frameMs = [];
  for (let step = 0; step < steps; step++) {
    const at = performance.now();
    for (const agent of agents) {
      if (!agent.waypoints.length) continue;
      const moved = advanceRoute(agent.position, agent.waypoints, AGENT_PARAMS.maxSpeed * dt);
      agent.position = moved.position;
    }
    frameMs.push(performance.now() - at);
  }
  const positions = agents.map(agent => agent.position);
  return {
    engine: 'CURRENT_JS_ROUTE_FOLLOWER',
    featureEquivalent: false,
    setupMs,
    updateMs: frameMs.reduce((sum, value) => sum + value, 0),
    meanFrameMs: frameMs.reduce((sum, value) => sum + value, 0) / Math.max(1, frameMs.length),
    p95FrameMs: percentile(frameMs, 0.95),
    overlapPairs: overlapPairs(positions),
    meanDistanceMoved: agents.reduce((sum, agent) => sum + distance2d(agent.start, agent.position), 0) / agents.length,
    meanRemainingTargetDistance: agents.reduce((sum, agent) => sum + distance2d(agent.position, agent.target), 0) / agents.length
  };
}

function snap(crowd, point) {
  const result = crowd.navMeshQuery.findNearestPoly(point3(point), { halfExtents: HALF_EXTENTS });
  if (!result.success || !result.nearestRef || !result.nearestPoint) throw new Error('INHA_NATIVE_P0_SNAP_FAILED');
  return result.nearestPoint;
}

function benchmarkCrowd(core, navMesh, pairs, agentCount, steps, dt) {
  const rssBefore = process.memoryUsage().rss;
  const setupStarted = performance.now();
  const crowd = new core.Crowd(navMesh, { maxAgents: agentCount, maxAgentRadius: AGENT_PARAMS.radius });
  const agents = [];
  let acceptedTargets = 0;
  try {
    for (let index = 0; index < agentCount; index++) {
      const pair = pairs[index % pairs.length];
      const start = snap(crowd, pair.from);
      const target = snap(crowd, pair.to);
      const agent = crowd.addAgent(start, { ...AGENT_PARAMS, userData: index });
      if (agent.agentIndex < 0) throw new Error('INHA_NATIVE_P0_ADD_AGENT_FAILED');
      if (agent.requestMoveTarget(target)) acceptedTargets++;
      agents.push({ agent, start, target });
    }
    const setupMs = performance.now() - setupStarted;
    const frameMs = [];
    for (let step = 0; step < steps; step++) {
      const at = performance.now();
      crowd.update(dt);
      frameMs.push(performance.now() - at);
    }
    const positions = agents.map(({ agent }) => agent.position());
    const invalidAgents = agents.filter(({ agent }) => agent.state() === 0).length;
    const rssAfter = process.memoryUsage().rss;
    return {
      engine: 'RECAST_DETOUR_CROWD_WASM',
      featureEquivalent: false,
      activeAgents: crowd.getActiveAgentCount(),
      acceptedTargets,
      invalidAgents,
      setupMs,
      updateMs: frameMs.reduce((sum, value) => sum + value, 0),
      meanFrameMs: frameMs.reduce((sum, value) => sum + value, 0) / Math.max(1, frameMs.length),
      p95FrameMs: percentile(frameMs, 0.95),
      overlapPairs: overlapPairs(positions),
      meanDistanceMoved: agents.reduce((sum, item) => sum + distance2d(item.start, item.agent.position()), 0) / agents.length,
      meanRemainingTargetDistance: agents.reduce((sum, item) => sum + distance2d(item.agent.position(), item.target), 0) / agents.length,
      rssDeltaBytes: rssAfter - rssBefore
    };
  } finally {
    crowd.destroy();
  }
}

export async function runCrowdBenchmark({
  tiers = [48, 100, 200],
  steps = 180,
  dt = 1 / 60,
  includeJs = true
} = {}) {
  if (!Array.isArray(tiers) || !tiers.length || tiers.some(value => !Number.isSafeInteger(value) || value < 1)) {
    throw new TypeError('INHA_NATIVE_P0_INVALID_TIERS');
  }
  if (!Number.isSafeInteger(steps) || steps < 1 || !Number.isFinite(dt) || dt <= 0) {
    throw new TypeError('INHA_NATIVE_P0_INVALID_STEP_CONFIG');
  }

  const contextStarted = performance.now();
  const context = await prepareCampus();
  const pairs = movementPairs(context);
  const { core, generators, packageVersion } = await actualRecastLoader();
  if (packageVersion !== '0.43.1' || typeof core?.Crowd !== 'function') {
    throw new Error('INHA_NATIVE_P0_INCOMPATIBLE_RECAST_RUNTIME');
  }
  await core.init();

  const surface = buildFlatNavigationSurface(context.legacyNavigator, { corridorGraph: context.corridorGraph });
  const generated = generators.generateSoloNavMesh(surface.positions, surface.indices, recastNavMeshConfig(context.corridorGraph));
  if (!generated?.success || !generated.navMesh) {
    throw new Error(`INHA_NATIVE_P0_NAVMESH_GENERATION_FAILED: ${generated?.error ?? 'unknown'}`);
  }

  const navMesh = generated.navMesh;
  try {
    const results = [];
    for (const agents of tiers) {
      results.push({
        agents,
        steps,
        simulatedSeconds: steps * dt,
        js: includeJs ? benchmarkJs(pairs, agents, steps, dt) : null,
        wasm: benchmarkCrowd(core, navMesh, pairs, agents, steps, dt)
      });
    }
    return {
      schema: INHA_NATIVE_P0_SCHEMA,
      authorityEffect: 'NONE',
      productionCutover: false,
      benchmarkOnly: true,
      comparisonScope: 'Current JS waypoint following versus DetourCrowd WASM local steering; feature sets are intentionally not equivalent.',
      packageVersion,
      movementPairCount: pairs.length,
      contextSetupMs: performance.now() - contextStarted,
      surface: {
        tiles: surface.tiles,
        corridorQuads: surface.corridorQuads,
        triangles: surface.indices.length / 3
      },
      agentParameters: { ...AGENT_PARAMS },
      results
    };
  } finally {
    navMesh.destroy?.();
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(JSON.stringify(await runCrowdBenchmark(), null, 2));
}
