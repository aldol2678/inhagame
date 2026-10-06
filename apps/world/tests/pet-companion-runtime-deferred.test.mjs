import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

test('pet companion runtime stays deferred from production wiring', () => {
  assert.doesNotMatch(main, /createDuckObservationClient|createDuckCompanionFollow/);
  assert.doesNotMatch(main, /duckCompanion(?:Follow)?\./);
  assert.match(main, /canObserveOrdinary: \(\) => inkyungSideEvent\.canObserveOrdinaryDuck\(\)/);
  assert.match(main, /getOrdinaryActionLabel: \(\) => "오리 관찰"/);
});
