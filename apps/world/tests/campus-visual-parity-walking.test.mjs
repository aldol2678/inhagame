import test from 'node:test';
import assert from 'node:assert/strict';
import { PlayerController } from '../src/player-controller.js';
import { BACK_ALLEY_BLOCKS } from '../src/back-alley-layout.js';
import { GARDEN_FLOOR } from '../src/library-garden-layout.js';
import { SPORTS_FLOOR } from '../src/stadium-stands-layout.js';

// Only the DOM and entity storage are fakes. The production PlayerController,
// campus obstacles, collision sweep and ground-height functions run unchanged.
function fixture() {
  const saved = Object.fromEntries(['window', 'document', 'HTMLElement'].map(k => [k, globalThis[k]]));
  globalThis.window = { addEventListener() {} };
  globalThis.document = { body: { dataset: {} }, getElementById() { return null; } };
  globalThis.HTMLElement = class {};
  let position = { x: 0, y: 1.15, z: -98 }, rotation = { x: 0, y: 17, z: 0 };
  const player = {
    getLocalPosition: () => ({ ...position }),
    setLocalPosition(x, y, z) { position = { x, y, z }; },
    getLocalEulerAngles: () => ({ ...rotation }),
    setLocalEulerAngles(x, y, z) { rotation = { x, y, z }; }
  };
  const controller = new PlayerController(player);
  return { player, controller, close() {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  } };
}

test('walking QA exports a browser-safe helper rather than a replacement locomotion model', async () => {
  const module = await import('./browser/campus-visual-parity-walking.mjs').catch(() => ({}));
  assert.equal(typeof module.runWalking, 'function', 'missing actual-controller walking QA helper');
});

test('real controller walks all restored entrances both ways and cannot enter the 35 alley shells', async () => {
  const { runWalking } = await import('./browser/campus-visual-parity-walking.mjs');
  const d = fixture();
  try {
    const result = await runWalking(d);
    assert.equal(result.inputMode, 'deterministic-controller-touch-vector');
    assert.equal(result.dt, 1 / 60);
    assert.equal(result.cases.filter(c => c.area === 'garden').length, 8);
    assert.equal(result.cases.filter(c => c.area === 'stadium').length, 10);
    assert.equal(result.cases.filter(c => c.type === 'barrier').length, BACK_ALLEY_BLOCKS.length);
    assert.equal(result.cases.filter(c => c.type === 'clear-alley-route').length, 2);
    assert.ok(result.totalTicks > 0);
    for (const c of result.cases) {
      assert.ok(c.trace.length > 1, `${c.id}: real actor trace`);
      assert.ok(c.ticks > 0, `${c.id}: actual update ticks`);
      assert.ok(c.maxFootError < 1e-6, `${c.id}: feet follow the existing height function`);
      if (c.area === 'garden' || c.area === 'stadium') {
        const floor = c.area === 'garden' ? GARDEN_FLOOR : SPORTS_FLOOR;
        const first = c.trace[0].footY, last = c.trace.at(-1).footY;
        assert.ok(Math.abs(first - (c.direction === 'in' ? 0 : floor)) < 1e-6, `${c.id}: actual starting foot elevation`);
        assert.ok(Math.abs(last - (c.direction === 'in' ? floor : 0)) < 1e-6, `${c.id}: actual destination foot elevation`);
        assert.ok(c.trace.some(p => p.footY < -.05 && p.footY > floor + .05), `${c.id}: actor really transits intermediate step/ramp elevations`);
      }
      if (c.type === 'barrier') assert.equal(c.blockedBy, c.id.replace(/:wall$/, ''), `${c.id}: intended visible collider actually stops the actor`);
    }
    assert.equal(result.passed, true, JSON.stringify(result.cases.filter(c => !c.passed), null, 2));
  } finally { d.close(); }
});

test('walking QA restores position, orientation and pre-existing controller inputs', async () => {
  const { runWalking } = await import('./browser/campus-visual-parity-walking.mjs');
  const d = fixture();
  try {
    const position = d.player.getLocalPosition(), rotation = d.player.getLocalEulerAngles();
    const keys = d.controller.keys, touch = d.controller.touchVector;
    keys.add('KeyA'); touch.x = .2; touch.y = .3;
    d.controller.inputEnabled = false;
    d.controller.jumpQueued = true;
    d.controller.velocityY = 2;
    d.controller.assist = { x: 0, z: 1, sprint: true };
    const before = { keys: [...keys], touch: { ...touch }, assist: d.controller.assist };
    await runWalking(d);
    assert.deepEqual(d.player.getLocalPosition(), position);
    assert.deepEqual(d.player.getLocalEulerAngles(), rotation);
    assert.equal(d.controller.keys, keys);
    assert.equal(d.controller.touchVector, touch);
    assert.deepEqual([...keys], before.keys);
    assert.deepEqual(touch, before.touch);
    assert.equal(d.controller.assist, before.assist);
    assert.equal(d.controller.inputEnabled, false);
    assert.equal(d.controller.jumpQueued, true);
    assert.equal(d.controller.velocityY, 2);
  } finally { d.close(); }
});
