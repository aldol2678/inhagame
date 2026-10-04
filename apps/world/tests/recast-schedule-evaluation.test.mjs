import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateRecastSchedule } from '../npc-factory/recast-schedule-evaluation.mjs';

function evaluate({ count = 48, expansion = 'READY', roster = new Map(), fail = false } = {}) {
  return evaluateRecastSchedule({
    batch: { npcs: Array.from({ length: count }, () => ({})) }, expansion, roster,
    legacyNavigator: { route: (from, to) => [to] },
    recastNavigator: {
      evaluateRoute: (from, to) => fail ? { ok: false, route: null, reason: 'INCOMPLETE_PATH' }
        : { ok: true, route: [to], reason: 'RECAST' },
      recast: { surfaceTiles: 1, corridorQuads: 0, triangleCount: 2, packageVersion: '0.43.1' }
    }
  });
}
const member = {
  schedule: [{ destination: 'a' }, { destination: 'b' }],
  destinations: { a: { position: { x: 0, z: 0 } }, b: { position: { x: 1, z: 1 } } }
};

test('empty schedules and unavailable/partial populations cannot pass acceptance', () => {
  assert.equal(evaluate().verdict, 'FAIL');
  assert.equal(evaluate({ count: 20, roster: new Map([['a', member]]) }).verdict, 'FAIL');
  assert.equal(evaluate({ expansion: 'UNAVAILABLE', roster: new Map([['a', member]]) }).verdict, 'FAIL');
  assert.equal(evaluate({ roster: new Map([['a', member]]) }).verdict, 'PASS');
});

test('records every failure beyond the original 20-item cap with endpoint diagnostics', () => {
  const roster = new Map(Array.from({ length: 12 }, (_, i) => [String(i), member]));
  const result = evaluate({ roster, fail: true });
  assert.equal(result.eligibleLegs, 24);
  assert.equal(result.failures.length, 24);
  assert.equal(result.failures.at(-1).reason, 'INCOMPLETE_PATH');
  assert.deepEqual(result.failures.at(-1).toPosition, { x: 1, z: 1 });
  assert.equal(result.coverage, 0);
});

test('missing endpoints fail the gate instead of silently shrinking the denominator', () => {
  const result = evaluate({ roster: new Map([['a', { ...member, destinations: { a: member.destinations.a } }]]) });
  assert.equal(result.skippedMissingEndpoints, 2);
  assert.equal(result.verdict, 'FAIL');
});
