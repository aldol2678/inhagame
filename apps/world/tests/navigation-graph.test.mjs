import test from "node:test";
import assert from "node:assert/strict";
import {
  NAV_EDGE_KIND,
  NAV_GRAPH_SCHEMA,
  buildNavGraph,
  createNavGraph,
  largestNavComponent
} from "../src/navigation/nav-graph.js";
import { ROUTE_MODE, createRouteSolver, polylineLength } from "../src/navigation/route-solver.js";

const line = (id, points, kind = NAV_EDGE_KIND.PATH) => ({ id, kind, source: "TEST", points: points.map(([x, z]) => ({ x, z })) });
const graphOf = (polylines, options = {}) => createNavGraph(buildNavGraph({ polylines, ...options }));

test("M3C graph merges shared vertices into walkable nodes and edges", () => {
  const graph = graphOf([
    line("a", [[0, 0], [10, 0], [20, 0]]),
    line("b", [[10, 0], [10, 10]])
  ]);
  assert.equal(graph.nodeCount, 4, "shared (10,0) is one node");
  assert.equal(graph.edgeCount, 3);
  assert.equal(graph.components().length, 1);
  const junction = graph.nodes().find(n => n.x === 10 && n.z === 0);
  assert.equal(graph.neighbors(junction.id).length, 3);
});

test("M3C a vertex on another segment interior splits that segment (crossing lanes)", () => {
  const graph = graphOf([
    line("spine", [[0, 0], [0, 40]]),
    line("lane", [[-10, 20], [0, 20], [10, 20]])
  ]);
  assert.equal(graph.components().length, 1, "lane midpoint on the spine joins the network");
  const crossing = graph.nodes().find(n => n.x === 0 && n.z === 20);
  assert.equal(graph.neighbors(crossing.id).length, 4);
});

test("M3C dangling ends join nearby walkways only within tolerance and when allowed", () => {
  const polylines = [line("main", [[0, 0], [40, 0]]), line("spur", [[20, 5], [20, 30]])];
  assert.equal(graphOf(polylines).components().length, 2, "no junction snapping by default");
  const joined = graphOf(polylines, { junctionTolerance: 6 });
  assert.equal(joined.components().length, 1);
  const connector = joined.edges().find(e => e.kind === NAV_EDGE_KIND.CONNECTOR);
  assert.ok(connector && Math.abs(connector.length - 5) < 1e-9, "connector is the 5-unit gap");
  assert.equal(graphOf(polylines, { junctionTolerance: 4 }).components().length, 2, "outside tolerance stays apart");
  const contexts = [];
  const vetoed = graphOf(polylines, {
    junctionTolerance: 6,
    canConnect: (_from, _to, context) => {
      contexts.push(context);
      return false;
    }
  });
  assert.equal(vetoed.components().length, 2, "a world veto (e.g. a wall) blocks the connector");
  assert.ok(contexts.some(context =>
    context.fromLineId === "spur" &&
    context.toLineId === "main" &&
    Math.abs(context.distance - 5) < 1e-9
  ), "junction veto receives source/target line ids and candidate distance");
});

test("M3C serialized graph round-trips and rejects foreign schemas", () => {
  const data = buildNavGraph({ polylines: [line("a", [[0, 0], [3, 4]])] });
  assert.equal(data.schema, NAV_GRAPH_SCHEMA);
  const graph = createNavGraph(data);
  const again = createNavGraph(JSON.parse(JSON.stringify(graph.toJSON())));
  assert.equal(again.nodeCount, graph.nodeCount);
  assert.equal(again.edges()[0].length, 5);
  assert.throws(() => createNavGraph({ ...data, schema: "other/1" }), /schema/);
  assert.throws(() => createNavGraph({ schema: NAV_GRAPH_SCHEMA, nodes: [{ id: "n0", x: 0, z: 0 }], edges: [{ id: "e0", a: "n0", b: "nX" }] }), /edge/);
});

test("M3C largest component pruning reports dropped authored lines", () => {
  const data = buildNavGraph({ polylines: [line("main", [[0, 0], [10, 0], [20, 0]]), line("island", [[100, 100], [105, 100]])] });
  const pruned = largestNavComponent(data);
  assert.equal(pruned.nodes.length, 3);
  assert.deepEqual(pruned.dropped.lineIds, ["island"]);
});

test("M3C nearest-edge snapping uses the spatial grid and honours maxDistance", () => {
  const graph = graphOf([line("a", [[0, 0], [100, 0]]), line("b", [[0, 50], [100, 50]])]);
  const hit = graph.nearestEdgePoint({ x: 30, z: 8 }, { maxDistance: 20 });
  assert.equal(hit.z, 0);
  assert.equal(hit.x, 30);
  assert.equal(hit.distance, 8);
  assert.equal(graph.nearestEdgePoint({ x: 30, z: 25 }, { maxDistance: 20 }), null);
});

// Two routes from west to east: a short south road and a long northern detour.
function ladder() {
  return graphOf([
    line("south", [[0, 0], [50, 0], [100, 0]]),
    line("west", [[0, 0], [0, 60]]),
    line("north", [[0, 60], [100, 60]]),
    line("east", [[100, 60], [100, 0]])
  ]);
}

test("M3C A* returns the shortest walkway route with waypoints", () => {
  const solver = createRouteSolver(ladder());
  const route = solver.solve({ x: -3, z: 2 }, { x: 103, z: 1 });
  assert.equal(route.mode, ROUTE_MODE.NETWORK);
  assert.ok(route.points.every(p => p.z < 5), "stays on the southern road");
  assert.ok(Math.abs(route.distance - polylineLength(route.points)) < 1e-9);
  assert.deepEqual(route.points.at(-1), { x: 103, z: 1 }, "ends at the true goal");
});

test("M3C A* picks the detour when the direct walkway is missing", () => {
  const graph = graphOf([
    line("west", [[0, 0], [0, 40]]),
    line("north", [[0, 40], [50, 40]]),
    line("east", [[50, 40], [50, 0]])
  ]);
  const route = createRouteSolver(graph).solve({ x: 0, z: 2 }, { x: 50, z: 2 });
  assert.equal(route.mode, ROUTE_MODE.DIRECT, "a 2.2x detour falls back to a straight bearing");
  const reachable = createRouteSolver(graph).solve({ x: 0, z: 20 }, { x: 50, z: 20 });
  assert.equal(reachable.mode, ROUTE_MODE.NETWORK);
  assert.ok(reachable.points.some(p => p.z === 40), "uses the northern walkway");
  const far = createRouteSolver(graph, { snapMaxDistance: 30 }).solve({ x: 0, z: 2 }, { x: 50, z: 2 });
  assert.equal(far.mode, ROUTE_MODE.NETWORK, "long trips keep the walkway even with a detour");
});

test("M3C short hops, off-network and disconnected targets use direct guidance", () => {
  const solver = createRouteSolver(ladder());
  assert.equal(solver.solve({ x: 10, z: 0 }, { x: 15, z: 0 }).reason, "SHORT");
  assert.equal(solver.solve({ x: 10, z: 0 }, { x: 400, z: 400 }).reason, "OFF_NETWORK");
  const split = createRouteSolver(graphOf([line("a", [[0, 0], [30, 0]]), line("b", [[0, 100], [30, 100]])]));
  assert.equal(split.solve({ x: 0, z: 1 }, { x: 30, z: 99 }).reason, "DISCONNECTED");
});

test("M3C same-edge routes and node paths for future NPC agents", () => {
  const graph = ladder();
  const solver = createRouteSolver(graph);
  const same = solver.solve({ x: 5, z: 1 }, { x: 45, z: 1 });
  assert.equal(same.mode, ROUTE_MODE.NETWORK);
  assert.equal(same.nodeIds.length, 0);
  const a = graph.nodes().find(n => n.x === 0 && n.z === 60);
  const b = graph.nodes().find(n => n.x === 100 && n.z === 0);
  const path = solver.findNodePath(a.id, b.id);
  assert.equal(path.nodeIds[0], a.id);
  assert.equal(path.nodeIds.at(-1), b.id);
  assert.equal(path.distance, 160);
});
