const clampNonNegative = value =>
  Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);

export const WINTER_PERFORMANCE_BUDGET = Object.freeze({
  low: Object.freeze({
    drawMeshes: 8,
    trackedVertices: 6000,
    dynamicFootprintVertices: 108
  }),
  medium: Object.freeze({
    drawMeshes: 11,
    trackedVertices: 10000,
    dynamicFootprintVertices: 180
  }),
  high: Object.freeze({
    drawMeshes: 11,
    trackedVertices: 14000,
    dynamicFootprintVertices: 252
  })
});

export function winterBudgetForTier(tier) {
  return WINTER_PERFORMANCE_BUDGET[tier] ?? WINTER_PERFORMANCE_BUDGET.medium;
}

const value = (object, key) => clampNonNegative(object?.[key]);

function enabledVertices(draws, vertices) {
  return value({ draws }, 'draws') > 0 ? value({ vertices }, 'vertices') : 0;
}

export function winterPerformanceSnapshot({
  tier = 'medium',
  snow = {},
  objects = {},
  depth = {},
  thaw = {},
  meltwater = {}
} = {}) {
  const resolvedTier = Object.hasOwn(WINTER_PERFORMANCE_BUDGET, tier) ? tier : 'medium';
  const budget = winterBudgetForTier(resolvedTier);

  const draws = Object.freeze({
    snowfall: value(snow, 'drawMeshes'),
    ground: value(snow, 'groundDrawMeshes'),
    footprints: value(snow, 'footprintDrawMeshes'),
    objects: value(objects, 'drawMeshes'),
    depth: value(depth, 'drawMeshes'),
    thaw: value(thaw, 'drawMeshes'),
    meltwater: value(meltwater, 'drawMeshes')
  });
  const drawMeshes = Object.values(draws).reduce((sum, count) => sum + count, 0);

  const vertices = Object.freeze({
    snowfall: value(snow, 'flakeVertexCount'),
    ground: value(snow, 'groundLawnVertexCount') + value(snow, 'groundRoadVertexCount'),
    footprints: value(snow, 'footprintVertexCount'),
    objects: enabledVertices(objects.drawMeshes, objects.vertexCount),
    depth:
      enabledVertices(depth.snowDrawMeshes, depth.snowVertexCount) +
      enabledVertices(depth.plowDrawMeshes, depth.plowVertexCount),
    thaw:
      enabledVertices(thaw.slushDrawMeshes, thaw.slushVertexCount) +
      enabledVertices(thaw.iceDrawMeshes, thaw.iceVertexCount),
    meltwater:
      enabledVertices(meltwater.dripDrawMeshes, meltwater.dripVertexCount) +
      enabledVertices(meltwater.runoffDrawMeshes, meltwater.runoffVertexCount)
  });
  const trackedVertices = Object.values(vertices).reduce((sum, count) => sum + count, 0);
  const dynamicFootprintVertices = value(snow, 'footprintVertexBudget');

  const resources = Object.freeze({
    realLights:
      value(snow, 'extraRealLights') +
      value(objects, 'extraRealLights') +
      value(depth, 'extraRealLights') +
      value(thaw, 'extraRealLights') +
      value(meltwater, 'extraRealLights'),
    shadowCasters:
      value(objects, 'extraShadowCasters') +
      value(depth, 'extraShadowCasters') +
      value(thaw, 'extraShadowCasters') +
      value(meltwater, 'extraShadowCasters'),
    externalTextures:
      value(thaw, 'externalTextures') +
      value(meltwater, 'externalTextures'),
    networkRequests:
      value(meltwater, 'networkRequests')
  });

  const violations = [];
  if (drawMeshes > budget.drawMeshes)
    violations.push(`drawMeshes:${drawMeshes}>${budget.drawMeshes}`);
  if (trackedVertices > budget.trackedVertices)
    violations.push(`trackedVertices:${trackedVertices}>${budget.trackedVertices}`);
  if (dynamicFootprintVertices > budget.dynamicFootprintVertices)
    violations.push(
      `dynamicFootprintVertices:${dynamicFootprintVertices}>${budget.dynamicFootprintVertices}`
    );
  for (const [name, count] of Object.entries(resources)) {
    if (count > 0) violations.push(`${name}:${count}>0`);
  }

  return Object.freeze({
    graphicsTier: resolvedTier,
    budget,
    draws,
    drawMeshes,
    vertices,
    trackedVertices,
    dynamicFootprintVertices,
    resources,
    withinBudget: violations.length === 0,
    violations: Object.freeze(violations)
  });
}
