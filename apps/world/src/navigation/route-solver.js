// INHA WORLD M3 Route Solver.
// A* over a Navigation Graph with virtual start/goal nodes snapped onto the nearest edges.
// Pure and stateless per query so the same solver can later drive purposeful NPC movement.

export const ROUTE_MODE = Object.freeze({
  NETWORK: "NETWORK",
  DIRECT: "DIRECT"
});

export const ROUTE_DEFAULTS = Object.freeze({
  // Farther than this from any walkway, the solver stops pretending and walks straight.
  snapMaxDistance: 60,
  // Short hops are walked straight instead of detouring to the nearest walkway.
  directDistance: 10,
  // Collinear/duplicate points closer than this are merged out of the waypoint list.
  minPointSpacing: 0.35
});

const finitePoint = value => Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const point = ({ x, z }) => Object.freeze({ x, z });

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(item) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (items[parent].f <= items[i].f) break;
      [items[parent], items[i]] = [items[i], items[parent]];
      i = parent;
    }
  }
  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1, right = left + 1;
        let smallest = i;
        if (left < items.length && items[left].f < items[smallest].f) smallest = left;
        if (right < items.length && items[right].f < items[smallest].f) smallest = right;
        if (smallest === i) break;
        [items[smallest], items[i]] = [items[i], items[smallest]];
        i = smallest;
      }
    }
    return top;
  }
}

export function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += flat(points[i - 1], points[i]);
  return total;
}

function simplify(points, minSpacing) {
  const out = [];
  for (const p of points) {
    if (out.length && flat(out.at(-1), p) < minSpacing) continue;
    out.push(point(p));
  }
  // Always keep the true goal as the final waypoint.
  const goal = points.at(-1);
  if (out.length && flat(out.at(-1), goal) > 0) out[out.length - 1] = point(goal);
  return out;
}

export function createRouteSolver(graph, options = {}) {
  if (!graph?.nearestEdgePoint || !graph?.neighbors || !graph?.node) {
    throw new TypeError("Route solver requires a Navigation Graph");
  }
  const config = Object.freeze({ ...ROUTE_DEFAULTS, ...options });

  // Node-to-node A*. `extraStart` / `extraGoal` wire the virtual snap points into the graph.
  function search(startLinks, goalLinks, goalPoint) {
    const START = "__start__", GOAL = "__goal__";
    const goalCosts = new Map(goalLinks.map(link => [link.to, link.cost]));
    const heuristic = id => id === GOAL ? 0 : flat(graph.node(id), goalPoint);
    const best = new Map([[START, 0]]);
    const parent = new Map();
    const open = new MinHeap();
    open.push({ id: START, g: 0, f: 0 });
    const closed = new Set();

    while (open.size) {
      const current = open.pop();
      if (closed.has(current.id)) continue;
      if (current.id === GOAL) break;
      closed.add(current.id);
      const links = current.id === START ? startLinks : graph.neighbors(current.id);
      const expanded = current.id !== START && goalCosts.has(current.id)
        ? [...links, { to: GOAL, cost: goalCosts.get(current.id) }]
        : links;
      for (const link of expanded) {
        if (closed.has(link.to)) continue;
        const g = current.g + link.cost;
        if (g >= (best.get(link.to) ?? Infinity)) continue;
        best.set(link.to, g);
        parent.set(link.to, current.id);
        open.push({ id: link.to, g, f: g + heuristic(link.to) });
      }
    }
    if (!parent.has(GOAL)) return null;
    const ids = [];
    for (let id = parent.get(GOAL); id && id !== START; id = parent.get(id)) ids.push(id);
    return { nodeIds: ids.reverse(), cost: best.get(GOAL) };
  }

  function directRoute(from, to, reason) {
    const points = [point(from), point(to)];
    return Object.freeze({
      ok: true,
      mode: ROUTE_MODE.DIRECT,
      reason,
      points: Object.freeze(points),
      distance: flat(from, to),
      nodeIds: Object.freeze([])
    });
  }

  function solve(from, to) {
    if (!finitePoint(from) || !finitePoint(to)) throw new TypeError("Route endpoints must be finite");
    const straight = flat(from, to);
    if (straight <= config.directDistance) return directRoute(from, to, "SHORT");

    const startSnap = graph.nearestEdgePoint(from, { maxDistance: config.snapMaxDistance });
    const goalSnap = graph.nearestEdgePoint(to, { maxDistance: config.snapMaxDistance });
    if (!startSnap || !goalSnap) return directRoute(from, to, "OFF_NETWORK");

    let networkPoints;
    let nodeIds = [];
    if (startSnap.edgeId === goalSnap.edgeId) {
      networkPoints = [startSnap, goalSnap];
    } else {
      const edgeStart = graph.edge?.(startSnap.edgeId);
      const edgeGoal = graph.edge?.(goalSnap.edgeId);
      const lenStart = edgeStart?.length ?? flat(graph.node(startSnap.a), graph.node(startSnap.b));
      const lenGoal = edgeGoal?.length ?? flat(graph.node(goalSnap.a), graph.node(goalSnap.b));
      const startLinks = [
        { to: startSnap.a, cost: lenStart * startSnap.t },
        { to: startSnap.b, cost: lenStart * (1 - startSnap.t) }
      ];
      const goalLinks = [
        { to: goalSnap.a, cost: lenGoal * goalSnap.t },
        { to: goalSnap.b, cost: lenGoal * (1 - goalSnap.t) }
      ];
      const found = search(startLinks, goalLinks, goalSnap);
      if (!found) return directRoute(from, to, "DISCONNECTED");
      nodeIds = found.nodeIds;
      networkPoints = [startSnap, ...nodeIds.map(id => graph.node(id)), goalSnap];
    }

    const points = simplify([from, ...networkPoints, to], config.minPointSpacing);
    const distance = polylineLength(points);
    // A walkway detour that costs more than twice the straight line is worse guidance than a
    // straight bearing (open lawns and plazas are walkable too).
    if (distance > straight * 2.2 && straight <= config.snapMaxDistance) {
      return directRoute(from, to, "DETOUR");
    }
    return Object.freeze({
      ok: true,
      mode: ROUTE_MODE.NETWORK,
      reason: null,
      points: Object.freeze(points),
      distance,
      accessDistance: startSnap.distance,
      egressDistance: goalSnap.distance,
      nodeIds: Object.freeze(nodeIds)
    });
  }

  // Graph-only query for agents that already stand on nodes (future NPC purposeful movement).
  function findNodePath(fromNodeId, toNodeId) {
    const from = graph.node(fromNodeId), to = graph.node(toNodeId);
    if (!from || !to) return null;
    if (fromNodeId === toNodeId) return Object.freeze({ nodeIds: Object.freeze([fromNodeId]), distance: 0 });
    const found = search([{ to: fromNodeId, cost: 0 }], [{ to: toNodeId, cost: 0 }], to);
    return found ? Object.freeze({ nodeIds: Object.freeze(found.nodeIds), distance: found.cost }) : null;
  }

  return Object.freeze({ solve, findNodePath, config });
}
