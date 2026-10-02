// Local C04 navigation grid. Routes avoid the pond and the World player's ground colliders.
import { getCanonicalLandmark, projectPolygon } from '../src/reality-adapter.js';
import { polygonOverlap } from '../src/polygon-collision.js';
import { OBSTACLES } from '../src/campus-layout.js';
import { campusNavGraph } from '../src/navigation/campus-navigation.js';
import { createRouteSolver } from '../src/navigation/route-solver.js';
import { PERIODS, snapshotForPeriod } from './dev-runtime-state.mjs';

const pond = projectPolygon(getCanonicalLandmark('lmk_inkyung_pond').polygon);
const clearance = .6;
const cellSize = 1.5;
const pointDistance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const campusGraph = campusNavGraph();
const campusRouteSolver = createRouteSolver(campusGraph, { directDistance: 0, snapMaxDistance: 2 });
const campusSnap = point => campusGraph.nearestEdgePoint(point, { maxDistance: .4 });
const campusNetworkRoute = (from, to) => {
  if (!campusSnap(from) || !campusSnap(to)) return null;
  const solved = campusRouteSolver.solve(from, to);
  if (!solved?.ok || solved.mode !== 'NETWORK') return null;
  return solved.points.slice(1).map(({ x, z }) => ({ x, z }));
};

export function advanceRoute(position, waypoints, distanceLimit) {
  let current = { ...position }, heading = 0, moved = 0;
  while (waypoints.length && distanceLimit > 0) {
    const waypoint = waypoints[0], dx = waypoint.x - current.x, dz = waypoint.z - current.z;
    const distance = Math.hypot(dx, dz);
    if (distance < .01) { waypoints.shift(); continue; }
    const step = Math.min(distance, distanceLimit);
    current = { x: current.x + dx / distance * step, z: current.z + dz / distance * step };
    heading = Math.atan2(dx, dz) * 180 / Math.PI;
    moved += step;
    distanceLimit -= step;
    if (step >= distance - .001) { current = { ...waypoint }; waypoints.shift(); }
  }
  return { position: current, heading, moved };
}

function boundsOf(ring) {
  return { minX: Math.min(...ring.map(p => p.x)), maxX: Math.max(...ring.map(p => p.x)),
    minZ: Math.min(...ring.map(p => p.z)), maxZ: Math.max(...ring.map(p => p.z)) };
}
function obstacleRecord(box) {
  const bounds = box.polygon ? boundsOf(box.polygon) : box;
  return { ...box, ...bounds };
}

export function createNpcNavigator(batch, { additionalAnchors = [] } = {}) {
  const anchors = [
    ...(batch ? PERIODS.flatMap(period => snapshotForPeriod(batch, period).actors.map(a => a.position).filter(Boolean)) : []),
    ...additionalAnchors
  ];
  if (!anchors.length) throw new Error('NPC navigation needs at least one anchor');
  const bounds = {
    minX: Math.floor((Math.min(...anchors.map(p => p.x)) - 15) / cellSize) * cellSize,
    maxX: Math.ceil((Math.max(...anchors.map(p => p.x)) + 15) / cellSize) * cellSize,
    minZ: Math.floor((Math.min(...anchors.map(p => p.z)) - 15) / cellSize) * cellSize,
    maxZ: Math.ceil((Math.max(...anchors.map(p => p.z)) + 15) / cellSize) * cellSize
  };
  const width = Math.round((bounds.maxX - bounds.minX) / cellSize) + 1;
  const height = Math.round((bounds.maxZ - bounds.minZ) / cellSize) + 1;
  const obstacles = OBSTACLES.filter(box => box.minY < 2.5 && box.maxY > 0)
    .map(obstacleRecord).filter(box => box.maxX >= bounds.minX && box.minX <= bounds.maxX &&
      box.maxZ >= bounds.minZ && box.minZ <= bounds.maxZ);
  const pondBounds = boundsOf(pond);
  function walkable(point) {
    const { x, z } = point;
    if (!Number.isFinite(x) || !Number.isFinite(z) || x < bounds.minX || x > bounds.maxX ||
        z < bounds.minZ || z > bounds.maxZ) return false;
    if (x >= pondBounds.minX - clearance && x <= pondBounds.maxX + clearance &&
        z >= pondBounds.minZ - clearance && z <= pondBounds.maxZ + clearance &&
        polygonOverlap(x, z, pond, clearance)) return false;
    const legacyBlocked = obstacles.some(box => x >= box.minX - clearance && x <= box.maxX + clearance &&
      z >= box.minZ - clearance && z <= box.maxZ + clearance &&
      (box.polygon ? polygonOverlap(x, z, box.polygon, clearance) : true));
    // Campus-wide P2-A anchors are snapped to the canonical World navigation graph. A path can
    // legitimately run closer than the old C04-only 0.6 m clearance to a building edge, so the
    // canonical walk network is allowed to override only that legacy-clearance rejection.
    return !legacyBlocked || Boolean(campusSnap(point));
  }
  function segmentSafe(from, to) {
    const steps = Math.max(1, Math.ceil(pointDistance(from, to) / .45));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!walkable({ x: from.x + (to.x - from.x) * t, z: from.z + (to.z - from.z) * t })) return false;
    }
    return true;
  }
  const cellPoint = index => ({ x: bounds.minX + (index % width) * cellSize,
    z: bounds.minZ + Math.floor(index / width) * cellSize });
  const openCells = Uint8Array.from({ length: width * height }, (_, index) => Number(walkable(cellPoint(index))));
  function nearestCell(point) {
    const centerX = Math.round((point.x - bounds.minX) / cellSize);
    const centerZ = Math.round((point.z - bounds.minZ) / cellSize);
    let best = -1, bestDistance = Infinity;
    for (let radius = 0; radius <= 4; radius++) {
      for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
        const x = centerX + dx, z = centerZ + dz;
        if (x < 0 || x >= width || z < 0 || z >= height) continue;
        const index = z * width + x, candidate = cellPoint(index), distance = pointDistance(point, candidate);
        if (openCells[index] && distance < bestDistance && segmentSafe(point, candidate)) {
          best = index; bestDistance = distance;
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
    if (start < 0 || goal < 0) return campusNetworkRoute(from, to);
    const score = new Float64Array(openCells.length).fill(Infinity);
    const previous = new Int32Array(openCells.length).fill(-1);
    const closed = new Uint8Array(openCells.length);
    const queue = [];
    const push = (index, priority) => {
      let at = queue.push({ index, priority }) - 1;
      while (at > 0) {
        const parent = Math.floor((at - 1) / 2);
        if (queue[parent].priority <= priority) break;
        queue[at] = queue[parent]; at = parent;
      }
      queue[at] = { index, priority };
    };
    const pop = () => {
      const first = queue[0], last = queue.pop();
      if (queue.length) {
        let at = 0;
        while (at * 2 + 1 < queue.length) {
          let child = at * 2 + 1;
          if (child + 1 < queue.length && queue[child + 1].priority < queue[child].priority) child++;
          if (queue[child].priority >= last.priority) break;
          queue[at] = queue[child]; at = child;
        }
        queue[at] = last;
      }
      return first.index;
    };
    score[start] = 0;
    push(start, pointDistance(cellPoint(start), cellPoint(goal)));
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
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
        if (!openCells[next] || closed[next]) continue;
        if (dx && dz && (!openCells[z * width + nx] || !openCells[nz * width + x])) continue;
        if (!segmentSafe(cellPoint(current), cellPoint(next))) continue;
        const candidate = score[current] + cellSize * (dx && dz ? Math.SQRT2 : 1);
        if (candidate >= score[next]) continue;
        score[next] = candidate;
        previous[next] = current;
        push(next, candidate + pointDistance(cellPoint(next), cellPoint(goal)));
      }
    }
    if (start !== goal && previous[goal] < 0) return campusNetworkRoute(from, to);
    const cells = [];
    for (let at = goal; at >= 0; at = previous[at]) {
      cells.push(cellPoint(at));
      if (at === start) break;
    }
    cells.reverse();
    const raw = [from, ...cells, to], result = [];
    for (let at = 0; at < raw.length - 1;) {
      let next = raw.length - 1;
      while (next > at + 1 && !segmentSafe(raw[at], raw[next])) next--;
      result.push(raw[next]); at = next;
    }
    return result;
  }
  function wanderRoute(from, anchor, id, leg, maxRadius = 12) {
    const number = Number(id.slice(-3));
    for (let attempt = 0; attempt < 12; attempt++) {
      const angle = (number * 2.41 + leg * 2.17 + attempt * .73) % (Math.PI * 2);
      const radius = 4 + ((number + leg * 3 + attempt * 5) % 7) / 7 * (maxRadius - 4);
      const goal = { x: anchor.x + Math.cos(angle) * radius, z: anchor.z + Math.sin(angle) * radius };
      if (!walkable(goal) || pointDistance(from, goal) < 3) continue;
      const planned = route(from, goal);
      if (planned) return planned;
    }
    return route(from, anchor);
  }
  return { walkable, segmentSafe, route, wanderRoute, bounds };
}
