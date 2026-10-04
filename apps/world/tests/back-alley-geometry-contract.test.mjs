import test from 'node:test';
import assert from 'node:assert/strict';
import { fillBackAlleyBase, fillBackAlleyNear, fillBackAlleyDetail } from '../src/back-alley-geometry.js';

for (const fill of [fillBackAlleyBase, fillBackAlleyNear, fillBackAlleyDetail]) {
  test(`${fill.name} preserves batch identity and the caller's finish chain`, () => {
    const positions = [], indices = [];
    const batch = Object.freeze({ positions, indices,
      triangle(_color, ...points) { const start = this.positions.length / 3; this.positions.push(...points.flat()); this.indices.push(start, start + 1, start + 2); },
      finish(root, name) { return { root, name, positions: this.positions, indices: this.indices }; }
    });
    const root = {};
    const result = fill(batch, Object.freeze(['unused-public-geometry-id']));
    assert.equal(result, batch);
    assert.equal(result.positions, positions);
    assert.equal(result.indices, indices);
    const finished = result.finish(root, 'back_alley');
    assert.deepEqual(finished, { root, name: 'back_alley', positions, indices });
    assert.equal(positions.length > 0, fill === fillBackAlleyBase, 'only persistent BASE adds solid geometry');
  });
}
