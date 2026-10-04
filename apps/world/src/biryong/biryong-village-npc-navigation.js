// Region-local navigator for the eight Biryong Village P0 NPCs.
// It deliberately knows only the current blockout bounds/colliders; no Campus graph fallback.
import { polygonOverlap } from "../polygon-collision.js";
import { BIRYONG_REALM_P0_BOUNDS, BIRYONG_REALM_P0_OBSTACLES } from "./biryong-village-layout.js";

const CELL = 1.5;
const CLEARANCE = 0.55;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

const obstacleBounds = BIRYONG_REALM_P0_OBSTACLES.map(obstacle => ({
  obstacle,
  minX: Math.min(...obstacle.polygon.map(p => p.x)),
  maxX: Math.max(...obstacle.polygon.map(p => p.x)),
  minZ: Math.min(...obstacle.polygon.map(p => p.z)),
  maxZ: Math.max(...obstacle.polygon.map(p => p.z))
}));

export function createBiryongVillageNpcNavigator({ bounds = BIRYONG_REALM_P0_BOUNDS } = {}) {
  const grid = Object.freeze({
    minX: Math.floor(bounds.minX / CELL) * CELL,
    maxX: Math.ceil(bounds.maxX / CELL) * CELL,
    minZ: Math.floor(bounds.minZ / CELL) * CELL,
    maxZ: Math.ceil(bounds.maxZ / CELL) * CELL
  });
  const width = Math.round((grid.maxX - grid.minX) / CELL) + 1;
  const height = Math.round((grid.maxZ - grid.minZ) / CELL) + 1;
  const pointFor = index => ({
    x: grid.minX + (index % width) * CELL,
    z: grid.minZ + Math.floor(index / width) * CELL
  });

  function walkable(point) {
    if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.z)) return false;
    if (point.x < bounds.minX || point.x > bounds.maxX || point.z < bounds.minZ || point.z > bounds.maxZ) return false;
    return !obstacleBounds.some(({ obstacle, minX, maxX, minZ, maxZ }) =>
      point.x >= minX - CLEARANCE && point.x <= maxX + CLEARANCE &&
      point.z >= minZ - CLEARANCE && point.z <= maxZ + CLEARANCE &&
      polygonOverlap(point.x, point.z, obstacle.polygon, CLEARANCE)
    );
  }

  function segmentSafe(from, to) {
    const steps = Math.max(1, Math.ceil(distance(from, to) / 0.4));
    for (let i = 0; i <= steps; i += 1) {
      const t = i / steps;
      if (!walkable({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t })) return false;
    }
    return true;
  }

  const open = Uint8Array.from({ length: width * height }, (_, index) => Number(walkable(pointFor(index))));

  function nearestCell(point) {
    const cx = Math.round((point.x - grid.minX) / CELL);
    const cz = Math.round((point.z - grid.minZ) / CELL);
    let best = -1, bestDistance = Infinity;
    for (let radius = 0; radius <= 5; radius += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) for (let dx = -radius; dx <= radius; dx += 1) {
        const x = cx + dx, z = cz + dz;
        if (x < 0 || x >= width || z < 0 || z >= height) continue;
        const index = z * width + x;
        if (!open[index]) continue;
        const candidate = pointFor(index);
        const d = distance(point, candidate);
        if (d < bestDistance && segmentSafe(point, candidate)) {
          best = index;
          bestDistance = d;
        }
      }
      if (best >= 0) break;
    }
    return best;
  }

  function route(from, to) {
    if (!walkable(from) || !walkable(to)) return null;
    if (segmentSafe(from, to)) return [{ ...to }];

    const start = nearestCell(from), goal = nearestCell(to);
    if (start < 0 || goal < 0) return null;
    const score = new Float64Array(open.length).fill(Infinity);
    const previous = new Int32Array(open.length).fill(-1);
    const closed = new Uint8Array(open.length);
    const queue = [];

    const push = (index, priority) => {
      let at = queue.push({ index, priority }) - 1;
      while (at > 0) {
        const parent = Math.floor((at - 1) / 2);
        if (queue[parent].priority <= priority) break;
        queue[at] = queue[parent];
        at = parent;
      }
      queue[at] = { index, priority };
    };
    const pop = () => {
      const first = queue[0], last = queue.pop();
      if (queue.length) {
        let at = 0;
        while (at * 2 + 1 < queue.length) {
          let child = at * 2 + 1;
          if (child + 1 < queue.length && queue[child + 1].priority < queue[child].priority) child += 1;
          if (queue[child].priority >= last.priority) break;
          queue[at] = queue[child];
          at = child;
        }
        queue[at] = last;
      }
      return first.index;
    };

    score[start] = 0;
    push(start, distance(pointFor(start), pointFor(goal)));
    const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
    while (queue.length) {
      const current = pop();
      if (closed[current]) continue;
      if (current === goal) break;
      closed[current] = 1;
      const x = current % width, z = Math.floor(current / width);
      for (const [dx, dz] of directions) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nx >= width || nz < 0 || nz >= height) continue;
        const next = nz * width + nx;
        if (!open[next] || closed[next]) continue;
        if (dx && dz && (!open[z * width + nx] || !open[nz * width + x])) continue;
        if (!segmentSafe(pointFor(current), pointFor(next))) continue;
        const nextScore = score[current] + CELL * (dx && dz ? Math.SQRT2 : 1);
        if (nextScore >= score[next]) continue;
        score[next] = nextScore;
        previous[next] = current;
        push(next, nextScore + distance(pointFor(next), pointFor(goal)));
      }
    }
    if (start !== goal && previous[goal] < 0) return null;

    const cells = [];
    for (let at = goal; at >= 0; at = previous[at]) {
      cells.push(pointFor(at));
      if (at === start) break;
    }
    cells.reverse();

    const raw = [from, ...cells, to], result = [];
    for (let at = 0; at < raw.length - 1;) {
      let next = raw.length - 1;
      while (next > at + 1 && !segmentSafe(raw[at], raw[next])) next -= 1;
      result.push({ ...raw[next] });
      at = next;
    }
    return result;
  }

  return Object.freeze({ walkable, segmentSafe, route, bounds });
}
