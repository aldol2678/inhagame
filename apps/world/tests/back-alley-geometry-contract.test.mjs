import test from 'node:test';
import assert from 'node:assert/strict';
import { fillBackAlleyBase, fillBackAlleyNear, fillBackAlleyDetail } from '../src/back-alley-geometry.js';

for (const fill of [fillBackAlleyBase, fillBackAlleyNear, fillBackAlleyDetail]) {
  test(`${fill.name} preserves empty-batch identity and the caller's finish chain`, () => {
    const positions = Object.freeze([]), indices = Object.freeze([]);
    const batch = Object.freeze({ positions, indices,
      finish(root, name) { return { root, name, positions: this.positions, indices: this.indices }; }
    });
    const root = {};
    const result = fill(batch, Object.freeze(['unused-public-geometry-id']));
    assert.equal(result, batch);
    assert.equal(result.positions, positions);
    assert.equal(result.indices, indices);
    assert.deepEqual(result.finish(root, 'back_alley'), { root, name: 'back_alley', positions: [], indices: [] });
  });
}
