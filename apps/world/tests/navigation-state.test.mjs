import test from "node:test";
import assert from "node:assert/strict";
import { buildNavGraph, createNavGraph } from "../src/navigation/nav-graph.js";
import { createRouteSolver } from "../src/navigation/route-solver.js";
import {
  NAV_DESTINATION_SOURCE,
  NAV_STATUS,
  createNavigationState,
  formatGuidanceDistance,
  relativeBearing
} from "../src/navigation/navigation-state.js";

const line = (id, points) => ({ id, points: points.map(([x, z]) => ({ x, z })) });
// An L-shaped street: east along z=0, then north along x=100.
const graph = createNavGraph(buildNavGraph({ polylines: [
  line("east", [[0, 0], [50, 0], [100, 0]]),
  line("north", [[100, 0], [100, 50], [100, 100]])
] }));

function rig(options = {}) {
  const clock = { t: 0, now() { return this.t; } };
  const state = createNavigationState({ solver: createRouteSolver(graph), clock, ...options });
  const events = [];
  state.onChange((snapshot, event) => events.push({ event, status: snapshot.status }));
  return { clock, state, events };
}

const northTower = { id: "poi:tower", poiId: "poi.tower", title: "탑", x: 100, z: 100, mapSourceId: "campus" };

test("M3A destination set/change/cancel is independent navigation state", () => {
  const { state, events } = rig();
  assert.equal(state.getSnapshot().status, NAV_STATUS.IDLE);
  state.setDestination(northTower, { position: { x: 0, z: 0 }, spaceId: "campus" });
  let s = state.getSnapshot();
  assert.equal(s.status, NAV_STATUS.GUIDING);
  assert.equal(s.destination.title, "탑");
  assert.equal(s.destination.source, NAV_DESTINATION_SOURCE.POI);
  assert.equal(s.destination.mapSourceId, "campus");
  assert.equal(s.routeMode, "NETWORK");
  const firstVersion = s.routeVersion;

  state.setDestination({ id: "poi:mid", poiId: "poi.mid", title: "중간", x: 100, z: 40 }, { position: { x: 0, z: 0 }, spaceId: "campus" });
  s = state.getSnapshot();
  assert.equal(s.destination.title, "중간", "destination change replaces the target");
  assert.ok(s.routeVersion > firstVersion, "destination change recomputes the route");

  assert.equal(state.clearDestination(), true);
  assert.equal(state.getSnapshot().status, NAV_STATUS.IDLE);
  assert.equal(state.getSnapshot().destination, null);
  assert.equal(state.clearDestination(), false);
  assert.deepEqual(events.map(e => e.event), ["destination", "destination", "cancel"]);
});

test("M3B remaining distance and bearing update with movement and camera yaw", () => {
  const { state } = rig();
  state.setDestination(northTower, { position: { x: 0, z: 0 }, spaceId: "campus" });
  let s = state.update({ position: { x: 0, z: 0 }, yaw: 0, spaceId: "campus" });
  assert.ok(Math.abs(s.remainingDistance - 200) < 1e-6, "route distance along the L");
  assert.ok(Math.abs(s.guidanceBearing - Math.PI / 2) < 1e-6, "next waypoint is to the right (east) with north-up camera");
  s = state.update({ position: { x: 40, z: 0 }, yaw: -Math.PI / 2, spaceId: "campus" });
  assert.ok(Math.abs(s.remainingDistance - 160) < 1e-6, "distance shrinks as the player walks");
  assert.ok(Math.abs(s.guidanceBearing) < 1e-6, "camera turned east: waypoint is straight ahead");
  assert.ok(Number.isFinite(s.destinationBearing));
  assert.equal(formatGuidanceDistance(s.remainingDistance), "320m");
  assert.equal(formatGuidanceDistance(600), "1.2km");
  assert.equal(formatGuidanceDistance(2.2), "4m");
  assert.ok(Math.abs(relativeBearing({ x: 0, z: 0 }, { x: 0, z: -5 }, 0) - Math.PI) < 1e-9, "behind = ±π");
});

test("M3C waypoint progression is monotonic along the route", () => {
  const { state } = rig();
  state.setDestination(northTower, { position: { x: 0, z: 0 }, spaceId: "campus" });
  const indices = [];
  for (const position of [{ x: 0, z: 0 }, { x: 60, z: 0 }, { x: 99, z: 1 }, { x: 100, z: 20 }, { x: 100, z: 70 }]) {
    indices.push(state.update({ position, yaw: 0, spaceId: "campus" }).waypointIndex);
  }
  for (let i = 1; i < indices.length; i += 1) assert.ok(indices[i] >= indices[i - 1], `waypoint index never goes back: ${indices}`);
  assert.ok(indices.at(-1) > indices[0]);
  const s = state.getSnapshot();
  assert.equal(s.routePoints[0].x, 100, "remaining route starts at the player");
  assert.deepEqual(s.routePoints.at(-1), { x: 100, z: 100 });
  // Walking back toward the start does not rewind progress.
  assert.equal(state.update({ position: { x: 100, z: 60 }, yaw: 0, spaceId: "campus" }).waypointIndex, indices.at(-1));
});

test("M3C off-route recovery reroutes after grace and cooldown, never every frame", () => {
  const { clock, state, events } = rig();
  state.setDestination(northTower, { position: { x: 0, z: 0 }, spaceId: "campus" });
  const version = state.getSnapshot().routeVersion;
  clock.t = 2000;
  let s = state.update({ position: { x: 50, z: 30 }, yaw: 0, spaceId: "campus" });
  assert.equal(s.offRoute, true);
  assert.equal(s.routeVersion, version, "no reroute before the grace period");
  clock.t = 2500;
  s = state.update({ position: { x: 50, z: 30 }, yaw: 0, spaceId: "campus" });
  assert.equal(s.routeVersion, version, "still within grace");
  clock.t = 3000;
  s = state.update({ position: { x: 50, z: 30 }, yaw: 0, spaceId: "campus" });
  assert.equal(s.routeVersion, version + 1, "reroute once the player keeps off the route");
  assert.equal(s.rerouteCount, 1);
  assert.equal(events.at(-1).event, "reroute");
  clock.t = 3100;
  s = state.update({ position: { x: 20, z: 40 }, yaw: 0, spaceId: "campus" });
  clock.t = 3200;
  s = state.update({ position: { x: 20, z: 40 }, yaw: 0, spaceId: "campus" });
  assert.equal(s.routeVersion, version + 1, "cooldown prevents reroute storms");
});

test("M3D arrival ends guidance, gives feedback and auto-dismisses", () => {
  const { clock, state, events } = rig({ arrivedHoldMs: 1000 });
  state.setDestination({ ...northTower, arrivalRadius: 3 }, { position: { x: 0, z: 0 }, spaceId: "campus" });
  let s = state.update({ position: { x: 100, z: 98 }, yaw: 0, spaceId: "campus" });
  assert.equal(s.status, NAV_STATUS.ARRIVED);
  assert.equal(s.routePoints.length, 0, "route guidance stops on arrival");
  assert.equal(s.destination.title, "탑", "arrival feedback keeps the name");
  assert.equal(events.at(-1).event, "arrived");
  clock.t = 999;
  assert.equal(state.update({ position: { x: 100, z: 98 }, spaceId: "campus" }).status, NAV_STATUS.ARRIVED);
  clock.t = 1000;
  assert.equal(state.update({ position: { x: 100, z: 98 }, spaceId: "campus" }).status, NAV_STATUS.IDLE);
  // A new destination can be set straight after arriving.
  state.setDestination({ id: "poi:start", title: "출발", x: 0, z: 0 }, { position: { x: 100, z: 98 }, spaceId: "campus" });
  assert.equal(state.getSnapshot().status, NAV_STATUS.GUIDING);
});

test("M3D indoor pause keeps the campus destination and resumes with a fresh route", () => {
  const { state, events } = rig();
  state.setDestination(northTower, { position: { x: 0, z: 0 }, spaceId: "campus" });
  state.update({ position: { x: 30, z: 0 }, yaw: 0, spaceId: "campus" });
  const before = state.getSnapshot().routeVersion;
  // Inside a room the player position is room-local; it must never drive campus guidance.
  let s = state.update({ position: { x: 1, z: -2 }, yaw: 0, spaceId: "ROOM_CLUBHOUSE_01" });
  assert.equal(s.status, NAV_STATUS.PAUSED);
  assert.equal(s.destination.id, "poi:tower", "destination survives the room switch");
  assert.equal(s.routePoints.length, 0, "no campus route in room coordinates");
  s = state.update({ position: { x: 2, z: 1 }, yaw: 0, spaceId: "ROOM_DORM1_LOBBY" });
  assert.equal(s.status, NAV_STATUS.PAUSED, "nested rooms stay paused");
  s = state.update({ position: { x: 100, z: 10 }, yaw: 0, spaceId: "campus" });
  assert.equal(s.status, NAV_STATUS.GUIDING, "guidance resumes outdoors");
  assert.ok(s.routeVersion > before, "route recomputed from the return point");
  assert.equal(s.routePoints[0].z, 10);
  assert.ok(Math.abs(s.remainingDistance - 90) < 1e-6);
  assert.deepEqual(events.map(e => e.event).slice(-2), ["pause", "resume"]);
});

test("M3D setting a campus destination while indoors waits paused", () => {
  const { state } = rig();
  state.setDestination(northTower, { position: { x: 0, z: 0 }, spaceId: "ROOM_CLUBHOUSE_01" });
  assert.equal(state.getSnapshot().status, NAV_STATUS.PAUSED);
  assert.equal(state.update({ position: { x: 0, z: 0 }, spaceId: "campus" }).status, NAV_STATUS.GUIDING);
});

test("M3 guidance tolerates a failing solver with a direct fallback", () => {
  const state = createNavigationState({ solver: { solve() { throw new Error("boom"); } } });
  state.setDestination(northTower, { position: { x: 0, z: 0 }, spaceId: "campus" });
  const s = state.getSnapshot();
  assert.equal(s.status, NAV_STATUS.GUIDING);
  assert.equal(s.routeMode, "DIRECT");
  assert.equal(state.errors()[0].where, "solve");
});
