// INHA WORLD M3 Navigation Graph.
// Pure walkable node/edge graph. No DOM, PlayCanvas, INHA content or network imports.
// The serialized form ({ schema, nodes, edges }) is the contract a future World Editor can
// author or patch; buildNavGraph() only derives that same form from centerline polylines.

export const NAV_GRAPH_SCHEMA = "inha.nav-graph/1";

export const NAV_EDGE_KIND = Object.freeze({
  ROAD: "ROAD",
  PATH: "PATH",
  CONNECTOR: "CONNECTOR"
});

const finitePoint = value => Boolean(value) && Number.isFinite(value.x) && Number.isFinite(value.z);
const flat = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function projectOnSegment(point, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq <= 1e-12 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq));
  const x = a.x + dx * t, z = a.z + dz * t;
  return { t, x, z, distance: Math.hypot(point.x - x, point.z - z) };
}

// Derive the serialized graph from centerlines.
// - vertices closer than mergeTolerance collapse into one node (shared OSM nodes, touching ends)
// - a dangling polyline end within junctionTolerance of another segment is joined to it
//   (T-junctions between separately authored layers); the target segment is split there.
export function buildNavGraph({
  polylines = [],
  mergeTolerance = 0.05,
  junctionTolerance = 0,
  // Optional world check for junction connectors, e.g. "does not cross a building".
  canConnect = null
} = {}) {
  if (!Array.isArray(polylines)) throw new TypeError("Navigation polylines must be an array");
  if (!(mergeTolerance >= 0) || !(junctionTolerance >= 0)) throw new TypeError("Navigation tolerances must be non-negative");

  const nodes = [];
  const edges = [];
  const edgeIds = new Set();
  const cell = Math.max(mergeTolerance, 1e-6) * 4;
  const buckets = new Map();
  const bucketKey = (x, z) => `${Math.floor(x / cell)}:${Math.floor(z / cell)}`;

  function nodeAt(point) {
    const cx = Math.floor(point.x / cell), cz = Math.floor(point.z / cell);
    for (let ix = cx - 1; ix <= cx + 1; ix += 1) {
      for (let iz = cz - 1; iz <= cz + 1; iz += 1) {
        for (const index of buckets.get(`${ix}:${iz}`) ?? []) {
          if (flat(nodes[index], point) <= mergeTolerance) return nodes[index];
        }
      }
    }
    const node = { id: `n${nodes.length}`, x: point.x, z: point.z };
    const key = bucketKey(point.x, point.z);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(nodes.length);
    nodes.push(node);
    return node;
  }

  function addEdge(a, b, meta) {
    if (a.id === b.id) return null;
    const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
    if (edgeIds.has(pairKey)) return null;
    edgeIds.add(pairKey);
    const edge = { id: `e${edges.length}`, a: a.id, b: b.id, kind: meta.kind, source: meta.source, lineId: meta.lineId };
    edges.push(edge);
    return edge;
  }

  const ends = [];
  for (const line of polylines) {
    if (!line?.id || !Array.isArray(line.points) || line.points.length < 2) {
      throw new TypeError(`Invalid navigation polyline: ${line?.id ?? "unknown"}`);
    }
    const meta = {
      kind: Object.values(NAV_EDGE_KIND).includes(line.kind) ? line.kind : NAV_EDGE_KIND.PATH,
      source: String(line.source ?? "UNKNOWN"),
      lineId: line.id
    };
    let previous = null;
    for (const point of line.points) {
      if (!finitePoint(point)) throw new TypeError(`Invalid navigation point in ${line.id}`);
      const node = nodeAt(point);
      if (previous) addEdge(previous, node, meta);
      previous = node;
    }
    ends.push({ node: nodeAt(line.points[0]), lineId: line.id }, { node: nodeAt(line.points.at(-1)), lineId: line.id });
  }

  // A vertex lying on another line's segment interior (e.g. a lane crossing a spine between
  // its authored vertices) becomes a shared node by splitting that segment.
  {
    const byId = new Map(nodes.map(node => [node.id, node]));
    for (const node of nodes) {
      for (let i = 0; i < edges.length; i += 1) {
        const edge = edges[i];
        if (edge.a === node.id || edge.b === node.id) continue;
        const a = byId.get(edge.a), b = byId.get(edge.b);
        const hit = projectOnSegment(node, a, b);
        if (hit.distance > mergeTolerance || flat(node, a) <= mergeTolerance || flat(node, b) <= mergeTolerance) continue;
        const { kind, source, lineId } = edge;
        edges.splice(i, 1);
        edgeIds.delete(edge.a < edge.b ? `${edge.a}|${edge.b}` : `${edge.b}|${edge.a}`);
        addEdge(a, node, { kind, source, lineId });
        addEdge(node, b, { kind, source, lineId });
        i = -1;
      }
    }
  }

  if (junctionTolerance > 0) {
    const byId = new Map(nodes.map(node => [node.id, node]));
    const degree = new Map();
    for (const edge of edges) {
      degree.set(edge.a, (degree.get(edge.a) ?? 0) + 1);
      degree.set(edge.b, (degree.get(edge.b) ?? 0) + 1);
    }
    for (const end of ends) {
      if ((degree.get(end.node.id) ?? 0) !== 1) continue;
      let best = null;
      for (const edge of edges) {
        if (edge.lineId === end.lineId || edge.a === end.node.id || edge.b === end.node.id) continue;
        const hit = projectOnSegment(end.node, byId.get(edge.a), byId.get(edge.b));
        if (hit.distance > junctionTolerance || (best && hit.distance >= best.hit.distance)) continue;
        if (canConnect && hit.distance > mergeTolerance && !canConnect(end.node, hit)) continue;
        best = { edge, hit };
      }
      if (!best) continue;
      const a = byId.get(best.edge.a), b = byId.get(best.edge.b);
      let target;
      if (flat(best.hit, a) <= mergeTolerance) target = a;
      else if (flat(best.hit, b) <= mergeTolerance) target = b;
      else {
        // Split the target segment so the junction is a real node shared by both lines.
        target = nodeAt(best.hit);
        byId.set(target.id, target);
        const { kind, source, lineId } = best.edge;
        edges.splice(edges.indexOf(best.edge), 1);
        edgeIds.delete(best.edge.a < best.edge.b ? `${best.edge.a}|${best.edge.b}` : `${best.edge.b}|${best.edge.a}`);
        addEdge(a, target, { kind, source, lineId });
        addEdge(target, b, { kind, source, lineId });
      }
      if (target.id !== end.node.id) {
        addEdge(end.node, target, { kind: NAV_EDGE_KIND.CONNECTOR, source: "JUNCTION", lineId: `junction.${end.lineId}` });
        degree.set(end.node.id, 2);
      }
    }
  }

  // Re-number edges so the serialized form is stable after splits.
  return Object.freeze({
    schema: NAV_GRAPH_SCHEMA,
    nodes: nodes.map(node => Object.freeze({ ...node })),
    edges: edges.map((edge, index) => Object.freeze({ ...edge, id: `e${index}` }))
  });
}

// Keep only the largest connected component. Detached fragments cannot be routed to and would
// otherwise capture snaps; they return automatically once an editor/data pass connects them.
export function largestNavComponent(data) {
  const adjacency = new Map(data.nodes.map(node => [node.id, []]));
  for (const edge of data.edges) {
    adjacency.get(edge.a)?.push(edge.b);
    adjacency.get(edge.b)?.push(edge.a);
  }
  let best = new Set();
  const seen = new Set();
  for (const node of data.nodes) {
    if (seen.has(node.id)) continue;
    const group = new Set([node.id]);
    const stack = [node.id];
    seen.add(node.id);
    while (stack.length) {
      for (const next of adjacency.get(stack.pop())) {
        if (seen.has(next)) continue;
        seen.add(next);
        group.add(next);
        stack.push(next);
      }
    }
    if (group.size > best.size) best = group;
  }
  return Object.freeze({
    schema: data.schema,
    nodes: data.nodes.filter(node => best.has(node.id)),
    edges: data.edges.filter(edge => best.has(edge.a) && best.has(edge.b)),
    dropped: Object.freeze({
      nodes: data.nodes.length - best.size,
      lineIds: Object.freeze([...new Set(data.edges.filter(edge => !best.has(edge.a)).map(edge => edge.lineId))].sort())
    })
  });
}

// Load a serialized graph (derived or authored) into a queryable runtime graph.
export function createNavGraph(data, { cellSize = 24 } = {}) {
  if (data?.schema !== NAV_GRAPH_SCHEMA) throw new TypeError(`Unsupported navigation graph schema: ${data?.schema}`);
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new TypeError("Navigation graph requires nodes and edges");

  const nodes = new Map();
  for (const node of data.nodes) {
    if (!node?.id || !finitePoint(node)) throw new TypeError(`Invalid navigation node: ${node?.id}`);
    if (nodes.has(node.id)) throw new Error(`Duplicate navigation node: ${node.id}`);
    nodes.set(node.id, Object.freeze({ id: node.id, x: node.x, z: node.z }));
  }

  const edges = new Map();
  const adjacency = new Map([...nodes.keys()].map(id => [id, []]));
  for (const edge of data.edges) {
    if (!edge?.id || !nodes.has(edge.a) || !nodes.has(edge.b) || edge.a === edge.b) {
      throw new TypeError(`Invalid navigation edge: ${edge?.id}`);
    }
    if (edges.has(edge.id)) throw new Error(`Duplicate navigation edge: ${edge.id}`);
    const length = flat(nodes.get(edge.a), nodes.get(edge.b));
    const cost = Number.isFinite(edge.cost) && edge.cost > 0 ? edge.cost : length;
    const record = Object.freeze({ ...edge, length, cost });
    edges.set(edge.id, record);
    adjacency.get(edge.a).push(Object.freeze({ edgeId: edge.id, to: edge.b, cost }));
    adjacency.get(edge.b).push(Object.freeze({ edgeId: edge.id, to: edge.a, cost }));
  }

  // Uniform grid over edge bounding boxes keeps nearest-edge snapping cheap every frame.
  const grid = new Map();
  const cellOf = value => Math.floor(value / cellSize);
  for (const edge of edges.values()) {
    const a = nodes.get(edge.a), b = nodes.get(edge.b);
    for (let ix = cellOf(Math.min(a.x, b.x)); ix <= cellOf(Math.max(a.x, b.x)); ix += 1) {
      for (let iz = cellOf(Math.min(a.z, b.z)); iz <= cellOf(Math.max(a.z, b.z)); iz += 1) {
        const key = `${ix}:${iz}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(edge);
      }
    }
  }

  function nearestEdgePoint(point, { maxDistance = Infinity, filter = null } = {}) {
    if (!finitePoint(point)) throw new TypeError("Navigation snap point must be finite");
    let best = null;
    const consider = edge => {
      if (filter && !filter(edge)) return;
      const hit = projectOnSegment(point, nodes.get(edge.a), nodes.get(edge.b));
      if (hit.distance <= maxDistance && (!best || hit.distance < best.distance)) {
        best = { edgeId: edge.id, a: edge.a, b: edge.b, t: hit.t, x: hit.x, z: hit.z, distance: hit.distance };
      }
    };
    if (Number.isFinite(maxDistance)) {
      const seen = new Set();
      const reach = Math.ceil(maxDistance / cellSize);
      const cx = cellOf(point.x), cz = cellOf(point.z);
      for (let ix = cx - reach; ix <= cx + reach; ix += 1) {
        for (let iz = cz - reach; iz <= cz + reach; iz += 1) {
          for (const edge of grid.get(`${ix}:${iz}`) ?? []) {
            if (seen.has(edge.id)) continue;
            seen.add(edge.id);
            consider(edge);
          }
        }
      }
    } else {
      for (const edge of edges.values()) consider(edge);
    }
    return best ? Object.freeze(best) : null;
  }

  function components() {
    const seen = new Set();
    const groups = [];
    for (const id of nodes.keys()) {
      if (seen.has(id)) continue;
      const group = [];
      const stack = [id];
      seen.add(id);
      while (stack.length) {
        const current = stack.pop();
        group.push(current);
        for (const link of adjacency.get(current)) {
          if (seen.has(link.to)) continue;
          seen.add(link.to);
          stack.push(link.to);
        }
      }
      groups.push(group);
    }
    return groups.sort((a, b) => b.length - a.length);
  }

  return Object.freeze({
    schema: NAV_GRAPH_SCHEMA,
    node: id => nodes.get(id) ?? null,
    edge: id => edges.get(id) ?? null,
    nodes: () => [...nodes.values()],
    edges: () => [...edges.values()],
    neighbors: id => adjacency.get(id) ?? [],
    nearestEdgePoint,
    components,
    get nodeCount() { return nodes.size; },
    get edgeCount() { return edges.size; },
    toJSON: () => ({
      schema: NAV_GRAPH_SCHEMA,
      nodes: [...nodes.values()].map(node => ({ ...node })),
      edges: [...edges.values()].map(({ length, ...edge }) => ({ ...edge }))
    })
  });
}
