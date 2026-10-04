import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WINTER_PERFORMANCE_BUDGET,
  winterBudgetForTier,
  winterPerformanceSnapshot
} from '../src/environment/winter-performance-budget.js';

test('P6K winter budgets scale by graphics tier', () => {
  assert.deepEqual(WINTER_PERFORMANCE_BUDGET.low, {
    drawMeshes: 8,
    trackedVertices: 6000,
    dynamicFootprintVertices: 108
  });
  assert.deepEqual(WINTER_PERFORMANCE_BUDGET.medium, {
    drawMeshes: 11,
    trackedVertices: 10000,
    dynamicFootprintVertices: 180
  });
  assert.deepEqual(WINTER_PERFORMANCE_BUDGET.high, {
    drawMeshes: 11,
    trackedVertices: 14000,
    dynamicFootprintVertices: 252
  });
  assert.equal(winterBudgetForTier('unknown'), WINTER_PERFORMANCE_BUDGET.medium);
});

test('aggregate winter snapshot sums active draw calls and tracked vertices', () => {
  const snapshot = winterPerformanceSnapshot({
    tier: 'medium',
    snow: {
      drawMeshes: 1,
      groundDrawMeshes: 2,
      footprintDrawMeshes: 1,
      flakeVertexCount: 576,
      groundLawnVertexCount: 180,
      groundRoadVertexCount: 220,
      footprintVertexCount: 90,
      footprintVertexBudget: 180
    },
    objects: { drawMeshes: 1, vertexCount: 700 },
    depth: {
      drawMeshes: 2,
      snowDrawMeshes: 1,
      plowDrawMeshes: 1,
      snowVertexCount: 520,
      plowVertexCount: 24
    },
    thaw: {
      drawMeshes: 2,
      slushDrawMeshes: 1,
      iceDrawMeshes: 1,
      slushVertexCount: 48,
      iceVertexCount: 66,
      externalTextures: 0
    },
    meltwater: {
      drawMeshes: 2,
      dripDrawMeshes: 1,
      runoffDrawMeshes: 1,
      dripVertexCount: 64,
      runoffVertexCount: 48,
      networkRequests: 0
    }
  });
  assert.equal(snapshot.drawMeshes, 11);
  assert.equal(snapshot.trackedVertices, 2536);
  assert.equal(snapshot.dynamicFootprintVertices, 180);
  assert.equal(snapshot.withinBudget, true);
  assert.deepEqual(snapshot.violations, []);
});

test('P6K flags budget and forbidden-resource regressions', () => {
  const snapshot = winterPerformanceSnapshot({
    tier: 'low',
    snow: {
      drawMeshes: 2,
      groundDrawMeshes: 2,
      footprintDrawMeshes: 1,
      footprintVertexBudget: 200,
      flakeVertexCount: 5000,
      groundLawnVertexCount: 2000
    },
    objects: { drawMeshes: 2, vertexCount: 1000, extraRealLights: 1 },
    depth: { drawMeshes: 2, extraShadowCasters: 1 },
    thaw: { drawMeshes: 1, externalTextures: 1 },
    meltwater: { drawMeshes: 1, networkRequests: 1 }
  });
  assert.equal(snapshot.withinBudget, false);
  assert.ok(snapshot.violations.some(item => item.startsWith('drawMeshes:')));
  assert.ok(snapshot.violations.some(item => item.startsWith('trackedVertices:')));
  assert.ok(snapshot.violations.some(item => item.startsWith('dynamicFootprintVertices:')));
  assert.ok(snapshot.violations.includes('realLights:1>0'));
  assert.ok(snapshot.violations.includes('shadowCasters:1>0'));
  assert.ok(snapshot.violations.includes('externalTextures:1>0'));
  assert.ok(snapshot.violations.includes('networkRequests:1>0'));
});

test('inactive static batches do not count toward active tracked vertices', () => {
  const snapshot = winterPerformanceSnapshot({
    tier: 'high',
    objects: { drawMeshes: 0, vertexCount: 9000 },
    depth: { snowDrawMeshes: 0, snowVertexCount: 5000 },
    thaw: { iceDrawMeshes: 0, iceVertexCount: 4000 },
    meltwater: { runoffDrawMeshes: 0, runoffVertexCount: 3000 }
  });
  assert.equal(snapshot.drawMeshes, 0);
  assert.equal(snapshot.trackedVertices, 0);
  assert.equal(snapshot.withinBudget, true);
});
