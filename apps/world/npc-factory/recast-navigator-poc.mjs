import { RECAST_PACKAGE_VERSION, validateRecastArtifact } from './recast-navmesh-artifact.mjs';

const DEFAULT_RECAST_URL = 'https://esm.sh/recast-navigation@0.43.1';
const DEFAULT_GENERATORS_URL = 'https://esm.sh/recast-navigation@0.43.1/generators';

const distance2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point3 = point => ({ x: point.x, y: Number.isFinite(point.y) ? point.y : 0, z: point.z });

export const RECAST_NPC_POC_VERSION = 'p0-shadow-v2';

const finitePoint = point => Boolean(point) && Number.isFinite(point.x) && Number.isFinite(point.z);
// Detour detail bits: BUFFER_TOO_SMALL, OUT_OF_NODES and PARTIAL_RESULT.
const INCOMPLETE_PATH = 0x10 | 0x20 | 0x40;

export function buildFlatNavigationSurface(navigator, {
  tileSize = 1.5, y = 0, corridorGraph = null, corridorHalfWidth = 0.25, corridorStep = 0.75
} = {}) {
  if (!navigator?.bounds || typeof navigator.walkable !== 'function') {
    throw new Error('Recast NPC PoC requires navigator bounds and walkable(point)');
  }
  if (!Number.isFinite(tileSize) || !(tileSize > 0)) throw new Error('Recast NPC PoC tileSize must be positive');
  if (!Number.isFinite(corridorHalfWidth) || !(corridorHalfWidth > 0) ||
      !Number.isFinite(corridorStep) || !(corridorStep > 0)) throw new Error('Invalid corridor sampling');

  const { minX, maxX, minZ, maxZ } = navigator.bounds;
  const positions = [];
  const indices = [];
  let tiles = 0;
  let corridorQuads = 0;

  function triangle(a, b, c) {
    const base = positions.length / 3;
    for (const point of [a, b, c]) positions.push(point.x, y, point.z);
    const normalY = (b.z - a.z) * (c.x - a.x) - (b.x - a.x) * (c.z - a.z);
    indices.push(base, base + (normalY >= 0 ? 1 : 2), base + (normalY >= 0 ? 2 : 1));
  }

  for (let z = minZ; z + tileSize <= maxZ + 1e-6; z += tileSize) {
    for (let x = minX; x + tileSize <= maxX + 1e-6; x += tileSize) {
      const corners = [
        { x, z },
        { x, z: z + tileSize },
        { x: x + tileSize, z },
        { x: x + tileSize, z: z + tileSize }
      ];
      const center = { x: x + tileSize / 2, z: z + tileSize / 2 };
      if (!navigator.walkable(center) || corners.some(point => !navigator.walkable(point))) continue;
      if (typeof navigator.segmentSafe === 'function' &&
          [[0, 1], [1, 3], [3, 2], [2, 0], [0, 3], [1, 2]]
            .some(([a, b]) => !navigator.segmentSafe(corners[a], corners[b]))) continue;

      const base = positions.length / 3;
      for (const point of corners) positions.push(point.x, y, point.z);
      // Counter-clockwise when viewed from +Y, so the walkable normal points upward.
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      tiles++;
    }
  }

  // The legacy contract admits narrow canonical graph corridors that a 1.5m all-corners
  // tile cannot represent. Read that graph; never invent a shortcut or widen walkability.
  if (corridorGraph) {
    const nodes = new Map(corridorGraph.nodes.map(node => [node.id, node]));
    const safe = point => finitePoint(point) && navigator.walkable(point);
    for (const edge of corridorGraph.edges) {
      const a = nodes.get(edge.a), b = nodes.get(edge.b);
      if (!a || !b) throw new Error('Corridor graph edge has no endpoint');
      const length = distance2d(a, b);
      if (!length) continue;
      const ox = -(b.z - a.z) / length * corridorHalfWidth;
      const oz = (b.x - a.x) / length * corridorHalfWidth;
      const steps = Math.max(1, Math.ceil(length / corridorStep));
      for (let i = 0; i < steps; i++) {
        const at = t => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
        const from = at(i / steps), to = at((i + 1) / steps);
        const left = p => ({ x: p.x + ox, z: p.z + oz });
        const right = p => ({ x: p.x - ox, z: p.z - oz });
        const corners = [left(from), right(from), left(to), right(to)];
        if (![...corners, from, to, at((i + 0.5) / steps)].every(safe)) continue;
        triangle(corners[0], corners[1], corners[2]);
        triangle(corners[2], corners[1], corners[3]);
        corridorQuads++;
      }
    }
    // Small overlapping discs preserve turns/junctions between the authored strips.
    for (const node of nodes.values()) {
      const ring = Array.from({ length: 12 }, (_, i) => ({
        x: node.x + Math.cos(i * Math.PI / 6) * corridorHalfWidth,
        z: node.z + Math.sin(i * Math.PI / 6) * corridorHalfWidth
      }));
      if (![node, ...ring].every(safe)) continue;
      for (let i = 0; i < ring.length; i++) triangle(node, ring[i], ring[(i + 1) % ring.length]);
    }
  }

  if (!indices.length) throw new Error('Recast NPC PoC produced no walkable triangles');
  return { positions, indices, tiles, corridorQuads, tileSize, bounds: { ...navigator.bounds } };
}

export function routeLength(from, route) {
  let total = 0;
  let previous = from;
  for (const point of route ?? []) {
    total += distance2d(previous, point);
    previous = point;
  }
  return total;
}

export async function loadPinnedRecast({
  recastUrl = DEFAULT_RECAST_URL,
  generatorsUrl = DEFAULT_GENERATORS_URL
} = {}) {
  const [core, generators] = await Promise.all([
    import(recastUrl),
    import(generatorsUrl)
  ]);
  return { core, generators, packageVersion: recastUrl === DEFAULT_RECAST_URL &&
    generatorsUrl === DEFAULT_GENERATORS_URL ? RECAST_PACKAGE_VERSION : null };
}

export function recastNavMeshConfig(corridorGraph = null, navMeshConfig = {}) {
  return {
    cs: corridorGraph ? 0.1 : 0.5,
    ch: 0.2,
    walkableSlopeAngle: 45,
    walkableHeight: 8,
    walkableClimb: 2,
    // Legacy walkable() already applies clearance. Further erosion removes its narrow
    // graph override corridors; route acceptance still checks every legacy segment.
    walkableRadius: corridorGraph ? 0 : 1,
    maxEdgeLen: 12,
    maxSimplificationError: corridorGraph ? 0.1 : 1.3,
    minRegionArea: 2,
    mergeRegionArea: 8,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    ...navMeshConfig
  };
}

export function recastArtifactContract({ corridorGraph = null, navMeshConfig = {}, tileSize = 1.5,
  maxEndpointSnapDistance = 1.5, maxPathPolys = 2048 } = {}) {
  return { adapterVersion: RECAST_NPC_POC_VERSION, packageVersion: RECAST_PACKAGE_VERSION,
    surface: { tileSize, corridorHalfWidth: 0.25, corridorStep: 0.75, y: 0 },
    config: recastNavMeshConfig(corridorGraph, navMeshConfig),
    query: { maxEndpointSnapDistance, maxPathPolys, maxNodes: 8192 } };
}

export async function createRecastNpcNavigator(baseNavigator, {
  loader = loadPinnedRecast,
  tileSize = 1.5,
  corridorGraph = null,
  navMeshConfig = {},
  maxEndpointSnapDistance = 1.5,
  maxPathPolys = 2048,
  prebuilt = null
} = {}) {
  if (typeof baseNavigator?.segmentSafe !== 'function') throw new Error('Recast NPC PoC requires segmentSafe');
  if (!Number.isFinite(maxEndpointSnapDistance) || maxEndpointSnapDistance <= 0 ||
      !Number.isInteger(maxPathPolys) || maxPathPolys < 1) throw new Error('Invalid Recast query limits');
  const contract = recastArtifactContract({ corridorGraph, navMeshConfig, tileSize,
    maxEndpointSnapDistance, maxPathPolys });
  const config = contract.config;
  // Validate all fingerprints before import (and before loading/initializing WASM).
  let surface = prebuilt === null ? null : await validateRecastArtifact({ ...prebuilt, contract });
  const { core, generators, packageVersion } = await loader();
  if (typeof core?.init !== 'function' || typeof core?.NavMeshQuery !== 'function' ||
      (prebuilt === null ? typeof generators?.generateSoloNavMesh !== 'function' : typeof core.importNavMesh !== 'function')) {
    throw new Error('Recast NPC PoC loader returned an incompatible API');
  }
  if (prebuilt !== null && packageVersion !== RECAST_PACKAGE_VERSION)
    throw new Error('RECAST_ARTIFACT_RUNTIME_VERSION');
  await core.init();
  let navMesh;
  if (prebuilt === null) {
    const generatedSurface = buildFlatNavigationSurface(baseNavigator, { tileSize, corridorGraph });
    const generated = generators.generateSoloNavMesh(generatedSurface.positions, generatedSurface.indices, config);
    if (!generated?.success || !generated.navMesh) {
      const detail = generated?.error ? `: ${generated.error}` : '';
      throw new Error(`Recast NPC PoC navmesh generation failed${detail}`);
    }
    navMesh = generated.navMesh;
    surface = { surfaceTiles: generatedSurface.tiles, corridorQuads: generatedSurface.corridorQuads,
      triangleCount: generatedSurface.indices.length / 3 };
  } else {
    navMesh = core.importNavMesh(prebuilt.bytes)?.navMesh;
    if (!navMesh) throw new Error('RECAST_ARTIFACT_IMPORT_FAILED');
  }
  let query;
  try { query = new core.NavMeshQuery(navMesh, { maxNodes: 8192 }); }
  catch (error) { navMesh.destroy?.(); throw error; }
  let destroyed = false;

  function evaluateRoute(from, to) {
    const fail = (reason, detail = {}) => ({ ok: false, route: null, reason, ...detail });
    if (destroyed) return fail('DESTROYED');
    if (!finitePoint(from) || !finitePoint(to)) return fail('INVALID_ENDPOINT');
    if (!baseNavigator.walkable(from) || !baseNavigator.walkable(to)) return fail('UNWALKABLE_ENDPOINT');
    // Same-position schedule slots are legitimate no-op arrivals, not movement coverage.
    if (distance2d(from, to) < 1e-6) return { ok: true, route: [{ ...to }], reason: 'NO_MOVEMENT' };
    const halfExtents = { x: maxEndpointSnapDistance, y: 2, z: maxEndpointSnapDistance };
    const start = query.findNearestPoly(point3(from), { halfExtents });
    const end = query.findNearestPoly(point3(to), { halfExtents });
    if (!start.success || !start.nearestRef || !finitePoint(start.nearestPoint)) return fail('NO_START_POLYGON');
    if (!end.success || !end.nearestRef || !finitePoint(end.nearestPoint)) return fail('NO_END_POLYGON');
    const startSnapDistance = distance2d(from, start.nearestPoint);
    const endSnapDistance = distance2d(to, end.nearestPoint);
    const snapDetail = { startSnapDistance, endSnapDistance };
    if (Math.max(startSnapDistance, endSnapDistance) > maxEndpointSnapDistance) return fail('ENDPOINT_SNAP_TOO_FAR', snapDetail);
    if (!baseNavigator.segmentSafe(from, start.nearestPoint) || !baseNavigator.segmentSafe(end.nearestPoint, to))
      return fail('UNSAFE_ENDPOINT_CONNECTOR', snapDetail);

    let corridor, straight;
    try {
      corridor = query.findPath(start.nearestRef, end.nearestRef, start.nearestPoint, end.nearestPoint, { maxPathPolys });
      if (!corridor.success || !corridor.polys?.size) return fail('NO_PATH', { status: corridor.status, ...snapDetail });
      if ((corridor.status & INCOMPLETE_PATH) || corridor.polys.get(corridor.polys.size - 1) !== end.nearestRef)
        return fail('INCOMPLETE_PATH', { status: corridor.status, ...snapDetail });
      straight = query.findStraightPath(start.nearestPoint, end.nearestPoint, corridor.polys, { maxStraightPathPoints: maxPathPolys });
      if (!straight.success || (straight.status & INCOMPLETE_PATH) || !straight.straightPathCount)
        return fail('INCOMPLETE_STRAIGHT_PATH', { status: straight.status, ...snapDetail });
      const points = Array.from({ length: straight.straightPathCount }, (_, i) => ({
        x: straight.straightPath.get(i * 3), z: straight.straightPath.get(i * 3 + 2)
      }));
      if (points.some(point => !finitePoint(point)) || distance2d(points.at(-1), end.nearestPoint) > 0.05)
        return fail('ENDPOINT_NOT_REACHED', snapDetail);
      while (points.length && distance2d(points[0], from) < 0.01) points.shift();
      if (!points.length || distance2d(points.at(-1), to) > 1e-6) points.push({ ...to });
      let previous = from;
      for (let i = 0; i < points.length; i++) {
        if (!baseNavigator.segmentSafe(previous, points[i])) return fail('UNSAFE_SEGMENT', {
          segment: i, segmentFrom: { x: previous.x, z: previous.z }, segmentTo: { ...points[i] }, ...snapDetail
        });
        previous = points[i];
      }
      return { ok: true, route: points, reason: 'RECAST', status: corridor.status, ...snapDetail };
    } finally {
      corridor?.polys?.destroy();
      straight?.straightPath?.destroy();
      straight?.straightPathFlags?.destroy();
      straight?.straightPathRefs?.destroy();
    }
  }
  const route = (from, to) => evaluateRoute(from, to).route;

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    try { query.destroy?.(); } catch {}
    // NavMeshQuery 0.43.1 allocates its own filter but does not destroy it.
    try { if (query.defaultFilter?.raw) core.Raw?.destroy(query.defaultFilter.raw); } catch {}
    try { navMesh.destroy?.(); } catch {}
  }

  return {
    ...baseNavigator,
    route,
    networkRoute: route,
    evaluateRoute,
    recast: Object.freeze({
      version: RECAST_NPC_POC_VERSION,
      packageVersion: RECAST_PACKAGE_VERSION,
      initialization: prebuilt === null ? 'GENERATED' : 'IMPORTED',
      surfaceTiles: surface.surfaceTiles,
      corridorQuads: surface.corridorQuads,
      triangleCount: surface.triangleCount,
      config: Object.freeze({ ...config })
    }),
    exportNavMesh() {
      if (destroyed) throw new Error('Recast NPC PoC navigator destroyed');
      if (typeof core.exportNavMesh !== 'function') throw new Error('Recast NPC PoC export unavailable');
      return core.exportNavMesh(navMesh);
    },
    destroy
  };
}
