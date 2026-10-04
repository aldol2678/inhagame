import test from 'node:test';
import assert from 'node:assert/strict';
import { actualRecastLoader, evaluateCampus } from './evaluate.mjs';
import { createRecastNpcNavigator } from '../../npc-factory/recast-navigator-poc.mjs';

test('actual Recast WASM rejects unreachable destination across disconnected surfaces', async () => {
  const walkable = p => p.x >= 0 && p.x <= 27 && p.z >= 0 && p.z <= 9 && (p.x <= 9 || p.x >= 18);
  const segmentSafe = (a, b) => {
    const steps = Math.max(1, Math.ceil(Math.hypot(a.x - b.x, a.z - b.z) / 0.1));
    for (let i = 0; i <= steps; i++) if (!walkable({ x: a.x + (b.x - a.x) * i / steps,
      z: a.z + (b.z - a.z) * i / steps })) return false;
    return true;
  };
  const nav = await createRecastNpcNavigator({
    bounds: { minX: 0, maxX: 27, minZ: 0, maxZ: 9 }, walkable, segmentSafe
  }, { loader: actualRecastLoader });
  try {
    const result = nav.evaluateRoute({ x: 4.5, z: 4.5 }, { x: 22.5, z: 4.5 });
    assert.equal(result.ok, false);
    assert.equal(result.route, null);
    assert.equal(result.reason, 'INCOMPLETE_PATH');
  } finally { nav.destroy(); }
});

test('current 48-NPC schedules meet the actual-engine partial acceptance without unsafe routes', async t => {
  const result = await evaluateCampus();
  t.diagnostic(JSON.stringify({ ...result, failures: result.failures.map(f => ({ npc: f.npc, leg: f.leg, reason: f.reason })) }));
  assert.equal(result.population, 48);
  assert.equal(result.expansion, 'READY');
  assert.equal(result.eligibleLegs, 200);
  assert.equal(result.legacyRoutes, 200);
  assert.equal(result.unsafeReturnedRoutes, 0);
  assert.equal(result.incorrectEndpoints, 0);
  assert.ok(result.recastRoutes >= 190, `Coverage ${result.coverage}: ${JSON.stringify(result.failures)}`);
});
