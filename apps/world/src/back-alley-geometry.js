// Neutral public reconstruction from the existing gameplay collision envelopes.
// No historical street-view facade, shop identity, or private asset is used.
import { BACK_ALLEY_COLLIDERS } from './back-alley-layout.js';
import { buildPolygonMeshGeometry } from './reality-adapter.js';

export function fillBackAlleyBase(batch) {
  for (const collider of BACK_ALLEY_COLLIDERS) {
    const geometry = buildPolygonMeshGeometry(collider.polygon, {
      yBase: collider.minY, height: collider.maxY - collider.minY
    });
    for (let i = 0; i < geometry.indices.length; i += 3) {
      const points = geometry.indices.slice(i, i + 3).map(index => geometry.positions.slice(index * 3, index * 3 + 3));
      const roof = points.every(point => Math.abs(point[1] - collider.maxY) < 1e-8);
      batch.triangle(roof ? '#d9eeee' : '#598f91', ...points);
    }
  }
  return batch;
}
// The solid obstacle stays in persistent BASE. There is no duplicate LOD shell
// and no invented doorway suggesting that a currently solid collider is enterable.
export function fillBackAlleyNear(batch, ..._args) { return batch; }
export function fillBackAlleyDetail(batch, ..._args) { return batch; }
