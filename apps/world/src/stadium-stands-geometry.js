// Neutral public reconstruction of existing gameplay heights and collider bounds.
// Campus terrain owns the depressed floor; this module owns only steps and walls.
import { FacilityMeshBatch } from './facility-mesh-batch.js';
import { buildPolygonMeshGeometry } from './reality-adapter.js';
import {
  SPORTS_FLOOR, SPORTS_COLLIDERS, SPORTS_SIDE_ENTRIES, STANDS,
  standHeight, sideEntryHeight
} from './stadium-stands-layout.js';

function slab(batch, polygon, top, color) {
  if (top <= SPORTS_FLOOR) return; // The persistent terrain already owns this floor.
  const geometry = buildPolygonMeshGeometry(polygon, { yBase: SPORTS_FLOOR, height: top - SPORTS_FLOOR });
  for (let i = 0; i < geometry.indices.length; i += 3) {
    batch.triangle(color, ...geometry.indices.slice(i, i + 3).map(index => geometry.positions.slice(index * 3, index * 3 + 3)));
  }
}
const rectangle = (frame, u0, u1, v0, v1) => [[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v]) => frame.at(u,v));

export function fillStadiumStands(batch) {
  // Split at the exact aisle edges before stepping. The existing height owner
  // uses 12 small risers in aisles and 4 broad rows everywhere else.
  const cuts = [...new Set([0, STANDS.frame.length, ...STANDS.aisles.flatMap(u => [u - STANDS.aisleWidth / 2, u + STANDS.aisleWidth / 2])]
    .map(u => Math.max(0, Math.min(STANDS.frame.length, u))))].sort((a,b) => a-b);
  for (let index = 1; index < cuts.length; index++) {
    const u0 = cuts[index - 1], u1 = cuts[index], middle = (u0 + u1) / 2;
    const aisle = STANDS.aisles.some(u => Math.abs(middle - u) <= STANDS.aisleWidth / 2);
    const steps = aisle ? STANDS.aisleSteps : STANDS.rows;
    for (let step = 0; step < steps; step++) {
      const v0 = step * STANDS.run / steps, v1 = (step + 1) * STANDS.run / steps;
      slab(batch, rectangle(STANDS.frame, u0, u1, v0, v1), standHeight((v0 + v1) / 2, steps), aisle ? '#c9c5b8' : '#a9b0a3');
    }
  }
  for (const entry of SPORTS_SIDE_ENTRIES) {
    for (let step = 0; step < entry.steps; step++) {
      const v0 = step * entry.run / entry.steps, v1 = (step + 1) * entry.run / entry.steps;
      slab(batch, rectangle(entry.frame, entry.u - entry.width / 2, entry.u + entry.width / 2, -v1, -v0),
        sideEntryHeight(entry, (v0 + v1) / 2), '#c9c5b8');
    }
  }
  for (const collider of SPORTS_COLLIDERS) slab(batch, collider.polygon, collider.maxY, '#8a9389');
  return batch;
}

export function buildStadiumStands(root) {
  fillStadiumStands(new FacilityMeshBatch()).finish(root, 'stadium_stands');
}
