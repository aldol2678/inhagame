const DEFAULT_RECAST_URL = 'https://esm.sh/recast-navigation@0.43.1';
const DEFAULT_GENERATORS_URL = 'https://esm.sh/recast-navigation@0.43.1/generators';

const distance2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point3 = point => ({ x: point.x, y: Number.isFinite(point.y) ? point.y : 0, z: point.z });

export const RECAST_NPC_POC_VERSION = 'p0-shadow-v1';

export function buildFlatNavigationSurface(navigator, { tileSize = 1.5, y = 0 } = {}) {
  if (!navigator?.bounds || typeof navigator.walkable !== 'function') {
    throw new Error('Recast NPC PoC requires navigator bounds and walkable(point)');
  }
  if (!(tileSize > 0)) throw new Error('Recast NPC PoC tileSize must be positive');

  const { minX, maxX, minZ, maxZ } = navigator.bounds;
  const positions = [];
  const indices = [];
  let tiles = 0;

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

      const base = positions.length / 3;
      for (const point of corners) positions.push(point.x, y, point.z);
      // Counter-clockwise when viewed from +Y, so the walkable normal points upward.
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
      tiles++;
    }
  }

  if (!indices.length) throw new Error('Recast NPC PoC produced no walkable triangles');
  return { positions, indices, tiles, tileSize, bounds: { ...navigator.bounds } };
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
  return { core, generators };
}

export async function createRecastNpcNavigator(baseNavigator, {
  loader = loadPinnedRecast,
  tileSize = 1.5,
  navMeshConfig = {}
} = {}) {
  const { core, generators } = await loader();
  if (typeof core?.init !== 'function' || typeof core?.NavMeshQuery !== 'function' ||
      typeof generators?.generateSoloNavMesh !== 'function') {
    throw new Error('Recast NPC PoC loader returned an incompatible API');
  }

  await core.init();

  const surface = buildFlatNavigationSurface(baseNavigator, { tileSize });
  const config = {
    cs: 0.5,
    ch: 0.2,
    walkableSlopeAngle: 45,
    walkableHeight: 8,
    walkableClimb: 2,
    walkableRadius: 1,
    maxEdgeLen: 12,
    maxSimplificationError: 1.3,
    minRegionArea: 2,
    mergeRegionArea: 8,
    maxVertsPerPoly: 6,
    detailSampleDist: 6,
    detailSampleMaxError: 1,
    ...navMeshConfig
  };

  const generated = generators.generateSoloNavMesh(surface.positions, surface.indices, config);
  if (!generated?.success || !generated.navMesh) {
    const detail = generated?.error ? `: ${generated.error}` : '';
    throw new Error(`Recast NPC PoC navmesh generation failed${detail}`);
  }

  const navMesh = generated.navMesh;
  const query = new core.NavMeshQuery(navMesh);

  function route(from, to) {
    if (!baseNavigator.walkable(from) || !baseNavigator.walkable(to)) return null;
    const result = query.computePath(point3(from), point3(to));
    if (!result?.success || !Array.isArray(result.path) || !result.path.length) return null;

    const points = result.path.map(point => ({ x: point.x, z: point.z }));
    while (points.length && distance2d(points[0], from) < 0.01) points.shift();
    if (!points.length || distance2d(points.at(-1), to) > 0.05) points.push({ ...to });
    return points;
  }

  function destroy() {
    try { query.destroy?.(); } catch {}
    try { navMesh.destroy?.(); } catch {}
  }

  return {
    ...baseNavigator,
    route,
    networkRoute: route,
    recast: Object.freeze({
      version: RECAST_NPC_POC_VERSION,
      packageVersion: '0.43.1',
      surfaceTiles: surface.tiles,
      triangleCount: surface.indices.length / 3,
      config: Object.freeze({ ...config })
    }),
    destroy
  };
}
